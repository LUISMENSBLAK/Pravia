import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { ComplianceError } from '../domain/compliance';
import {
  calculateLegalDeadline,
  deriveComplianceState,
  evaluateLegalRule,
  selectEffectiveRuleRevisions,
  type LegalCondition,
  type LegalRuleOutcome,
  type LegalRuleRevisionInput,
} from '../domain/complianceLegalEngine';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { ComplianceDocumentService } from './complianceDocument.service';

type User = NonNullable<Request['user']>;
const ENGINE_VERSION = 'H1-CUM-MAT-1';
const families = new Set(['CUM_MAT_001','CUM_MAT_002','CUM_MAT_003','CUM_MAT_004','CUM_MAT_005','CUM_MAT_006','CUM_MAT_007']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const json = (value: unknown) => value as Prisma.InputJsonValue;

function requireText(value: unknown, code: string): string {
  const text = String(value || '').trim();
  if (!text) throw new ComplianceError('Falta información obligatoria para completar la operación.', code);
  return text;
}

function validateCondition(value: unknown, depth = 0): asserts value is LegalCondition {
  if (depth > 12 || !value || typeof value !== 'object') throw new ComplianceError('La condición de la regla no es válida.', 'LEGAL_RULE_CONDITION_INVALID');
  const condition = value as Record<string, unknown>;
  const op = String(condition.op || '');
  if (['all', 'any'].includes(op)) {
    if (!Array.isArray(condition.rules) || !condition.rules.length) throw new ComplianceError('La condición compuesta requiere reglas.', 'LEGAL_RULE_CONDITION_INVALID');
    condition.rules.forEach((rule) => validateCondition(rule, depth + 1)); return;
  }
  if (op === 'not') { validateCondition(condition.rule, depth + 1); return; }
  if (op === 'array_some') {
    requireText(condition.path, 'LEGAL_RULE_PATH_REQUIRED'); validateCondition(condition.rule, depth + 1); return;
  }
  if (!['exists', 'equals', 'in', 'gte', 'lte'].includes(op)) throw new ComplianceError('La operación de condición no está permitida.', 'LEGAL_RULE_OPERATOR_UNSUPPORTED');
  requireText(condition.path, 'LEGAL_RULE_PATH_REQUIRED');
  if (op === 'in' && !Array.isArray(condition.values)) throw new ComplianceError('La condición IN requiere una lista.', 'LEGAL_RULE_CONDITION_INVALID');
  if (['gte', 'lte'].includes(op) && typeof condition.value !== 'number') throw new ComplianceError('La comparación numérica requiere un número.', 'LEGAL_RULE_CONDITION_INVALID');
}

function validateOutcome(value: unknown): asserts value is LegalRuleOutcome {
  if (!value || typeof value !== 'object' || !(value as any).when_true) throw new ComplianceError('El resultado de la regla no es válido.', 'LEGAL_RULE_OUTCOME_INVALID');
  const outcome = (value as any).when_true;
  if (!['APLICA_SIN_AVISO', 'APLICA_CON_AVISO'].includes(outcome.applicability)) throw new ComplianceError('La aplicabilidad configurada no es válida.', 'LEGAL_RULE_OUTCOME_INVALID');
  if (outcome.obligation?.deadline) {
    const deadline = outcome.obligation.deadline;
    if (deadline.kind === 'DAYS_AFTER_LEGAL_DATE' && (!Number.isInteger(deadline.days) || deadline.days < 0)) throw new ComplianceError('El plazo legal no es válido.', 'LEGAL_RULE_DEADLINE_INVALID');
    if (deadline.kind === 'FIXED_DATE' && Number.isNaN(new Date(`${deadline.date}T00:00:00.000Z`).getTime())) throw new ComplianceError('La fecha legal fija no es válida.', 'LEGAL_RULE_DEADLINE_INVALID');
    if (!['DAYS_AFTER_LEGAL_DATE', 'FIXED_DATE'].includes(deadline.kind)) throw new ComplianceError('La fuente del plazo legal no está permitida.', 'LEGAL_RULE_DEADLINE_INVALID');
  }
  if (outcome.document_requirements !== undefined) {
    if (!Array.isArray(outcome.document_requirements)) throw new ComplianceError('Los requisitos documentales deben ser una lista.', 'LEGAL_RULE_DOCUMENT_REQUIREMENTS_INVALID');
    const categories = new Set(['IDENTIFICACION','PERSONAS_MORALES','FORMATOS','CUESTIONARIOS_RIESGO','BENEFICIARIO_CONTROLADOR','PAGOS_EVIDENCIAS','AVISOS_ACUSES','REVISIONES']);
    const sources = new Set(['COMPARECIENTE','EXPEDIENTE','FORMAT_GENERATED','FUTURE_MODULE']);
    const targets = new Set(['EXPEDIENTE','EACH_RELEVANT_COMPARECIENTE']);
    const actions = new Set(['GO_TO_COMPARECIENTE','GO_TO_QUESTIONNAIRE','GO_TO_BENEFICIAL_OWNER','UPLOAD_SIGNED','UPLOAD_DOCUMENT','GO_TO_PAYMENT_EVIDENCE','GO_TO_NOTICE']);
    const keys = new Set<string>();
    for (const requirement of outcome.document_requirements) {
      if (!requirement || typeof requirement !== 'object') throw new ComplianceError('La definición documental no es válida.', 'LEGAL_RULE_DOCUMENT_REQUIREMENT_INVALID');
      const key = requireText(requirement.key, 'LEGAL_RULE_DOCUMENT_REQUIREMENT_KEY_REQUIRED');
      requireText(requirement.label, 'LEGAL_RULE_DOCUMENT_REQUIREMENT_LABEL_REQUIRED');
      if (keys.has(key)) throw new ComplianceError('Las claves documentales deben ser únicas dentro de la regla.', 'LEGAL_RULE_DOCUMENT_REQUIREMENT_DUPLICATE');
      keys.add(key);
      if (!categories.has(requirement.category) || !sources.has(requirement.source) || !targets.has(requirement.target_scope) || !actions.has(requirement.action)) {
        throw new ComplianceError('La taxonomía del requisito documental no es válida.', 'LEGAL_RULE_DOCUMENT_REQUIREMENT_TAXONOMY_INVALID');
      }
      if (requirement.source === 'COMPARECIENTE' && requirement.target_scope !== 'EACH_RELEVANT_COMPARECIENTE') {
        throw new ComplianceError('Un documento de compareciente requiere un objetivo personal explícito.', 'LEGAL_RULE_DOCUMENT_REQUIREMENT_TARGET_INVALID');
      }
      if (requirement.requires_signed_document && requirement.action !== 'UPLOAD_SIGNED') {
        throw new ComplianceError('Un requisito firmado debe dirigir a Cargar firmado.', 'LEGAL_RULE_DOCUMENT_REQUIREMENT_SIGNED_ACTION_INVALID');
      }
    }
  }
}

async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error: any) { if (error?.code !== 'P2034' || attempt === 2) throw error; }
  }
  throw new ComplianceError('No fue posible completar la operación concurrente.', 'COMPLIANCE_CONCURRENCY_CONFLICT', 409);
}

