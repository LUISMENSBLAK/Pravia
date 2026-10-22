import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { budgetTotals, moneyToCents, normalizeEditableBudgetConcepts, withDerivedHonorariosIva } from '../domain/expedienteBudget';
import { cotizacionObjectWhere } from './objectAccess.service';
import { normalizeOperationalText } from '../utils/operationalText';
import { getQuotationTemplate } from './quotationTemplate.service';

type Actor = NonNullable<Request['user']>;

export class QuoteBudgetError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export function quoteBudgetDraft(input: {
  folio: string;
  client: string;
  act: string;
  description: string;
  responsible: string;
  date: Date;
  totals: { subtotal_honorarios: string; subtotal_impuestos_derechos: string; otros_gastos?: string; iva_otros_gastos?: string; total: string };
}) {
  return getQuotationTemplate({
    folio: input.folio,
    cliente: input.client,
    acto: input.act,
    descripcion: input.description,
    responsable: input.responsible,
    fecha: input.date,
    honorarios: input.totals.subtotal_honorarios,
    impuestos_derechos: input.totals.subtotal_impuestos_derechos,
    otros_gastos: input.totals.otros_gastos,
    iva_otros_gastos: input.totals.iva_otros_gastos,
    total: input.totals.total,
  });
}

export const quoteBudgetPayload = (rows: Array<{ id?: string; concepto: string; categoria: any; importe: unknown; orden: number; origen?: string; tratamiento_iva?: any; iva_tasa?: unknown; regla_fiscal_fuente?: string | null; regla_fiscal_version?: string | null }>) => {
  const concepts = rows.map((row, orden) => ({
    ...(row.id ? { id: row.id } : {}),
    concepto: row.concepto,
    categoria: row.categoria,
    importe: String(row.importe),
    orden,
    origen: row.origen ?? 'MANUAL',
    tratamiento_iva: row.tratamiento_iva ?? null,
    iva_tasa: row.iva_tasa == null ? null : String(row.iva_tasa),
    regla_fiscal_fuente: row.regla_fiscal_fuente ?? null,
    regla_fiscal_version: row.regla_fiscal_version ?? null,
  }));
  const totals = budgetTotals(concepts.map((row) => ({ ...row, importeCents: moneyToCents(row.importe) })));
  return {
    concepts,
    totals: {
      honorarios: totals.honorarios,
      iva_honorarios: totals.iva_honorarios,
      subtotal_honorarios: totals.subtotal_honorarios,
      impuestos_derechos: totals.subtotal_impuestos_derechos,
      otros_gastos: totals.otros_gastos,
      iva_otros_gastos: totals.iva_otros_gastos,
      subtotal_otros_gastos: totals.subtotal_otros_gastos,
      requires_review: totals.requiresReview,
      total: totals.total,
    },
  };
};

