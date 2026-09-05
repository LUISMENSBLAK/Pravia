import { createHash, randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import {
  deriveScreeningExecutionState,
  requirementStateFromScreening,
  screeningCandidateScore,
  screeningIdentityFingerprint,
  type H3IdentitySnapshot,
  type H3ScreeningProvider,
} from '../domain/complianceScreening';
import { deriveComplianceState } from '../domain/complianceLegalEngine';
import { renderScreeningQueryReportPdf } from '../domain/screeningReportPdf';
import { deleteFile, uploadFile } from './supabase.service';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { comparecienteObjectWhere } from './objectAccess.service';
import { recordComplianceActivityTx } from './complianceH7.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
type TriggerReason = 'COMPARECIENTE_CREATED' | 'RELEVANT_IDENTITY_CHANGED' | 'VULNERABLE_OPERATION' | 'MANUAL_RERUN' | 'FREE_SEARCH';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const finalStates = ['NOT_CONFIGURED', 'SUCCEEDED'] as const;
const retryableStates = ['PARTIAL', 'ERROR'] as const;

export class ScreeningError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const need = (actor: Actor, permission: string) => {
  if (!actor.permissions.includes(permission as any)) throw new ScreeningError(403, 'SCREENING_PERMISSION_DENIED', 'No tienes permiso para realizar esta acción.');
};

const dateOnly = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;
const normalized = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es-MX');
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])]));
  return value;
};
const stableJson = (value: unknown) => JSON.stringify(canonicalJson(value));
const SCREENING_REPORT_FORMAT_VERSION = 'CUM-LST-001-REPORT-V1';

const compareStableText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const compareNullableStableText = (left: unknown, right: unknown) => {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  return compareStableText(String(left), String(right));
};
const compareNullableStableTextDesc = (left: unknown, right: unknown) => {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return compareStableText(String(right), String(left));
};
const stableDateKey = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? null : String(value);
const firstNonZero = (...comparisons: number[]) => comparisons.find((comparison) => comparison !== 0) || 0;

const currentScreeningResolution = (resolutions: any[]) => [...(resolutions || [])].sort((left, right) => firstNonZero(
  compareNullableStableTextDesc(stableDateKey(left.created_at), stableDateKey(right.created_at)),
  compareNullableStableTextDesc(left.id, right.id),
))[0] || null;

export const buildScreeningReportSnapshot = (query: any) => {
  const sourceExecutions = [...(query.sourceExecutions || [])].sort((left, right) => firstNonZero(
    compareNullableStableText(left.source_id || left.source?.id, right.source_id || right.source?.id),
    compareNullableStableText(left.source_version_id || left.sourceVersion?.id, right.source_version_id || right.sourceVersion?.id),
    compareNullableStableText(left.id, right.id),
  ));
  const candidates = [...(query.candidates || [])].sort((left, right) => firstNonZero(
    compareNullableStableText(left.source_execution_id, right.source_execution_id),
    compareNullableStableText(left.stable_candidate_id, right.stable_candidate_id),
    compareNullableStableText(left.id, right.id),
  ));
  return {
    format_version: SCREENING_REPORT_FORMAT_VERSION,
    query: {
      id: query.id,
      contract_version: query.contract_version,
      query_kind: query.query_kind,
      execution_state: query.execution_state,
      identity_fingerprint: query.identity_fingerprint || null,
      identity: query.query_snapshot,
    },
    sources: sourceExecutions.map((execution: any) => ({
      execution_id: execution.id,
      source_id: execution.source_id || execution.source?.id || null,
      source_name: execution.source.display_name,
      source_version_id: execution.source_version_id || execution.sourceVersion?.id || null,
      source_version: execution.sourceVersion?.version || null,
      execution_state: execution.execution_state,
    })),
    candidates: candidates.map((candidate: any) => ({
      candidate_id: candidate.id,
      source_execution_id: candidate.source_execution_id,
      stable_candidate_id: candidate.stable_candidate_id || null,
      source_record_ref: candidate.source_record_ref,
      display_name: candidate.display_name,
      score: candidate.score?.toString() || 'n/d',
      latest_decision: currentScreeningResolution(candidate.resolutions)?.decision || 'PENDIENTE_DE_REVISION',
    })),
  };
};

export const screeningReportSemanticFingerprint = (snapshot: ReturnType<typeof buildScreeningReportSnapshot>) =>
  createHash('sha256').update(stableJson(snapshot)).digest('hex');

export const renderScreeningReportSnapshotPdf = (snapshot: ReturnType<typeof buildScreeningReportSnapshot>, generatedAt: string) =>
  renderScreeningQueryReportPdf({
    queryId: snapshot.query.id,
    generatedAt,
    queryKind: snapshot.query.query_kind,
    executionState: snapshot.query.execution_state,
    identityLabel: (snapshot.query.identity as any).primary_name || 'Identidad consultada',
    sources: snapshot.sources.map((source) => ({ name: source.source_name, version: source.source_version, state: source.execution_state })),
    candidates: snapshot.candidates.map((candidate) => ({ reference: candidate.source_record_ref, name: candidate.display_name, score: candidate.score, decision: candidate.latest_decision })),
  });

