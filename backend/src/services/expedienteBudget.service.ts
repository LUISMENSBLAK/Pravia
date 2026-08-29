import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import {
  budgetTotals, calculateDistribution, centsToMoney, moneyToCents, normalizeBudgetConcepts,
  percentageFromCents, quoteCategoryToBudget, renderClientBudgetPdf, type BudgetCategory,
  type DistributionInput,
} from '../domain/expedienteBudget';
import { deleteFile, getSignedUrl, uploadFile } from '../storage/storage.service';

export type BudgetActor = { id: string; organizationId: string; sessionId: string; rol: any; permissions: string[] };
type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const safeName = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100);
const money = (value: unknown) => centsToMoney(moneyToCents(String(value ?? '0')));

export class ExpedienteBudgetError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const can = (actor: BudgetActor, permission: string) => actor.permissions.includes(permission);
const categoryLabel = (category: BudgetCategory) => category === 'IMPUESTOS_DERECHOS'
  ? 'Impuestos y derechos'
  : category === 'IVA_HONORARIOS' ? 'IVA de honorarios' : 'Honorarios';

export class ExpedienteBudgetService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: BudgetActor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const budget = await this.budget(this.prisma, actor, expedienteId);
    return this.response(actor, budget);
  }

  async save(actor: BudgetActor, expedienteId: string, input: { expected_version: number; concepts: unknown; distribution?: DistributionInput }) {
    if (!can(actor, 'expedientes.write')) throw new ExpedienteBudgetError(403, 'EXP007_WRITE_DENIED', 'No tienes permiso para modificar el presupuesto.');
    const concepts = normalizeBudgetConcepts(input.concepts);
    const totals = budgetTotals(concepts);
    if (input.distribution && !can(actor, 'finanzas.write')) throw new ExpedienteBudgetError(403, 'EXP007_DISTRIBUTION_WRITE_DENIED', 'No tienes permiso para modificar la distribución interna.');
    const calculatedDistribution = input.distribution ? calculateDistribution(totals, input.distribution) : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp007-budget:${actor.organizationId}:${expedienteId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      const current = await this.budget(tx, actor, expedienteId);
      if (!Number.isInteger(input.expected_version) || input.expected_version !== current.version) {
        throw new ExpedienteBudgetError(409, 'EXP007_STALE_BUDGET', 'El presupuesto cambió en otra sesión. Recarga antes de guardar.');
      }
      const previous = this.auditSnapshot(current);
      await tx.expedientePresupuestoConcepto.deleteMany({ where: { organization_id: actor.organizationId, presupuesto_id: current.id } });
      await tx.expedientePresupuestoConcepto.createMany({ data: concepts.map((item) => ({
        organization_id: actor.organizationId, presupuesto_id: current.id, concepto: item.concepto,
        categoria: item.categoria, importe: item.importe, orden: item.orden,
      })) });
      if (calculatedDistribution) {
        await tx.expedientePresupuestoDistribucion.upsert({ where: { presupuesto_id: current.id }, update: {
          pravia_honorarios: calculatedDistribution.pravia.honorarios, pravia_iva: calculatedDistribution.pravia.iva,
          notaria_honorarios: calculatedDistribution.notaria.honorarios, notaria_iva: calculatedDistribution.notaria.iva,
        }, create: {
          organization_id: actor.organizationId, presupuesto_id: current.id,
          pravia_honorarios: calculatedDistribution.pravia.honorarios, pravia_iva: calculatedDistribution.pravia.iva,
          notaria_honorarios: calculatedDistribution.notaria.honorarios, notaria_iva: calculatedDistribution.notaria.iva,
        } });
      } else {
        const existing = current.distribucion;
        const praviaHonorarios = moneyToCents(String(existing?.pravia_honorarios ?? 0));
        const praviaIva = moneyToCents(String(existing?.pravia_iva ?? 0));
        const boundedHonorarios = praviaHonorarios > totals.honorariosCents ? totals.honorariosCents : praviaHonorarios;
        const boundedIva = praviaIva > totals.ivaHonorariosCents ? totals.ivaHonorariosCents : praviaIva;
        await tx.expedientePresupuestoDistribucion.upsert({ where: { presupuesto_id: current.id }, update: {
          pravia_honorarios: centsToMoney(boundedHonorarios), pravia_iva: centsToMoney(boundedIva),
          notaria_honorarios: centsToMoney(totals.honorariosCents - boundedHonorarios), notaria_iva: centsToMoney(totals.ivaHonorariosCents - boundedIva),
        }, create: {
          organization_id: actor.organizationId, presupuesto_id: current.id,
          pravia_honorarios: centsToMoney(boundedHonorarios), pravia_iva: centsToMoney(boundedIva),
          notaria_honorarios: centsToMoney(totals.honorariosCents - boundedHonorarios), notaria_iva: centsToMoney(totals.ivaHonorariosCents - boundedIva),
        } });
      }
      const updated = await tx.expedientePresupuesto.update({ where: { id: current.id }, data: {
        subtotal_honorarios: totals.subtotal_honorarios, subtotal_impuestos_derechos: totals.subtotal_impuestos_derechos,
        total: totals.total, actualizado_por_id: actor.id, version: { increment: 1 },
        requiere_clasificacion: false, distribucion_requiere_revision: false,
      }, include: this.include() });
      await tx.expediente.update({ where: { id: expedienteId }, data: { version: { increment: 1 } } });
      await this.record(tx, actor, expedienteId, 'EXP007_UPDATE_BUDGET', current.id, previous, this.auditSnapshot(updated), 'Presupuesto actualizado', `Se guardaron ${concepts.length} concepto(s) del presupuesto vigente.`);
      return this.response(actor, updated);
    }, { timeout: 20_000 });
  }

  async generatePdf(actor: BudgetActor, expedienteId: string, input: { expected_version: number; idempotency_key: string; note?: string }) {
    if (!can(actor, 'expedientes.write') || !can(actor, 'documentos.write')) throw new ExpedienteBudgetError(403, 'EXP007_GENERATE_DENIED', 'No tienes permiso para generar el presupuesto.');
    const idempotencyKey = String(input.idempotency_key || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new ExpedienteBudgetError(400, 'EXP007_IDEMPOTENCY_REQUIRED', 'No fue posible identificar de forma segura esta generación.');
    const note = String(input.note || '').trim();
    if (note.length > 500) throw new ExpedienteBudgetError(400, 'EXP007_NOTE_TOO_LONG', 'La nota no puede superar 500 caracteres.');
    const expediente = await this.assertExpediente(this.prisma, actor, expedienteId);
    const existing = await this.prisma.expedientePresupuestoDocumento.findFirst({ where: {
      organization_id: actor.organizationId, presupuesto: { expediente_id: expedienteId }, idempotency_key: idempotencyKey,
    }, include: { documento: true } });
    if (existing) return { item: this.pdfItem(existing), idempotent: true };
    const budget = await this.budget(this.prisma, actor, expedienteId);
    if (budget.version !== input.expected_version) throw new ExpedienteBudgetError(409, 'EXP007_STALE_BUDGET', 'El presupuesto cambió. Recarga antes de generar el PDF.');
    if (budget.requiere_clasificacion) throw new ExpedienteBudgetError(409, 'EXP007_LEGACY_CLASSIFICATION_REQUIRED', 'Clasifica los conceptos históricos antes de generar un nuevo presupuesto.');
    const format = await this.resolveFormat(actor.organizationId);
    const preference = await this.prisma.userPreference.findUnique({ where: { user_id: actor.id }, select: { date_format: true, timezone: true } });
    const generatedAt = new Date();
    const generatedDate = this.formatDate(generatedAt, preference?.date_format, preference?.timezone);
    const clientDto = {
      folio: expediente.numero_pravia, client: expediente.cliente_alias || 'Cliente',
      notary: expediente.notaria?.nombre || 'Notaría por confirmar', generatedDate,
      concepts: budget.conceptos.map((item) => ({ concept: item.concepto, categoryLabel: categoryLabel(item.categoria), amount: money(item.importe) })),
      subtotalHonorarios: money(budget.subtotal_honorarios), subtotalImpuestosDerechos: money(budget.subtotal_impuestos_derechos),
      total: money(budget.total), optionalNote: note || undefined,
    };
    const buffer = renderClientBudgetPdf(clientDto);
    const fileName = `Presupuesto_${safeName(expediente.numero_pravia)}_${generatedAt.toISOString().slice(0, 10)}.pdf`;
    const storageKey = `organizations/${actor.organizationId}/expedientes/${expedienteId}/presupuestos/${randomUUID()}_${fileName}`;
    await uploadFile(buffer, storageKey, 'application/pdf');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp007-pdf:${actor.organizationId}:${expedienteId}`}))`);
        const concurrentExisting = await tx.expedientePresupuestoDocumento.findFirst({ where: { organization_id: actor.organizationId, presupuesto_id: budget.id, idempotency_key: idempotencyKey }, include: { documento: true } });
        if (concurrentExisting) return { item: this.pdfItem(concurrentExisting), idempotent: true, discardUpload: true };
        const current = await this.budget(tx, actor, expedienteId);
        if (current.version !== input.expected_version) throw new ExpedienteBudgetError(409, 'EXP007_STALE_BUDGET', 'El presupuesto cambió durante la generación. Vuelve a intentarlo.');
        const document = await tx.documento.create({ data: {
          organization_id: actor.organizationId, nombre_original: fileName, nombre_interno: `${randomUUID()}-${fileName}`,
          tipo: 'EXP007_PRESUPUESTO_CLIENTE', categoria: 'OTROS', storage_key: storageKey, mime_type: 'application/pdf',
          size_bytes: buffer.length, checksum_sha256: sha(buffer), estatus: 'VIGENTE', subido_por_id: actor.id, expediente_id: expedienteId,
          observaciones: note || null,
          datos_extraidos: json({ exp007: { presupuesto_version: current.version, total: money(current.total), formato_fuente: format.source, formato_version_id: format.id } }),
        } });
        const history = await tx.expedientePresupuestoDocumento.create({ data: {
          organization_id: actor.organizationId, presupuesto_id: current.id, documento_id: document.id,
          formato_version_id: format.id, formato_fuente: format.source, presupuesto_version: current.version,
          total_snapshot: money(current.total), nota: note || null, idempotency_key: idempotencyKey,
          generado_por_id: actor.id, generado_at: generatedAt,
        }, include: { documento: true } });
        await tx.expedienteDocumento.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: document.id,
          tipo_vinculo: 'EXP007_PRESUPUESTO', creado_por_id: actor.id, origen: 'EXPEDIENTE',
          source_entity_type: 'ExpedientePresupuestoDocumento', source_entity_id: history.id, source_context: 'PRESUPUESTO_CLIENTE',
          source_key: `EXPEDIENTE:ExpedientePresupuestoDocumento:${history.id}:${document.id}:PRESUPUESTO_CLIENTE`,
          document_version: sha(buffer), provenance: json({ source: 'EXP-007', presupuesto_id: current.id, presupuesto_version: current.version, formato_fuente: format.source }),
        } });
        await this.record(tx, actor, expedienteId, 'EXP007_GENERATE_PDF', history.id, null,
          { document_id: document.id, budget_version: current.version, total: money(current.total), format_source: format.source },
          'Presupuesto PDF generado', `Se generó un presupuesto por ${money(current.total)} MXN.`);
        return { item: this.pdfItem(history), idempotent: false, discardUpload: false };
      }, { timeout: 20_000 });
      if (result.discardUpload) await deleteFile(storageKey).catch(() => undefined);
      return { item: result.item, idempotent: result.idempotent };
    } catch (error) {
      await deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async signedUrl(actor: BudgetActor, expedienteId: string, historyId: string) {
    if (!can(actor, 'documentos.read')) throw new ExpedienteBudgetError(403, 'EXP007_PDF_READ_DENIED', 'No tienes permiso para consultar documentos.');
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const item = await this.pdf(this.prisma, actor, expedienteId, historyId);
    if (item.eliminado_at) throw new ExpedienteBudgetError(404, 'EXP007_PDF_NOT_FOUND', 'El presupuesto histórico ya no está disponible.');
    return { url: await getSignedUrl(item.documento.storage_key, 600), expires_in: 600, file_name: item.documento.nombre_original, mime_type: item.documento.mime_type };
  }

  async deletePdf(actor: BudgetActor, expedienteId: string, historyId: string, reason?: string) {
    if (!can(actor, 'documentos.unlink')) throw new ExpedienteBudgetError(403, 'EXP007_PDF_DELETE_DENIED', 'No tienes permiso para retirar este documento.');
    const cleanReason = String(reason || '').trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp007-delete:${actor.organizationId}:${historyId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      const item = await this.pdf(tx, actor, expedienteId, historyId);
      if (item.eliminado_at) return { deleted: true, idempotent: true };
      await tx.expedientePresupuestoDocumento.update({ where: { id: item.id }, data: { eliminado_at: new Date(), eliminado_por_id: actor.id, motivo_eliminacion: cleanReason || 'Retirado desde el expediente.' } });
      await tx.expedienteDocumento.updateMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: item.documento_id, estatus: 'ACTIVO' }, data: { estatus: 'INACTIVO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: cleanReason || 'Presupuesto histórico retirado.' } });
      await this.record(tx, actor, expedienteId, 'EXP007_DELETE_PDF', item.id, { active: true }, { active: false, document_id: item.documento_id }, 'Presupuesto PDF retirado', 'Se retiró un presupuesto histórico; el archivo se conserva para auditoría.');
      return { deleted: true, idempotent: false };
    });
  }

  async createFromQuoteInTransaction(tx: Prisma.TransactionClient, input: { actor: BudgetActor; expedienteId: string; quoteVersion: any }) {
    const { actor, expedienteId, quoteVersion } = input;
    const rawConcepts = Array.isArray(quoteVersion?.desglose_notaria?.rubros) ? quoteVersion.desglose_notaria.rubros : [];
    const normalized = rawConcepts.map((item: any) => ({ concepto: String(item?.concepto || '').trim(), categoria: quoteCategoryToBudget(item?.categoria, item?.concepto), importe: String(item?.monto ?? '0') })).filter((item: any) => item.concepto);
    const concepts = normalized.length ? normalizeBudgetConcepts(normalized) : [];
    const totals = budgetTotals(concepts);
    const totalFallback = money(quoteVersion.total_cliente);
    const praviaTotal = moneyToCents(String(quoteVersion.honorarios_pravia ?? 0));
    const budget = await tx.expedientePresupuesto.create({ data: {
      organization_id: actor.organizationId, expediente_id: expedienteId, cotizacion_version_origen_id: quoteVersion.id,
      origen: 'COTIZACION_ESTRUCTURADA', subtotal_honorarios: concepts.length ? totals.subtotal_honorarios : '0.00',
      subtotal_impuestos_derechos: concepts.length ? totals.subtotal_impuestos_derechos : totalFallback,
      total: concepts.length ? totals.total : totalFallback, requiere_clasificacion: !concepts.length,
      distribucion_requiere_revision: !concepts.length && praviaTotal > 0n,
      creado_por_id: actor.id, actualizado_por_id: actor.id,
      conceptos: concepts.length ? { create: concepts.map((item) => ({ organization_id: actor.organizationId, concepto: item.concepto, categoria: item.categoria, importe: item.importe, orden: item.orden })) } : undefined,
    } });
    const praviaHonorarios = praviaTotal > totals.honorariosCents ? totals.honorariosCents : praviaTotal;
    const praviaIva = praviaTotal - praviaHonorarios > totals.ivaHonorariosCents ? totals.ivaHonorariosCents : praviaTotal - praviaHonorarios;
    await tx.expedientePresupuestoDistribucion.create({ data: {
      organization_id: actor.organizationId, presupuesto_id: budget.id,
      pravia_honorarios: centsToMoney(praviaHonorarios), pravia_iva: centsToMoney(praviaIva),
      notaria_honorarios: centsToMoney(totals.honorariosCents - praviaHonorarios), notaria_iva: centsToMoney(totals.ivaHonorariosCents - praviaIva),
    } });
    return budget;
  }

  private async assertExpediente(db: Db, actor: BudgetActor, expedienteId: string) {
    const record = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor as any) }, include: { notaria: { select: { nombre: true } } } });
    if (!record) throw new ExpedienteBudgetError(403, 'EXP007_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return record;
  }

  private async budget(db: Db, actor: BudgetActor, expedienteId: string) {
    const budget = await db.expedientePresupuesto.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId }, include: this.include() });
    if (!budget) throw new ExpedienteBudgetError(409, 'EXP007_BUDGET_NOT_MATERIALIZED', 'El presupuesto todavía no está materializado. Revisa la migración del expediente.');
    return budget;
  }

  private include() { return {
    conceptos: { orderBy: [{ orden: 'asc' as const }, { created_at: 'asc' as const }] }, distribucion: true,
    documentos: { where: { eliminado_at: null }, include: { documento: true }, orderBy: { generado_at: 'desc' as const } },
    cotizacionVersionOrigen: { select: { id: true, version: true, cotizacion_id: true } },
  }; }

  private response(actor: BudgetActor, budget: any) {
    const normalized = budget.conceptos.map((item: any, orden: number) => ({ id: item.id, concepto: item.concepto, categoria: item.categoria as BudgetCategory, importe: money(item.importe), importeCents: moneyToCents(String(item.importe)), orden }));
    const totals = budgetTotals(normalized);
    const internal = budget.distribucion && can(actor, 'finanzas.read') ? this.distributionResponse(budget.distribucion, totals) : null;
    return {
      id: budget.id, version: budget.version, origin: budget.origen,
      quote_origin: budget.cotizacionVersionOrigen ? { quote_id: budget.cotizacionVersionOrigen.cotizacion_id, quote_version_id: budget.cotizacionVersionOrigen.id, quote_version: budget.cotizacionVersionOrigen.version, immutable: true } : null,
      concepts: normalized.map(({ importeCents: _ignore, ...item }: any) => item),
      totals: { honorarios: totals.honorarios, iva_honorarios: totals.iva_honorarios, subtotal_honorarios: money(budget.subtotal_honorarios), subtotal_impuestos_derechos: money(budget.subtotal_impuestos_derechos), total: money(budget.total) },
      internal_distribution: internal, requires_classification: budget.requiere_clasificacion,
      distribution_requires_review: budget.distribucion_requiere_revision,
      pdf_history: budget.documentos.map((item: any) => this.pdfItem(item)),
      capabilities: {
        can_edit: can(actor, 'expedientes.write'), can_view_internal_distribution: can(actor, 'finanzas.read'),
        can_edit_internal_distribution: can(actor, 'finanzas.write') && can(actor, 'expedientes.write'),
        can_generate_pdf: can(actor, 'expedientes.write') && can(actor, 'documentos.write'),
        can_view_pdf: can(actor, 'documentos.read'), can_delete_pdf: can(actor, 'documentos.unlink'),
      },
      editable_history_versions: 0, canonical_source: 'ExpedientePresupuesto', legacy_json_writer_enabled: false,
    };
  }

  private distributionResponse(row: any, totals: ReturnType<typeof budgetTotals>) {
    const ph = moneyToCents(String(row.pravia_honorarios)); const pi = moneyToCents(String(row.pravia_iva));
    const nh = moneyToCents(String(row.notaria_honorarios)); const ni = moneyToCents(String(row.notaria_iva));
    return {
      pravia: { honorarios: centsToMoney(ph), honorarios_porcentaje: percentageFromCents(ph, totals.honorariosCents), iva: centsToMoney(pi), iva_porcentaje: percentageFromCents(pi, totals.ivaHonorariosCents) },
      notaria: { honorarios: centsToMoney(nh), honorarios_porcentaje: percentageFromCents(nh, totals.honorariosCents), iva: centsToMoney(ni), iva_porcentaje: percentageFromCents(ni, totals.ivaHonorariosCents) },
      canonical_values: 'AMOUNTS', closed: ph + nh === totals.honorariosCents && pi + ni === totals.ivaHonorariosCents,
    };
  }

  private async pdf(db: Db, actor: BudgetActor, expedienteId: string, historyId: string) {
    const item = await db.expedientePresupuestoDocumento.findFirst({ where: { id: historyId, organization_id: actor.organizationId, presupuesto: { expediente_id: expedienteId } }, include: { documento: true } });
    if (!item || item.documento.organization_id !== actor.organizationId || item.documento.expediente_id !== expedienteId) throw new ExpedienteBudgetError(403, 'EXP007_PDF_ACCESS_DENIED', 'No tienes acceso a este presupuesto histórico.');
    return item;
  }

  private pdfItem(item: any) { return { id: item.id, document_id: item.documento_id, generated_at: item.generado_at, total: money(item.total_snapshot), budget_version: item.presupuesto_version, note: item.nota, file_name: item.documento.nombre_original, mime_type: item.documento.mime_type, immutable: true }; }
  private auditSnapshot(budget: any) { return { version: budget.version, concepts: budget.conceptos.map((item: any) => ({ id: item.id, concept: item.concepto, category: item.categoria, amount: money(item.importe) })), totals: { honorarios: money(budget.subtotal_honorarios), impuestos_derechos: money(budget.subtotal_impuestos_derechos), total: money(budget.total) }, internal_distribution: budget.distribucion ? '[INTERNAL_REDACTED]' : null }; }

  private async resolveFormat(organizationId: string) {
    const artifact = await this.prisma.catalogoArtefacto.findFirst({ where: { organization_id: organizationId, activo: true, nombre: { contains: 'presupuesto', mode: 'insensitive' } }, include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updated_at: 'desc' } });
    const version = artifact?.versiones[0];
    return version ? { id: version.id, source: `CONFIGURACION:${artifact!.id}:V${version.version}` } : { id: null, source: 'SISTEMA_EXP007_V1' };
  }

  private formatDate(date: Date, format = 'DD/MM/YYYY', timeZone = 'America/Mexico_City') {
    const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return format === 'YYYY-MM-DD' ? `${value.year}-${value.month}-${value.day}` : `${value.day}/${value.month}/${value.year}`;
  }

  private async record(tx: Prisma.TransactionClient, actor: BudgetActor, expedienteId: string, action: string, entityId: string, before: unknown, after: unknown, title: string, description: string) {
    const correlationId = randomUUID();
    await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ExpedientePresupuesto', entidad_id: entityId, valores_anteriores: before === null ? Prisma.JsonNull : json(before), valores_nuevos: json(after), correlation_id: correlationId, session_id: actor.sessionId } });
    await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA', titulo: title, descripcion: description, metadatos: json({ source: 'EXP-007', action, entity_id: entityId }) } });
    await tx.domainEventOutbox.create({ data: { organization_id: actor.organizationId, event_type: action, aggregate_type: 'ExpedientePresupuesto', aggregate_id: entityId, actor_user_id: actor.id, correlation_id: correlationId, payload: json({ expediente_id: expedienteId, source: 'EXP-007' }) } });
  }
}
