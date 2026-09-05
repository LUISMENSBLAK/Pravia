import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { ComplianceError } from '../domain/compliance';
import { selectCanonicalDeed } from '../domain/complianceH6';
import {
  compareManifests, h9Hash, h9Readiness, manifestFingerprint, normalizeManifest,
  validateH9Result, type H9SourceManifestEntry,
} from '../domain/complianceH9';
import { runH9ReviewWithOpenAI, type H9AiAdapter } from './complianceH9.ai';
import { recordAIUsageInDb, recordAIFailure } from './aiUsage.service';
import { recordComplianceActivityTx } from './complianceH7.service';

type User = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sourceRef = (entry: H9SourceManifestEntry) => `${entry.source_type}:${entry.entity_id}:${entry.path}`;

function compact(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && item !== null)
    .map(([key, item]) => [key, compact(item)]));
  return value;
}

function factualDocumentFields(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const allowed = /campo|valor|dato|field|item|nombre|razon|rfc|curp|domicilio|direccion|calle|colonia|municipio|estado|pais|fecha|rol|caracter|importe|monto|moneda|pagador|receptor|cuenta|referencia|firma|pago|persona/i;
  const walk = (input: unknown, depth = 0): unknown => {
    if (depth > 4 || input == null || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.slice(0, 200).map((item) => walk(item, depth + 1));
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .filter(([key]) => allowed.test(key))
      .map(([key, item]) => [key, walk(item, depth + 1)]));
  };
  return walk(value);
}

function manifestEntry(source_type: string, entity_id: string, path: string, value: unknown, purpose: string[], extra: Partial<H9SourceManifestEntry> = {}): H9SourceManifestEntry {
  return {
    source_type, entity_id, revision_id: extra.revision_id || null,
    checksum: extra.checksum || h9Hash(compact(value)), document_id: extra.document_id || null,
    path, purpose,
  };
}

export class ComplianceH9Service {
  constructor(private readonly db: Db = prisma, private readonly ai: H9AiAdapter = runH9ReviewWithOpenAI) {}

  private requireRunPermission(user: User) {
    if (!user.permissions.includes('compliance.review') || !user.permissions.includes('ia.execute')) {
      throw new ComplianceError('No tienes autorización para ejecutar esta revisión asistida.', 'H9_PERMISSION_DENIED', 403);
    }
  }

