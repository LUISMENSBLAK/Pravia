import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { hashVerificationToken, moneyDecimal, renderPaymentRequestPdf, renderPraviaReceiptPdf, validateIncomeAllocation } from '../domain/expedienteFinance';
import { deleteFile, downloadFile, getSignedUrl, uploadFile } from '../storage/storage.service';
import { extraerFinanzasDesdeDocumento, getOpenAIModelName } from './openaiDocument.service';
import { recordAIFailure, recordAIUsage } from './aiUsage.service';
import { FinancialMovementService } from './financialMovement.service';
import {
  closePaymentRequestTiming,
  closeReceiptApplicationTiming,
  openPaymentRequestTiming,
  openReceiptApplicationTiming,
} from './timingPolicy.service';

export type ExpedienteFinanceActor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
type Upload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max);
const safeName = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100);
const checksum = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export class ExpedienteFinanceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const include = {
  ingresosReportados: { orderBy: { created_at: 'desc' as const }, include: { documentos: { where: { estatus: 'ACTIVO' as const, documento: { estatus: 'VIGENTE' as const } }, include: { documento: true } }, propuestasIA: { orderBy: { created_at: 'desc' as const } }, movimiento: { include: { comprobanteInterno: true } }, reportadoPor: { select: { id: true, nombre: true, apellido: true } }, aplicadoPor: { select: { id: true, nombre: true, apellido: true } } } },
  solicitudesPago: { orderBy: { created_at: 'desc' as const }, include: { documentos: { where: { estatus: 'ACTIVO' as const, documento: { estatus: 'VIGENTE' as const } }, include: { documento: true } }, propuestasIA: { orderBy: { created_at: 'desc' as const } }, movimiento: { include: { comprobanteInterno: true } }, creadoPor: { select: { id: true, nombre: true, apellido: true } }, pagadoPor: { select: { id: true, nombre: true, apellido: true } } } },
  presupuesto: { select: { subtotal_honorarios: true, subtotal_impuestos_derechos: true, total: true, version: true } },
} as const;

export class ExpedienteFinanceService {
  private readonly ledger: FinancialMovementService;
  constructor(private readonly prisma: PrismaClient) { this.ledger = new FinancialMovementService(prisma); }

