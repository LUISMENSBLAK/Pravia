import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { deleteFile, downloadFile, uploadFile } from '../storage/storage.service';
import {
  buildFirPreflight,
  ComplianceH6Error,
  deriveAviState,
  packageKind,
  relevantSourceFingerprint,
  isSignatureRelevantArtifact,
  selectCanonicalDeed,
  selectOfficialRevision,
  semanticHash,
  serializeCanonicalScope,
  sourceManifestMatches,
  stableObligationIdentity,
  validatePresentationLineage,
  type H6ScopeKind,
} from '../domain/complianceH6';
import { ComplianceH5Service } from './complianceH5.service';
import { ExpedienteArtifactsError, ExpedienteArtifactsService } from './expedienteArtifacts.service';
import { deriveComplianceState } from '../domain/complianceLegalEngine';

type User = NonNullable<Request['user']>;
type Db = Prisma.TransactionClient | typeof prisma;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

type AdapterResult = { bytes: Buffer; mimeType: string; fileName: string };
type Adapter = (input: { schema: unknown; mappings: unknown; values: unknown; sourceManifest: unknown }) => Promise<AdapterResult>;
const adapters = new Map<string, Adapter>();
const adapterKey = (productType: string, layoutKey: string, version: string) => `${productType}:${layoutKey}:${version}`;

function requireText(value: unknown, code: string) {
  const text = String(value || '').trim();
  if (!text) throw new ComplianceH6Error(code, 'Falta información obligatoria para completar la operación.', 400);
  return text;
}

function sourceAtPath(source: unknown, path: string): { found: boolean; value?: unknown } {
  let value: any = source;
  for (const segment of path.split('.').filter(Boolean)) {
    if (value === null || value === undefined || typeof value !== 'object' || !(segment in value)) return { found: false };
    value = value[segment];
  }
  return value === null || value === undefined ? { found: false } : { found: true, value };
}

function requirementStatusForAvi(state: string) {
  if (state === 'NO_APLICA') return 'NO_APLICA';
  if (state === 'CUMPLIDO') return 'CUMPLIDO';
  if (state === 'INFORMACION_INCOMPLETA') return 'BLOQUEADO_POR_FALTA_DATOS';
  if (['VALIDADO', 'LISTO_PARA_PRESENTAR', 'PRESENTADO', 'ACUSE_CARGADO'].includes(state)) return 'EN_PROCESO';
  return 'PENDIENTE';
}

function normalizeNoticeLocalValues(definition: any, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ComplianceH6Error('H6_FICHE_VALUES_INVALID', 'Los datos locales de la ficha no son válidos.', 400);
  const fields = (Array.isArray(definition.schema_json?.fields) ? definition.schema_json.fields : []).filter((field: any) => field.authority === 'NOTICE_LOCAL_FIELD');
  const allowed = new Map(fields.map((field: any) => [String(field.key), field]));
  const unknown = Object.keys(raw as Record<string, unknown>).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ComplianceH6Error('H6_FICHE_FIELD_NOT_ALLOWED', 'La ficha contiene campos que no pertenecen a la definición oficial.', 400, { fields: unknown });
  const catalogs = definition.catalogs_json && typeof definition.catalogs_json === 'object' ? definition.catalogs_json : {};
  const values: Record<string, unknown> = {};
  for (const [key, input] of Object.entries(raw as Record<string, unknown>)) {
    const field: any = allowed.get(key);
    if (input === null || input === undefined || input === '') { values[key] = ''; continue; }
    const type = String(field.type || field.input_type || 'string').toLowerCase();
    let value: unknown = input;
    if (type === 'integer' || type === 'number') {
      const parsed = Number(input);
      if (!Number.isFinite(parsed) || (type === 'integer' && !Number.isInteger(parsed))) throw new ComplianceH6Error('H6_FICHE_FIELD_TYPE_INVALID', 'Un campo local no tiene el tipo esperado.', 400, { field: key });
      value = parsed;
    } else if (type === 'boolean') {
      if (typeof input !== 'boolean') throw new ComplianceH6Error('H6_FICHE_FIELD_TYPE_INVALID', 'Un campo local no tiene el tipo esperado.', 400, { field: key });
    } else {
      value = String(input);
      const transformation = String(field.transformation || 'TRIM').toUpperCase();
      if (!['IDENTITY', 'TRIM', 'UPPERCASE', 'LOWERCASE'].includes(transformation)) throw new ComplianceH6Error('H6_FICHE_TRANSFORMATION_UNSUPPORTED', 'La definición solicita una transformación no permitida.', 409, { field: key });
      if (transformation === 'TRIM') value = String(value).trim();
      if (transformation === 'UPPERCASE') value = String(value).trim().toLocaleUpperCase('es-MX');
      if (transformation === 'LOWERCASE') value = String(value).trim().toLocaleLowerCase('es-MX');
      if (field.max_length && String(value).length > Number(field.max_length)) throw new ComplianceH6Error('H6_FICHE_FIELD_TOO_LONG', 'Un campo local excede la longitud permitida.', 400, { field: key });
      if (type === 'date' && Number.isNaN(new Date(`${String(value)}T00:00:00Z`).getTime())) throw new ComplianceH6Error('H6_FICHE_FIELD_DATE_INVALID', 'Un campo local no contiene una fecha válida.', 400, { field: key });
    }
    const inlineOptions = Array.isArray(field.options) ? field.options : [];
    const catalog = field.catalog_key ? (catalogs as any)[field.catalog_key] : null;
    const catalogOptions = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.values) ? catalog.values : [];
    const options = inlineOptions.length ? inlineOptions : catalogOptions;
    if (options.length && !options.map((option: any) => String(option?.value ?? option)).includes(String(value))) throw new ComplianceH6Error('H6_FICHE_CATALOG_VALUE_INVALID', 'Un campo local no coincide con el catálogo fijado.', 400, { field: key });
    values[key] = value;
  }
  return { fields, values };
}