export async function loadScreeningIdentity(db: Db, organizationId: string, comparecienteId: string): Promise<H3IdentitySnapshot> {
  const record = await db.compareciente.findFirst({
    where: { id: comparecienteId, organization_id: organizationId, archived_at: null },
    include: {
      personaFisica: true,
      personaMoral: true,
      aliases: { where: { activo: true, archived_at: null }, orderBy: [{ principal: 'desc' }, { created_at: 'asc' }] },
      identificaciones: { where: { archived_at: null, principal: true }, orderBy: { updated_at: 'desc' }, take: 1 },
    },
  });
  if (!record) throw new ScreeningError(404, 'SCREENING_COMPARECIENTE_NOT_FOUND', 'Compareciente no encontrado.');
  const identification = record.identificaciones[0];
  if (record.tipo_persona === 'FISICA') return {
    tipo_persona: 'FISICA', primary_name: record.personaFisica?.nombre_completo_calculado || record.nombre_busqueda,
    aliases: record.aliases.map((item) => item.alias), birth_date: dateOnly(record.personaFisica?.fecha_nacimiento),
    birth_place: record.personaFisica?.lugar_nacimiento || null, birth_country: record.personaFisica?.pais_nacimiento || null,
    nationality: record.personaFisica?.nacionalidad || null, curp: record.personaFisica?.curp || null,
    rfc: record.personaFisica?.rfc || null,
    identification: identification ? { type: identification.tipo_identificacion, number: identification.numero || null, country: identification.pais_emisor || null } : null,
    incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null,
  };
  return {
    tipo_persona: 'MORAL', primary_name: record.personaMoral?.razon_social || record.nombre_busqueda,
    aliases: record.aliases.map((item) => item.alias), birth_date: null, birth_place: null, birth_country: null,
    nationality: record.personaMoral?.nacionalidad || null, curp: null, rfc: record.personaMoral?.rfc || null,
    identification: identification ? { type: identification.tipo_identificacion, number: identification.numero || null, country: identification.pais_emisor || null } : null,
    incorporation_date: dateOnly(record.personaMoral?.fecha_constitucion), commercial_name: record.personaMoral?.nombre_comercial || null,
    commercial_folio: record.personaMoral?.folio_mercantil || null, corporate_type: record.personaMoral?.tipo_societario || null,
  };
}

type QueueMasterInput = {
  organizationId: string; comparecienteId: string; requestedById: string | null;
  triggerReason: Exclude<TriggerReason, 'FREE_SEARCH'>; triggerKey: string; triggerEventId?: string | null;
  correlationId?: string | null; reviewId?: string | null;
};

