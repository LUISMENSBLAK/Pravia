import { Prisma, PrismaClient, PresupuestoConceptoCategoria } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { budgetTotals, normalizeEditableBudgetConcepts, withDerivedHonorariosIva } from '../domain/expedienteBudget';
import { cotizacionObjectWhere } from './objectAccess.service';
import { INSUFFICIENT_LEGAL_FOUNDATION } from './knowledge.service';
import { readQuoteTerritory, territoryApplies, type QuoteTerritory } from '../domain/quoteTerritory';

type Actor = NonNullable<Request['user']>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const frozen = new Set(['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE']);

export class QuoteAIError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type ComparableRow = { concepto: string; categoria: PresupuestoConceptoCategoria; importe: Prisma.Decimal; cotizacion_id: string };
export const verifiedKnowledgeVersionAt = (legalDate: Date) => ({
  verification_status: 'VERIFICADA' as const,
  effective_from: { lte: legalDate },
  OR: [{ effective_to: null }, { effective_to: { gte: legalDate } }],
});
const median = (values: Prisma.Decimal[]) => {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1].plus(sorted[middle]).div(2);
};

type InternalCriterionRow = { id: string; code: string; title: string; scope: Prisma.JsonValue };
export function approvedInternalBudgetRows(criteria: InternalCriterionRow[], act: string, legalDate = new Date(), territory: QuoteTerritory | null = null) {
  const day = legalDate.toISOString().slice(0, 10);
  return criteria.flatMap((criterion) => {
    const scope = criterion.scope && typeof criterion.scope === 'object' && !Array.isArray(criterion.scope)
      ? criterion.scope as Record<string, unknown> : {};
    const kind = String(scope.kind || '').toUpperCase();
    const approval = String(scope.approval_status || '').toUpperCase();
    const review = String(scope.review_status || '').toUpperCase();
    const applicableAct = String(scope.act || '').trim();
    const from = String(scope.effective_from || '');
    const to = String(scope.effective_to || '');
    const amount = String(scope.fixed_honorarium || '');
    if (!['ARANCEL_PROPIO', 'TABLA_HONORARIOS'].includes(kind) || approval !== 'APROBADO' || review !== 'REVISADO' ||
        !territoryApplies(scope, territory) || (applicableAct && applicableAct.localeCompare(act, 'es', { sensitivity: 'base' }) !== 0) ||
        (from && from > day) || (to && to < day) || !/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return [];
    return [{ categoria: PresupuestoConceptoCategoria.HONORARIOS, concepto: criterion.title.trim(), importe: Number(new Prisma.Decimal(amount).toFixed(2)),
      explanation: { layer: 'CRITERIO_INTERNO_APROBADO', criterion_id: criterion.id, code: criterion.code,
        version: Number(scope.version || 1), reason: 'Honorario explícito de criterio interno revisado y aprobado; no es norma ni fuente oficial.' } }];
  });
}

export function buildComparableProposal(rows: ComparableRow[]) {
  const groups = new Map<string, ComparableRow[]>();
  for (const row of rows) {
    // Historical comparables are a commercial aid for professional fees only.
    // Taxes, duties and VAT require their deterministic/versioned source.
    if (row.categoria !== PresupuestoConceptoCategoria.HONORARIOS) continue;
    const key = `${row.categoria}\u0000${row.concepto.trim().toLocaleUpperCase('es-MX')}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].map((group) => {
    const amounts = group.map((row) => row.importe);
    const quoteIds = [...new Set(group.map((row) => row.cotizacion_id))];
    const middle = median(amounts).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const sorted = [...amounts].sort((a, b) => a.comparedTo(b));
    return {
      categoria: group[0].categoria,
      concepto: group[0].concepto.trim(),
      importe: Number(middle.toFixed(2)),
      explanation: {
        layer: 'HISTORICO_VALIDADO',
        sample_size: quoteIds.length,
        range: { min: Number(sorted[0].toFixed(2)), median: Number(middle.toFixed(2)), max: Number(sorted[sorted.length - 1].toFixed(2)) },
        reason: 'Mediana de conceptos equivalentes en cotizaciones aceptadas o convertidas de la misma organización y acto.',
      },
    };
  }).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.concepto.localeCompare(b.concepto, 'es'));
}

export class QuoteAIProposalService {
  constructor(private db: PrismaClient = prisma) {}

  async generate(actor: Actor, quoteId: string, input: Record<string, unknown>) {
    if (!actor.permissions.includes('cotizaciones.write') || !actor.permissions.includes('ai.use')) throw new QuoteAIError(403, 'QUOTE_AI_DENIED', 'No tienes permiso para generar propuestas asistidas.');
    const key = String(input.idempotency_key || '').trim();
    if (!key || key.length > 160) throw new QuoteAIError(400, 'QUOTE_AI_IDEMPOTENCY_REQUIRED', 'No fue posible identificar de forma segura esta propuesta.');
    const quote = await this.db.cotizacion.findFirst({
      where: { id: quoteId, ...cotizacionObjectWhere(actor) },
      include: { prospecto: true, conceptos: { orderBy: { orden: 'asc' } } },
    });
    if (!quote?.organization_id) throw new QuoteAIError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización o no tienes acceso.');
    const prior = await this.db.cotizacionIAProposal.findFirst({ where: { organization_id: actor.organizationId, cotizacion_id: quoteId, idempotency_key: key } });
    if (prior) return { data: prior, idempotent: true };
    if (quote.etapa_contractual && frozen.has(quote.etapa_contractual)) throw new QuoteAIError(409, 'QUOTE_AI_FROZEN', 'La cotización aceptada conserva su presupuesto histórico.');
    const act = quote.prospecto?.tipo_acto?.trim();
    if (!act) throw new QuoteAIError(409, 'QUOTE_AI_CONTEXT_REQUIRED', 'Define el acto antes de solicitar una propuesta.');
    const legalDate = new Date();
    const territory = readQuoteTerritory(quote.territorio_operacion);
    const comparables = await this.db.cotizacion.findMany({
      where: {
        organization_id: actor.organizationId, id: { not: quoteId },
        etapa_contractual: { in: ['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE'] },
        prospecto: { is: { tipo_acto: { equals: act, mode: 'insensitive' } } },
        conceptos: { some: { categoria: 'HONORARIOS' } },
      },
      select: { id: true, conceptos: { where: { categoria: 'HONORARIOS' }, select: { concepto: true, categoria: true, importe: true, cotizacion_id: true } } },
      take: 30,
      orderBy: { updated_at: 'desc' },
    });
    const comparableRows = buildComparableProposal(comparables.flatMap((item) => item.conceptos));
    const [tariffs, criteria] = await Promise.all([
      this.db.knowledgeSource.findMany({
        where: {
          organization_id: actor.organizationId,
          active: true,
          AND: [
            { OR: [{ category: { contains: 'ARANCEL', mode: 'insensitive' } }, { title: { contains: 'ARANCEL', mode: 'insensitive' } }] },
            { OR: [{ applicability: { contains: act, mode: 'insensitive' } }, { title: { contains: act, mode: 'insensitive' } }] },
          ],
          versions: { some: verifiedKnowledgeVersionAt(legalDate) },
        },
        select: { id: true, inventory_code: true, title: true, jurisdiction: true, source_url: true, versions: { where: verifiedKnowledgeVersionAt(legalDate), orderBy: { version: 'desc' }, take: 1, select: { version: true, effective_from: true, effective_to: true } } },
      }),
      this.db.knowledgeCriterion.findMany({ where: { organization_id: actor.organizationId, active: true }, select: { id: true, code: true, title: true, scope: true }, take: 100 }),
    ]);
    const internalRows = approvedInternalBudgetRows(criteria, act, legalDate, territory);
    const applicableCriterionIds = new Set(internalRows.map((row) => row.explanation.criterion_id));
    const rows = internalRows.length ? internalRows : comparableRows;
    if (!rows.length) throw new QuoteAIError(409, 'QUOTE_AI_FOUNDATION_INSUFFICIENT', INSUFFICIENT_LEGAL_FOUNDATION);
    const normalized = withDerivedHonorariosIva(normalizeEditableBudgetConcepts(rows));
    const totals = budgetTotals(normalized);
    const evidence = {
      operation_territory: territory,
      quote_updated_at: quote.updated_at.toISOString(),
      layers: {
        tariff: tariffs.filter((item) => territoryApplies({ jurisdiction: item.jurisdiction }, territory)).map((item) => ({ source_id: item.id, code: item.inventory_code, title: item.title, official_url: item.source_url, version: item.versions[0]?.version, validity: { from: item.versions[0]?.effective_from, to: item.versions[0]?.effective_to } })),
        internal_policy: criteria.filter((item) => applicableCriterionIds.has(item.id))
          .map((item) => ({ criterion_id: item.id, code: item.code, title: item.title, label: 'CRITERIO INTERNO — NO ES NORMA.', scope: item.scope })),
        validated_comparables: { organization_id: actor.organizationId, act, sample_quotes: new Set(comparables.map((item) => item.id)).size },
      },
      exclusions: ['BORRADOR', 'RECHAZADA', 'CANCELADA', 'PROPUESTA_IA_NO_APLICADA'],
      taxes_notice: 'Impuestos, derechos e ISR no se estiman libremente: requieren motor determinístico o fuente tarifaria verificada.',
    };
    const proposal = { concepts: rows, totals: { honorarios: totals.honorarios, iva_honorarios: totals.iva_honorarios, impuestos_derechos: totals.subtotal_impuestos_derechos, total: totals.total } };
    const created = await this.db.cotizacionIAProposal.create({ data: { organization_id: actor.organizationId, cotizacion_id: quoteId, proposal: json(proposal), evidence_packet: json(evidence), model_version: 'PRAVIA-COT-IA-001/layered-v3', idempotency_key: key, created_by_id: actor.id } });
    await this.db.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'GENERAR_PROPUESTA_COTIZACION_IA', entidad: 'CotizacionIAProposal', entidad_id: created.id, detalles: json({ cotizacion_id: quoteId, concepts: rows.length, persisted_to_budget: false }) } });
    return { data: created, idempotent: false };
  }

  async decide(actor: Actor, quoteId: string, proposalId: string, input: Record<string, unknown>) {
    if (!actor.permissions.includes('cotizaciones.write')) throw new QuoteAIError(403, 'QUOTE_AI_DECISION_DENIED', 'No tienes permiso para modificar la cotización.');
    const action = String(input.action || '').toUpperCase();
    if (!['APLICAR', 'DESCARTAR'].includes(action)) throw new QuoteAIError(400, 'QUOTE_AI_DECISION_INVALID', 'Selecciona aplicar o descartar la propuesta.');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:quote-budget:${actor.organizationId}:${quoteId}`}))`);
      const quote = await tx.cotizacion.findFirst({ where: { id: quoteId, ...cotizacionObjectWhere(actor) }, include: { prospecto: true } });
      const proposal = await tx.cotizacionIAProposal.findFirst({ where: { id: proposalId, organization_id: actor.organizationId, cotizacion_id: quoteId } });
      if (!quote || !proposal) throw new QuoteAIError(404, 'QUOTE_AI_PROPOSAL_NOT_FOUND', 'La propuesta ya no está disponible.');
      if (proposal.status !== 'PENDIENTE') return { data: proposal, idempotent: true, applied: proposal.status === 'APLICADA' };
      if (action === 'DESCARTAR') {
        const discarded = await tx.cotizacionIAProposal.update({ where: { id: proposal.id }, data: { status: 'DESCARTADA', decided_by_id: actor.id, decided_at: new Date() } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'DESCARTAR_PROPUESTA_COTIZACION_IA', entidad: 'CotizacionIAProposal', entidad_id: proposal.id, detalles: { cotizacion_id: quoteId, budget_changed: false } } });
        return { data: discarded, idempotent: false, applied: false };
      }
      if (quote.etapa_contractual && frozen.has(quote.etapa_contractual)) throw new QuoteAIError(409, 'QUOTE_AI_FROZEN', 'La cotización aceptada conserva su presupuesto histórico.');
      const evidence = proposal.evidence_packet as Record<string, any>;
      if (proposal.model_version !== 'PRAVIA-COT-IA-001/layered-v3' || evidence.quote_updated_at !== quote.updated_at.toISOString() ||
          JSON.stringify(evidence.operation_territory) !== JSON.stringify(readQuoteTerritory(quote.territorio_operacion))) {
        throw new QuoteAIError(409, 'QUOTE_AI_STALE', 'La cotización o su territorio cambió. Descarta y genera una propuesta actualizada.');
      }
      const policies = evidence.layers?.internal_policy ?? [];
      if (policies.length) {
        const current = await tx.knowledgeCriterion.findMany({ where: { organization_id: actor.organizationId, active: true, id: { in: policies.map((item: any) => item.criterion_id) } } });
        const applicable = approvedInternalBudgetRows(current, quote.prospecto?.tipo_acto?.trim() || '', new Date(), readQuoteTerritory(quote.territorio_operacion));
        if (applicable.length !== policies.length || policies.some((item: any) => !applicable.some((row) => row.explanation.criterion_id === item.criterion_id && row.explanation.version === Number(item.scope?.version || 1)))) {
          throw new QuoteAIError(409, 'QUOTE_AI_POLICY_CHANGED', 'El criterio interno cambió o dejó de estar vigente. Genera una propuesta actualizada.');
        }
      }
      const raw = proposal.proposal as Record<string, unknown>;
      const concepts = withDerivedHonorariosIva(normalizeEditableBudgetConcepts(raw.concepts));
      const totals = budgetTotals(concepts);
      await tx.cotizacionConcepto.deleteMany({ where: { organization_id: actor.organizationId, cotizacion_id: quoteId } });
      await tx.cotizacionConcepto.createMany({ data: concepts.map((row) => ({ organization_id: actor.organizationId, cotizacion_id: quoteId, concepto: row.concepto, categoria: row.categoria, importe: row.importe, orden: row.orden,
        tratamiento_iva: row.tratamiento_iva, iva_tasa: row.iva_tasa, regla_fiscal_fuente: row.regla_fiscal_fuente, regla_fiscal_version: row.regla_fiscal_version,
        origen: row.categoria === 'IVA_HONORARIOS' ? 'DERIVADO' : 'IA_PROPUESTA' })) });
      await tx.cotizacion.update({ where: { id: quoteId }, data: { total_notaria: totals.total, total_cliente: totals.total, honorarios_pravia: null } });
      const applied = await tx.cotizacionIAProposal.update({ where: { id: proposal.id }, data: { status: 'APLICADA', decided_by_id: actor.id, decided_at: new Date() } });
      await tx.cotizacionIAProposal.updateMany({ where: { organization_id: actor.organizationId, cotizacion_id: quoteId, status: 'PENDIENTE', id: { not: proposal.id } }, data: { status: 'SUPERADA', decided_by_id: actor.id, decided_at: new Date() } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'APLICAR_PROPUESTA_COTIZACION_IA', entidad: 'CotizacionIAProposal', entidad_id: proposal.id, detalles: json({ cotizacion_id: quoteId, concepts: concepts.length, total: totals.total, stage_changed: false }) } });
      return { data: applied, idempotent: false, applied: true };
    });
  }
}

export const quoteAIProposalService = new QuoteAIProposalService();