export async function createQuoteOperationalSnapshotInTransaction(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; quoteId: string; actorId: string; reason: string },
) {
  const quote = await tx.cotizacion.findFirst({
    where: { id: input.quoteId, organization_id: input.organizationId },
    include: { conceptos: { orderBy: { orden: 'asc' } } },
  });
  if (!quote) throw new QuoteBudgetError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización.');
  if (!quote.conceptos.length) throw new QuoteBudgetError(409, 'QUOTE_STRUCTURED_BUDGET_REQUIRED', 'Captura el presupuesto estructurado antes de continuar.');
  const payload = quoteBudgetPayload(quote.conceptos);
  if (payload.totals.requires_review) throw new QuoteBudgetError(409, 'QUOTE_BUDGET_TAX_REVIEW_REQUIRED', 'Revisa el IVA histórico o el tratamiento fiscal pendiente antes de continuar con la cotización.');
  const latest = await tx.cotizacionVersion.findFirst({
    where: { cotizacion_id: quote.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  const versionNumber = (latest?.version ?? 0) + 1;
  await tx.cotizacionVersion.updateMany({ where: { cotizacion_id: quote.id, aprobada: true }, data: { aprobada: false } });
  const snapshot = await tx.cotizacionVersion.create({ data: {
    organization_id: input.organizationId,
    cotizacion_id: quote.id,
    version: versionNumber,
    total_cliente: payload.totals.total,
    total_notaria: payload.totals.total,
    honorarios_pravia: '0.00',
    desglose_notaria: json({ rubros: payload.concepts.map((row) => ({ concepto: row.concepto, categoria: row.categoria, monto: row.importe })) }),
    notas: `Snapshot operativo inmutable: ${input.reason}`,
    creada_por_id: input.actorId,
    aprobada: true,
  } });
  await tx.cotizacionVersionConcepto.createMany({ data: payload.concepts.map((row) => ({
    organization_id: input.organizationId,
    cotizacion_version_id: snapshot.id,
    concepto: row.concepto,
    categoria: row.categoria,
    importe: row.importe,
    tratamiento_iva: row.tratamiento_iva,
    iva_tasa: row.iva_tasa,
    regla_fiscal_fuente: row.regla_fiscal_fuente,
    regla_fiscal_version: row.regla_fiscal_version,
    orden: row.orden,
    origen: row.origen === 'DERIVADO' ? 'DERIVADO' : row.origen === 'IMPORTADO' ? 'IMPORTADO' : 'MANUAL',
  })) });
  await tx.cotizacion.update({ where: { id: quote.id }, data: {
    version_actual: versionNumber,
    total_notaria: payload.totals.total,
    total_cliente: payload.totals.total,
    honorarios_pravia: null,
    fecha_aprobacion_version: new Date(),
  } });
  return tx.cotizacionVersion.findUniqueOrThrow({
    where: { id: snapshot.id }, include: { conceptos: { orderBy: { orden: 'asc' } } },
  });
}

export class QuoteBudgetService {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(actor: Actor, quoteId: string, rawConcepts: unknown) {
    if (!actor.permissions.includes('cotizaciones.read')) throw new QuoteBudgetError(403, 'QUOTE_BUDGET_READ_DENIED', 'No tienes permiso para consultar la cotización.');
    const quote = await this.prisma.cotizacion.findFirst({ where: { id: quoteId, ...cotizacionObjectWhere(actor) }, select: { id: true } });
    if (!quote) throw new QuoteBudgetError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización o no tienes acceso.');
    const concepts = withDerivedHonorariosIva(normalizeEditableBudgetConcepts(rawConcepts));
    const totals = budgetTotals(concepts);
    return { totals: {
      honorarios: totals.honorarios, iva_honorarios: totals.iva_honorarios, subtotal_honorarios: totals.subtotal_honorarios,
      impuestos_derechos: totals.subtotal_impuestos_derechos, otros_gastos: totals.otros_gastos,
      iva_otros_gastos: totals.iva_otros_gastos, subtotal_otros_gastos: totals.subtotal_otros_gastos,
      requires_review: totals.requiresReview, total: totals.total,
    } };
  }

  async save(actor: Actor, quoteId: string, raw: Record<string, unknown>) {
    if (!actor.permissions.includes('cotizaciones.write')) throw new QuoteBudgetError(403, 'QUOTE_BUDGET_WRITE_DENIED', 'No tienes permiso para modificar la cotización.');
    const allowed = new Set(['concepts', 'origin', 'operationContext', 'expectedUpdatedAt']);
    const unexpected = Object.keys(raw).filter((key) => !allowed.has(key));
    if (unexpected.length) throw new QuoteBudgetError(400, 'QUOTE_BUDGET_FIELDS_DENIED', 'La solicitud contiene campos no permitidos.');
    const expected = typeof raw.expectedUpdatedAt === 'string' ? new Date(raw.expectedUpdatedAt) : null;
    if (!expected || Number.isNaN(expected.getTime())) throw new QuoteBudgetError(400, 'QUOTE_BUDGET_REVISION_REQUIRED', 'Actualiza la ficha antes de guardar el presupuesto.');
    const origin = raw.origin === 'IMPORTADO' ? 'IMPORTADO' : 'MANUAL';
    const operationContext = typeof raw.operationContext === 'string' ? normalizeOperationalText(raw.operationContext, 4_000) : '';

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:quote-budget:${actor.organizationId}:${quoteId}`}))`);
      const quote = await tx.cotizacion.findFirst({
        where: { id: quoteId, ...cotizacionObjectWhere(actor) },
        include: {
          conceptos: { orderBy: { orden: 'asc' } },
          prospecto: true,
          creada_por: { select: { nombre: true, apellido: true } },
          actos: { include: { tipo_acto: { select: { nombre: true } } }, orderBy: { orden: 'asc' } },
        },
      });
      if (!quote) throw new QuoteBudgetError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización o no tienes acceso.');
      if (!quote.organization_id) throw new QuoteBudgetError(409, 'QUOTE_TENANT_REQUIRED', 'La cotización histórica requiere revisión antes de editarse.');
      if (['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE'].includes(String(quote.etapa_contractual))) {
        throw new QuoteBudgetError(409, 'QUOTE_BUDGET_FROZEN', 'La cotización aceptada o convertida conserva su presupuesto y documentos históricos.');
      }
      if (quote.updated_at.getTime() !== expected.getTime()) throw new QuoteBudgetError(409, 'QUOTE_BUDGET_STALE', 'La cotización cambió en otra sesión. Recarga antes de guardar.');
      const concepts = withDerivedHonorariosIva(normalizeEditableBudgetConcepts(raw.concepts));
      const totals = budgetTotals(concepts);
      const before = quoteBudgetPayload(quote.conceptos);
      await tx.cotizacionConcepto.deleteMany({ where: { organization_id: actor.organizationId, cotizacion_id: quote.id } });
      await tx.cotizacionConcepto.createMany({ data: concepts.map((row) => ({
        organization_id: actor.organizationId,
        cotizacion_id: quote.id,
        concepto: row.concepto,
        categoria: row.categoria,
        importe: row.importe,
        tratamiento_iva: row.tratamiento_iva,
        iva_tasa: row.iva_tasa,
        regla_fiscal_fuente: row.regla_fiscal_fuente,
        regla_fiscal_version: row.regla_fiscal_version,
        orden: row.orden,
        origen: row.categoria === 'IVA_HONORARIOS' ? 'DERIVADO' : origin,
      })) });
      const draft = quoteBudgetDraft({
        folio: quote.numero_cotizacion || quote.numero_solicitud || quote.id,
        client: quote.prospecto?.nombre || 'Cliente pendiente',
        act: quote.actos?.map((item) => item.tipo_acto.nombre).join(', ') || quote.prospecto?.tipo_acto || 'Acto pendiente',
        description: operationContext || quote.contexto_operacion || quote.prospecto?.necesidad || 'Sin descripción adicional',
        responsible: [quote.creada_por?.nombre, quote.creada_por?.apellido].filter(Boolean).join(' ') || 'Responsable pendiente',
        date: quote.created_at || new Date(),
        totals,
      });
      const refreshUnsentDraft = !quote.fecha_enviada_cliente;
      const updated = await tx.cotizacion.update({ where: { id: quote.id }, data: {
        total_notaria: totals.total,
        total_cliente: totals.total,
        honorarios_pravia: null,
        contexto_operacion: operationContext || null,
        ...(refreshUnsentDraft ? { correo_asunto: draft.subject, cuerpo_correo_cliente: draft.body } : {}),
      }, include: { conceptos: { orderBy: { orden: 'asc' } } } });
      const after = quoteBudgetPayload(updated.conceptos);
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId,
        user_id: actor.id,
        accion: 'QUOTE_BUDGET_UPDATED',
        entidad: 'Cotizacion',
        entidad_id: quote.id,
        session_id: actor.sessionId,
        valores_anteriores: json({ stage: quote.etapa_contractual, budget: before, operationContext: quote.contexto_operacion }),
        valores_nuevos: json({ stage: updated.etapa_contractual, budget: after, operationContext: updated.contexto_operacion }),
        detalles: { source: 'CORRECCION_002_V2', stage_changed: false, editable_version_created: false },
      } });
      return { presupuesto: after, updated_at: updated.updated_at, stage: updated.etapa_contractual };
    }, { timeout: 15_000, maxWait: 10_000 });
  }
}