function legalDateFor(expediente: any, supplied: unknown): { date: Date | null; source: string | null } {
  if (expediente.fecha_real_firma) return { date: new Date(expediente.fecha_real_firma), source: 'EXPEDIENTE_FECHA_REAL_FIRMA' };
  if (!supplied) return { date: null, source: null };
  const parsed = new Date(String(supplied));
  if (Number.isNaN(parsed.getTime())) throw new ComplianceError('La fecha jurídica confirmada no es válida.', 'LEGAL_DATE_INVALID');
  return { date: parsed, source: 'CONFIRMADA_POR_USUARIO' };
}

function operationalAlertWindow(deadline: Date | null, lead: { id: string; lead_days: number } | null) {
  if (!deadline || !lead) return { lead_revision_id: null, lead_days_snapshot: null, opens_at: null };
  const opensAt = new Date(deadline);
  opensAt.setUTCDate(opensAt.getUTCDate() - lead.lead_days);
  return { lead_revision_id: lead.id, lead_days_snapshot: lead.lead_days, opens_at: opensAt };
}

export class ComplianceLegalEngineService {
  static async publishAlertLead(user: User, body: any, correlationId?: string) {
    const leadDays = Number(body.lead_days);
    if (!Number.isInteger(leadDays) || leadDays < 0) throw new ComplianceError('La anticipación debe ser un número entero no negativo.', 'COMPLIANCE_ALERT_LEAD_INVALID');
    if (!body.provenance || typeof body.provenance !== 'object' || Array.isArray(body.provenance) || !Object.keys(body.provenance).length) throw new ComplianceError('La procedencia de la configuración es obligatoria.', 'COMPLIANCE_ALERT_LEAD_PROVENANCE_REQUIRED');
    const idempotencyKey = requireText(body.idempotency_key, 'COMPLIANCE_ALERT_LEAD_IDEMPOTENCY_REQUIRED').slice(0, 160);
    const payloadHash = digest({ lead_days: leadDays, provenance: body.provenance });
    return serializable(async (tx) => {
      const existing = await tx.complianceAlertLeadRevision.findFirst({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw new ComplianceError('La clave de idempotencia ya fue usada con otra configuración.', 'COMPLIANCE_ALERT_LEAD_IDEMPOTENCY_CONFLICT', 409);
        return existing;
      }
      const current = await tx.complianceAlertLeadRevision.findFirst({ where: { superseded_at: null }, orderBy: { revision: 'desc' } });
      const latest = await tx.complianceAlertLeadRevision.findFirst({ orderBy: { revision: 'desc' } });
      const now = new Date();
      if (current) await tx.complianceAlertLeadRevision.update({ where: { id: current.id }, data: { superseded_at: now } });
      const created = await tx.complianceAlertLeadRevision.create({ data: { organization_id: user.organizationId, revision: (latest?.revision || 0) + 1, lead_days: leadDays, provenance: json(body.provenance), created_by_id: user.id, published_at: now, idempotency_key: idempotencyKey, payload_hash: payloadHash } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'PUBLISH_COMPLIANCE_ALERT_LEAD', entidad: 'ComplianceAlertLeadRevision', entidad_id: created.id, valores_nuevos: { revision: created.revision, lead_days: created.lead_days, payload_hash: created.payload_hash }, correlation_id: correlationId } });
      return created;
    });
  }