  async read(actor: ExpedienteFinanceActor, expedienteId: string) {
    const expediente = await this.assertExpediente(this.prisma, actor, expedienteId);
    const data = await this.prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId }, select: include });
    const [accounts, categories] = this.canApply(actor) ? await Promise.all([
      this.prisma.cuentaFinanciera.findMany({ where: { organization_id: actor.organizationId, activa: true }, select: { id: true, institucion: true, alias: true, ultimos_cuatro: true, moneda: true }, orderBy: [{ predeterminada: 'desc' }, { alias: 'asc' }] }),
      this.prisma.categoriaFinanciera.findMany({ where: { organization_id: actor.organizationId, activa: true }, select: { id: true, clave: true, nombre: true, direccion: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
    ]) : [[], []];
    return { expediente: { id: expediente.id, numero_pravia: expediente.numero_pravia }, ...data, catalogs: { accounts, categories }, capabilities: this.capabilities(actor) };
  }

  async reportIncome(actor: ExpedienteFinanceActor, expedienteId: string, input: any, file: Upload) {
    this.requireOperationalWrite(actor);
    const key = this.idempotency(input.idempotency_key);
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const existing = await this.prisma.expedienteIngresoReportado.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key }, include: { documentos: { include: { documento: true } } } });
    if (existing) return { item: existing, idempotent: true };
    const stored = await this.storeUpload(actor, expedienteId, file, 'comprobantes-ingreso');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `income-report:${actor.organizationId}:${expedienteId}:${key}`);
        const concurrent = await tx.expedienteIngresoReportado.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key }, include: { documentos: { include: { documento: true } } } });
        if (concurrent) return { item: concurrent, idempotent: true };
        await this.assertExpediente(tx, actor, expedienteId);
        const report = await tx.expedienteIngresoReportado.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, concepto_contexto: clean(input.concepto_contexto, 500) || null, referencia_solicitud: clean(input.referencia_solicitud, 180) || null, monto_reportado: input.monto_reportado ? moneyDecimal(input.monto_reportado, 'Monto reportado') : null, reportado_por_id: actor.id, idempotency_key: key } });
        await openReceiptApplicationTiming(tx, actor.organizationId, { sourceId: report.id, openedAt: report.created_at });
        const document = await this.createDocument(tx, actor, expedienteId, stored, 'EXP008_COMPROBANTE_INGRESO', { source: 'EXP-008', role: 'COMPROBANTE_INGRESO', auto_applied: false });
        await this.linkDocument(tx, actor, expedienteId, document.id, 'COMPROBANTE_INGRESO', key, { ingreso_reportado_id: report.id });
        await this.record(tx, actor, expedienteId, 'EXP008_REPORT_INCOME', report.id, 'Comprobante reportado', 'Se reportó un comprobante; permanece pendiente de aplicación.', { documento_id: document.id, auto_applied: false });
        return { item: await tx.expedienteIngresoReportado.findUniqueOrThrow({ where: { id: report.id }, include: { documentos: { include: { documento: true } } } }), idempotent: false };
      });
      if (result.idempotent) await deleteFile(stored.storageKey).catch(() => undefined);
      return result;
    } catch (error) { await deleteFile(stored.storageKey).catch(() => undefined); throw error; }
  }

  async createInternalRequest(actor: ExpedienteFinanceActor, expedienteId: string, input: any) {
    this.requireOperationalWrite(actor);
    const key = this.idempotency(input.idempotency_key);
    const amount = moneyDecimal(input.importe, 'Importe');
    const concept = clean(input.concepto, 500);
    if (!concept) throw new ExpedienteFinanceError(400, 'EXP008_CONCEPT_REQUIRED', 'Indica el concepto de la solicitud.');
    const expediente = await this.assertExpediente(this.prisma, actor, expedienteId);
    const existing = await this.prisma.expedienteSolicitudPago.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key }, include: { documentos: { include: { documento: true } } } });
    if (existing) return { item: existing, idempotent: true };
    const format = await this.resolveFormat(actor.organizationId, 'solicitud');
    const buffer = renderPaymentRequestPdf({ folio: expediente.numero_pravia, concept, amount: amount.toFixed(2), beneficiary: clean(input.beneficiario, 300) || null, dependency: clean(input.dependencia, 300) || null, reference: clean(input.referencia, 180) || null, createdAt: new Date().toLocaleDateString('es-MX'), formatSource: format.source });
    const fileName = `Solicitud_pago_${safeName(expediente.numero_pravia)}_${new Date().toISOString().slice(0, 10)}.pdf`;
    const stored = await this.storeBuffer(actor, expedienteId, buffer, fileName, 'application/pdf', 'solicitudes-pago');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `request-create:${actor.organizationId}:${expedienteId}:${key}`);
        const concurrent = await tx.expedienteSolicitudPago.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key }, include: { documentos: { include: { documento: true } } } });
        if (concurrent) return { item: concurrent, idempotent: true };
        await this.assertExpediente(tx, actor, expedienteId);
        const request = await tx.expedienteSolicitudPago.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, via: 'INTERNA', concepto: concept, importe: amount, dependencia: clean(input.dependencia, 300) || null, beneficiario: clean(input.beneficiario, 300) || null, referencia: clean(input.referencia, 180) || null, fecha_limite: input.fecha_limite ? new Date(input.fecha_limite) : null, notas: clean(input.notas, 2_000) || null, formato_version_id: format.id, formato_fuente: format.source, creado_por_id: actor.id, idempotency_key: key } });
        await openPaymentRequestTiming(tx, actor.organizationId, { sourceId: request.id, openedAt: request.created_at });
        const document = await this.createDocument(tx, actor, expedienteId, stored, 'EXP008_SOLICITUD_GENERADA', { source: 'EXP-008', role: 'SOLICITUD_GENERADA', format_source: format.source, format_version_id: format.id });
        await this.linkDocument(tx, actor, expedienteId, document.id, 'SOLICITUD_GENERADA', key, { solicitud_pago_id: request.id });
        await this.record(tx, actor, expedienteId, 'EXP008_CREATE_PAYMENT_REQUEST', request.id, 'Solicitud de pago creada', `Se creó una solicitud por ${amount.toFixed(2)} MXN.`, { via: 'INTERNA', documento_id: document.id, format_source: format.source });
        return { item: await tx.expedienteSolicitudPago.findUniqueOrThrow({ where: { id: request.id }, include: { documentos: { include: { documento: true } } } }), idempotent: false };
      });
      if (result.idempotent) await deleteFile(stored.storageKey).catch(() => undefined);
      return result;
    } catch (error) { await deleteFile(stored.storageKey).catch(() => undefined); throw error; }
  }

  async createExternalRequest(actor: ExpedienteFinanceActor, expedienteId: string, input: any, file: Upload) {
    this.requireOperationalWrite(actor);
    const key = this.idempotency(input.idempotency_key);
    const amount = moneyDecimal(input.importe, 'Importe');
    const concept = clean(input.concepto, 500);
    if (!concept) throw new ExpedienteFinanceError(400, 'EXP008_CONCEPT_REQUIRED', 'Indica el concepto de la solicitud.');
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const existing = await this.prisma.expedienteSolicitudPago.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key }, include: { documentos: { include: { documento: true } } } });
    if (existing) return { item: existing, idempotent: true };
    const stored = await this.storeUpload(actor, expedienteId, file, 'solicitudes-pago');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `request-create:${actor.organizationId}:${expedienteId}:${key}`);
        const concurrent = await tx.expedienteSolicitudPago.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key }, include: { documentos: { include: { documento: true } } } });
        if (concurrent) return { item: concurrent, idempotent: true };
        await this.assertExpediente(tx, actor, expedienteId);
        const request = await tx.expedienteSolicitudPago.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, via: 'DOCUMENTO_EXTERNO', concepto: concept, importe: amount, dependencia: clean(input.dependencia, 300) || null, beneficiario: clean(input.beneficiario, 300) || null, referencia: clean(input.referencia, 180) || null, fecha_limite: input.fecha_limite ? new Date(input.fecha_limite) : null, notas: clean(input.notas, 2_000) || null, creado_por_id: actor.id, idempotency_key: key } });
        await openPaymentRequestTiming(tx, actor.organizationId, { sourceId: request.id, openedAt: request.created_at });
        const document = await this.createDocument(tx, actor, expedienteId, stored, 'EXP008_SOLICITUD_ORIGEN', { source: 'EXP-008', role: 'SOLICITUD_ORIGEN' });
        await this.linkDocument(tx, actor, expedienteId, document.id, 'SOLICITUD_ORIGEN', key, { solicitud_pago_id: request.id });
        await this.record(tx, actor, expedienteId, 'EXP008_CREATE_PAYMENT_REQUEST', request.id, 'Solicitud de pago creada', `Se creó una solicitud por ${amount.toFixed(2)} MXN.`, { via: 'DOCUMENTO_EXTERNO', documento_id: document.id });
        return { item: await tx.expedienteSolicitudPago.findUniqueOrThrow({ where: { id: request.id }, include: { documentos: { include: { documento: true } } } }), idempotent: false };
      });
      if (result.idempotent) await deleteFile(stored.storageKey).catch(() => undefined);
      return result;
    } catch (error) { await deleteFile(stored.storageKey).catch(() => undefined); throw error; }
  }

  async proposeFromDocument(actor: ExpedienteFinanceActor, expedienteId: string, input: { documento_id: string; ingreso_reportado_id?: string; solicitud_pago_id?: string; operation_id: string }) {
    if (!this.canApply(actor) || !actor.permissions.includes('ia.execute')) throw new ExpedienteFinanceError(403, 'EXP008_AI_DENIED', 'No tienes permiso para analizar esta evidencia.');
    await this.assertExpediente(this.prisma, actor, expedienteId);
    if (Boolean(input.ingreso_reportado_id) === Boolean(input.solicitud_pago_id)) throw new ExpedienteFinanceError(400, 'EXP008_AI_TARGET_INVALID', 'Selecciona exactamente un registro para analizar.');
    const operationId = this.idempotency(input.operation_id);
    const existing = await this.prisma.expedienteFinanzaPropuestaIA.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, operation_id: operationId } });
    if (existing) return { item: existing, idempotent: true };
    const link = await this.prisma.expedienteFinanzaDocumento.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: input.documento_id, estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' }, ...(input.ingreso_reportado_id ? { ingreso_reportado_id: input.ingreso_reportado_id } : { solicitud_pago_id: input.solicitud_pago_id }) }, include: { documento: true } });
    if (!link) throw new ExpedienteFinanceError(403, 'EXP008_AI_SOURCE_DENIED', 'El documento no está autorizado para este registro financiero.');
    const started = Date.now();
    try {
      const buffer = await downloadFile(link.documento.storage_key);
      const extraction = await extraerFinanzasDesdeDocumento({ buffer, mimeType: link.documento.mime_type, tipoDocumento: link.tipo, documentoId: link.documento_id, nombreOriginal: link.documento.nombre_original });
      const fields = Object.fromEntries(extraction.campos.map((field) => [field.campo, field.valor]));
      const proposalResult = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `ai-proposal:${actor.organizationId}:${operationId}`);
        const concurrent = await tx.expedienteFinanzaPropuestaIA.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, operation_id: operationId } });
        if (concurrent) return { item: concurrent, idempotent: true };
        const created = await tx.expedienteFinanzaPropuestaIA.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: link.documento_id, ingreso_reportado_id: input.ingreso_reportado_id || null, solicitud_pago_id: input.solicitud_pago_id || null, estado: extraction.conflictos.length ? 'CONFLICTO' : 'PENDIENTE', propuesta: json(fields), provenance: json(extraction.campos.map((field) => ({ campo: field.campo, documento_id: link.documento_id, documento: link.documento.nombre_original, pagina: field.pagina, fragmento: field.fragmento, confianza: field.confianza }))), conflictos: extraction.conflictos.length ? json(extraction.conflictos) : Prisma.JsonNull, faltantes: extraction.faltantes.length ? json(extraction.faltantes) : Prisma.JsonNull, modelo: extraction.modelo, operation_id: operationId } });
        await this.record(tx, actor, expedienteId, 'EXP008_PROPOSE_FINANCIAL_FIELDS_AI', created.id, 'Propuesta documental preparada', 'La IA propuso datos; no se aplicó ningún movimiento.', { documento_id: link.documento_id, persisted_finance: false, conflicts: extraction.conflictos.length });
        return { item: created, idempotent: false };
      });
      await recordAIUsage(extraction.uso, { organizationId: actor.organizationId, usuarioId: actor.id, expedienteId, operacion: 'EXP008_FINANCIAL_DOCUMENT_EXTRACTION', operationId, metadata: { documento_id: link.documento_id, proposal_id: proposalResult.item.id, target: input.ingreso_reportado_id ? 'INGRESO' : 'SOLICITUD', silent_write: false } });
      return proposalResult;
    } catch (error) {
      await recordAIFailure({ organizationId: actor.organizationId, usuarioId: actor.id, expedienteId, operacion: 'EXP008_FINANCIAL_DOCUMENT_EXTRACTION', operationId, modelo: getOpenAIModelName(), durationMs: Date.now() - started, errorCode: 'EXP008_AI_FAILED', metadata: { documento_id: link.documento_id } }).catch(() => undefined);
      throw new ExpedienteFinanceError(502, 'EXP008_AI_FAILED', 'No pudimos analizar el documento. Los datos permanecen sin cambios.');
    }
  }

  async validateProposal(actor: ExpedienteFinanceActor, expedienteId: string, proposalId: string, input: any) {
    if (!this.canApply(actor)) throw new ExpedienteFinanceError(403, 'EXP008_ADMIN_REVIEW_DENIED', 'No tienes permiso para validar propuestas financieras.');
    const decision = input.decision === 'ACCEPT' ? 'ACCEPT' : input.decision === 'REJECT' ? 'REJECT' : null;
    if (!decision) throw new ExpedienteFinanceError(400, 'EXP008_PROPOSAL_DECISION_INVALID', 'Selecciona aceptar o rechazar la propuesta.');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `proposal:${actor.organizationId}:${proposalId}`);
      await this.assertExpediente(tx, actor, expedienteId);
      const proposal = await tx.expedienteFinanzaPropuestaIA.findFirst({ where: { id: proposalId, organization_id: actor.organizationId, expediente_id: expedienteId } });
      if (!proposal) throw new ExpedienteFinanceError(404, 'EXP008_PROPOSAL_NOT_FOUND', 'La propuesta no está disponible.');
      if (proposal.estado === 'VALIDADA') return { item: proposal, idempotent: true };
      if (proposal.estado === 'RECHAZADA') throw new ExpedienteFinanceError(409, 'EXP008_PROPOSAL_REJECTED', 'La propuesta fue rechazada.');
      const accepted = decision === 'ACCEPT' && input.accepted_fields && typeof input.accepted_fields === 'object' ? input.accepted_fields : {};
      if (decision === 'ACCEPT' && proposal.ingreso_reportado_id) await tx.expedienteIngresoReportado.update({ where: { id: proposal.ingreso_reportado_id }, data: { monto_reportado: accepted.monto ? moneyDecimal(accepted.monto, 'Monto') : undefined, fecha_ingreso: accepted.fecha ? new Date(accepted.fecha) : undefined, forma_pago: accepted.forma_pago ? clean(accepted.forma_pago, 100) : undefined, referencia: accepted.referencia ? clean(accepted.referencia, 180) : undefined, concepto_contexto: accepted.concepto ? clean(accepted.concepto, 500) : undefined, version: { increment: 1 } } });
      if (decision === 'ACCEPT' && proposal.solicitud_pago_id) await tx.expedienteSolicitudPago.update({ where: { id: proposal.solicitud_pago_id }, data: { importe: accepted.monto ? moneyDecimal(accepted.monto, 'Importe') : undefined, concepto: accepted.concepto ? clean(accepted.concepto, 500) : undefined, beneficiario: accepted.beneficiario ? clean(accepted.beneficiario, 300) : undefined, dependencia: accepted.dependencia ? clean(accepted.dependencia, 300) : undefined, referencia: accepted.referencia ? clean(accepted.referencia, 180) : undefined, version: { increment: 1 } } });
      const item = await tx.expedienteFinanzaPropuestaIA.update({ where: { id: proposal.id }, data: { estado: decision === 'REJECT' ? 'RECHAZADA' : 'VALIDADA', revisado_por_id: actor.id, revisado_at: new Date() } });
      await this.record(tx, actor, expedienteId, 'EXP008_REVIEW_AI_PROPOSAL', item.id, 'Propuesta documental revisada', decision === 'REJECT' ? 'La propuesta fue rechazada.' : 'Los campos elegidos fueron confirmados por una persona.', { decision, accepted_fields: Object.keys(accepted), auto_applied: false });
      return { item, idempotent: false };
    });
  }

  async applyIncome(actor: ExpedienteFinanceActor, expedienteId: string, incomeId: string, input: any) {
    if (!this.canApply(actor)) throw new ExpedienteFinanceError(403, 'EXP008_APPLY_DENIED', 'Sólo Administración autorizada puede aplicar ingresos.');
    const allocation = validateIncomeAllocation(input.monto_validado, input.honorarios, input.impuestos_derechos);
    const key = this.idempotency(input.idempotency_key);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `income-apply:${actor.organizationId}:${incomeId}`);
      await this.assertExpediente(tx, actor, expedienteId);
      const report = await tx.expedienteIngresoReportado.findFirst({ where: { id: incomeId, organization_id: actor.organizationId, expediente_id: expedienteId }, include: { documentos: { where: { estatus: 'ACTIVO', tipo: 'COMPROBANTE_INGRESO' } } } });
      if (!report) throw new ExpedienteFinanceError(404, 'EXP008_INCOME_NOT_FOUND', 'El comprobante reportado no está disponible.');
      if (report.estado === 'APLICADO' && report.movimiento_id) return { item: report, idempotent: true };
      if (report.estado !== 'PENDIENTE_APLICACION') throw new ExpedienteFinanceError(409, 'EXP008_INCOME_STATE_INVALID', 'El comprobante ya no puede aplicarse.');
      if (!report.documentos.length) throw new ExpedienteFinanceError(409, 'EXP008_INCOME_EVIDENCE_REQUIRED', 'El comprobante reportado debe conservar evidencia activa.');
      const categories = await tx.categoriaFinanciera.findMany({ where: { organization_id: actor.organizationId, clave: { in: ['HONORARIOS', 'IMPUESTOS'] }, activa: true } });
      const byKey = new Map(categories.map((category) => [category.clave, category]));
      if ((allocation.honorarios.gt(0) && !byKey.get('HONORARIOS')) || (allocation.impuestosDerechos.gt(0) && !byKey.get('IMPUESTOS'))) throw new ExpedienteFinanceError(409, 'EXP008_CANONICAL_CATEGORIES_MISSING', 'Configura las categorías canónicas Honorarios e Impuestos antes de aplicar.');
      const result = await this.ledger.applyOperationalMovementInTransaction(tx, { organizationId: actor.organizationId, expedienteId, actorId: actor.id, correlationId: randomUUID(), nature: 'INGRESO', amount: allocation.total, concept: clean(input.concepto, 500) || report.concepto_contexto || 'Ingreso reportado en expediente', accountId: clean(input.cuenta_id, 36), paymentMethod: clean(input.forma_pago, 100) || report.forma_pago, reference: clean(input.referencia, 180) || report.referencia, idempotencyKey: `EXP008:INGRESO:${incomeId}:${key}`, allocations: [ ...(allocation.honorarios.gt(0) ? [{ categoryId: byKey.get('HONORARIOS')!.id, amount: allocation.honorarios, note: 'Aplicación general: Honorarios' }] : []), ...(allocation.impuestosDerechos.gt(0) ? [{ categoryId: byKey.get('IMPUESTOS')!.id, amount: allocation.impuestosDerechos, note: 'Aplicación general: Impuestos y derechos' }] : []) ] });
      const appliedAt = new Date();
      const updated = await tx.expedienteIngresoReportado.update({ where: { id: report.id }, data: { estado: 'APLICADO', monto_validado: allocation.total, honorarios_aplicados: allocation.honorarios, impuestos_derechos_aplicados: allocation.impuestosDerechos, fecha_ingreso: input.fecha_ingreso ? new Date(input.fecha_ingreso) : report.fecha_ingreso || appliedAt, forma_pago: clean(input.forma_pago, 100) || report.forma_pago, referencia: clean(input.referencia, 180) || report.referencia, cuenta_id: input.cuenta_id, movimiento_id: result.movement.id, aplicado_por_id: actor.id, aplicado_at: appliedAt, version: { increment: 1 } } });
      await closeReceiptApplicationTiming(tx, actor.organizationId, report.id, appliedAt);
      await tx.movimientoDocumento.createMany({ data: report.documentos.map((link) => ({ organization_id: actor.organizationId, movimiento_id: result.movement.id, documento_id: link.documento_id, tipo_vinculo: 'COMPROBANTE_PAGO', creado_por_id: actor.id })), skipDuplicates: true });
      await this.record(tx, actor, expedienteId, 'EXP008_APPLY_REPORTED_INCOME', report.id, 'Comprobante aplicado', `Se aplicó un ingreso por ${allocation.total.toFixed(2)} MXN.`, { movimiento_id: result.movement.id, honorarios: allocation.honorarios.toFixed(2), impuestos_derechos: allocation.impuestosDerechos.toFixed(2), idempotency_key: key });
      return { item: updated, movement: result.movement, idempotent: result.idempotent };
    }, { timeout: 20_000 });
  }

  async payRequest(actor: ExpedienteFinanceActor, expedienteId: string, requestId: string, input: any, files: { payment?: Upload; fiscal?: Upload }) {
    if (!this.canApply(actor)) throw new ExpedienteFinanceError(403, 'EXP008_PAY_DENIED', 'Sólo Administración autorizada puede registrar el pago.');
    const key = this.idempotency(input.idempotency_key);
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const existing = await this.prisma.expedienteSolicitudPago.findFirst({ where: { id: requestId, organization_id: actor.organizationId, expediente_id: expedienteId } });
    if (!existing) throw new ExpedienteFinanceError(404, 'EXP008_REQUEST_NOT_FOUND', 'La solicitud no está disponible.');
    if (existing.estado === 'PAGADA' && existing.movimiento_id) return { item: existing, idempotent: true };
    const uploads: Array<{ stored: Awaited<ReturnType<ExpedienteFinanceService['storeUpload']>>; type: 'COMPROBANTE_PAGO' | 'COMPROBANTE_FISCAL' }> = [];
    if (files.payment) uploads.push({ stored: await this.storeUpload(actor, expedienteId, files.payment, 'comprobantes-pago'), type: 'COMPROBANTE_PAGO' });
    if (files.fiscal) uploads.push({ stored: await this.storeUpload(actor, expedienteId, files.fiscal, 'comprobantes-fiscales'), type: 'COMPROBANTE_FISCAL' });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `request-pay:${actor.organizationId}:${requestId}`);
        await this.assertExpediente(tx, actor, expedienteId);
        const request = await tx.expedienteSolicitudPago.findFirst({ where: { id: requestId, organization_id: actor.organizationId, expediente_id: expedienteId } });
        if (!request) throw new ExpedienteFinanceError(404, 'EXP008_REQUEST_NOT_FOUND', 'La solicitud no está disponible.');
        if (request.estado === 'PAGADA' && request.movimiento_id) return { item: request, idempotent: true };
        if (request.estado !== 'PENDIENTE') throw new ExpedienteFinanceError(409, 'EXP008_REQUEST_STATE_INVALID', 'La solicitud ya no puede pagarse.');
        const category = await tx.categoriaFinanciera.findFirst({ where: { id: input.categoria_id, organization_id: actor.organizationId, activa: true } });
        if (!category) throw new ExpedienteFinanceError(409, 'EXP008_CATEGORY_INVALID', 'Selecciona una categoría de egreso válida.');
        const movement = await this.ledger.applyOperationalMovementInTransaction(tx, { organizationId: actor.organizationId, expedienteId, actorId: actor.id, correlationId: randomUUID(), nature: 'EGRESO', amount: request.importe, concept: request.concepto, accountId: clean(input.cuenta_id, 36), paymentMethod: clean(input.forma_pago, 100) || null, reference: clean(input.referencia, 180) || request.referencia, idempotencyKey: `EXP008:EGRESO:${requestId}:${key}`, allocations: [{ categoryId: category.id, amount: request.importe, note: 'Solicitud de pago EXP-008' }] });
        for (const upload of uploads) {
          const document = await this.createDocument(tx, actor, expedienteId, upload.stored, `EXP008_${upload.type}`, { source: 'EXP-008', role: upload.type, request_id: request.id });
          await this.linkDocument(tx, actor, expedienteId, document.id, upload.type, `${key}:${upload.type}`, { solicitud_pago_id: request.id, movimiento_id: movement.movement.id });
          if (upload.type === 'COMPROBANTE_PAGO') await tx.movimientoDocumento.create({ data: { organization_id: actor.organizationId, movimiento_id: movement.movement.id, documento_id: document.id, tipo_vinculo: 'COMPROBANTE_PAGO', creado_por_id: actor.id } });
        }
        const paidAt = new Date();
        const updated = await tx.expedienteSolicitudPago.update({ where: { id: request.id }, data: { estado: 'PAGADA', categoria_id: category.id, cuenta_id: input.cuenta_id, movimiento_id: movement.movement.id, pagado_por_id: actor.id, pagado_at: paidAt, version: { increment: 1 } } });
        await closePaymentRequestTiming(tx, actor.organizationId, request.id, paidAt);
        await this.record(tx, actor, expedienteId, 'EXP008_PAY_REQUEST', request.id, 'Solicitud pagada', `Se registró el egreso por ${request.importe.toFixed(2)} MXN.`, { movimiento_id: movement.movement.id, comprobante_pago: Boolean(files.payment), comprobante_fiscal: Boolean(files.fiscal), reconciled: false });
        return { item: updated, movement: movement.movement, idempotent: false };
      }, { timeout: 20_000 });
      if (result.idempotent) await Promise.all(uploads.map((item) => deleteFile(item.stored.storageKey).catch(() => undefined)));
      return result;
    } catch (error) { await Promise.all(uploads.map((item) => deleteFile(item.stored.storageKey).catch(() => undefined))); throw error; }
  }

  async generatePraviaReceipt(actor: ExpedienteFinanceActor, expedienteId: string, movementId: string, input: any) {
    if (!this.canApply(actor) || !actor.permissions.includes('documentos.write')) throw new ExpedienteFinanceError(403, 'EXP008_RECEIPT_DENIED', 'No tienes permiso para generar el comprobante PRAVIA.');
    const key = this.idempotency(input.idempotency_key);
    const expediente = await this.assertExpediente(this.prisma, actor, expedienteId);
    const existing = await this.prisma.expedienteFinanzaDocumento.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, movimiento_id: movementId, tipo: 'COMPROBANTE_PRAVIA', estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' } }, include: { documento: true } });
    if (existing) return { item: existing, idempotent: true };
    const movement = await this.prisma.movimientoFinanciero.findFirst({ where: { id: movementId, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'APLICADO' }, include: { comprobanteInterno: true } });
    if (!movement?.comprobanteInterno) throw new ExpedienteFinanceError(409, 'EXP008_RECEIPT_SOURCE_INVALID', 'El movimiento aplicado no tiene comprobante financiero canónico.');
    const format = await this.resolveFormat(actor.organizationId, 'comprobante');
    const token = randomBytes(32).toString('base64url');
    const code = token.slice(0, 12).toUpperCase();
    const verificationUrl = `/api/expedientes/comprobantes-pravia/verificar/${token}`;
    const buffer = renderPraviaReceiptPdf({ receiptFolio: movement.comprobanteInterno.folio, caseFolio: expediente.numero_pravia, concept: movement.concepto, amount: movement.monto.toFixed(2), date: new Date().toLocaleDateString('es-MX'), code, verificationUrl, formatSource: format.source });
    const stored = await this.storeBuffer(actor, expedienteId, buffer, `Comprobante_PRAVIA_${safeName(movement.comprobanteInterno.folio)}.pdf`, 'application/pdf', 'comprobantes-pravia');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `receipt:${actor.organizationId}:${movementId}`);
        const concurrent = await tx.expedienteFinanzaDocumento.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, movimiento_id: movementId, tipo: 'COMPROBANTE_PRAVIA', estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' } }, include: { documento: true } });
        if (concurrent) return { item: concurrent, idempotent: true };
        const current = await tx.movimientoFinanciero.findFirst({ where: { id: movementId, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'APLICADO' }, include: { comprobanteInterno: true } });
        if (!current?.comprobanteInterno) throw new ExpedienteFinanceError(409, 'EXP008_RECEIPT_SOURCE_INVALID', 'El movimiento ya no permite generar comprobante.');
        await tx.comprobanteFinanciero.update({ where: { id: current.comprobanteInterno.id }, data: { verification_token_hash: hashVerificationToken(token), verification_code_hint: code, verification_created_at: new Date() } });
        const document = await this.createDocument(tx, actor, expedienteId, stored, 'EXP008_COMPROBANTE_PRAVIA', { source: 'EXP-008', role: 'COMPROBANTE_PRAVIA', receipt_id: current.comprobanteInterno.id, verification_code: code, format_source: format.source });
        const link = await this.linkDocument(tx, actor, expedienteId, document.id, 'COMPROBANTE_PRAVIA', key, { movimiento_id: movementId, comprobante_id: current.comprobanteInterno.id });
        await this.record(tx, actor, expedienteId, 'EXP008_GENERATE_PRAVIA_RECEIPT', current.comprobanteInterno.id, 'Comprobante PRAVIA generado', 'Se generó un comprobante operativo verificable.', { movimiento_id: movementId, documento_id: document.id, verification_code_hint: code, token_persisted: false });
        return { item: { ...link, documento: document }, idempotent: false };
      });
      if (result.idempotent) await deleteFile(stored.storageKey).catch(() => undefined);
      return result;
    } catch (error) { await deleteFile(stored.storageKey).catch(() => undefined); throw error; }
  }

  async verifyReceipt(actor: ExpedienteFinanceActor, token: string) {
    const hash = hashVerificationToken(clean(token, 200));
    const receipt = await this.prisma.comprobanteFinanciero.findFirst({ where: { organization_id: actor.organizationId, verification_token_hash: hash, movimiento: { expediente_id: { not: null } } }, select: { folio: true, fecha: true, estado: true, verification_code_hint: true, movimiento: { select: { expediente_id: true } } } });
    if (!receipt) throw new ExpedienteFinanceError(404, 'EXP008_RECEIPT_NOT_FOUND', 'El comprobante no pudo verificarse.');
    await this.assertExpediente(this.prisma, actor, receipt.movimiento.expediente_id!);
    return { valid: receipt.estado === 'VIGENTE', folio: receipt.folio, fecha: receipt.fecha, estado: receipt.estado, codigo: receipt.verification_code_hint };
  }

  async signedUrl(actor: ExpedienteFinanceActor, expedienteId: string, linkId: string) {
    if (!actor.permissions.includes('documentos.read')) throw new ExpedienteFinanceError(403, 'EXP008_DOCUMENT_READ_DENIED', 'No tienes permiso para consultar documentos.');
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const link = await this.prisma.expedienteFinanzaDocumento.findFirst({ where: { id: linkId, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' } }, include: { documento: true } });
    if (!link) throw new ExpedienteFinanceError(404, 'EXP008_DOCUMENT_NOT_FOUND', 'El documento no está disponible.');
    return { url: await getSignedUrl(link.documento.storage_key, 600), expires_in: 600, file_name: link.documento.nombre_original, mime_type: link.documento.mime_type };
  }

  async retireDocument(actor: ExpedienteFinanceActor, expedienteId: string, linkId: string, reason: string) {
    if (!actor.permissions.includes('documentos.unlink')) throw new ExpedienteFinanceError(403, 'EXP008_DOCUMENT_RETIRE_DENIED', 'No tienes permiso para retirar documentos.');
    const why = clean(reason, 500);
    if (!why) throw new ExpedienteFinanceError(400, 'EXP008_RETIRE_REASON_REQUIRED', 'Indica el motivo de retiro.');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `document-retire:${actor.organizationId}:${linkId}`);
      await this.assertExpediente(tx, actor, expedienteId);
      const link = await tx.expedienteFinanzaDocumento.findFirst({ where: { id: linkId, organization_id: actor.organizationId, expediente_id: expedienteId } });
      if (!link) throw new ExpedienteFinanceError(404, 'EXP008_DOCUMENT_NOT_FOUND', 'El documento no está disponible.');
      if (link.estatus !== 'ACTIVO') return { retired: true, idempotent: true };
      await tx.expedienteFinanzaDocumento.update({ where: { id: link.id }, data: { estatus: 'INACTIVO', retirado_at: new Date(), retirado_por_id: actor.id, motivo_retiro: why } });
      await tx.expedienteDocumento.updateMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: link.documento_id, estatus: 'ACTIVO' }, data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: why } });
      if (link.movimiento_id) await tx.movimientoDocumento.updateMany({ where: { organization_id: actor.organizationId, movimiento_id: link.movimiento_id, documento_id: link.documento_id, estatus: 'ACTIVO' }, data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: why } });
      await this.record(tx, actor, expedienteId, 'EXP008_RETIRE_FINANCIAL_DOCUMENT', link.id, 'Documento financiero retirado', 'El vínculo se retiró; el archivo se conserva para auditoría.', { documento_id: link.documento_id, hard_delete: false, reason: why });
      return { retired: true, idempotent: false };
    });
  }

  async voidRecord(actor: ExpedienteFinanceActor, expedienteId: string, kind: 'income' | 'request', id: string, reason: string) {
    if (!this.canApply(actor)) throw new ExpedienteFinanceError(403, 'EXP008_VOID_DENIED', 'No tienes permiso para anular este registro.');
    const why = clean(reason, 500);
    if (!why) throw new ExpedienteFinanceError(400, 'EXP008_VOID_REASON_REQUIRED', 'Indica el motivo de anulación.');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `void:${actor.organizationId}:${kind}:${id}`);
      await this.assertExpediente(tx, actor, expedienteId);
      if (kind === 'income') {
        const row = await tx.expedienteIngresoReportado.findFirst({ where: { id, organization_id: actor.organizationId, expediente_id: expedienteId } });
        if (!row) throw new ExpedienteFinanceError(404, 'EXP008_INCOME_NOT_FOUND', 'El comprobante no está disponible.');
        if (row.estado === 'APLICADO') throw new ExpedienteFinanceError(409, 'EXP008_LEDGER_REVERSE_REQUIRED', 'El ingreso aplicado debe corregirse mediante el reverso financiero canónico.');
        if (row.estado === 'ANULADO') return { voided: true, idempotent: true };
        const voidedAt = new Date();
        await tx.expedienteIngresoReportado.update({ where: { id }, data: { estado: 'ANULADO', anulado_por_id: actor.id, anulado_at: voidedAt, motivo_anulacion: why, version: { increment: 1 } } });
        await closeReceiptApplicationTiming(tx, actor.organizationId, row.id, voidedAt);
      } else {
        const row = await tx.expedienteSolicitudPago.findFirst({ where: { id, organization_id: actor.organizationId, expediente_id: expedienteId } });
        if (!row) throw new ExpedienteFinanceError(404, 'EXP008_REQUEST_NOT_FOUND', 'La solicitud no está disponible.');
        if (row.estado === 'PAGADA') throw new ExpedienteFinanceError(409, 'EXP008_LEDGER_REVERSE_REQUIRED', 'La solicitud pagada debe corregirse mediante el reverso financiero canónico.');
        if (row.estado === 'ANULADA') return { voided: true, idempotent: true };
        const voidedAt = new Date();
        await tx.expedienteSolicitudPago.update({ where: { id }, data: { estado: 'ANULADA', anulado_por_id: actor.id, anulado_at: voidedAt, motivo_anulacion: why, version: { increment: 1 } } });
        await closePaymentRequestTiming(tx, actor.organizationId, row.id, voidedAt);
      }
      await this.record(tx, actor, expedienteId, 'EXP008_VOID_OPERATIONAL_RECORD', id, kind === 'income' ? 'Comprobante reportado anulado' : 'Solicitud anulada', 'El registro fue anulado sin eliminar su trazabilidad.', { kind, reason: why, hard_delete: false });
      return { voided: true, idempotent: false };
    });
  }

  private capabilities(actor: ExpedienteFinanceActor) { return { canRead: actor.permissions.includes('expedientes.read'), canReport: actor.permissions.includes('expedientes.write') && actor.permissions.includes('documentos.write'), canCreateRequest: actor.permissions.includes('expedientes.write') && actor.permissions.includes('documentos.write'), canApply: this.canApply(actor), canUseAI: this.canApply(actor) && actor.permissions.includes('ia.execute'), canReadDocuments: actor.permissions.includes('documentos.read'), canRetireDocuments: actor.permissions.includes('documentos.unlink') }; }
  private canApply(actor: ExpedienteFinanceActor) { return actor.permissions.includes('finanzas.write') && actor.permissions.includes('finanzas.validate'); }
  private requireOperationalWrite(actor: ExpedienteFinanceActor) { if (!actor.permissions.includes('expedientes.write') || !actor.permissions.includes('documentos.write')) throw new ExpedienteFinanceError(403, 'EXP008_OPERATION_DENIED', 'No tienes permiso para registrar operaciones financieras del expediente.'); }
  private idempotency(value: unknown) { const key = clean(value, 160); if (!key) throw new ExpedienteFinanceError(400, 'EXP008_IDEMPOTENCY_REQUIRED', 'No fue posible identificar de forma segura la operación.'); return key; }
  private async lock(tx: Prisma.TransactionClient, key: string) { await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp008:${key}`}))`); }
  private async assertExpediente(db: Db, actor: ExpedienteFinanceActor, expedienteId: string) { const record = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true, numero_pravia: true, cliente_alias: true } }); if (!record) throw new ExpedienteFinanceError(403, 'EXP008_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.'); return record; }
  private async resolveFormat(organizationId: string, kind: 'solicitud' | 'comprobante') { const artifact = await this.prisma.catalogoArtefacto.findFirst({ where: { organization_id: organizationId, activo: true, AND: [{ nombre: { contains: kind, mode: 'insensitive' } }, { nombre: { contains: 'pago', mode: 'insensitive' } }] }, include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updated_at: 'desc' } }); const version = artifact?.versiones[0]; return version ? { id: version.id, source: `CONFIGURACION:${artifact!.id}:V${version.version}` } : { id: null, source: `SISTEMA_EXP008_${kind.toUpperCase()}_V1` }; }
  private async storeUpload(actor: ExpedienteFinanceActor, expedienteId: string, file: Upload, folder: string) { if (!file?.buffer?.length) throw new ExpedienteFinanceError(400, 'EXP008_FILE_REQUIRED', 'Selecciona un documento.'); if (file.size > 25 * 1024 * 1024) throw new ExpedienteFinanceError(413, 'EXP008_FILE_TOO_LARGE', 'El archivo supera 25 MB.'); return this.storeBuffer(actor, expedienteId, file.buffer, safeName(file.originalname), file.mimetype || 'application/octet-stream', folder); }
  private async storeBuffer(actor: ExpedienteFinanceActor, expedienteId: string, buffer: Buffer, fileName: string, mimeType: string, folder: string) { const storageKey = `organizations/${actor.organizationId}/expedientes/${expedienteId}/finanzas/${folder}/${randomUUID()}_${safeName(fileName)}`; await uploadFile(buffer, storageKey, mimeType); return { storageKey, buffer, fileName, mimeType, checksum: checksum(buffer) }; }
  private async createDocument(tx: Prisma.TransactionClient, actor: ExpedienteFinanceActor, expedienteId: string, stored: { storageKey: string; buffer: Buffer; fileName: string; mimeType: string; checksum: string }, type: string, provenance: Record<string, unknown>) { const document = await tx.documento.create({ data: { organization_id: actor.organizationId, nombre_original: stored.fileName, nombre_interno: `${randomUUID()}-${stored.fileName}`, tipo: type, categoria: 'OTROS', storage_key: stored.storageKey, mime_type: stored.mimeType, size_bytes: stored.buffer.length, checksum_sha256: stored.checksum, estatus: 'VIGENTE', subido_por_id: actor.id, expediente_id: expedienteId, datos_extraidos: json(provenance) } }); await tx.expedienteDocumento.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: document.id, tipo_vinculo: type, creado_por_id: actor.id, origen: 'FINANZAS', source_entity_type: 'ExpedienteFinanzaDocumento', source_entity_id: document.id, source_context: type, source_key: `FINANZAS:Documento:${document.id}:${type}`, document_version: stored.checksum, provenance: json(provenance) } }); return document; }
  private async linkDocument(tx: Prisma.TransactionClient, actor: ExpedienteFinanceActor, expedienteId: string, documentId: string, type: any, key: string, target: { ingreso_reportado_id?: string; solicitud_pago_id?: string; movimiento_id?: string; comprobante_id?: string }) { return tx.expedienteFinanzaDocumento.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: documentId, tipo: type, ingreso_reportado_id: target.ingreso_reportado_id || null, solicitud_pago_id: target.solicitud_pago_id || null, movimiento_id: target.movimiento_id || null, comprobante_id: target.comprobante_id || null, vinculado_por_id: actor.id, idempotency_key: key } }); }
  private async record(tx: Prisma.TransactionClient, actor: ExpedienteFinanceActor, expedienteId: string, action: string, entityId: string, title: string, description: string, details: Record<string, unknown>) { const correlationId = randomUUID(); await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ExpedienteFinanzas', entidad_id: entityId, valores_nuevos: json(details), correlation_id: correlationId, session_id: actor.sessionId } }); await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA', titulo: title, descripcion: description, metadatos: json({ source: 'EXP-008', action, entity_id: entityId }) } }); await tx.domainEventOutbox.create({ data: { organization_id: actor.organizationId, event_type: action, aggregate_type: 'ExpedienteFinanzas', aggregate_id: entityId, actor_user_id: actor.id, correlation_id: correlationId, payload: json({ expediente_id: expedienteId, source: 'EXP-008' }) } }); }
}