export async function queueMasterScreeningTx(db: Db, input: QueueMasterInput) {
  await db.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h3:master:${input.organizationId}:${input.triggerKey}`);
  const prior = await db.complianceScreeningResult.findFirst({ where: { organization_id: input.organizationId, trigger_key: input.triggerKey, contract_version: 'CUM-LST-001' } });
  if (prior) return { query: prior, idempotent: true };
  const identity = await loadScreeningIdentity(db, input.organizationId, input.comparecienteId);
  const sources = await db.screeningSource.findMany({
    where: { organization_id: input.organizationId, status: 'ACTIVE' },
    include: { versions: { where: { status: 'ACTIVE' }, take: 1 } }, orderBy: { code: 'asc' },
  });
  const executable = sources.filter((source) => source.versions.length > 0);
  const now = new Date();
  const query = await db.complianceScreeningResult.create({ data: {
    organization_id: input.organizationId, review_id: input.reviewId || null, compareciente_id: input.comparecienteId,
    provider: 'H3_VERSIONED_SOURCE_SET', status: 'QUEUED', queried_at: null, query_snapshot: json(identity),
    contract_version: 'CUM-LST-001', query_kind: 'MASTER', execution_state: 'QUEUED',
    trigger_reason: input.triggerReason, trigger_key: input.triggerKey, trigger_event_id: input.triggerEventId || null,
    requested_by_id: input.requestedById, identity_fingerprint: screeningIdentityFingerprint(identity),
    completed_at: null, correlation_id: input.correlationId || randomUUID(),
  } });
  for (const source of sources) {
    const version = source.versions[0];
    await db.screeningSourceExecution.create({ data: {
      organization_id: input.organizationId, query_id: query.id, source_id: source.id, source_version_id: version?.id || null,
      execution_state: version ? 'QUEUED' : 'NOT_CONFIGURED', completed_at: version ? null : now,
      result_summary: version ? undefined : json({ reason: 'ACTIVE_SOURCE_WITHOUT_ACTIVE_VERSION' }),
    } });
  }
  const finalQuery = executable.length ? query : await db.complianceScreeningResult.update({
    where: { id: query.id }, data: { status: 'NOT_CONFIGURED', execution_state: 'NOT_CONFIGURED', completed_at: now },
  });
  await db.auditLog.create({ data: {
    organization_id: input.organizationId, user_id: input.requestedById!, accion: 'SCREENING_QUERY_QUEUED',
    entidad: 'ComplianceScreeningResult', entidad_id: query.id,
    detalles: json({ query_kind: 'MASTER', trigger_reason: input.triggerReason, compareciente_id: input.comparecienteId, execution_state: finalQuery.execution_state }),
    correlation_id: input.correlationId || undefined, event_id: input.triggerEventId || undefined,
  } });
  return { query: finalQuery, idempotent: false };
}

export async function enqueueComparecienteCreatedTx(db: Db, input: {
  organizationId: string; comparecienteId: string; actorUserId: string; tipoPersona: 'FISICA' | 'MORAL';
  correlationId: string; identityLabel?: string | null;
}) {
  const event = await db.domainEventOutbox.create({ data: {
    organization_id: input.organizationId,
    event_type: 'ComparecienteCreado', aggregate_type: 'Compareciente', aggregate_id: input.comparecienteId,
    actor_user_id: input.actorUserId, correlation_id: input.correlationId,
    payload: json({ compareciente_id: input.comparecienteId, tipo_persona: input.tipoPersona, identity_label: input.identityLabel || null, actor_user_id: input.actorUserId }),
  } });
  const queued = await queueMasterScreeningTx(db, {
    organizationId: input.organizationId, comparecienteId: input.comparecienteId, requestedById: input.actorUserId,
    triggerReason: 'COMPARECIENTE_CREATED', triggerKey: `event:${event.id}`, triggerEventId: event.id,
    correlationId: input.correlationId,
  });
  return { event, ...queued };
}

export async function linkOperationSnapshotTx(db: Db, input: {
  organizationId: string; requirementId: string; queryId: string; capturedById: string | null;
}) {
  const existing = await db.screeningOperationSnapshot.findFirst({ where: { organization_id: input.organizationId, requirement_id: input.requirementId, query_id: input.queryId } });
  if (existing) return existing;
  const executions = await db.screeningSourceExecution.findMany({ where: { organization_id: input.organizationId, query_id: input.queryId }, include: { source: true, sourceVersion: true } });
  const candidates = await db.screeningCandidate.findMany({ where: { organization_id: input.organizationId, query_id: input.queryId }, include: { resolutions: { orderBy: { created_at: 'desc' }, take: 1 } } });
  const unresolved = candidates.filter((candidate) => !candidate.resolutions[0] || candidate.resolutions[0].decision === 'REVISION_ADICIONAL').length;
  const snapshot = await db.screeningOperationSnapshot.create({ data: {
    organization_id: input.organizationId, requirement_id: input.requirementId, query_id: input.queryId,
    source_summary: json(executions.map((item) => ({ source_id: item.source_id, source_name: item.source.display_name, source_version_id: item.source_version_id, version: item.sourceVersion?.version || null, state: item.execution_state }))),
    resolution_summary: json(candidates.map((candidate) => ({ candidate_id: candidate.id, decision: candidate.resolutions[0]?.decision || null }))),
    unresolved_count: unresolved, captured_by_id: input.capturedById,
  } });
  if (input.capturedById) await db.auditLog.create({ data: { organization_id: input.organizationId, user_id: input.capturedById, accion: 'SCREENING_OPERATION_SNAPSHOT_LINKED', entidad: 'ScreeningOperationSnapshot', entidad_id: snapshot.id, detalles: json({ requirement_id: input.requirementId, query_id: input.queryId }) } });
  return snapshot;
}

export class ComplianceScreeningService {
  constructor(private readonly db: PrismaClient = prisma, private readonly providers: Map<string, H3ScreeningProvider> = new Map()) {}

  async current(actor: Actor, comparecienteId: string) {
    need(actor, 'comparecientes.read'); need(actor, 'compliance.read'); need(actor, 'compliance.sensitive.read');
    await this.assertCompareciente(actor, comparecienteId);
    const history = await this.db.complianceScreeningResult.findMany({
      where: { organization_id: actor.organizationId, compareciente_id: comparecienteId, query_kind: 'MASTER', contract_version: 'CUM-LST-001' },
      include: this.queryInclude(), orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    return { current: history[0] ? this.present(history[0]) : null, history: history.map((item) => this.present(item)) };
  }

  async manualRerun(actor: Actor, comparecienteId: string, idempotencyKey: string, correlationId?: string) {
    need(actor, 'comparecientes.read'); need(actor, 'compliance.read'); need(actor, 'compliance.sensitive.read');
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    await this.assertCompareciente(actor, comparecienteId);
    const key = normalized(idempotencyKey).slice(0, 120);
    if (!key) throw new ScreeningError(400, 'SCREENING_IDEMPOTENCY_REQUIRED', 'La consulta requiere una clave de idempotencia.');
    const queued = await this.db.$transaction((tx) => queueMasterScreeningTx(tx, {
      organizationId: actor.organizationId, comparecienteId, requestedById: actor.id,
      triggerReason: 'MANUAL_RERUN', triggerKey: `manual:${comparecienteId}:${key}`, correlationId,
    }));
    if (!queued.idempotent && queued.query.execution_state === 'QUEUED') await this.execute(actor.organizationId, queued.query.id, actor.id, correlationId);
    return this.readQuery(actor.organizationId, queued.query.id);
  }

  async freeSearch(actor: Actor, identity: H3IdentitySnapshot, idempotencyKey: string, correlationId?: string) {
    need(actor, 'compliance.write'); need(actor, 'compliance.sensitive.read');
    if (!identity.primary_name?.trim()) throw new ScreeningError(400, 'SCREENING_IDENTITY_REQUIRED', 'Escribe la identidad que deseas consultar.');
    const key = normalized(idempotencyKey).slice(0, 120);
    if (!key) throw new ScreeningError(400, 'SCREENING_IDEMPOTENCY_REQUIRED', 'La consulta requiere una clave de idempotencia.');
    const triggerKey = `free:${actor.id}:${key}`;
    const queued = await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h3:free:${actor.organizationId}:${triggerKey}`);
      const prior = await tx.complianceScreeningResult.findFirst({ where: { organization_id: actor.organizationId, trigger_key: triggerKey, owner_user_id: actor.id, query_kind: 'FREE' } });
      if (prior) return { query: prior, idempotent: true };
      const sources = await tx.screeningSource.findMany({ where: { organization_id: actor.organizationId, status: 'ACTIVE' }, include: { versions: { where: { status: 'ACTIVE' }, take: 1 } }, orderBy: { code: 'asc' } });
      const executable = sources.filter((source) => source.versions.length);
      const now = new Date();
      const created = await tx.complianceScreeningResult.create({ data: {
        organization_id: actor.organizationId, provider: 'H3_VERSIONED_SOURCE_SET', status: 'QUEUED', query_snapshot: json(identity),
        contract_version: 'CUM-LST-001', query_kind: 'FREE', execution_state: 'QUEUED', trigger_reason: 'FREE_SEARCH',
        trigger_key: triggerKey, owner_user_id: actor.id, requested_by_id: actor.id,
        identity_fingerprint: screeningIdentityFingerprint(identity), completed_at: null,
        correlation_id: correlationId || randomUUID(),
      } });
      for (const source of sources) await tx.screeningSourceExecution.create({ data: {
        organization_id: actor.organizationId, query_id: created.id, source_id: source.id, source_version_id: source.versions[0]?.id || null,
        execution_state: source.versions[0] ? 'QUEUED' : 'NOT_CONFIGURED', completed_at: source.versions[0] ? null : now,
        result_summary: source.versions[0] ? undefined : json({ reason: 'ACTIVE_SOURCE_WITHOUT_ACTIVE_VERSION' }),
      } });
      const finalQuery = executable.length ? created : await tx.complianceScreeningResult.update({ where: { id: created.id }, data: { status: 'NOT_CONFIGURED', execution_state: 'NOT_CONFIGURED', completed_at: now } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'SCREENING_QUERY_QUEUED', entidad: 'ComplianceScreeningResult', entidad_id: created.id, detalles: json({ query_kind: 'FREE', execution_state: finalQuery.execution_state }), correlation_id: correlationId } });
      return { query: finalQuery, idempotent: false };
    });
    if (!queued.idempotent && queued.query.execution_state === 'QUEUED') await this.execute(actor.organizationId, queued.query.id, actor.id, correlationId);
    return this.readQuery(actor.organizationId, queued.query.id, actor.id);
  }

  async technicalRetry(actor: Actor, comparecienteId: string, queryId: string, correlationId?: string) {
    need(actor, 'comparecientes.read'); need(actor, 'compliance.read'); need(actor, 'compliance.sensitive.read');
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    await this.assertCompareciente(actor, comparecienteId);
    const query = await this.db.complianceScreeningResult.findFirst({ where: {
      id: queryId, organization_id: actor.organizationId, compareciente_id: comparecienteId,
      query_kind: 'MASTER', contract_version: 'CUM-LST-001', execution_state: { in: [...retryableStates] },
    } });
    if (!query) throw new ScreeningError(409, 'SCREENING_QUERY_NOT_RETRYABLE', 'La consulta no admite un reintento técnico.');
    return this.execute(actor.organizationId, query.id, actor.id, correlationId, true);
  }

  async execute(organizationId: string, queryId: string, actorUserId: string, correlationId?: string, technicalRetry = false) {
    const query = await this.db.complianceScreeningResult.findFirst({ where: { id: queryId, organization_id: organizationId, contract_version: 'CUM-LST-001' }, include: { sourceExecutions: { include: { source: true, sourceVersion: true } } } });
    if (!query) throw new ScreeningError(404, 'SCREENING_QUERY_NOT_FOUND', 'Consulta no encontrada.');
    if (finalStates.includes(query.execution_state as any)) return query;
    if (query.execution_state === 'RUNNING') return query;
    if (!technicalRetry && retryableStates.includes(query.execution_state as any)) return query;
    const expectedStates = technicalRetry ? [...retryableStates] : ['QUEUED'];
    const executionTargets = query.sourceExecutions.filter((item) => technicalRetry ? retryableStates.includes(item.execution_state as any) : item.execution_state === 'QUEUED');
    const preparedAttempts = new Map<string, any>();
    if (technicalRetry) {
      const claimed = await this.db.$transaction(async (tx) => {
        const queryClaim = await tx.complianceScreeningResult.updateMany({ where: { id: query.id, organization_id: organizationId, execution_state: { in: expectedStates as any } }, data: { execution_state: 'RUNNING', status: 'RUNNING', started_at: new Date(), completed_at: null } });
        if (queryClaim.count !== 1) return false;
        for (const execution of executionTargets) {
          const sourceClaim = await tx.screeningSourceExecution.updateMany({ where: {
            id: execution.id, organization_id: organizationId, execution_state: { in: [...retryableStates] },
          }, data: { execution_state: 'RUNNING', started_at: new Date(), completed_at: null, error_code: null, error_detail: null } });
          if (sourceClaim.count !== 1) continue;
          const latest = await tx.screeningSourceExecutionAttempt.findFirst({
            where: { organization_id: organizationId, source_execution_id: execution.id }, orderBy: { attempt_number: 'desc' }, select: { attempt_number: true },
          });
          const attempt = await tx.screeningSourceExecutionAttempt.create({ data: {
            organization_id: organizationId, source_execution_id: execution.id, attempt_number: (latest?.attempt_number || 0) + 1,
            execution_state: 'RUNNING', started_at: new Date(),
          } });
          preparedAttempts.set(execution.id, attempt);
        }
        if (!preparedAttempts.size) throw new ScreeningError(409, 'SCREENING_QUERY_NOT_RETRYABLE', 'La consulta no tiene fuentes que admitan reintento técnico.');
        await this.refreshRequirementsTx(tx, organizationId, query.id, actorUserId);
        return true;
      });
      if (!claimed) return this.db.complianceScreeningResult.findFirst({ where: { id: query.id, organization_id: organizationId } });
    } else {
      const claimed = await this.db.complianceScreeningResult.updateMany({ where: { id: query.id, organization_id: organizationId, execution_state: { in: expectedStates as any } }, data: { execution_state: 'RUNNING', status: 'RUNNING', started_at: new Date(), completed_at: null } });
      if (claimed.count !== 1) return this.db.complianceScreeningResult.findFirst({ where: { id: query.id, organization_id: organizationId } });
    }
    const identity = query.query_snapshot as unknown as H3IdentitySnapshot;
    for (const execution of executionTargets) {
      const provider = execution.sourceVersion ? this.providers.get(execution.sourceVersion.adapter_key) : undefined;
      if (!technicalRetry && (!execution.sourceVersion || !provider)) {
        await this.db.screeningSourceExecution.update({ where: { id: execution.id }, data: { execution_state: 'NOT_CONFIGURED', completed_at: new Date(), result_summary: json({ reason: !execution.sourceVersion ? 'MISSING_ACTIVE_SOURCE_VERSION' : 'PROVIDER_NOT_CONFIGURED' }) } });
        continue;
      }
      const attempt = technicalRetry ? preparedAttempts.get(execution.id) : await this.db.$transaction(async (tx) => {
        const sourceClaim = await tx.screeningSourceExecution.updateMany({ where: {
          id: execution.id, organization_id: organizationId, execution_state: { in: ['QUEUED'] },
        }, data: { execution_state: 'RUNNING', started_at: new Date(), completed_at: null, error_code: null, error_detail: null } });
        if (sourceClaim.count !== 1) return null;
        const latest = await tx.screeningSourceExecutionAttempt.findFirst({
          where: { organization_id: organizationId, source_execution_id: execution.id }, orderBy: { attempt_number: 'desc' }, select: { attempt_number: true },
        });
        return tx.screeningSourceExecutionAttempt.create({ data: {
          organization_id: organizationId, source_execution_id: execution.id, attempt_number: (latest?.attempt_number || 0) + 1,
          execution_state: 'RUNNING', started_at: new Date(),
        } });
      });
      if (!attempt) continue;
      try {
        if (!execution.sourceVersion || !provider) throw new Error(!execution.sourceVersion ? 'MISSING_ACTIVE_SOURCE_VERSION' : 'PROVIDER_NOT_CONFIGURED');
        const result = await provider.execute({ queryId: query.id, sourceVersionId: execution.sourceVersion.id, identity });
        if (!result || !['SUCCEEDED', 'PARTIAL'].includes(result.status) || !Array.isArray(result.candidates)) throw new Error('MALFORMED_PROVIDER_RESULT');
        if (result.candidates.some((candidate) => !candidate.stableId?.trim() || !candidate.sourceReference?.trim())) throw new Error('CANDIDATE_STABLE_ID_REQUIRED');
        if (new Set(result.candidates.map((candidate) => candidate.stableId.trim())).size !== result.candidates.length) throw new Error('DUPLICATE_CANDIDATE_STABLE_ID');
        const resultDigest = createHash('sha256').update(JSON.stringify({ status: result.status, candidates: result.candidates.map((candidate) => ({ stableId: candidate.stableId, sourceReference: candidate.sourceReference })), summary: result.summary || {} })).digest('hex');
        await this.db.$transaction(async (tx) => {
          for (const candidate of result.candidates) {
            const scored = screeningCandidateScore(identity, candidate);
            const priorCandidate = await tx.screeningCandidate.findFirst({ where: { organization_id: organizationId, source_execution_id: execution.id, stable_candidate_id: candidate.stableId.trim() }, select: { id: true } });
            if (!priorCandidate) await tx.screeningCandidate.create({ data: {
                organization_id: organizationId, query_id: query.id, source_execution_id: execution.id,
                stable_candidate_id: candidate.stableId.trim(), source_record_ref: candidate.sourceReference.trim(),
                display_name: candidate.displayName.trim(), score: scored.score, match_fields: json(scored.fields),
                evidence_snapshot: json(candidate.evidence),
              } });
          }
          await tx.screeningSourceExecution.update({ where: { id: execution.id }, data: { execution_state: result.status, completed_at: new Date(), result_summary: json({ ...(result.summary || {}), candidate_count: result.candidates.length }) } });
          await tx.screeningSourceExecutionAttempt.update({ where: { id: attempt.id }, data: { execution_state: result.status, completed_at: new Date(), result_digest: resultDigest, result_metadata: json({ candidate_count: result.candidates.length, provider_status: result.status }) } });
        });
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 120) : 'PROVIDER_EXECUTION_FAILED';
        await this.db.$transaction(async (tx) => {
          await tx.screeningSourceExecution.update({ where: { id: execution.id }, data: { execution_state: 'ERROR', completed_at: new Date(), error_code: code, error_detail: 'La fuente no pudo completarse; no se emitió un resultado limpio.' } });
          await tx.screeningSourceExecutionAttempt.update({ where: { id: attempt.id }, data: { execution_state: 'ERROR', completed_at: new Date(), error_code: code, error_detail: 'La fuente no pudo completarse; no se emitió un resultado limpio.' } });
          await tx.auditLog.create({ data: { organization_id: organizationId, user_id: actorUserId, accion: 'SCREENING_PROVIDER_FAILED', entidad: 'ScreeningSourceExecution', entidad_id: execution.id, detalles: json({ query_id: query.id, source_id: execution.source_id, attempt_id: attempt.id, attempt_number: attempt.attempt_number, error_code: code }), correlation_id: correlationId } });
        });
      }
    }
    const executions = await this.db.screeningSourceExecution.findMany({ where: { organization_id: organizationId, query_id: query.id } });
    const state = deriveScreeningExecutionState(executions.map((item) => item.execution_state as any));
    const completed = await this.db.complianceScreeningResult.update({ where: { id: query.id }, data: { execution_state: state, status: state, queried_at: new Date(), completed_at: new Date() } });
    await this.db.auditLog.create({ data: { organization_id: organizationId, user_id: actorUserId, accion: technicalRetry ? 'SCREENING_TECHNICAL_RETRY_COMPLETED' : 'SCREENING_QUERY_EXECUTED', entidad: 'ComplianceScreeningResult', entidad_id: query.id, detalles: json({ execution_state: state, source_count: executions.length }), correlation_id: correlationId } });
    await this.refreshRequirements(organizationId, query.id, actorUserId);
    return completed;
  }

  async resolve(actor: Actor, comparecienteId: string, queryId: string, candidateId: string, decision: string, rationale: string, correlationId?: string) {
    need(actor, 'compliance.review'); need(actor, 'compliance.sensitive.read');
    await this.assertCompareciente(actor, comparecienteId);
    if (!['NO_CORRESPONDE', 'REVISION_ADICIONAL', 'COINCIDENCIA_CONFIRMADA'].includes(decision)) throw new ScreeningError(400, 'SCREENING_DECISION_INVALID', 'Selecciona una resolución válida.');
    if (!rationale.trim()) throw new ScreeningError(400, 'SCREENING_RATIONALE_REQUIRED', 'Documenta el motivo de la resolución.');
    const candidate = await this.db.screeningCandidate.findFirst({ where: { id: candidateId, organization_id: actor.organizationId, query_id: queryId, query: { compareciente_id: comparecienteId, query_kind: 'MASTER' } }, include: { query: { select: { review_id: true } } } });
    if (!candidate) throw new ScreeningError(404, 'SCREENING_CANDIDATE_NOT_FOUND', 'La posible coincidencia no está disponible.');
    const resolution = await this.db.$transaction(async (tx) => {
      const created = await tx.screeningHumanResolution.create({ data: { organization_id: actor.organizationId, candidate_id: candidate.id, decision: decision as any, rationale: rationale.trim(), resolved_by_id: actor.id } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'SCREENING_CANDIDATE_RESOLVED', entidad: 'ScreeningCandidate', entidad_id: candidate.id, valores_nuevos: json({ resolution_id: created.id, decision }), correlation_id: correlationId } });
      if (candidate.query?.review_id) {
        const review = await tx.complianceReview.findFirst({ where: { id: candidate.query.review_id, organization_id: actor.organizationId, expediente: { archived_at: null, ...expedienteAccessWhere(actor) } }, select: { expediente_id: true } });
        if (review) await recordComplianceActivityTx(tx, {
          organizationId: actor.organizationId, expedienteId: review.expediente_id, actorUserId: actor.id,
          action: 'SCREENING_MATCH_RESOLVED', entity: 'ScreeningHumanResolution', entityId: created.id,
          title: 'Coincidencia de listas resuelta', description: decision === 'COINCIDENCIA_CONFIRMADA' ? 'Se confirmó una coincidencia nominal.' : decision === 'NO_CORRESPONDE' ? 'Se descartó una posible coincidencia nominal.' : 'La coincidencia requiere revisión adicional.',
          idempotencyKey: `h7:screening-resolution:${created.id}`, correlationId,
          metadata: { query_id: queryId, candidate_id: candidate.id, decision },
        });
      }
      return created;
    });
    await this.refreshRequirements(actor.organizationId, queryId, actor.id);
    return resolution;
  }

  async generateReport(actor: Actor, comparecienteId: string, queryId: string, idempotencyKey: string, correlationId?: string) {
    need(actor, 'comparecientes.read'); need(actor, 'compliance.read'); need(actor, 'compliance.sensitive.read'); need(actor, 'documentos.write');
    await this.assertCompareciente(actor, comparecienteId);
    const query = await this.db.complianceScreeningResult.findFirst({ where: { id: queryId, organization_id: actor.organizationId, compareciente_id: comparecienteId, query_kind: 'MASTER', contract_version: 'CUM-LST-001' }, include: this.queryInclude() });
    if (!query) throw new ScreeningError(404, 'SCREENING_QUERY_NOT_FOUND', 'Consulta no encontrada.');
    const safeKey = normalized(idempotencyKey).slice(0, 120);
    if (!safeKey) throw new ScreeningError(400, 'SCREENING_REPORT_IDEMPOTENCY_REQUIRED', 'El reporte requiere una clave de idempotencia.');
    const existing = await this.db.screeningReport.findFirst({ where: { organization_id: actor.organizationId, query_id: query.id, idempotency_key: safeKey } });
    if (existing) return { report: existing, idempotent: true };
    const semanticSnapshot = buildScreeningReportSnapshot(query);
    const semanticFingerprint = screeningReportSemanticFingerprint(semanticSnapshot);
    const semanticExisting = await this.db.screeningReport.findFirst({ where: { organization_id: actor.organizationId, query_id: query.id, semantic_fingerprint: semanticFingerprint } });
    if (semanticExisting) return { report: semanticExisting, idempotent: true };
    const cutoff = new Date();
    const buffer = renderScreeningReportSnapshotPdf(semanticSnapshot, cutoff.toISOString());
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const fileName = `Reporte_consulta_${query.id}.pdf`;
    const storageKey = `organizations/${actor.organizationId}/screening/${query.id}/${safeKey}_${fileName}`;
    await uploadFile(buffer, storageKey, 'application/pdf');
    try {
      const outcome = await this.db.$transaction(async (tx) => {
        const concurrent = await tx.screeningReport.findFirst({ where: { organization_id: actor.organizationId, query_id: query.id, OR: [{ semantic_fingerprint: semanticFingerprint }, { idempotency_key: safeKey }] }, include: { documento: { select: { storage_key: true } } } });
        if (concurrent) return { report: concurrent, won: false };
        const document = await tx.documento.create({ data: { organization_id: actor.organizationId, nombre_original: fileName, nombre_interno: `${randomUUID()}-${fileName}`, tipo: 'REPORTE_CONSULTA_SCREENING', categoria: 'OTROS', storage_key: storageKey, mime_type: 'application/pdf', size_bytes: buffer.length, checksum_sha256: checksum, estatus: 'VIGENTE', subido_por_id: actor.id, compareciente_id: comparecienteId, datos_extraidos: json({ h3: { query_id: query.id, cutoff_at: cutoff.toISOString(), report_name: 'REPORTE DE CONSULTA' } }) } });
        const created = await tx.screeningReport.create({ data: { organization_id: actor.organizationId, query_id: query.id, documento_id: document.id, generated_by_id: actor.id, idempotency_key: safeKey, cutoff_at: cutoff, semantic_fingerprint: semanticFingerprint, content_checksum: checksum } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'SCREENING_REPORT_GENERATED', entidad: 'ScreeningReport', entidad_id: created.id, detalles: json({ query_id: query.id, documento_id: document.id, report_name: 'REPORTE DE CONSULTA' }), correlation_id: correlationId } });
        return { report: { ...created, documento: { storage_key: storageKey } }, won: true };
      });
      if (!outcome.won) {
        const compensation = await this.compensateUploadedReportBlob(actor, query.id, storageKey, outcome.report, correlationId, 'SEMANTIC_REPORT_RACE');
        return { report: outcome.report, idempotent: true, cleanup_queued: compensation.queued };
      }
      return { report: outcome.report, idempotent: false };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const concurrent = await this.db.screeningReport.findFirst({ where: { organization_id: actor.organizationId, query_id: query.id, OR: [{ semantic_fingerprint: semanticFingerprint }, { idempotency_key: safeKey }] }, include: { documento: { select: { storage_key: true } } } });
        if (concurrent) {
          const compensation = await this.compensateUploadedReportBlob(actor, query.id, storageKey, concurrent, correlationId, 'SEMANTIC_REPORT_UNIQUE_CONFLICT');
          return { report: concurrent, idempotent: true, cleanup_queued: compensation.queued };
        }
      }
      await this.compensateUploadedReportBlob(actor, query.id, storageKey, null, correlationId, `POST_UPLOAD_FAILURE:${String(error?.code || 'UNKNOWN').slice(0, 80)}`);
      throw error;
    }
  }

  async listSources(actor: Actor) {
    need(actor, 'compliance.rules.read');
    return this.db.screeningSource.findMany({ where: { organization_id: actor.organizationId }, include: { versions: { orderBy: { version: 'desc' } } }, orderBy: { code: 'asc' } });
  }

  async createSource(actor: Actor, body: any) {
    need(actor, 'compliance.rules.manage');
    const code = normalized(body.code).replace(/[^A-Z0-9_-]/g, '').slice(0, 80);
    const name = String(body.display_name || '').trim().slice(0, 160);
    const providerKey = String(body.provider_key || '').trim().slice(0, 120);
    if (!code || !name || !providerKey) throw new ScreeningError(400, 'SCREENING_SOURCE_INVALID', 'Completa código, nombre y proveedor de la fuente.');
    return this.db.screeningSource.create({ data: { organization_id: actor.organizationId, code, display_name: name, provider_key: providerKey, status: 'DISABLED', created_by_id: actor.id } });
  }

  async createSourceVersion(actor: Actor, sourceId: string, body: any) {
    need(actor, 'compliance.rules.manage');
    const source = await this.db.screeningSource.findFirst({ where: { id: sourceId, organization_id: actor.organizationId } });
    if (!source) throw new ScreeningError(404, 'SCREENING_SOURCE_NOT_FOUND', 'Fuente no encontrada.');
    const checksum = normalized(body.dataset_checksum).toLowerCase();
    const adapterVersion = String(body.adapter_version || '').trim().slice(0, 80);
    const availableAt = body.available_at ? new Date(body.available_at) : null;
    if (!/^[a-f0-9]{64}$/.test(checksum) || !body.provenance || !adapterVersion || !availableAt || Number.isNaN(availableAt.getTime())) throw new ScreeningError(400, 'SCREENING_SOURCE_VERSION_INVALID', 'La versión requiere checksum, procedencia, adaptador y fecha de disponibilidad verificables.');
    const latest = await this.db.screeningSourceVersion.findFirst({ where: { organization_id: actor.organizationId, source_id: source.id }, orderBy: { version: 'desc' } });
    return this.db.screeningSourceVersion.create({ data: { organization_id: actor.organizationId, source_id: source.id, version: (latest?.version || 0) + 1, dataset_checksum: checksum, adapter_key: source.provider_key, adapter_version: adapterVersion, provenance: json(body.provenance), available_at: availableAt, created_by_id: actor.id } });
  }

  async activateSourceVersion(actor: Actor, sourceId: string, versionId: string) {
    need(actor, 'compliance.rules.manage');
    const version = await this.db.screeningSourceVersion.findFirst({ where: { id: versionId, organization_id: actor.organizationId, source_id: sourceId, status: 'DRAFT' }, include: { source: true } });
    if (!version) throw new ScreeningError(404, 'SCREENING_SOURCE_VERSION_NOT_FOUND', 'Versión de fuente no encontrada.');
    if (!this.providers.has(version.adapter_key)) throw new ScreeningError(409, 'SCREENING_PROVIDER_NOT_CONFIGURED', 'El proveedor de esta fuente no está configurado; no se activó la versión.');
    return this.db.$transaction(async (tx) => {
      await tx.screeningSourceVersion.updateMany({ where: { organization_id: actor.organizationId, source_id: sourceId, status: 'ACTIVE' }, data: { status: 'RETIRED', retired_at: new Date() } });
      const activated = await tx.screeningSourceVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE', activated_by_id: actor.id, activated_at: new Date() } });
      await tx.screeningSource.update({ where: { id: sourceId }, data: { status: 'ACTIVE' } });
      return activated;
    });
  }

  private async assertCompareciente(actor: Actor, id: string) {
    const record = await this.db.compareciente.findFirst({ where: { id, organization_id: actor.organizationId, archived_at: null, ...comparecienteObjectWhere(actor) }, select: { id: true } });
    if (!record) throw new ScreeningError(403, 'SCREENING_COMPARECIENTE_ACCESS_DENIED', 'No tienes acceso a este compareciente.');
  }

  private async compensateUploadedReportBlob(actor: Actor, queryId: string, loserStorageKey: string, winner: any | null, correlationId: string | undefined, reason: string) {
    const winnerStorageKey = String(winner?.documento?.storage_key || '');
    if (winnerStorageKey === loserStorageKey) return { queued: false };
    try {
      await deleteFile(loserStorageKey);
      return { queued: false };
    } catch (error: any) {
      const safeError = String(error?.message || 'No fue posible eliminar el blob perdedor.').slice(0, 500);
      try {
        await this.db.$transaction(async (tx) => {
          await tx.storageCompensationJob.create({ data: {
            organization_id: actor.organizationId, screening_report_id: winner?.id || null, storage_key: loserStorageKey,
            tipo_operacion: 'ELIMINAR_REPORTE_SCREENING_HUERFANO', correlation_id: correlationId || randomUUID(),
            ultimo_error: safeError,
          } });
          await tx.auditLog.create({ data: {
            organization_id: actor.organizationId, user_id: actor.id, accion: 'SCREENING_REPORT_STORAGE_CLEANUP_QUEUED',
            entidad: winner ? 'ScreeningReport' : 'ComplianceScreeningResult', entidad_id: winner?.id || queryId,
            detalles: json({ query_id: queryId, loser_storage_key: loserStorageKey, cleanup_error: safeError, reason }), correlation_id: correlationId,
          } });
        });
      } catch (compensationError: any) {
        throw new ScreeningError(503, 'SCREENING_REPORT_STORAGE_COMPENSATION_FAILED', `No fue posible registrar la compensación durable: ${String(compensationError?.code || 'UNKNOWN').slice(0, 80)}.`);
      }
      return { queued: true };
    }
  }

  private queryInclude() { return {
    sourceExecutions: { include: { source: true, sourceVersion: true, attempts: { orderBy: { attempt_number: 'asc' as const } } }, orderBy: [{ source_id: 'asc' as const }, { source_version_id: 'asc' as const }, { id: 'asc' as const }] },
    candidates: { include: { resolutions: { orderBy: [{ created_at: 'desc' as const }, { id: 'desc' as const }] } }, orderBy: [{ source_execution_id: 'asc' as const }, { stable_candidate_id: 'asc' as const }, { id: 'asc' as const }] },
    reports: { orderBy: { created_at: 'desc' as const } }, operationSnapshots: { orderBy: { created_at: 'desc' as const } },
  }; }

  private present(query: any) {
    return { ...query, human_status: this.humanStatus(query), candidates: query.candidates.map((candidate: any) => ({ ...candidate, latest_resolution: candidate.resolutions[0] || null })) };
  }

  private humanStatus(query: any) {
    if (query.execution_state === 'NOT_CONFIGURED') return 'Fuente no configurada';
    if (query.execution_state === 'ERROR') return 'No fue posible completar la consulta';
    if (['QUEUED', 'RUNNING', 'PARTIAL'].includes(query.execution_state)) return 'Consulta en proceso';
    if (query.execution_state !== 'SUCCEEDED') return 'Consulta pendiente';
    if (!query.candidates.length) return 'Sin posibles coincidencias';
    const decisions = query.candidates.map((candidate: any) => candidate.resolutions[0]?.decision || null);
    if (decisions.includes('COINCIDENCIA_CONFIRMADA')) return 'Coincidencia confirmada';
    if (decisions.some((decision: string | null) => !decision || decision === 'REVISION_ADICIONAL')) return 'Posible coincidencia · revisión adicional';
    return 'No corresponde';
  }

  private async readQuery(organizationId: string, id: string, ownerUserId?: string) {
    const query = await this.db.complianceScreeningResult.findFirst({ where: { id, organization_id: organizationId, ...(ownerUserId ? { owner_user_id: ownerUserId } : {}) }, include: this.queryInclude() });
    if (!query) throw new ScreeningError(404, 'SCREENING_QUERY_NOT_FOUND', 'Consulta no encontrada.');
    return this.present(query);
  }

  private async refreshRequirements(organizationId: string, queryId: string, actorUserId: string) {
    return this.refreshRequirementsTx(this.db, organizationId, queryId, actorUserId);
  }

  private async refreshRequirementsTx(db: Db, organizationId: string, queryId: string, actorUserId: string) {
    const query = await db.complianceScreeningResult.findFirst({ where: { id: queryId, organization_id: organizationId }, include: { candidates: { include: { resolutions: { orderBy: { created_at: 'desc' }, take: 1 } } }, operationSnapshots: true } });
    if (!query) return;
    const status = requirementStateFromScreening({ executionState: query.execution_state || 'NOT_EXECUTED', candidates: query.candidates.map((candidate) => ({ latestDecision: candidate.resolutions[0]?.decision || null })) });
    const incidence = query.candidates.some((candidate) => candidate.resolutions[0]?.decision === 'COINCIDENCIA_CONFIRMADA');
    for (const snapshot of query.operationSnapshots) {
      const requirement = await db.complianceRequirement.findFirst({ where: { id: snapshot.requirement_id, organization_id: organizationId, provider: 'LST' } });
      if (!requirement) continue;
      await db.complianceRequirement.update({ where: { id: requirement.id }, data: { status, source_snapshot: json({ query_id: query.id, execution_state: query.execution_state, incidence_confirmed: incidence, consequence: null }) } });
      const requirements = await db.complianceRequirement.findMany({ where: { organization_id: organizationId, state_id: requirement.state_id, review_id: requirement.review_id } });
      const state = deriveComplianceState(requirements.map((item) => item.status), requirements.map((item) => item.deadline));
      await db.expedienteComplianceState.update({ where: { id: requirement.state_id }, data: { state: state as any, pending_count: requirements.filter((item) => !['CUMPLIDO', 'NO_APLICA'].includes(item.status)).length, updated_by_id: actorUserId } });
    }
  }

  async operationStatus(actor: Actor, expedienteId: string) {
    need(actor, 'expedientes.read'); need(actor, 'compliance.read'); need(actor, 'compliance.sensitive.read');
    const expediente = await this.db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true } });
    if (!expediente) throw new ScreeningError(403, 'SCREENING_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    const requirements = await this.db.complianceRequirement.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, provider: 'LST' }, include: { } });
    const rows = await Promise.all(requirements.map(async (requirement) => {
      const snapshot = await this.db.screeningOperationSnapshot.findFirst({ where: { organization_id: actor.organizationId, requirement_id: requirement.id }, orderBy: { created_at: 'desc' } });
      const query = snapshot ? await this.db.complianceScreeningResult.findFirst({ where: { id: snapshot.query_id, organization_id: actor.organizationId }, select: { id: true, compareciente_id: true, execution_state: true, completed_at: true } }) : null;
      return { requirement, snapshot, query, action: requirement.target_compareciente_id ? `/comparecientes/${requirement.target_compareciente_id}#screening` : null };
    }));
    return { data: rows };
  }
}

export const complianceScreeningService = new ComplianceScreeningService();