export class ComplianceH6Service {
  private static auditTx(tx: Prisma.TransactionClient, user: User, action: string, entity: string, entityId: string, detail: unknown) {
    return tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: action, entidad: entity, entidad_id: entityId, detalles: json(detail) } });
  }
  private static async refreshProjectionTx(tx: Prisma.TransactionClient, user: User, obligationId: string, state: string) {
    const requirement = await tx.complianceRequirement.findFirst({ where: { organization_id: user.organizationId, obligation_id: obligationId, provider: 'AVI' } });
    if (!requirement) return;
    await tx.complianceRequirement.update({ where: { id: requirement.id }, data: { status: requirementStatusForAvi(state) as any } });
    const requirements = await tx.complianceRequirement.findMany({ where: { organization_id: user.organizationId, state_id: requirement.state_id, review_id: requirement.review_id }, select: { status: true, deadline: true } });
    const statuses = requirements.map((item) => item.status); const deadlines = requirements.map((item) => item.deadline);
    await tx.expedienteComplianceState.update({ where: { id: requirement.state_id }, data: {
      state: deriveComplianceState(statuses, deadlines) as any,
      pending_count: statuses.filter((status) => !['CUMPLIDO', 'NO_APLICA'].includes(status)).length,
      next_deadline: deadlines.filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0] || null,
      updated_by_id: user.id,
    } });
  }
  static async markSourceChangedTx(tx: Prisma.TransactionClient, input: { organizationId: string; expedienteId: string; sourceType: string; stableId?: string | null }) {
    const fiches = await tx.complianceNoticeFicheRevision.findMany({
      where: { organization_id: input.organizationId, obligation: { expediente_id: input.expedienteId } },
      select: { obligation_id: true, source_manifest: true },
    });
    const obligationIds = [...new Set(fiches.filter((fiche) => {
      const entries = Array.isArray(fiche.source_manifest) ? fiche.source_manifest as any[] : [];
      return entries.some((entry) => sourceManifestMatches(entry, input.sourceType, input.stableId));
    }).map((fiche) => fiche.obligation_id))];
    for (const obligationId of obligationIds) {
      const presented = Boolean(await tx.complianceNoticePresentation.findFirst({ where: { organization_id: input.organizationId, obligation_id: obligationId }, select: { id: true } }));
      await tx.complianceObligation.update({ where: { id: obligationId }, data: presented
        ? { freshness: 'STALE', review_needed: true }
        : { freshness: 'STALE', review_needed: false, avi_state: 'PENDIENTE' } });
      if (!presented) await tx.complianceRequirement.updateMany({ where: { organization_id: input.organizationId, obligation_id: obligationId, provider: 'AVI' }, data: { status: 'PENDIENTE' } });
    }
    return obligationIds.length;
  }

  static registerSyntheticAdapterForTests(productType: string, layoutKey: string, version: string, adapter: Adapter) {
    if (process.env.NODE_ENV !== 'test') throw new ComplianceH6Error('H6_TEST_ADAPTER_FORBIDDEN', 'Los adaptadores sintéticos sólo están disponibles en pruebas.', 403);
    adapters.set(adapterKey(productType, layoutKey, version), adapter);
  }

  static clearSyntheticAdaptersForTests() {
    if (process.env.NODE_ENV === 'test') adapters.clear();
  }

  private static async firInput(db: Db, organizationId: string, expedienteId: string, version: number) {
    const [expediente, state, snapshot] = await Promise.all([
      db.expediente.findFirst({ where: { id: expedienteId, organization_id: organizationId }, select: { fecha_estimada_firma: true } }),
      db.expedienteComplianceState.findFirst({ where: { organization_id: organizationId, expediente_id: expedienteId } }),
      db.expedienteDocumentoSnapshot.findFirst({ where: { organization_id: organizationId, expediente_id: expedienteId }, select: { id: true, expediente_version: true } }),
    ]);
    const [requirements, artifacts] = await Promise.all([
      state?.current_review_id ? db.complianceRequirement.findMany({ where: { organization_id: organizationId, expediente_id: expedienteId, review_id: state.current_review_id }, orderBy: { requirement_key: 'asc' } }) : [],
      db.expedienteArtefactoPendiente.findMany({ where: { organization_id: organizationId, expediente_id: expedienteId }, include: { artefacto: { select: { nombre: true, purpose: true } }, currentDocument: { select: { checksum_sha256: true } } }, orderBy: { identity_key: 'asc' } }),
    ]);
    const requirementIds = requirements.map((item) => item.id);
    const evidence = requirementIds.length ? await db.complianceEvidence.findMany({ where: { organization_id: organizationId, expediente_id: expedienteId, requirement_id: { in: requirementIds }, estatus: 'ACTIVO' }, orderBy: { id: 'asc' } }) : [];
    return buildFirPreflight({
      organizationId, expedienteId, version, effectiveDate: expediente?.fecha_estimada_firma || null,
      target: { kind: 'EXPEDIENTE', id: expedienteId }, requirements,
      artifacts: artifacts.map((item) => ({ ...item, label: item.artefacto.nombre })), evidence,
      documentSnapshot: snapshot ? { id: snapshot.id, version: snapshot.expediente_version } : null,
    });
  }

  private static async assertCaseAccess(db: Db, user: User, expedienteId: string) {
    const expediente = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } });
    if (!expediente) throw new ComplianceH6Error('H6_CASE_NOT_FOUND', 'Expediente no encontrado.', 404);
  }

  private static async validateCanonicalScopeTx(tx: Prisma.TransactionClient, user: User, expedienteId: string, kind: H6ScopeKind, scope: any) {
    await this.assertCaseAccess(tx, user, expedienteId);
    if (kind === 'EXPEDIENTE') return;
    if (kind === 'ACT_SET') {
      const ids: string[] = [...new Set<string>((scope.expediente_acto_ids || []).map((id: unknown) => String(id).toLowerCase()))];
      const count = await tx.expedienteActo.count({ where: { id: { in: ids }, organization_id: user.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null } });
      if (count !== ids.length) throw new ComplianceH6Error('H6_SCOPE_ACT_MEMBERSHIP_INVALID', 'Uno o más actos no pertenecen al expediente.', 409);
      return;
    }
    if (kind === 'SUBJECT') {
      const subjectId = String(scope.compareciente_id).toLowerCase();
      const link = await tx.expedienteCompareciente.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', archived_at: null, OR: [{ id: subjectId }, { compareciente_id: subjectId }] }, select: { id: true } });
      if (!link) throw new ComplianceH6Error('H6_SCOPE_SUBJECT_MEMBERSHIP_INVALID', 'El compareciente no pertenece al expediente.', 409);
      return;
    }
    const instrumentId = String(scope.instrument_id).toLowerCase();
    const document = await tx.expedienteDocumento.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', OR: [{ id: instrumentId }, { documento_id: instrumentId }] }, select: { id: true } });
    if (!document) throw new ComplianceH6Error('H6_SCOPE_INSTRUMENT_MEMBERSHIP_INVALID', 'El instrumento no pertenece al expediente.', 409);
  }

  static async firPreflight(user: User, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({
      where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) },
      select: { id: true, version: true },
    });
    if (!expediente) throw new ComplianceH6Error('H6_CASE_NOT_FOUND', 'Expediente no encontrado.', 404);
    return this.firInput(prisma, user.organizationId, expediente.id, expediente.version);
  }

  static async firPreflightTx(tx: Prisma.TransactionClient, organizationId: string, expedienteId: string, version: number) {
    return this.firInput(tx, organizationId, expedienteId, version);
  }

  static async generatePendingSignatureFormats(user: User, expedienteId: string) {
    const exp006 = new ExpedienteArtifactsService(prisma);
    const initial = await exp006.read(user, expedienteId);
    await exp006.materialize(user, expedienteId, initial.preview.revision);
    const current = await exp006.read(user, expedienteId);
    const signatureRows = await prisma.expedienteArtefactoPendiente.findMany({
      where: { organization_id: user.organizationId, expediente_id: expedienteId },
      include: { artefacto: { select: { purpose: true } } },
    });
    const signatureIds = new Set(signatureRows.filter(isSignatureRelevantArtifact).map((item) => item.id));
    const results: Array<{ id: string; outcome: 'GENERATED' | 'ALREADY_CURRENT' | 'NOT_APPLICABLE' | 'MISSING_INPUT' | 'MISSING_TEMPLATE' | 'UNSUPPORTED'; detail?: string }> = [];
    for (const pending of current.data) {
      if (!signatureIds.has(pending.id)) continue;
      if (!pending.in_scope || pending.estado === 'NO_APLICA') { results.push({ id: pending.id, outcome: 'NOT_APPLICABLE' }); continue; }
      if (pending.estado === 'VALIDADO' && pending.document_id) { results.push({ id: pending.id, outcome: 'ALREADY_CURRENT' }); continue; }
      try {
        const preview = await exp006.generationPreview(user, expedienteId, pending.id);
        if (preview.missing.length || preview.conflicts.length) { results.push({ id: pending.id, outcome: 'MISSING_INPUT', detail: [...preview.missing, ...preview.conflicts].join(', ') }); continue; }
        await exp006.generate(user, expedienteId, pending.id, { expected_version: pending.version, source_revision: preview.source_revision, idempotency_key: `H6:FIR:${pending.id}:${preview.source_revision}` });
        results.push({ id: pending.id, outcome: 'GENERATED' });
      } catch (error) {
        if (error instanceof ExpedienteArtifactsError && error.code === 'EXP006_MASTER_VERSION_UNAVAILABLE') results.push({ id: pending.id, outcome: 'MISSING_TEMPLATE' });
        else if (error instanceof ExpedienteArtifactsError && ['EXP006_FRONTEND_SOURCE_INJECTION', 'EXP006_INDIVIDUAL_SUBJECT_REQUIRED'].includes(error.code)) results.push({ id: pending.id, outcome: 'UNSUPPORTED', detail: error.message });
        else throw error;
      }
    }
    return { outcomes: results, generated: results.filter((item) => item.outcome === 'GENERATED').length };
  }

  static async signaturePackage(user: User, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true, numero_pravia: true } });
    if (!expediente) throw new ComplianceH6Error('H6_CASE_NOT_FOUND', 'Expediente no encontrado.', 404);
    const state = await prisma.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, expediente_id: expediente.id } });
    const requirementIds = state?.current_review_id ? (await prisma.complianceRequirement.findMany({
      where: {
        organization_id: user.organizationId,
        expediente_id: expediente.id,
        review_id: state.current_review_id,
        phase: 'PRE_FIRMA',
        requires_signed_document: true,
        status: { not: 'NO_APLICA' },
      },
      select: { id: true },
    })).map((item) => item.id) : [];
    const [evidence, artifactLinks, projects] = await Promise.all([
      prisma.complianceEvidence.findMany({ where: { organization_id: user.organizationId, expediente_id: expediente.id, requirement_id: { in: requirementIds }, estatus: 'ACTIVO', validation_status: 'VALIDATED' }, include: { documento: true } }),
      prisma.expedienteArtefactoPendiente.findMany({ where: { organization_id: user.organizationId, expediente_id: expediente.id, en_alcance: true, obligatoria: true, estado: 'VALIDADO', current_document_id: { not: null }, artefacto: { purpose: 'FIR_SIGNATURE_RELEVANT' } }, include: { currentDocument: true, artefacto: { select: { purpose: true } } } }),
      prisma.expedienteDocumento.findMany({ where: { organization_id: user.organizationId, expediente_id: expediente.id, estatus: 'ACTIVO', document_role: { in: ['DEFINITIVE_DEED', 'PROJECT_DRAFT'] } }, include: { documento: true } }),
    ]);
    const project = selectCanonicalDeed(projects);
    const seen = new Set<string>();
    const selected = [...evidence.map((item) => item.documento), ...artifactLinks.filter(isSignatureRelevantArtifact).flatMap((item) => item.currentDocument ? [item.currentDocument] : []), project.documento]
      .filter((document) => document.estatus !== 'RECHAZADO' && !seen.has(document.id) && seen.add(document.id));
    const documents = await Promise.all(selected.map(async (document) => ({ document, bytes: await downloadFile(document.storage_key) })));
    const kind = packageKind(selected);
    if (kind === 'PDF') {
      const merged = await PDFDocument.create();
      for (const item of documents) {
        const source = await PDFDocument.load(item.bytes);
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
      }
      const bytes = Buffer.from(await merged.save());
      return { buffer: bytes, mime_type: 'application/pdf', file_name: `Paquete_firma_${expediente.numero_pravia}.pdf`, included: selected.map((item) => item.id), excluded_policy: ['HISTORICOS', 'ACUSES', 'AVISOS_PRESENTADOS', 'SUSTITUIDOS'] };
    }
    const zip = new JSZip();
    documents.forEach(({ document, bytes }, index) => zip.file(`${String(index + 1).padStart(2, '0')}_${document.nombre_original}`, bytes));
    zip.file('manifest.json', JSON.stringify({ expediente_id: expediente.id, included: selected.map((item) => ({ id: item.id, checksum: item.checksum_sha256 })) }, null, 2));
    return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), mime_type: 'application/zip', file_name: `Paquete_firma_${expediente.numero_pravia}.zip`, included: selected.map((item) => item.id), excluded_policy: ['HISTORICOS', 'ACUSES', 'AVISOS_PRESENTADOS', 'SUSTITUIDOS'] };
  }

  static async materializeObligationTx(tx: Prisma.TransactionClient, user: User, input: {
    expedienteId: string; reviewId: string; stateId: string; ruleResultId: string; ruleRevisionId: string;
    expedienteActoId: string | null; result: any; legalDate: Date; deadline: Date | null; deadlineSource: string | null;
  }) {
    const obligation = input.result.obligation;
    if (!obligation) return null;
    const legalObligationKey = requireText(obligation.legal_obligation_key || obligation.key, 'H6_LEGAL_OBLIGATION_KEY_REQUIRED');
    const scopeKind = String(obligation.scope_kind || 'ACT_SET') as H6ScopeKind;
    const scopeInput = scopeKind === 'EXPEDIENTE' ? { expediente_id: input.expedienteId }
      : scopeKind === 'ACT_SET' ? { expediente_acto_ids: obligation.scope_act_ids || [input.expedienteActoId].filter(Boolean) }
        : scopeKind === 'SUBJECT' ? { compareciente_id: obligation.subject_compareciente_id }
          : { instrument_id: obligation.instrument_id };
    const scopeKey = serializeCanonicalScope(scopeKind, scopeInput);
    await this.validateCanonicalScopeTx(tx, user, input.expedienteId, scopeKind, scopeInput);
    const identity = stableObligationIdentity({ organizationId: user.organizationId, expedienteId: input.expedienteId, legalObligationKey, channelCode: obligation.channel, obligationTypeCode: obligation.type, scopeKind, scopeKey });
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:obligation:${identity.stable_identity_hash}`}))`);
    const existing = await tx.complianceObligation.findFirst({ where: {
      organization_id: user.organizationId, expediente_id: input.expedienteId,
      OR: [
        { stable_identity_hash: identity.stable_identity_hash },
        { legal_obligation_key: legalObligationKey, channel_code: obligation.channel,
          obligation_type_code: obligation.type, canonical_scope_kind: scopeKind, canonical_scope_key: scopeKey },
      ],
    } });
    const applicable = input.result.applicability !== 'NO_APLICA';
    const master = existing ? await tx.complianceObligation.update({ where: { id: existing.id }, data: {
      review_id: input.reviewId, rule_result_id: input.ruleResultId, rule_revision_id: input.ruleRevisionId,
      stable_identity_hash: identity.stable_identity_hash,
      legal_basis: input.result.legalBasis, rule_version: String(input.result.version), rule_status: 'ACTIVE', origin_date: input.legalDate,
      due_at: input.deadline, legal_deadline_source: input.deadlineSource, status: applicable ? existing.status : 'NO_APLICA',
      avi_state: applicable ? (existing.avi_state === 'NO_APLICA' ? 'PENDIENTE' : existing.avi_state) : 'NO_APLICA',
      freshness: existing.freshness, snapshot: json(input.result),
    } }) : applicable ? await tx.complianceObligation.create({ data: {
      organization_id: user.organizationId, expediente_id: input.expedienteId, review_id: input.reviewId,
      type: obligation.type, legal_basis: input.result.legalBasis, rule_version: String(input.result.version), rule_status: 'ACTIVE',
      origin_date: input.legalDate, due_at: input.deadline, channel: obligation.channel, channel_code: obligation.channel,
      status: 'POR_DETERMINAR', checklist: json({}), snapshot: json(input.result), rule_result_id: input.ruleResultId,
      rule_revision_id: input.ruleRevisionId, obligation_key: obligation.key, legal_obligation_key: legalObligationKey,
      obligation_type_code: obligation.type, canonical_scope_kind: scopeKind, canonical_scope_key: scopeKey,
      stable_identity_hash: identity.stable_identity_hash, avi_state: input.result.missingPaths?.length ? 'INFORMACION_INCOMPLETA' : 'PENDIENTE',
      legal_deadline_source: input.deadlineSource,
    } }) : null;
    if (!master) return null;
    const triggerHash = semanticHash({ rule_result_id: input.ruleResultId, rule_revision_id: input.ruleRevisionId, expediente_acto_id: input.expedienteActoId });
    await tx.complianceObligationTrigger.upsert({ where: { organization_id_obligation_id_trigger_identity_hash: { organization_id: user.organizationId, obligation_id: master.id, trigger_identity_hash: triggerHash } }, create: {
      organization_id: user.organizationId, obligation_id: master.id, review_id: input.reviewId, rule_result_id: input.ruleResultId,
      rule_revision_id: input.ruleRevisionId, expediente_acto_id: input.expedienteActoId, trigger_identity_hash: triggerHash,
      applicability: input.result.applicability, source_snapshot: json({ stable_key: input.result.stableKey, checksum: input.result.checksum }),
    }, update: {} });
    const aviStatus = requirementStatusForAvi(master.avi_state);
    const projected = await tx.complianceRequirement.findFirst({ where: { organization_id: user.organizationId, obligation_id: master.id, provider: 'AVI' } });
    if (projected) await tx.complianceRequirement.update({ where: { id: projected.id }, data: { review_id: input.reviewId, state_id: input.stateId, rule_result_id: input.ruleResultId, status: aviStatus as any, deadline: input.deadline, source_snapshot: json({ obligation_identity: identity.stable_identity_hash, review_id: input.reviewId }) } });
    else await tx.complianceRequirement.create({ data: {
      organization_id: user.organizationId, expediente_id: input.expedienteId, state_id: input.stateId, review_id: input.reviewId,
      rule_result_id: input.ruleResultId, obligation_id: master.id, provider: 'AVI', requirement_key: `AVI:${identity.stable_identity_hash}`,
      label: input.result.requirementLabel || 'Preparar aviso o declaración', status: aviStatus as any, deadline: input.deadline,
      source_snapshot: json({ obligation_identity: identity.stable_identity_hash }), phase: 'POST_FIRMA', trigger: 'EXPEDIENTE_FIRMADO',
      missing_action: 'GO_TO_NOTICE', blocks_completion: true,
    } });
    return master;
  }

  static async readWorkspace(user: User, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true, fecha_real_firma: true } });
    if (!expediente) throw new ComplianceH6Error('H6_CASE_NOT_FOUND', 'Expediente no encontrado.', 404);
    const [obligations, acknowledgementDocuments] = await Promise.all([prisma.complianceObligation.findMany({ where: { organization_id: user.organizationId, expediente_id: expediente.id }, include: {
      triggers: true, ficheRevisions: { include: { officialRevision: { select: { schema_json: true } } }, orderBy: { revision_number: 'desc' } }, officialProducts: { orderBy: { created_at: 'desc' } },
      presentations: { include: { acknowledgements: true, product: { select: { id: true, checksum: true, adapter_version: true, created_at: true } }, ficheRevision: { select: { revision_number: true } } }, orderBy: [{ presented_at: 'desc' }, { created_at: 'desc' }] }, projectedRequirements: true,
    }, orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }] }), prisma.documento.findMany({
      where: { organization_id: user.organizationId, expediente_id: expediente.id, estatus: { not: 'RECHAZADO' }, checksum_sha256: { not: null } },
      select: { id: true, nombre_original: true, tipo: true, fecha_carga: true }, orderBy: { fecha_carga: 'desc' },
    })]);
    return { post_sign_materialization: expediente.fecha_real_firma && obligations.length === 0 ? 'EN_PROCESO' : 'CURRENT', obligations, acknowledgement_documents: acknowledgementDocuments };
  }

  static async createOfficialDefinition(user: User, body: any) {
    return prisma.$transaction(async (tx) => {
      const definition = await tx.complianceOfficialDefinition.create({ data: {
        stable_definition_key: requireText(body.stable_definition_key, 'H6_OFFICIAL_KEY_REQUIRED'),
        institution_code: requireText(body.institution_code, 'H6_OFFICIAL_INSTITUTION_REQUIRED'),
        channel_code: requireText(body.channel_code, 'H6_OFFICIAL_CHANNEL_REQUIRED'),
        product_family: requireText(body.product_family, 'H6_OFFICIAL_FAMILY_REQUIRED'),
        product_type: requireText(body.product_type, 'H6_OFFICIAL_PRODUCT_TYPE_REQUIRED'), created_by_id: user.id,
      } });
      await this.auditTx(tx, user, 'H6_CREATE_OFFICIAL_DEFINITION', 'ComplianceOfficialDefinition', definition.id, { stable_definition_key: definition.stable_definition_key, channel_code: definition.channel_code, product_type: definition.product_type });
      return definition;
    });
  }

  static async createOfficialRevision(user: User, definitionId: string, body: any) {
    const definition = await prisma.complianceOfficialDefinition.findUnique({ where: { id: definitionId } });
    if (!definition) throw new ComplianceH6Error('H6_OFFICIAL_DEFINITION_NOT_FOUND', 'Definición institucional no encontrada.', 404);
    const payload = {
      schema_json: body.schema || {}, mappings_json: body.mappings || {}, requiredness_json: body.requiredness || {}, catalogs_json: body.catalogs || {},
      transformations_json: body.transformations || {}, validations_json: body.validations || {}, layout_key: requireText(body.layout_key, 'H6_LAYOUT_KEY_REQUIRED'),
      product_type: definition.product_type, adapter_version: requireText(body.adapter_version, 'H6_ADAPTER_VERSION_REQUIRED'),
      effective_date_basis: body.effective_date_basis, effective_from: body.effective_from ? new Date(body.effective_from) : null,
      effective_to: body.effective_to ? new Date(body.effective_to) : null, provenance: body.provenance || {},
    };
    if (!['LEGAL_DATE', 'GENERATION_DATE', 'PRESENTATION_DATE'].includes(payload.effective_date_basis)) throw new ComplianceH6Error('H6_EFFECTIVE_DATE_BASIS_INVALID', 'Selecciona una base de fecha válida.', 400);
    if (payload.effective_from && Number.isNaN(payload.effective_from.getTime())) throw new ComplianceH6Error('H6_EFFECTIVE_FROM_INVALID', 'La fecha inicial de vigencia no es válida.', 400);
    if (payload.effective_to && Number.isNaN(payload.effective_to.getTime())) throw new ComplianceH6Error('H6_EFFECTIVE_TO_INVALID', 'La fecha final de vigencia no es válida.', 400);
    if (payload.effective_from && payload.effective_to && payload.effective_from >= payload.effective_to) throw new ComplianceH6Error('H6_EFFECTIVE_RANGE_INVALID', 'La fecha final de vigencia debe ser posterior a la fecha inicial.', 400);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:official-revision:${definition.id}`}))`);
      const latest = await tx.complianceOfficialDefinitionRevision.findFirst({ where: { definition_id: definition.id }, orderBy: { revision_number: 'desc' } });
      const revision = await tx.complianceOfficialDefinitionRevision.create({ data: { definition_id: definition.id, revision_number: (latest?.revision_number || 0) + 1, status: 'DRAFT', ...payload, checksum: semanticHash(payload), created_by_id: user.id } as any });
      await this.auditTx(tx, user, 'H6_CREATE_OFFICIAL_REVISION', 'ComplianceOfficialDefinitionRevision', revision.id, { definition_id: definition.id, revision_number: revision.revision_number, checksum: revision.checksum });
      return revision;
    });
  }

  static async verifyOfficialRevision(user: User, definitionId: string, revisionId: string) {
    return prisma.$transaction(async (tx) => {
      const revision = await tx.complianceOfficialDefinitionRevision.findFirst({ where: { id: revisionId, definition_id: definitionId, status: 'DRAFT' } });
      if (!revision) throw new ComplianceH6Error('H6_OFFICIAL_DRAFT_NOT_FOUND', 'La revisión borrador no existe o ya fue cerrada.', 409);
      const verified = await tx.complianceOfficialDefinitionRevision.update({ where: { id: revision.id }, data: { status: 'VERIFIED', verified_by_id: user.id, verified_at: new Date() } });
      await this.auditTx(tx, user, 'H6_VERIFY_OFFICIAL_REVISION', 'ComplianceOfficialDefinitionRevision', verified.id, { definition_id: definitionId, checksum: verified.checksum });
      return verified;
    });
  }

  static async activateOfficialRevision(user: User, definitionId: string, revisionId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:official-activation:${user.organizationId}:${definitionId}`}))`);
      const revision = await tx.complianceOfficialDefinitionRevision.findFirst({ where: { id: revisionId, definition_id: definitionId, status: 'VERIFIED' } });
      if (!revision) throw new ComplianceH6Error('H6_OFFICIAL_REVISION_NOT_VERIFIED', 'Sólo puede activarse una revisión verificada.', 409);
      await tx.complianceOfficialDefinitionActivation.updateMany({ where: { organization_id: user.organizationId, definition_id: definitionId, active: true }, data: { active: false, retired_at: new Date() } });
      const activation = await tx.complianceOfficialDefinitionActivation.upsert({ where: { organization_id_definition_id_revision_id: { organization_id: user.organizationId, definition_id: definitionId, revision_id: revisionId } }, create: { organization_id: user.organizationId, definition_id: definitionId, revision_id: revisionId, activated_by_id: user.id }, update: { active: true, activated_by_id: user.id, activated_at: new Date(), retired_at: null } });
      await this.auditTx(tx, user, 'H6_ACTIVATE_OFFICIAL_REVISION', 'ComplianceOfficialDefinitionActivation', activation.id, { definition_id: definitionId, revision_id: revisionId });
      return activation;
    });
  }

  static async retireOfficialRevision(user: User, definitionId: string, revisionId: string) {
    return prisma.$transaction(async (tx) => {
      const revision = await tx.complianceOfficialDefinitionRevision.findFirst({ where: { id: revisionId, definition_id: definitionId, status: 'VERIFIED' } });
      if (!revision) throw new ComplianceH6Error('H6_OFFICIAL_REVISION_NOT_VERIFIED', 'Sólo puede retirarse una revisión verificada.', 409);
      const active = await tx.complianceOfficialDefinitionActivation.count({ where: { definition_id: definitionId, revision_id: revisionId, active: true } });
      if (active) throw new ComplianceH6Error('H6_OFFICIAL_REVISION_ACTIVE', 'Desactiva la revisión en todas las organizaciones antes de retirarla.', 409);
      const retired = await tx.complianceOfficialDefinitionRevision.update({ where: { id: revision.id }, data: { status: 'RETIRED', retired_at: new Date() } });
      await this.auditTx(tx, user, 'H6_RETIRE_OFFICIAL_REVISION', 'ComplianceOfficialDefinitionRevision', retired.id, { definition_id: definitionId, checksum: retired.checksum });
      return retired;
    });
  }

  private static async obligation(user: User, obligationId: string, include: any = {}, db: Db = prisma) {
    const obligation = await db.complianceObligation.findFirst({ where: { id: obligationId, organization_id: user.organizationId }, include });
    if (!obligation) throw new ComplianceH6Error('H6_OBLIGATION_NOT_FOUND', 'Obligación no encontrada.', 404);
    if (!obligation.expediente_id) throw new ComplianceH6Error('H6_OBLIGATION_NOT_FOUND', 'Obligación no encontrada.', 404);
    await this.assertCaseAccess(db, user, obligation.expediente_id);
    return obligation as any;
  }

  private static async resolveOfficialRevision(db: Db, user: User, obligation: any, basis: 'LEGAL_DATE' | 'GENERATION_DATE' | 'PRESENTATION_DATE', date: Date) {
    const activations = await db.complianceOfficialDefinitionActivation.findMany({ where: { organization_id: user.organizationId, active: true }, include: { definition: true, revision: true } });
    const candidates = activations.map((item) => ({ ...item.revision, active: item.active, stable_definition_key: item.definition.stable_definition_key, channel_code: item.definition.channel_code, product_type: item.definition.product_type }));
    return selectOfficialRevision(candidates as any, { stableDefinitionKey: obligation.legal_obligation_key, channelCode: obligation.channel_code, productType: obligation.obligation_type_code, effectiveDate: date, effectiveDateBasis: basis, hasAdapter: (candidate) => adapters.has(adapterKey(candidate.product_type, candidate.layout_key, candidate.adapter_version)) });
  }

  private static async sourceContext(db: Db, user: User, obligation: any) {
    const expediente = await db.expediente.findFirst({ where: { id: obligation.expediente_id, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, include: {
      actos: { where: { estatus: 'ACTIVO', removed_at: null } }, predios: { where: { estatus: 'ACTIVO' }, include: { predio: true } },
      comparecientes: { where: { estatus: 'ACTIVO', archived_at: null }, include: { compareciente: true } },
      calculosISR: { where: { archived_at: null }, include: { versiones: { orderBy: { version: 'desc' }, take: 1 } } },
    } });
    if (!expediente) throw new ComplianceH6Error('H6_CASE_NOT_FOUND', 'Expediente no encontrado.', 404);
    const [payments, bc] = await Promise.all([
      ComplianceH5Service.currentPaymentSourcesTx(db, user.organizationId, expediente.id),
      db.complianceBcStructureSnapshot.findMany({ where: { organization_id: user.organizationId, expediente_id: expediente.id }, orderBy: { captured_at: 'desc' } }),
    ]);
    return { expediente, actos: expediente.actos, predios: expediente.predios, comparecientes: expediente.comparecientes, isr: expediente.calculosISR.map((item) => item.versiones[0]).filter(Boolean), payments, bc };
  }

  private static buildManifest(definition: any, source: any) {
    const fields = Array.isArray(definition.schema_json?.fields) ? definition.schema_json.fields : [];
    const manifest: any[] = []; const masterValues: Record<string, unknown> = {}; const missing: string[] = [];
    for (const field of fields.filter((item: any) => item.authority === 'MASTER_SOURCE')) {
      const resolved = sourceAtPath(source, String(field.path || ''));
      if (!resolved.found) { if (field.required) missing.push(field.key); continue; }
      masterValues[field.key] = resolved.value;
      manifest.push({ type: field.source_type || 'MASTER_SOURCE', entity: field.entity || String(field.path).split('.')[0], stable_id: field.stable_id_path ? sourceAtPath(source, field.stable_id_path).value || null : null, revision: field.revision_path ? sourceAtPath(source, field.revision_path).value || null : null, path: field.path, transformer: field.transformer || 'IDENTITY', normalized_value_hash: semanticHash(resolved.value) });
    }
    return { manifest, masterValues, missing };
  }

  static async ensureFicheDraft(user: User, obligationId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:fiche:${user.organizationId}:${obligationId}`}))`);
      const obligation = await this.obligation(user, obligationId, { ficheRevisions: { orderBy: { revision_number: 'desc' } } }, tx);
      const currentDraft = obligation.ficheRevisions.find((item: any) => item.status === 'DRAFT');
      if (currentDraft) return currentDraft;
      const selection = await this.resolveOfficialRevision(tx, user, obligation, 'LEGAL_DATE', new Date(obligation.origin_date));
      if (selection.status !== 'PINNED') throw new ComplianceH6Error(`H6_OFFICIAL_${selection.status}`, selection.status === 'NOT_CONFIGURED' ? 'No existe una definición oficial activada y compatible.' : 'Existe más de una definición oficial aplicable.', 409);
      const source = await this.sourceContext(tx, user, obligation);
      const built = this.buildManifest(selection.revision, source);
      const latest = obligation.ficheRevisions[0];
      return tx.complianceNoticeFicheRevision.create({ data: { organization_id: user.organizationId, obligation_id: obligation.id, official_revision_id: selection.revision.id, revision_number: (latest?.revision_number || 0) + 1, status: 'DRAFT', base_revision_id: latest?.status === 'VALIDATED' ? latest.id : null, local_values: json(latest?.status === 'VALIDATED' ? latest.local_values : {}), source_manifest: json(built.manifest), source_fingerprint: semanticHash(built.manifest), created_by_id: user.id } });
    });
  }

  static async saveFicheDraft(user: User, obligationId: string, ficheId: string, body: any) {
    await this.obligation(user, obligationId);
    const fiche = await prisma.complianceNoticeFicheRevision.findFirst({ where: { id: ficheId, organization_id: user.organizationId, obligation_id: obligationId, status: 'DRAFT' }, include: { officialRevision: true } });
    if (!fiche) throw new ComplianceH6Error('H6_FICHE_DRAFT_NOT_FOUND', 'La ficha borrador no existe o ya fue validada.', 409);
    const expectedVersion = Number(body.expected_version);
    const { values } = normalizeNoticeLocalValues(fiche.officialRevision, body.local_values || {});
    const updated = await prisma.complianceNoticeFicheRevision.updateMany({ where: { id: fiche.id, version: expectedVersion }, data: { local_values: json(values), version: { increment: 1 } } });
    if (!updated.count) throw new ComplianceH6Error('H6_FICHE_VERSION_CONFLICT', 'La ficha cambió. Recarga antes de guardar.', 409);
    return prisma.complianceNoticeFicheRevision.findUnique({ where: { id: fiche.id } });
  }

  static async finalizeFiche(user: User, obligationId: string, ficheId: string, body: any) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:presentation:${user.organizationId}:${obligationId}`}))`);
      const fiche = await tx.complianceNoticeFicheRevision.findFirst({ where: { id: ficheId, organization_id: user.organizationId, obligation_id: obligationId, status: 'DRAFT' }, include: { officialRevision: true } });
      if (!fiche) throw new ComplianceH6Error('H6_FICHE_DRAFT_NOT_FOUND', 'La ficha borrador no existe o ya fue validada.', 409);
      if (fiche.version !== Number(body.expected_version)) throw new ComplianceH6Error('H6_FICHE_VERSION_CONFLICT', 'La ficha cambió. Recarga antes de validar.', 409);
      const fields = Array.isArray((fiche.officialRevision.schema_json as any)?.fields) ? (fiche.officialRevision.schema_json as any).fields : [];
      const { values: localValues } = normalizeNoticeLocalValues(fiche.officialRevision, fiche.local_values);
      const source = await this.sourceContext(tx, user, await this.obligation(user, obligationId, {}, tx));
      const built = this.buildManifest(fiche.officialRevision, source);
      const missing = [...built.missing, ...fields.filter((field: any) => field.authority === 'NOTICE_LOCAL_FIELD' && field.required && (localValues?.[field.key] === undefined || localValues?.[field.key] === '')).map((field: any) => field.key)];
      if (missing.length) throw new ComplianceH6Error('H6_FICHE_INCOMPLETE', 'La ficha contiene campos locales obligatorios pendientes.', 409, { missing });
      const fingerprint = relevantSourceFingerprint({ legalSource: { obligation_id: obligationId }, officialRevision: { id: fiche.official_revision_id, checksum: fiche.officialRevision.checksum }, validatedFiche: { id: fiche.id, source_fingerprint: semanticHash(built.manifest) }, localValues, sourceManifest: built.manifest });
      const validated = await tx.complianceNoticeFicheRevision.update({ where: { id: fiche.id }, data: { status: 'VALIDATED', source_manifest: json(built.manifest), validation_snapshot: json({ validated: true, fingerprint }), source_fingerprint: fingerprint, validated_at: new Date(), version: { increment: 1 } } });
      await tx.complianceObligation.update({ where: { id: obligationId }, data: { avi_state: 'VALIDADO', freshness: 'CURRENT' } });
      await this.refreshProjectionTx(tx, user, obligationId, 'VALIDADO');
      await this.auditTx(tx, user, 'H6_VALIDATE_NOTICE_FICHE', 'ComplianceNoticeFicheRevision', validated.id, { obligation_id: obligationId, fingerprint });
      return validated;
    });
  }

  static async generateOfficialProduct(user: User, obligationId: string, body: any) {
    await this.obligation(user, obligationId);
    await this.refreshObligationState(user, obligationId);
    const fiche = await prisma.complianceNoticeFicheRevision.findFirst({ where: { id: String(body.fiche_revision_id), organization_id: user.organizationId, obligation_id: obligationId, status: 'VALIDATED' }, include: { officialRevision: true, obligation: true } });
    if (!fiche) throw new ComplianceH6Error('H6_VALIDATED_FICHE_REQUIRED', 'Valida la ficha antes de generar el producto.', 409);
    if (fiche.obligation.freshness !== 'CURRENT') throw new ComplianceH6Error('H6_PRODUCT_SOURCE_STALE', 'Las fuentes cambiaron; prepara y valida una nueva ficha antes de generar.', 409);
    const key = requireText(body.idempotency_key, 'H6_IDEMPOTENCY_REQUIRED').slice(0, 160);
    const existing = await prisma.complianceOfficialProduct.findFirst({ where: { organization_id: user.organizationId, obligation_id: obligationId, idempotency_key: key } });
    if (existing) {
      if (existing.fiche_revision_id !== fiche.id) throw new ComplianceH6Error('H6_PRODUCT_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia pertenece a otra ficha.', 409);
      return existing;
    }
    const registryKey = adapterKey(fiche.officialRevision.product_type, fiche.officialRevision.layout_key, fiche.officialRevision.adapter_version);
    const adapter = adapters.get(registryKey);
    if (!adapter) throw new ComplianceH6Error('H6_OFFICIAL_ADAPTER_NOT_CONFIGURED', 'La definición está versionada, pero no existe un adaptador técnico compatible.', 409);
    const output = await adapter({ schema: fiche.officialRevision.schema_json, mappings: fiche.officialRevision.mappings_json, values: fiche.local_values, sourceManifest: fiche.source_manifest });
    if (!output.bytes.length) throw new ComplianceH6Error('H6_OFFICIAL_PRODUCT_EMPTY', 'El adaptador no produjo un archivo válido.', 500);
    const checksum = sha(output.bytes); const storageKey = `organizations/${user.organizationId}/compliance/h6/${obligationId}/${randomUUID()}_${output.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    await uploadFile(output.bytes, storageKey, output.mimeType);
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:presentation:${user.organizationId}:${obligationId}`}))`);
        const raced = await tx.complianceOfficialProduct.findFirst({ where: { organization_id: user.organizationId, obligation_id: obligationId, idempotency_key: key } });
        if (raced) {
          if (raced.fiche_revision_id !== fiche.id) throw new ComplianceH6Error('H6_PRODUCT_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia pertenece a otra ficha.', 409);
          return { product: raced, storageUsed: false };
        }
        const currentObligation = await tx.complianceObligation.findFirst({ where: { id: obligationId, organization_id: user.organizationId } });
        if (!currentObligation || currentObligation.freshness !== 'CURRENT') throw new ComplianceH6Error('H6_PRODUCT_SOURCE_STALE', 'Las fuentes cambiaron durante la generación.', 409);
        const currentSource = await this.sourceContext(tx, user, fiche.obligation);
        const currentManifest = this.buildManifest(fiche.officialRevision, currentSource);
        const currentFingerprint = relevantSourceFingerprint({ legalSource: { obligation_id: obligationId }, officialRevision: { id: fiche.official_revision_id, checksum: fiche.officialRevision.checksum }, validatedFiche: { id: fiche.id, source_fingerprint: semanticHash(currentManifest.manifest) }, localValues: fiche.local_values, sourceManifest: currentManifest.manifest });
        if (currentManifest.missing.length || currentFingerprint !== fiche.source_fingerprint) throw new ComplianceH6Error('H6_PRODUCT_SOURCE_STALE', 'Las fuentes cambiaron durante la generación.', 409);
        const document = await tx.documento.create({ data: { organization_id: user.organizationId, expediente_id: fiche.obligation.expediente_id, nombre_original: output.fileName, nombre_interno: `${randomUUID()}-${output.fileName}`, tipo: 'H6_AVISO_OFICIAL_GENERADO', categoria: 'OTROS', storage_key: storageKey, mime_type: output.mimeType, size_bytes: output.bytes.length, checksum_sha256: checksum, estatus: 'VIGENTE', subido_por_id: user.id, datos_extraidos: json({ source: 'H6', generated: true, signed: false, presented: false }) } });
        const product = await tx.complianceOfficialProduct.create({ data: { organization_id: user.organizationId, obligation_id: obligationId, fiche_revision_id: fiche.id, official_revision_id: fiche.official_revision_id, documento_id: document.id, adapter_key: fiche.officialRevision.layout_key, adapter_version: fiche.officialRevision.adapter_version, checksum, source_fingerprint: fiche.source_fingerprint, idempotency_key: key, created_by_id: user.id } });
        await tx.complianceObligation.update({ where: { id: obligationId }, data: { avi_state: 'LISTO_PARA_PRESENTAR', freshness: 'CURRENT' } });
        await this.refreshProjectionTx(tx, user, obligationId, 'LISTO_PARA_PRESENTAR');
        await this.auditTx(tx, user, 'H6_GENERATE_OFFICIAL_PRODUCT', 'ComplianceOfficialProduct', product.id, { obligation_id: obligationId, documento_id: document.id, checksum });
        return { product, storageUsed: true };
      });
      if (!result.storageUsed) await deleteFile(storageKey).catch(() => undefined);
      return result.product;
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  }

  static async registerPresentation(user: User, obligationId: string, body: any) {
    await this.obligation(user, obligationId);
    await this.refreshObligationState(user, obligationId);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:presentation:${user.organizationId}:${obligationId}`}))`);
      const product = await tx.complianceOfficialProduct.findFirst({ where: { id: String(body.product_id), organization_id: user.organizationId, obligation_id: obligationId }, include: { ficheRevision: { include: { officialRevision: true } } } });
      if (!product || product.ficheRevision.status !== 'VALIDATED') throw new ComplianceH6Error('H6_PRESENTATION_PRODUCT_INVALID', 'Selecciona un producto generado desde una ficha validada.', 409);
      const obligation = await tx.complianceObligation.findFirst({ where: { id: obligationId, organization_id: user.organizationId } });
      if (!obligation || obligation.freshness !== 'CURRENT' || product.source_fingerprint !== product.ficheRevision.source_fingerprint) throw new ComplianceH6Error('H6_PRESENTATION_PRODUCT_STALE', 'El producto ya no corresponde a las fuentes vigentes.', 409);
      const currentSource = await this.sourceContext(tx, user, obligation);
      const currentManifest = this.buildManifest(product.ficheRevision.officialRevision, currentSource);
      const currentFingerprint = relevantSourceFingerprint({ legalSource: { obligation_id: obligationId }, officialRevision: { id: product.ficheRevision.official_revision_id, checksum: product.ficheRevision.officialRevision.checksum }, validatedFiche: { id: product.ficheRevision.id, source_fingerprint: semanticHash(currentManifest.manifest) }, localValues: product.ficheRevision.local_values, sourceManifest: currentManifest.manifest });
      if (currentManifest.missing.length || currentFingerprint !== product.ficheRevision.source_fingerprint) throw new ComplianceH6Error('H6_PRESENTATION_PRODUCT_STALE', 'El producto ya no corresponde a las fuentes vigentes.', 409);
      const kind = String(body.kind || 'NORMAL'); if (!['NORMAL', 'COMPLEMENTARIA', 'CORRECCION'].includes(kind)) throw new ComplianceH6Error('H6_PRESENTATION_KIND_INVALID', 'El tipo de presentación no es válido.', 400);
      const previousPresentationId = body.previous_presentation_id ? String(body.previous_presentation_id) : null;
      validatePresentationLineage({ kind, presentationId: body.presentation_id ? String(body.presentation_id) : null, previousPresentationId });
      if (previousPresentationId) {
        const previous = await tx.complianceNoticePresentation.findFirst({ where: { id: previousPresentationId, organization_id: user.organizationId, obligation_id: obligationId } });
        if (!previous) throw new ComplianceH6Error('H6_PREVIOUS_PRESENTATION_INVALID', 'La presentación anterior no pertenece a esta obligación.', 409);
      }
      const presentedAt = new Date(body.presented_at); if (Number.isNaN(presentedAt.getTime())) throw new ComplianceH6Error('H6_PRESENTATION_DATE_INVALID', 'La fecha de presentación no es válida.', 400);
      const key = requireText(body.idempotency_key, 'H6_IDEMPOTENCY_REQUIRED').slice(0, 160);
      const externalFolio = String(body.external_folio || '').trim() || null;
      const existing = await tx.complianceNoticePresentation.findFirst({ where: { organization_id: user.organizationId, obligation_id: obligationId, idempotency_key: key } });
      if (existing) {
        if (existing.product_id !== product.id || existing.fiche_revision_id !== product.fiche_revision_id || existing.previous_presentation_id !== previousPresentationId || existing.kind !== kind || existing.presented_at.getTime() !== presentedAt.getTime() || existing.external_folio !== externalFolio) throw new ComplianceH6Error('H6_PRESENTATION_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia pertenece a otra presentación.', 409);
        return existing;
      }
      const presentation = await tx.complianceNoticePresentation.create({ data: { organization_id: user.organizationId, obligation_id: obligationId, fiche_revision_id: product.fiche_revision_id, product_id: product.id, previous_presentation_id: previousPresentationId, kind: kind as any, presented_at: presentedAt, external_folio: externalFolio, channel_snapshot: obligation.channel_code || obligation.channel, idempotency_key: key, metadata: json(body.metadata || {}), created_by_id: user.id } });
      await tx.complianceObligation.update({ where: { id: obligationId }, data: { avi_state: 'PRESENTADO', review_needed: false } });
      await this.refreshProjectionTx(tx, user, obligationId, 'PRESENTADO');
      await this.auditTx(tx, user, 'H6_REGISTER_NOTICE_PRESENTATION', 'ComplianceNoticePresentation', presentation.id, { obligation_id: obligationId, product_id: product.id, kind });
      return presentation;
    });
  }

  static async registerAcknowledgement(user: User, presentationId: string, body: any) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h6:ack:${user.organizationId}:${presentationId}`}))`);
      const presentation = await tx.complianceNoticePresentation.findFirst({ where: { id: presentationId, organization_id: user.organizationId }, include: { obligation: true, product: { include: { officialRevision: true } } } });
      if (!presentation) throw new ComplianceH6Error('H6_PRESENTATION_NOT_FOUND', 'Presentación no encontrada.', 404);
      await this.assertCaseAccess(tx, user, presentation.obligation.expediente_id!);
      const document = await tx.documento.findFirst({ where: { id: String(body.documento_id), organization_id: user.organizationId, expediente_id: presentation.obligation.expediente_id, estatus: { not: 'RECHAZADO' } } });
      if (!document?.checksum_sha256) throw new ComplianceH6Error('H6_ACK_DOCUMENT_INVALID', 'El acuse debe ser un documento íntegro y accesible.', 409);
      const evidenceId = body.evidence_id ? String(body.evidence_id) : null;
      if (evidenceId) {
        const evidence = await tx.complianceEvidence.findFirst({ where: { id: evidenceId, organization_id: user.organizationId, expediente_id: presentation.obligation.expediente_id, documento_id: document.id, estatus: 'ACTIVO' } });
        if (!evidence) throw new ComplianceH6Error('H6_ACK_EVIDENCE_INVALID', 'La evidencia no corresponde al documento del acuse.', 409);
      }
      const receivedAt = new Date(body.received_at); if (Number.isNaN(receivedAt.getTime())) throw new ComplianceH6Error('H6_ACK_DATE_INVALID', 'La fecha de recepción no es válida.', 400);
      const key = requireText(body.idempotency_key, 'H6_IDEMPOTENCY_REQUIRED').slice(0, 160);
      const acknowledgementType = requireText(body.acknowledgement_type, 'H6_ACK_TYPE_REQUIRED');
      const existing = await tx.complianceNoticeAcknowledgement.findFirst({ where: { organization_id: user.organizationId, presentation_id: presentation.id, idempotency_key: key } });
      if (existing) {
        if (existing.documento_id !== document.id || existing.evidence_id !== evidenceId || existing.acknowledgement_type !== acknowledgementType || existing.received_at.getTime() !== receivedAt.getTime()) throw new ComplianceH6Error('H6_ACK_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia pertenece a otro acuse.', 409);
        return existing;
      }
      const proposalId = body.proposal_id ? String(body.proposal_id) : null;
      if (proposalId) {
        if (body.confirm_proposal !== true) throw new ComplianceH6Error('H6_ACK_PROPOSAL_CONFIRMATION_REQUIRED', 'Confirma o corrige expresamente la propuesta antes de registrar el acuse.', 409);
        const proposal = await tx.complianceAiProposal.findFirst({ where: { id: proposalId, organization_id: user.organizationId, review_id: presentation.obligation.review_id, proposal_type: 'H6_ACK_EXTRACTION_PREPARE_ONLY', status: 'PROPUESTA_REQUIERE_CONFIRMACION' } });
        if (!proposal || proposal.source_document_id !== document.id || proposal.source_document_checksum !== document.checksum_sha256) throw new ComplianceH6Error('H6_ACK_PROPOSAL_STALE', 'La propuesta ya no coincide con el documento confirmado.', 409);
        await tx.complianceAiProposal.update({ where: { id: proposal.id }, data: { status: 'CONFIRMADA_POR_HUMANO', decided_by_id: user.id, decided_at: new Date() } });
      }
      const ack = await tx.complianceNoticeAcknowledgement.create({ data: { organization_id: user.organizationId, presentation_id: presentation.id, documento_id: document.id, evidence_id: evidenceId, acknowledgement_type: acknowledgementType, received_at: receivedAt, checksum: document.checksum_sha256, idempotency_key: key, created_by_id: user.id } });
      const evidenceValidated = evidenceId ? Boolean(await tx.complianceEvidence.findFirst({ where: { id: evidenceId, organization_id: user.organizationId, expediente_id: presentation.obligation.expediente_id, validation_status: 'VALIDATED' } })) : false;
      const fulfillmentPolicy = String((presentation.product?.officialRevision?.validations_json as any)?.fulfillment_policy || '');
      const fulfilled = evidenceValidated && fulfillmentPolicy === 'VALIDATED_ACKNOWLEDGEMENT';
      await tx.complianceObligation.update({ where: { id: presentation.obligation_id }, data: { avi_state: fulfilled ? 'CUMPLIDO' : 'ACUSE_CARGADO' } });
      await this.refreshProjectionTx(tx, user, presentation.obligation_id, fulfilled ? 'CUMPLIDO' : 'ACUSE_CARGADO');
      await this.auditTx(tx, user, 'H6_REGISTER_NOTICE_ACKNOWLEDGEMENT', 'ComplianceNoticeAcknowledgement', ack.id, { presentation_id: presentation.id, documento_id: document.id, evidence_id: evidenceId });
      return ack;
    });
  }

  static async prepareAcknowledgementProposal(user: User, presentationId: string, body: any) {
    const presentation = await prisma.complianceNoticePresentation.findFirst({ where: { id: presentationId, organization_id: user.organizationId }, include: { obligation: true } });
    if (!presentation) throw new ComplianceH6Error('H6_PRESENTATION_NOT_FOUND', 'Presentación no encontrada.', 404);
    await this.assertCaseAccess(prisma, user, presentation.obligation.expediente_id!);
    const document = await prisma.documento.findFirst({ where: { id: String(body.documento_id), organization_id: user.organizationId, expediente_id: presentation.obligation.expediente_id, estatus: { not: 'RECHAZADO' } } });
    if (!document?.checksum_sha256) throw new ComplianceH6Error('H6_ACK_DOCUMENT_INVALID', 'El documento propuesto debe ser íntegro y accesible.', 409);
    const operationId = requireText(body.operation_id, 'H6_ACK_PROPOSAL_OPERATION_REQUIRED').slice(0, 160);
    const existing = await prisma.complianceAiProposal.findFirst({ where: { organization_id: user.organizationId, h5_operation_id: operationId } });
    if (existing) {
      if (existing.review_id !== presentation.obligation.review_id || existing.source_document_id !== document.id || existing.proposal_type !== 'H6_ACK_EXTRACTION_PREPARE_ONLY') throw new ComplianceH6Error('H6_ACK_PROPOSAL_OPERATION_CONFLICT', 'La operación pertenece a otro contexto.', 409);
      return existing;
    }
    const proposed = body.proposed_fields && typeof body.proposed_fields === 'object' && !Array.isArray(body.proposed_fields) ? body.proposed_fields : {};
    const content = Object.fromEntries(['received_at', 'external_folio', 'acknowledgement_type', 'correspondence'].filter((key) => proposed[key] !== undefined).map((key) => [key, proposed[key]]));
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.complianceAiProposal.create({ data: {
        organization_id: user.organizationId, review_id: presentation.obligation.review_id, expediente_id: presentation.obligation.expediente_id,
        proposal_type: 'H6_ACK_EXTRACTION_PREPARE_ONLY', content: json(content), source_document_id: document.id,
        source_document_version: document.fecha_carga.toISOString(), source_document_checksum: document.checksum_sha256,
        source_documents: json([{ id: document.id, version: document.fecha_carga.toISOString(), checksum: document.checksum_sha256 }]),
        proposal_fingerprint: semanticHash({ presentation_id: presentation.id, document_id: document.id, checksum: document.checksum_sha256, content }),
        model: requireText(body.model, 'H6_ACK_PROPOSAL_MODEL_REQUIRED').slice(0, 120), prompt_version: requireText(body.prompt_version, 'H6_ACK_PROPOSAL_PROMPT_REQUIRED').slice(0, 80),
        h5_operation_id: operationId, requested_by_id: user.id,
      } });
      await this.auditTx(tx, user, 'H6_PREPARE_ACKNOWLEDGEMENT_AI_PROPOSAL', 'ComplianceAiProposal', proposal.id, { presentation_id: presentation.id, source_document_id: document.id, silent_write: false });
      return proposal;
    });
  }

  static async refreshObligationState(user: User, obligationId: string) {
    const obligation = await this.obligation(user, obligationId, {
      ficheRevisions: { include: { officialRevision: true }, orderBy: { revision_number: 'desc' } },
      officialProducts: true,
      presentations: { include: { acknowledgements: true, product: { include: { officialRevision: true } } } },
    });
    const latestValidated = obligation.ficheRevisions.find((item: any) => item.status === 'VALIDATED');
    let sourceChanged = false;
    let currentInformationMissing = false;
    if (latestValidated && obligation.avi_state !== 'NO_APLICA') {
      const source = await this.sourceContext(prisma, user, obligation);
      const built = this.buildManifest(latestValidated.officialRevision, source);
      currentInformationMissing = built.missing.length > 0;
      const currentFingerprint = relevantSourceFingerprint({
        legalSource: { obligation_id: obligation.id },
        officialRevision: { id: latestValidated.official_revision_id, checksum: latestValidated.officialRevision.checksum },
        validatedFiche: { id: latestValidated.id, source_fingerprint: semanticHash(built.manifest) },
        localValues: latestValidated.local_values,
        sourceManifest: built.manifest,
      });
      sourceChanged = currentFingerprint !== latestValidated.source_fingerprint;
    }
    const acks = obligation.presentations.flatMap((item: any) => item.acknowledgements.map((ack: any) => ({ ...ack, presentation: item })));
    const evidenceIds = acks.map((item: any) => item.evidence_id).filter(Boolean);
    const validatedEvidenceIds = evidenceIds.length ? new Set((await prisma.complianceEvidence.findMany({ where: { id: { in: evidenceIds }, organization_id: user.organizationId, validation_status: 'VALIDATED' }, select: { id: true } })).map((item) => item.id)) : new Set<string>();
    const fulfilledAck = acks.some((ack: any) => validatedEvidenceIds.has(ack.evidence_id)
      && String((ack.presentation.product?.officialRevision?.validations_json as any)?.fulfillment_policy || '') === 'VALIDATED_ACKNOWLEDGEMENT');
    const productCurrent = Boolean(latestValidated) && obligation.officialProducts.some((item: any) => item.source_fingerprint === latestValidated.source_fingerprint);
    const completeInformation = latestValidated ? !currentInformationMissing : obligation.avi_state !== 'INFORMACION_INCOMPLETA';
    const derived = deriveAviState({ applicable: obligation.avi_state !== 'NO_APLICA', completeInformation, ficheValidated: Boolean(latestValidated), productCurrent, presentationCount: obligation.presentations.length, acknowledgementCount: acks.length, acknowledgementValidated: fulfilledAck });
    const state = sourceChanged
      ? obligation.presentations.length > 0 ? obligation.avi_state : currentInformationMissing ? 'INFORMACION_INCOMPLETA' : 'PENDIENTE'
      : derived;
    return prisma.$transaction(async (tx) => {
      const updated = await tx.complianceObligation.update({ where: { id: obligation.id }, data: sourceChanged
        ? obligation.presentations.length > 0
          ? { freshness: 'STALE', review_needed: true }
          : { avi_state: state, freshness: 'STALE', review_needed: false }
        : { avi_state: state, freshness: 'CURRENT', review_needed: false } });
      await this.refreshProjectionTx(tx, user, obligation.id, state);
      return updated;
    });
  }
}