  private async buildDataset(user: User, expedienteId: string) {
    const db = this.db as any;
    const expediente = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) },
      select: {
        id: true, numero_pravia: true, numero_notaria: true, estatus: true, version: true,
        fecha_apertura: true, fecha_estimada_firma: true, fecha_real_firma: true, valor_operacion: true, datos_operacion: true,
        actos: { where: { estatus: 'ACTIVO', removed_at: null }, orderBy: { id: 'asc' }, select: { id: true, version: true, tipo_acto: { select: { id: true, nombre: true } } } },
        comparecientes: { where: { estatus: 'ACTIVO', archived_at: null }, select: {
          id: true, expediente_acto_id: true, compareciente_id: true, datos_validados: true,
          caracter: { select: { clave: true, nombre: true } },
          compareciente: { select: {
            id: true, version: true, tipo_persona: true, nombre_busqueda: true,
            personaFisica: { select: { nombre_completo_calculado: true, rfc: true, curp: true, fecha_nacimiento: true } },
            personaMoral: { select: { razon_social: true, rfc: true, fecha_constitucion: true } },
            domicilios: { where: { vigente: true, archived_at: null }, orderBy: { id: 'asc' }, select: { id: true, tipo: true, pais: true, estado: true, municipio: true, localidad: true, colonia: true, calle: true, exterior: true, interior: true, codigo_postal: true, comprobado: true, documento_comprobante_id: true } },
          } },
        }, orderBy: { id: 'asc' } },
      },
    });
    if (!expediente) throw new ComplianceError('No tienes acceso a este expediente.', 'H9_CASE_ACCESS_DENIED', 403);
    const state = await db.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, expediente_id: expediente.id }, select: { id: true, current_review_id: true, state: true, version: true } });
    const reviewId = state?.current_review_id || null;
    const where = { organization_id: user.organizationId, expediente_id: expediente.id };
    const [requirements, screenings, questionnaires, payments, bcEvaluations, obligations, projectLinks] = await Promise.all([
      reviewId ? db.complianceRequirement.findMany({ where: { ...where, review_id: reviewId }, select: {
        id: true, provider: true, requirement_key: true, label: true, status: true, deadline: true, source_snapshot: true,
        requires_signed_document: true, requires_human_validation: true, missing_action: true, action_target: true,
        evidence: { where: { estatus: 'ACTIVO' }, orderBy: { id: 'asc' }, select: { id: true, document_version: true, document_checksum_snapshot: true, document_state: true, validation_status: true, source: true, documento: { select: { id: true, tipo: true, categoria: true, checksum_sha256: true, datos_extraidos: true } } } },
      }, orderBy: [{ provider: 'asc' }, { requirement_key: 'asc' }] }) : [],
      reviewId ? db.complianceScreeningResult.findMany({ where: { organization_id: user.organizationId, review_id: reviewId }, select: { id: true, compareciente_id: true, provider: true, provider_version: true, status: true, execution_state: true, identity_fingerprint: true, human_decision: true, match_evidence: true }, orderBy: { id: 'asc' } }) : [],
      reviewId ? db.complianceQuestionnaireAssessment.findMany({ where: { ...where, review_id: reviewId }, select: { id: true, identity_key: true, scope: true, target_compareciente_id: true, currentRevision: { select: { id: true, revision_number: true, status: true, answers: true, definition_checksum: true, completeness: true, evaluation_status: true, evaluation_snapshot: true, semantic_fingerprint: true } } }, orderBy: { identity_key: 'asc' } }) : [],
      db.complianceOperationPayment.findMany({ where: { ...where, current_revision_id: { not: null } }, select: { id: true, currentRevision: { select: { id: true, revision_number: true, status: true, amount_original: true, currency_original: true, payment_date: true, method_code: true, institution: true, reference: true, account_last4: true, account_fingerprint: true, payer_raw: true, payee_raw: true, equivalent_mxn: true, declared_paid: true, declared_pending: true, semantic_fingerprint: true, parties: { orderBy: { id: 'asc' }, select: { role: true, display_name_snapshot: true, expediente_compareciente_id: true } }, evidence: { orderBy: { id: 'asc' }, select: { id: true, evidence_id: true, relation_kind: true } }, verifications: { orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, project_document_id: true, project_document_version: true, project_document_checksum: true, comparison_snapshot: true, status: true, semantic_fingerprint: true } } } } }, orderBy: { id: 'asc' } }),
      reviewId ? db.complianceBcEvaluation.findMany({ where: { ...where, review_id: reviewId }, select: { id: true, snapshot_id: true, regime: true, status: true, logical_hash: true, rule_set_checksum: true, input_snapshot: true, result_snapshot: true, results: { orderBy: { id: 'asc' }, select: { id: true, subject_compareciente_id: true, determination: true, facts_snapshot: true, result_snapshot: true } }, snapshot: { select: { structure_revision: true, structure_fingerprint: true, incomplete_markers: true } } }, orderBy: { id: 'asc' } }) : [],
      db.complianceObligation.findMany({ where, select: { id: true, legal_obligation_key: true, avi_state: true, freshness: true, review_needed: true, due_at: true, stable_identity_hash: true, ficheRevisions: { orderBy: [{ revision_number: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, revision_number: true, status: true, version: true, source_fingerprint: true, source_manifest: true, local_values: true } }, officialProducts: { orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, documento_id: true, checksum: true, source_fingerprint: true } }, presentations: { orderBy: [{ presented_at: 'desc' }, { id: 'desc' }], select: { id: true, kind: true, presented_at: true, external_folio: true, product_id: true, fiche_revision_id: true, acknowledgements: { orderBy: { id: 'asc' }, select: { id: true, documento_id: true, evidence_id: true, acknowledgement_type: true, received_at: true, checksum: true } } } } }, orderBy: { id: 'asc' } }),
      db.expedienteDocumento.findMany({ where: { ...where, estatus: 'ACTIVO', document_role: { in: ['DEFINITIVE_DEED', 'PROJECT_DRAFT'] } }, orderBy: { id: 'asc' }, select: { id: true, document_role: true, document_version: true, source_key: true, documento: { select: { id: true, checksum_sha256: true, fecha_carga: true, datos_extraidos: true, tipo: true, categoria: true } } } }),
    ]);
    const canonicalDocument: any = projectLinks.length ? selectCanonicalDeed(projectLinks as any) : null;
    const manifest: H9SourceManifestEntry[] = [];
    const core = compact({ id: expediente.id, version: expediente.version, numero_pravia: expediente.numero_pravia, numero_notaria: expediente.numero_notaria, estatus: expediente.estatus, fecha_apertura: expediente.fecha_apertura, fecha_estimada_firma: expediente.fecha_estimada_firma, fecha_real_firma: expediente.fecha_real_firma, valor_operacion: expediente.valor_operacion, datos_operacion: expediente.datos_operacion, actos: expediente.actos });
    manifest.push(manifestEntry('EXPEDIENTE_STRUCTURED', expediente.id, 'expediente.operation', core, ['OPERATION', 'DATES', 'ROLES']));
    for (const relation of expediente.comparecientes) manifest.push(manifestEntry('EXPEDIENTE_COMPARECIENTE', relation.id, 'comparecientes.identity-role-address', relation, ['NAMES', 'RFC', 'CURP', 'ADDRESSES', 'ROLES', 'DATES'], { revision_id: String(relation.compareciente.version) }));
    for (const requirement of requirements) {
      manifest.push(manifestEntry('COMPLIANCE_REQUIREMENT', requirement.id, `requirements.${requirement.requirement_key}`, requirement, ['DOCUMENTAL', 'SIGNED_FORMAT', 'CURRENT_STATE']));
      for (const evidence of requirement.evidence) manifest.push(manifestEntry('COMPLIANCE_EVIDENCE', evidence.id, 'evidence.current-document', evidence, ['DOCUMENTAL', 'SIGNED_FORMAT', 'PAYMENT_RECEIPT'], { revision_id: evidence.document_version || evidence.document_checksum_snapshot || evidence.documento.checksum_sha256, checksum: evidence.document_checksum_snapshot || evidence.documento.checksum_sha256 || h9Hash(evidence), document_id: evidence.documento.id }));
    }
    for (const item of screenings) manifest.push(manifestEntry('COMPLIANCE_SCREENING', item.id, 'screening.current-result', item, ['SCREENING_IDENTITY', 'SCREENING_STATUS'], { revision_id: item.provider_version, checksum: item.identity_fingerprint || h9Hash(item) }));
    for (const item of questionnaires) if (item.currentRevision) manifest.push(manifestEntry('COMPLIANCE_QUESTIONNAIRE', item.id, 'questionnaire.current-revision', item.currentRevision, ['QUESTIONNAIRE_PRESENCE', 'QUESTIONNAIRE_CONFLICTS'], { revision_id: item.currentRevision.id, checksum: item.currentRevision.semantic_fingerprint }));
    for (const payment of payments) if (payment.currentRevision) manifest.push(manifestEntry('COMPLIANCE_OPERATION_PAYMENT', payment.id, 'payments.current-revision', payment.currentRevision, ['PAYMENT_RECEIPT', 'PAYMENT_DEED'], { revision_id: payment.currentRevision.id, checksum: payment.currentRevision.semantic_fingerprint }));
    for (const item of bcEvaluations) manifest.push(manifestEntry('COMPLIANCE_BC_EVALUATION', item.id, 'beneficial-controller.pinned-result', item, ['BC_CONSISTENCY'], { revision_id: item.snapshot_id, checksum: item.logical_hash }));
    for (const item of obligations) manifest.push(manifestEntry('COMPLIANCE_AVI', item.id, 'notices.current-lineage', item, ['AVI_FICHE', 'AVI_PRODUCT', 'AVI_PRESENTATION', 'AVI_ACKNOWLEDGEMENT'], { revision_id: item.ficheRevisions[0]?.id || null, checksum: item.ficheRevisions[0]?.source_fingerprint || item.stable_identity_hash || h9Hash(item) }));
    const canonicalVersion = canonicalDocument ? canonicalDocument.document_version || canonicalDocument.documento.checksum_sha256 || canonicalDocument.documento.fecha_carga?.toISOString() || h9Hash(canonicalDocument.documento.datos_extraidos) : null;
    if (canonicalDocument) manifest.push(manifestEntry('CANONICAL_DEED', canonicalDocument.id, 'project-deed.extracted-facts', canonicalDocument.documento.datos_extraidos, ['NAMES', 'RFC', 'CURP', 'ADDRESSES', 'DATES', 'ROLES', 'PAYMENT_DEED'], { revision_id: canonicalVersion, checksum: canonicalDocument.documento.checksum_sha256 || h9Hash(canonicalDocument.documento.datos_extraidos), document_id: canonicalDocument.documento.id }));
    const normalizedManifest = normalizeManifest(manifest);
    const safeRequirements = requirements.map((requirement: any) => ({ ...requirement, evidence: requirement.evidence.map((evidence: any) => ({ ...evidence, documento: { ...evidence.documento, datos_extraidos: factualDocumentFields(evidence.documento.datos_extraidos) } })) }));
    const dataset = compact({
      expediente: core,
      compliance_context: state ? { review_id: reviewId, state_id: state.id, state: state.state, version: state.version } : null,
      personas_roles: expediente.comparecientes,
      requirements: safeRequirements,
      screening: screenings,
      questionnaires,
      payments,
      beneficial_controller: bcEvaluations,
      notices: obligations,
      canonical_project_or_deed: canonicalDocument ? { link_id: canonicalDocument.id, role: canonicalDocument.document_role, document_id: canonicalDocument.documento.id, version: canonicalVersion, checksum: canonicalDocument.documento.checksum_sha256, factual_fields: factualDocumentFields(canonicalDocument.documento.datos_extraidos) } : null,
    }) as Record<string, unknown>;
    const meaningful = normalizedManifest.filter((item) => item.source_type !== 'EXPEDIENTE_STRUCTURED');
    return { expediente, reviewId, dataset, manifest: normalizedManifest, meaningful, fingerprint: manifestFingerprint(normalizedManifest), canonicalDocument };
  }

  async workspace(user: User, expedienteId: string) {
    const current = await this.buildDataset(user, expedienteId);
    const readiness = h9Readiness({ expediente: true, reviewId: current.reviewId, manifest: current.meaningful });
    const history = await (this.db as any).complianceAssistedReview.findMany({
      where: { organization_id: user.organizationId, expediente_id: expedienteId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    const userIds = [...new Set(history.map((item: any) => item.executed_by_id))] as string[];
    const users = userIds.length ? await (this.db as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, nombre: true, apellido: true } }) : [];
    const userMap = new Map(users.map((item: any) => [item.id, `${item.nombre} ${item.apellido}`.trim()]));
    const items = history.map((item: any) => {
      const freshness = compareManifests(item.source_manifest as H9SourceManifestEntry[], current.manifest);
      return {
        id: item.id, created_at: item.created_at, executed_by: { id: item.executed_by_id, name: userMap.get(item.executed_by_id) || 'Usuario' },
        freshness: freshness.stale ? 'DESACTUALIZADA' : 'ACTUAL', changes: freshness.changes,
        correct_count: item.correct_count, observation_count: item.observation_count, critical_count: item.critical_count,
        result: item.result_json, provider: item.provider, model: item.model, prompt_version: item.prompt_version, output_schema_version: item.output_schema_version,
        canonical_document: item.canonical_document_id ? { id: item.canonical_document_id, version: item.canonical_document_version, checksum: item.canonical_document_checksum, role: item.canonical_document_role } : null,
      };
    });
    return { readiness, latest: items[0] || null, history: items };
  }

  async run(user: User, expedienteId: string, body: any, correlationId?: string) {
    this.requireRunPermission(user);
    const idempotencyKey = String(body?.idempotency_key || '').trim().slice(0, 160);
    if (idempotencyKey.length < 8) throw new ComplianceError('La revisión requiere una clave de idempotencia.', 'H9_IDEMPOTENCY_REQUIRED', 400);
    const existing = await (this.db as any).complianceAssistedReview.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey } });
    if (existing) return { review: existing, idempotent: true };
    const current = await this.buildDataset(user, expedienteId);
    const readiness = h9Readiness({ expediente: true, reviewId: current.reviewId, manifest: current.meaningful });
    if (readiness.status === 'NOT_READY') throw new ComplianceError(readiness.causes.join(' '), 'H9_NOT_READY', 409);
    let response;
    const operationId = `h9:${user.organizationId}:${expedienteId}:${idempotencyKey}`;
    try {
      response = await this.ai({ dataset: current.dataset, source_manifest: current.manifest.map((entry) => ({ ...entry, source_ref: sourceRef(entry) })) });
    } catch (error) {
      await recordAlaugFailureSafe(user, expedienteId, operationId, error);
      throw new ComplianceError('No fue posible completar la revisión asistida. Los datos permanecen sin cambios.', 'H9_AI_FAILED', 502);
    }
    let result;
    try { result = validateH9Result(response.result, new Set(current.manifest.map(sourceRef))); }
    catch {
      await recordAIFailure({ organizationId: user.organizationId, usuarioId: user.id, expedienteId, operacion: 'CUM_AUD_ASSISTED_REVIEW', operationId, modelo: response.model, errorCode: 'H9_AI_OUTPUT_INVALID' }).catch(() => undefined);
      throw new ComplianceError('La respuesta asistida no cumplió el contrato estructurado. Los datos permanecen sin cambios.', 'H9_AI_OUTPUT_INVALID', 502);
    }
    return (this.db as any).$transaction(async (tx: any) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h9:run:${user.organizationId}:${expedienteId}:${idempotencyKey}`}))`);
      const repeated = await tx.complianceAssistedReview.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey } });
      if (repeated) return { review: repeated, idempotent: true };
      const created = await tx.complianceAssistedReview.create({ data: {
        organization_id: user.organizationId, expediente_id: expedienteId, compliance_review_id: current.reviewId!, executed_by_id: user.id, idempotency_key: idempotencyKey,
        dataset_snapshot: json(current.dataset), dataset_fingerprint: current.fingerprint, source_manifest: json(current.manifest),
        canonical_document_id: current.canonicalDocument?.documento.id || null, canonical_document_version: current.canonicalDocument ? current.canonicalDocument.document_version || current.canonicalDocument.documento.checksum_sha256 || current.canonicalDocument.documento.fecha_carga?.toISOString() || h9Hash(current.canonicalDocument.documento.datos_extraidos) : null,
        canonical_document_checksum: current.canonicalDocument?.documento.checksum_sha256 || null, canonical_document_role: current.canonicalDocument?.document_role || null,
        provider: response.provider, model: response.model, prompt_version: response.prompt_version, output_schema_version: response.schema_version,
        result_json: json(result), result_checksum: h9Hash(result), correct_count: result.correct_count,
        observation_count: result.observations.length, critical_count: result.critical_inconsistencies.length,
      } });
      await recordAIUsageInDb(tx, response.usage, { organizationId: user.organizationId, usuarioId: user.id, expedienteId, operacion: 'CUM_AUD_ASSISTED_REVIEW', operationId, metadata: { assisted_review_id: created.id, prompt_version: response.prompt_version, schema_version: response.schema_version } });
      await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'H9_RUN_ASSISTED_COMPLIANCE_REVIEW', entidad: 'ComplianceAssistedReview', entidad_id: created.id, detalles: json({ expediente_id: expedienteId, compliance_review_id: current.reviewId, dataset_fingerprint: current.fingerprint, result_checksum: created.result_checksum }), correlation_id: correlationId, session_id: user.sessionId } });
      await recordComplianceActivityTx(tx, { organizationId: user.organizationId, expedienteId, actorUserId: user.id, action: 'ASSISTED_COMPLIANCE_REVIEW_COMPLETED', entity: 'ComplianceAssistedReview', entityId: created.id, title: 'Revisión de Cumplimiento ejecutada', description: `${result.correct_count} verificaciones correctas, ${result.observations.length} observaciones y ${result.critical_inconsistencies.length} inconsistencias críticas.`, idempotencyKey: `h9:review:${created.id}`, correlationId, metadata: { source: 'H9-CUM-AUD', assisted_review_id: created.id } });
      return { review: created, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

async function recordAlaugFailureSafe(user: User, expedienteId: string, operationId: string, error: unknown) {
  await recordAIFailure({ organizationId: user.organizationId, usuarioId: user.id, expedienteId, operacion: 'CUM_AUD_ASSISTED_REVIEW', operationId, modelo: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5.4-mini', errorCode: error instanceof Error ? error.message.slice(0, 80) : 'H9_AI_FAILED' }).catch(() => undefined);
}

export const complianceH9Service = new ComplianceH9Service();