  static async createRule(user: User, body: any, correlationId?: string) {
    const family = String(body.family || '');
    if (!families.has(family)) throw new ComplianceError('La familia contractual no es válida.', 'LEGAL_RULE_FAMILY_INVALID');
    return serializable(async (tx) => {
      const rule = await tx.complianceLegalRule.create({ data: { organization_id: user.organizationId, stable_key: requireText(body.stable_key, 'LEGAL_RULE_KEY_REQUIRED'), family: family as any, name: requireText(body.name, 'LEGAL_RULE_NAME_REQUIRED'), description: String(body.description || '').trim() || null, created_by_id: user.id } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'CREATE_COMPLIANCE_LEGAL_RULE', entidad: 'ComplianceLegalRule', entidad_id: rule.id, valores_nuevos: { stable_key: rule.stable_key, family: rule.family }, correlation_id: correlationId } });
      return rule;
    });
  }

  static async createRevision(user: User, ruleId: string, body: any, correlationId?: string) {
    validateCondition(body.conditions); validateOutcome(body.outcome);
    const effectiveFrom = new Date(body.effective_from);
    const effectiveTo = body.effective_to ? new Date(body.effective_to) : null;
    if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime()))) throw new ComplianceError('La vigencia de la regla no es válida.', 'LEGAL_RULE_EFFECTIVE_DATE_INVALID');
    return serializable(async (tx) => {
      const rule = await tx.complianceLegalRule.findFirst({ where: { id: ruleId } });
      if (!rule) throw new ComplianceError('Regla legal no encontrada.', 'LEGAL_RULE_NOT_FOUND', 404);
      const latest = await tx.complianceLegalRuleRevision.findFirst({ where: { rule_id: rule.id }, orderBy: { version: 'desc' } });
      const payload = { conditions: body.conditions, outcome: body.outcome, legal_basis: requireText(body.legal_basis, 'LEGAL_RULE_BASIS_REQUIRED'), effective_from: effectiveFrom.toISOString(), effective_to: effectiveTo?.toISOString() || null };
      const revision = await tx.complianceLegalRuleRevision.create({ data: { organization_id: user.organizationId, rule_id: rule.id, version: (latest?.version || 0) + 1, status: 'DRAFT', effective_from: effectiveFrom, effective_to: effectiveTo, conditions: json(body.conditions), outcome: json(body.outcome), legal_basis: payload.legal_basis, checksum: digest(payload), created_by_id: user.id, supersedes_revision_id: latest?.id || null } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'CREATE_COMPLIANCE_LEGAL_RULE_REVISION', entidad: 'ComplianceLegalRuleRevision', entidad_id: revision.id, valores_nuevos: { rule_id: rule.id, version: revision.version, checksum: revision.checksum }, correlation_id: correlationId } });
      return revision;
    });
  }

  static async verifyRevision(user: User, ruleId: string, revisionId: string, body: any, correlationId?: string) {
    return serializable(async (tx) => {
      const revision = await tx.complianceLegalRuleRevision.findFirst({ where: { id: revisionId, rule_id: ruleId, status: 'DRAFT' } });
      if (!revision) throw new ComplianceError('La revisión en borrador no existe.', 'LEGAL_RULE_REVISION_NOT_FOUND', 404);
      const source = { source_name: requireText(body.source_name, 'LEGAL_RULE_SOURCE_REQUIRED'), source_url: requireText(body.source_url, 'LEGAL_RULE_SOURCE_REQUIRED'), source_checksum: requireText(body.source_checksum, 'LEGAL_RULE_SOURCE_REQUIRED'), source_published_at: new Date(body.source_published_at) };
      if (Number.isNaN(source.source_published_at.getTime())) throw new ComplianceError('La fecha de publicación de la fuente no es válida.', 'LEGAL_RULE_SOURCE_INVALID');
      const verified = await tx.complianceLegalRuleRevision.update({ where: { id: revision.id }, data: { ...source, verified_by_id: user.id, verified_at: new Date(), status: 'VERIFIED' } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'VERIFY_COMPLIANCE_LEGAL_RULE_REVISION', entidad: 'ComplianceLegalRuleRevision', entidad_id: verified.id, valores_nuevos: { source_name: verified.source_name, source_checksum: verified.source_checksum }, correlation_id: correlationId } });
      return verified;
    });
  }

  static async activateRevision(user: User, ruleId: string, revisionId: string, correlationId?: string) {
    return serializable(async (tx) => {
      const revision = await tx.complianceLegalRuleRevision.findFirst({ where: { id: revisionId, rule_id: ruleId, status: 'VERIFIED' } });
      if (!revision || !revision.verified_at || !revision.source_name || !revision.source_url || !revision.source_checksum || !revision.source_published_at) throw new ComplianceError('Solo una revisión verificada y trazable puede activarse.', 'LEGAL_RULE_REVISION_NOT_VERIFIED', 409);
      const active = await tx.complianceLegalRuleRevision.findFirst({ where: { rule_id: ruleId, status: 'ACTIVE' } });
      if (active) await tx.complianceLegalRuleRevision.update({ where: { id: active.id }, data: { status: 'RETIRED' } });
      const activated = await tx.complianceLegalRuleRevision.update({ where: { id: revision.id }, data: { status: 'ACTIVE', activated_by_id: user.id, activated_at: new Date() } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'ACTIVATE_COMPLIANCE_LEGAL_RULE_REVISION', entidad: 'ComplianceLegalRuleRevision', entidad_id: activated.id, valores_nuevos: { rule_id: ruleId, version: activated.version }, correlation_id: correlationId } });
      return activated;
    });
  }

  static async evaluateCase(user: User, expedienteId: string, body: any, correlationId?: string) {
    const idempotencyKey = requireText(body.idempotency_key, 'COMPLIANCE_IDEMPOTENCY_KEY_REQUIRED').slice(0, 160);
    return serializable(async (tx) => {
      const expediente = await tx.expediente.findFirst({
        where: { id: expedienteId, archived_at: null, ...expedienteAccessWhere(user) },
        include: {
          actos: { where: { estatus: 'ACTIVO', removed_at: null }, include: { tipo_acto: true, predios: { where: { estatus: 'ACTIVO' }, include: { expedientePredio: { include: { predio: true } } } } }, orderBy: { created_at: 'asc' } },
          predios: { where: { estatus: 'ACTIVO' }, include: { predio: true, actos: { where: { estatus: 'ACTIVO' } } } },
          comparecientes: { where: { archived_at: null, estatus: 'ACTIVO' }, include: { caracter: true, compareciente: { include: { personaFisica: true, personaMoral: true } }, expedienteActo: { select: { id: true, tipo_acto_id: true } } } },
          calculosISR: { where: { archived_at: null }, include: { versiones: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updated_at: 'desc' } },
        },
      });
      if (!expediente) throw new ComplianceError('Expediente no encontrado.', 'COMPLIANCE_CASE_NOT_FOUND', 404);
      const legalDate = legalDateFor(expediente, body.fecha_juridica_confirmada);
      const snapshot = {
        expediente: { id: expediente.id, version: expediente.version, numero_pravia: expediente.numero_pravia, estatus: expediente.estatus, valor_operacion: expediente.valor_operacion, datos_operacion: expediente.datos_operacion, fecha_real_firma: expediente.fecha_real_firma, updated_at: expediente.updated_at },
        actos: expediente.actos, comparecientes: expediente.comparecientes, predios: expediente.predios,
        isr: expediente.calculosISR.map((calculo) => ({ id: calculo.id, estado: calculo.estado, tipo_operacion: calculo.tipo_operacion, version: calculo.versiones[0] || null })),
        legal_date: legalDate.date?.toISOString() || null, legal_date_source: legalDate.source,
      };
      const requestHash = digest({ expediente_id: expediente.id, snapshot, supplied_legal_date: body.fecha_juridica_confirmada || null });
      const existing = await tx.complianceReview.findFirst({ where: { expediente_id: expediente.id, idempotency_key: idempotencyKey, is_canonical_legal_engine: true } });
      if (existing) {
        if ((existing.input_snapshot as any)?.request_hash !== requestHash) throw new ComplianceError('La clave de idempotencia ya fue usada con datos distintos.', 'COMPLIANCE_IDEMPOTENCY_CONFLICT', 409);
        return this.readCanonicalEvaluation(tx, existing.id);
      }

      const applicableRevisions = legalDate.date ? await tx.complianceLegalRuleRevision.findMany({ where: { status: { in: ['ACTIVE', 'RETIRED'] }, effective_from: { lte: legalDate.date }, OR: [{ effective_to: null }, { effective_to: { gte: legalDate.date } }] }, orderBy: [{ rule_id: 'asc' }, { version: 'desc' }] }) : [];
      const revisions = selectEffectiveRuleRevisions(applicableRevisions);
      const alertLead = await tx.complianceAlertLeadRevision.findFirst({ where: { superseded_at: null }, orderBy: { revision: 'desc' }, select: { id: true, lead_days: true } });
      const identities = revisions.length ? await tx.complianceLegalRule.findMany({ where: { id: { in: revisions.map((item) => item.rule_id) } } }) : [];
      const identityById = new Map(identities.map((item) => [item.id, item]));
      const collection = revisions.map((item) => ({ id: item.id, rule_id: item.rule_id, version: item.version, checksum: item.checksum }));
      const collectionChecksum = digest(collection);
      const review = await tx.complianceReview.create({ data: { expediente_id: expediente.id, rule_set_id: null, tipo: 'LEGAL_H1', estatus: 'EVALUACION_DETERMINISTA', fecha_operacion: legalDate.date, rule_version_snapshot: collectionChecksum, cuestionario_json: json({}), resultado_json: json({ estado: 'PENDIENTE' }), explicacion: null, creado_por_id: user.id, rule_snapshot: json(collection), master_snapshot: json(snapshot), input_snapshot: json({ request_hash: requestHash, snapshot }), engine_version: ENGINE_VERSION, idempotency_key: idempotencyKey, legal_date_source: legalDate.source, rule_collection_checksum: collectionChecksum, is_canonical_legal_engine: true } });
      const state = await tx.expedienteComplianceState.upsert({ where: { expediente_id: expediente.id }, create: { organization_id: user.organizationId, expediente_id: expediente.id, current_review_id: review.id, state: 'PENDIENTE', pending_count: 0, updated_by_id: user.id }, update: { current_review_id: review.id, state: 'PENDIENTE', pending_count: 0, next_deadline: null, version: { increment: 1 }, updated_by_id: user.id } });

      const evaluations: Array<{ revision: any; act: any; result: ReturnType<typeof evaluateLegalRule> }> = [];
      for (const revision of revisions) {
        const identity = identityById.get(revision.rule_id)!;
        const input: LegalRuleRevisionInput = { id: revision.id, rule_id: revision.rule_id, stable_key: identity.stable_key, family: identity.family, version: revision.version, checksum: revision.checksum, legal_basis: revision.legal_basis, conditions: revision.conditions as unknown as LegalCondition, outcome: revision.outcome as unknown as LegalRuleOutcome };
        for (const act of expediente.actos) evaluations.push({ revision, act, result: evaluateLegalRule(input, { expediente: snapshot.expediente, acto: act, actos: snapshot.actos, comparecientes: snapshot.comparecientes, predios: snapshot.predios, isr: snapshot.isr }) });
      }

      const statuses: string[] = [];
      const deadlines: Array<Date | null> = [];
      if (!legalDate.date || !legalDate.source) {
        statuses.push('BLOQUEADO_POR_FALTA_DATOS'); deadlines.push(null);
        const requirement = await tx.complianceRequirement.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, provider: 'LEGAL', requirement_key: 'LEGAL_DATE', label: 'Confirmar la fecha jurídica aplicable', status: 'BLOQUEADO_POR_FALTA_DATOS', deadline: null, source_snapshot: json({ reason: 'NO_EXACT_LEGAL_DATE' }) } });
        await tx.complianceAlert.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, requirement_id: requirement.id, alert_key: 'MISSING_LEGAL_DATE', level: 'ADVERTENCIA', message: 'Falta confirmar la fecha jurídica aplicable; no se emitió una conclusión legal.' } });
      } else if (!expediente.actos.length) {
        statuses.push('BLOQUEADO_POR_FALTA_DATOS'); deadlines.push(null);
        const requirement = await tx.complianceRequirement.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, provider: 'LEGAL', requirement_key: 'ACTIVE_ACTS', label: 'Registrar al menos un acto del expediente', status: 'BLOQUEADO_POR_FALTA_DATOS', deadline: null, source_snapshot: json({ reason: 'NO_ACTIVE_ACTS' }) } });
        await tx.complianceAlert.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, requirement_id: requirement.id, alert_key: 'MISSING_ACTIVE_ACTS', level: 'ADVERTENCIA', message: 'No hay actos activos suficientes para ejecutar la detección legal.' } });
      } else if (!revisions.length) {
        statuses.push('BLOQUEADO_POR_FALTA_DATOS'); deadlines.push(null);
        const requirement = await tx.complianceRequirement.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, provider: 'LEGAL', requirement_key: 'AUTHORITATIVE_RULES', label: 'Publicar reglas legales verificadas', status: 'BLOQUEADO_POR_FALTA_DATOS', deadline: null, source_snapshot: json({ reason: 'NO_ACTIVE_VERIFIED_RULES', legal_date: legalDate.date.toISOString() }) } });
        await tx.complianceAlert.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, requirement_id: requirement.id, alert_key: 'NO_AUTHORITATIVE_RULES', level: 'CRITICA', message: 'No existe una regla legal verificada y vigente para la fecha confirmada; no se emitió una conclusión legal.' } });
      }

      for (const item of evaluations) {
        const result = await tx.complianceRuleResult.create({ data: { organization_id: user.organizationId, review_id: review.id, rule_revision_id: item.revision.id, expediente_acto_id: item.act.id, applicability: item.result.applicability, vulnerable_activity: item.result.vulnerableActivity, notice_required: item.result.noticeRequired, notice_type: item.result.noticeType, notice_channel: item.result.noticeChannel, missing_paths: json(item.result.missingPaths), result_snapshot: json(item.result), legal_basis_snapshot: json({ legal_basis: item.result.legalBasis, revision_id: item.revision.id, checksum: item.revision.checksum }) } });
        const deadlineInfo = calculateLegalDeadline(item.result.obligation?.deadline, legalDate.date);
        const status = item.result.applicability === 'INFORMACION_INCOMPLETA' ? 'BLOQUEADO_POR_FALTA_DATOS' : item.result.applicability === 'NO_APLICA' ? 'NO_APLICA' : 'PENDIENTE';
        statuses.push(status); deadlines.push(deadlineInfo.deadline);
        const key = `${item.result.stableKey}:${item.act.id}`;
        const requirement = await tx.complianceRequirement.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, rule_result_id: result.id, provider: 'LEGAL', requirement_key: key, label: item.result.requirementLabel, status: status as any, deadline: deadlineInfo.deadline, source_snapshot: json({ rule_revision_id: item.revision.id, checksum: item.revision.checksum, missing_paths: item.result.missingPaths }) } });
        const documentStatuses = await ComplianceDocumentService.materializeForRuleResultTx(tx, user, {
          expedienteId: expediente.id, reviewId: review.id, stateId: state.id, ruleResultId: result.id,
          expedienteActoId: item.act.id, result: item.result,
          parties: expediente.comparecientes.map((party) => ({ compareciente_id: party.compareciente_id, expediente_acto_id: party.expediente_acto_id })),
          correlationId,
        });
        statuses.push(...documentStatuses);
        if (status === 'BLOQUEADO_POR_FALTA_DATOS') await tx.complianceAlert.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, requirement_id: requirement.id, rule_revision_id: item.revision.id, alert_key: `INCOMPLETE:${key}`, level: 'ADVERTENCIA', message: 'Falta información confirmada para determinar la aplicabilidad de una regla legal.', deadline: null } });
        if (deadlineInfo.deadline) {
          const alertWindow = operationalAlertWindow(deadlineInfo.deadline, alertLead);
          const now = new Date();
          const level = deadlineInfo.deadline.getTime() < now.getTime() ? 'CRITICA' : alertWindow.opens_at && alertWindow.opens_at.getTime() <= now.getTime() ? 'ADVERTENCIA' : 'INFORMATIVA';
          await tx.complianceAlert.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, state_id: state.id, review_id: review.id, requirement_id: requirement.id, rule_revision_id: item.revision.id, alert_key: `DEADLINE:${key}`, level, message: level === 'CRITICA' ? 'Una obligación jurídica aplicable se encuentra vencida y requiere atención.' : 'Existe una obligación jurídica aplicable con plazo determinado por la regla vigente.', deadline: deadlineInfo.deadline, responsible_id: expediente.abogado_id || null, ...alertWindow } });
        }
        if (item.result.obligation) await tx.complianceObligation.create({ data: { review_id: review.id, type: `${item.result.obligation.type}:${item.result.stableKey}:${item.act.id}`, legal_basis: item.result.legalBasis, rule_version: String(item.result.version), rule_status: 'ACTIVE', origin_date: legalDate.date!, due_at: deadlineInfo.deadline, channel: item.result.obligation.channel, status: 'POR_DETERMINAR', checklist: json({}), snapshot: json(item.result), rule_result_id: result.id, rule_revision_id: item.revision.id, obligation_key: item.result.obligation.key, idempotency_key: `${review.id}:${item.revision.id}:${item.act.id}:${item.result.obligation.key}`, legal_deadline_source: deadlineInfo.source } });
      }

      const nextDeadline = deadlines.filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0] || null;
      const generalState = deriveComplianceState(statuses, deadlines) as any;
      const pendingCount = statuses.filter((status) => !['CUMPLIDO', 'NO_APLICA'].includes(status)).length;
      const updatedState = await tx.expedienteComplianceState.update({ where: { id: state.id }, data: { state: generalState, pending_count: pendingCount, next_deadline: nextDeadline, updated_by_id: user.id } });
      await tx.complianceReview.update({ where: { id: review.id }, data: { resultado_json: json({ estado: updatedState.state, resultados: evaluations.length, pendientes: pendingCount }), canonical_state_snapshot: json({ state: updatedState.state, pending_count: pendingCount, next_deadline: nextDeadline?.toISOString() || null }) } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'EVALUATE_COMPLIANCE_LEGAL_ENGINE', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { engine_version: ENGINE_VERSION, estado: updatedState.state, reglas: revisions.length, resultados: evaluations.length }, correlation_id: correlationId } });
      return this.readCanonicalEvaluation(tx, review.id);
    });
  }

  static async readState(user: User, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } });
    if (!expediente) throw new ComplianceError('Expediente no encontrado.', 'COMPLIANCE_CASE_NOT_FOUND', 404);
    const state = await prisma.expedienteComplianceState.findFirst({ where: { expediente_id: expediente.id } });
    if (!state) return { state: null, requirements: [], alerts: [] };
    const [requirements, alerts] = await Promise.all([prisma.complianceRequirement.findMany({ where: { state_id: state.id, review_id: state.current_review_id || undefined }, orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }] }), prisma.complianceAlert.findMany({ where: { state_id: state.id, review_id: state.current_review_id || undefined, status: 'ABIERTA' }, orderBy: [{ level: 'desc' }, { created_at: 'asc' }] })]);
    return { state, requirements, alerts };
  }

  private static async readCanonicalEvaluation(tx: Prisma.TransactionClient, reviewId: string) {
    const review = await tx.complianceReview.findFirst({ where: { id: reviewId, is_canonical_legal_engine: true } });
    if (!review) throw new ComplianceError('Evaluación legal no encontrada.', 'COMPLIANCE_REVIEW_NOT_FOUND', 404);
    const state = await tx.expedienteComplianceState.findFirst({ where: { current_review_id: review.id } });
    const [results, requirements, alerts, obligations] = await Promise.all([
      tx.complianceRuleResult.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      tx.complianceRequirement.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      tx.complianceAlert.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      tx.complianceObligation.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
    ]);
    return { review, state, results, requirements, alerts, obligations };
  }
}
