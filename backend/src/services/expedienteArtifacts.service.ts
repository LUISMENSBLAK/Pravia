import { createHash, randomUUID } from 'crypto';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import { Prisma, PrismaClient } from '@prisma/client';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { assertStrictPartySourceScope, exp006ResolutionRevision, resolveExp006, type Exp006Context, type Exp006Resolution } from '../domain/expedienteArtifacts';
import { deleteFile, downloadFile, getSignedUrl, uploadFile } from '../storage/storage.service';
import { generateOperationalArtifactWithOpenAI, getOpenAIModelName, type AIUsageMetrics } from './openaiDocument.service';
import { recordAIFailure, recordAIUsage, recordAIUsageInDb } from './aiUsage.service';

export type Exp006Actor = { id: string; organizationId: string; sessionId: string; rol: any; permissions: any[] };
type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const safe = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
const conditionObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export class ExpedienteArtifactsError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function institutionIdsFrom(value: unknown): string[] {
  const ids = new Set<string>();
  const walk = (item: unknown, key = '') => {
    if (Array.isArray(item)) return item.forEach((entry) => walk(entry, key));
    if (item && typeof item === 'object') return Object.entries(item as Record<string, unknown>).forEach(([childKey, child]) => walk(child, childKey));
    if (typeof item === 'string' && /(?:institucion|banco|fiduciaria).*id|(?:institucion_id|banco_id|fiduciaria_id)/i.test(key) && /^[0-9a-f-]{36}$/i.test(item)) ids.add(item);
  };
  walk(value);
  return [...ids];
}

export class ExpedienteArtifactsService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Exp006Actor, expedienteId: string) {
    const context = await this.buildContext(this.prisma, actor, expedienteId);
    const artifacts = await this.masterArtifacts(this.prisma, actor.organizationId);
    const resolution = resolveExp006(artifacts as any, context);
    const persisted = await this.prisma.expedienteArtefactoPendiente.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId }, orderBy: [{ en_alcance: 'desc' }, { created_at: 'asc' }],
    });
    return {
      data: persisted.map((row) => this.toResponse(row)),
      preview: { revision: exp006ResolutionRevision(resolution), applicable: resolution.length, creates: resolution.filter((row) => !persisted.some((item) => item.identity_key === row.identityKey)).length },
      source: 'CFG-002', master_rules_editable: false, auto_generated_documents: 0,
    };
  }

  async materialize(actor: Exp006Actor, expedienteId: string, expectedRevision: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp006-materialize:${actor.organizationId}:${expedienteId}`}))`);
      const context = await this.buildContext(tx, actor, expedienteId);
      const artifacts = await this.masterArtifacts(tx, actor.organizationId);
      const resolution = resolveExp006(artifacts as any, context);
      const actualRevision = exp006ResolutionRevision(resolution);
      if (!expectedRevision || expectedRevision !== actualRevision) throw new ExpedienteArtifactsError(409, 'EXP006_STALE_PREVIEW', 'La configuración o el expediente cambió. Revisa los pendientes antes de aplicar.');
      const changes = await this.applyResolution(tx, actor, expedienteId, resolution);
      await this.audit(tx, actor, 'EXP006_MATERIALIZE', 'Expediente', expedienteId, { revision: actualRevision, ...changes, cfg002_mutated: false, generated_documents: 0 });
      return { revision: actualRevision, ...changes, idempotent: Object.values(changes).every((value) => value === 0) };
    }, { timeout: 25_000 });
  }

  async reconcileContextChangeInTransaction(tx: Prisma.TransactionClient, actor: Exp006Actor, expedienteId: string, reason: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp006-reconcile:${actor.organizationId}:${expedienteId}`}))`);
    const artifacts = await this.masterArtifacts(tx, actor.organizationId);
    if (artifacts.length === 0) return { created: 0, restored: 0, retired: 0, protected: 0 };
    const context = await this.buildContext(tx, actor, expedienteId);
    const resolution = resolveExp006(artifacts as any, context);
    const changes = await this.applyResolution(tx, actor, expedienteId, resolution);
    if (!Object.values(changes).every((value) => value === 0)) {
      await this.audit(tx, actor, 'EXP006_RECONCILE_CONTEXT', 'Expediente', expedienteId, {
        reason, revision: exp006ResolutionRevision(resolution), ...changes,
        protected_work_preserved: true, cfg002_mutated: false, generated_documents: 0,
      });
    }
    return changes;
  }

  async generationPreview(actor: Exp006Actor, expedienteId: string, pendingId: string, requestedDocumentIds?: string[]) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const pending = await this.pending(this.prisma, actor, expedienteId, pendingId);
    assertStrictPartySourceScope({ subjectType: pending.sujeto_tipo, subjectId: pending.sujeto_id }, requestedDocumentIds);
    const sources = await this.partySources(this.prisma, actor, pending);
    return { pending_id: pending.id, pending_version: pending.version, source_revision: sources.revision, source_manifest: sources.manifest, missing: sources.missing, conflicts: sources.conflicts, can_generate: true };
  }

  async generate(actor: Exp006Actor, expedienteId: string, pendingId: string, input: { expected_version: number; source_revision: string; idempotency_key: string; document_ids?: string[] }) {
    const operationId = `exp006:${actor.organizationId}:${pendingId}:${input.idempotency_key}`;
    let storageKey = '';
    try {
      const pending = await this.pending(this.prisma, actor, expedienteId, pendingId);
      if (pending.version !== input.expected_version) throw new ExpedienteArtifactsError(409, 'EXP006_PENDING_STALE', 'El pendiente cambió. Recarga antes de generar.');
      assertStrictPartySourceScope({ subjectType: pending.sujeto_tipo, subjectId: pending.sujeto_id }, input.document_ids);
      const existing = await this.prisma.expedienteArtefactoDocumento.findFirst({ where: { organization_id: actor.organizationId, pendiente_id: pending.id, idempotency_key: input.idempotency_key } });
      if (existing) return { document_id: existing.documento_id, idempotent: true, estado: 'PENDIENTE_REVISION' };
      const sources = await this.partySources(this.prisma, actor, pending);
      if (sources.revision !== input.source_revision) throw new ExpedienteArtifactsError(409, 'EXP006_GENERATION_SOURCES_STALE', 'Las fuentes del compareciente cambiaron. Revisa nuevamente antes de generar.');
      const master = await this.prisma.catalogoArtefactoVersion.findFirst({ where: { id: pending.artefacto_version_id, organization_id: actor.organizationId, activa: true }, include: { artefacto: true } });
      if (!master || master.artefacto_id !== pending.artefacto_id || master.content_kind !== 'FILE' || !master.storage_key || !master.mime_type || !master.nombre_original) throw new ExpedienteArtifactsError(409, 'EXP006_MASTER_VERSION_UNAVAILABLE', 'La versión maestra de archivo ya no está disponible. Revisa el pendiente.');
      const masterBuffer = await downloadFile(master.storage_key);
      const masterText = await this.readText(masterBuffer, master.mime_type, master.nombre_original);
      const generation = await generateOperationalArtifactWithOpenAI({ artifactName: master.artefacto.nombre, masterText, structuredData: sources.structuredData, currentPartyDocuments: sources.documents });
      const currentSources = await this.partySources(this.prisma, actor, pending);
      if (currentSources.revision !== sources.revision) {
        await recordAIUsage(generation.usage, {
          organizationId: actor.organizationId, usuarioId: actor.id, expedienteId,
          operacion: 'EXP006_GENERATE_OPERATIONAL_ARTIFACT_DISCARDED_STALE_SOURCE', operationId,
          metadata: { pending_id: pending.id, source_manifest: sources.manifest, discarded: true },
        });
        throw new ExpedienteArtifactsError(409, 'EXP006_GENERATION_SOURCES_CHANGED', 'Las fuentes cambiaron durante la generación. Revisa y vuelve a intentarlo.');
      }
      const paragraphs = [new Paragraph({ text: master.artefacto.nombre, heading: HeadingLevel.TITLE }), ...generation.content.split(/\n+/).filter(Boolean).map((line) => new Paragraph({ children: [new TextRun(line)] }))];
      if (generation.missing_fields.length) paragraphs.push(new Paragraph({ text: `Datos pendientes de revisión: ${generation.missing_fields.join(', ')}`, heading: HeadingLevel.HEADING_2 }));
      if (generation.conflicts.length) paragraphs.push(new Paragraph({ text: 'Se detectaron datos contradictorios. Requiere revisión humana.', heading: HeadingLevel.HEADING_2 }));
      const buffer = await Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
      storageKey = `organizations/${actor.organizationId}/expedientes/${expedienteId}/exp006/${randomUUID()}_${safe(master.artefacto.nombre)}.docx`;
      await uploadFile(buffer, storageKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const result = await this.persistDocument(actor, expedienteId, pending, {
        buffer, storageKey, originalName: `${master.artefacto.nombre}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        via: 'IA', idempotencyKey: input.idempotency_key, sourceRevision: sources.revision, sourceManifest: sources.manifest,
        review: { missing_fields: generation.missing_fields, conflicts: generation.conflicts, model: generation.model },
        aiUsage: generation.usage, aiOperationId: operationId,
      });
      return { ...result, idempotent: false, estado: 'PENDIENTE_REVISION', missing: generation.missing_fields, conflicts: generation.conflicts };
    } catch (error: any) {
      if (storageKey) await deleteFile(storageKey).catch(() => undefined);
      if (!(error instanceof ExpedienteArtifactsError)) await recordAIFailure({ organizationId: actor.organizationId, usuarioId: actor.id, expedienteId, operacion: 'EXP006_GENERATE_OPERATIONAL_ARTIFACT', operationId, modelo: getOpenAIModelName(), errorCode: 'EXP006_AI_GENERATION_FAILED' }).catch(() => undefined);
      throw error;
    }
  }

  async uploadExternal(actor: Exp006Actor, expedienteId: string, pendingId: string, input: { expected_version: number; idempotency_key: string }, file: Express.Multer.File) {
    const pending = await this.pending(this.prisma, actor, expedienteId, pendingId);
    if (pending.version !== input.expected_version) throw new ExpedienteArtifactsError(409, 'EXP006_PENDING_STALE', 'El pendiente cambió. Recarga antes de cargar el archivo.');
    if (!file?.buffer?.length) throw new ExpedienteArtifactsError(400, 'EXP006_FILE_REQUIRED', 'Selecciona un archivo.');
    const allowed = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg']);
    if (!allowed.has(file.mimetype) || file.size > 25 * 1024 * 1024) throw new ExpedienteArtifactsError(400, 'EXP006_FILE_INVALID', 'Carga un PDF, DOCX, PNG o JPG de hasta 25 MB.');
    const existing = await this.prisma.expedienteArtefactoDocumento.findFirst({ where: { organization_id: actor.organizationId, pendiente_id: pending.id, idempotency_key: input.idempotency_key } });
    if (existing) return { document_id: existing.documento_id, idempotent: true, estado: 'PENDIENTE_REVISION' };
    const storageKey = `organizations/${actor.organizationId}/expedientes/${expedienteId}/exp006/${randomUUID()}_${safe(file.originalname)}`;
    await uploadFile(file.buffer, storageKey, file.mimetype);
    try {
      return { ...(await this.persistDocument(actor, expedienteId, pending, { buffer: file.buffer, storageKey, originalName: file.originalname, mimeType: file.mimetype, via: 'CARGA_EXTERNA', idempotencyKey: input.idempotency_key, sourceRevision: pending.source_revision, sourceManifest: null, review: {} })), idempotent: false, estado: 'PENDIENTE_REVISION' };
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  }

  async validate(actor: Exp006Actor, expedienteId: string, pendingId: string, input: { expected_version: number; idempotency_key: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp006-validate:${actor.organizationId}:${pendingId}`}))`);
      const pending = await this.pending(tx, actor, expedienteId, pendingId);
      if (pending.estado === 'VALIDADO') return { pending: this.toResponse(pending), idempotent: true, tracking_completed: false };
      if (pending.version !== input.expected_version) throw new ExpedienteArtifactsError(409, 'EXP006_PENDING_STALE', 'El pendiente cambió. Recarga antes de validar.');
      if (!pending.current_document_id || pending.estado !== 'PENDIENTE_REVISION') throw new ExpedienteArtifactsError(409, 'EXP006_REVIEW_REQUIRED', 'Obtén y revisa un documento antes de validarlo.');
      const updated = await tx.expedienteArtefactoPendiente.update({ where: { id: pending.id }, data: { estado: 'VALIDADO', validado_por_id: actor.id, validado_at: new Date(), requiere_revision: false, motivo_revision: null, version: { increment: 1 } } });
      const conditions = conditionObject(pending.explicacion_snapshot).conditions;
      const activityMasterId = conditionObject(conditions).actividad_id;
      const trackingCompleted = typeof activityMasterId === 'string' ? await this.completeLinkedTracking(tx, actor, expedienteId, pending.expediente_acto_id, activityMasterId) : false;
      if (trackingCompleted) {
        const context = await this.buildContext(tx, actor, expedienteId);
        const artifacts = await this.masterArtifacts(tx, actor.organizationId);
        await this.applyResolution(tx, actor, expedienteId, resolveExp006(artifacts as any, context));
      }
      await this.audit(tx, actor, 'EXP006_VALIDATE_DOCUMENT', 'ExpedienteArtefactoPendiente', pending.id, { idempotency_key: input.idempotency_key, document_id: pending.current_document_id, tracking_activity_master_id: activityMasterId || null, tracking_completed: trackingCompleted });
      return { pending: this.toResponse(updated), idempotent: false, tracking_completed: trackingCompleted };
    }, { timeout: 20_000 });
  }

  async signedUrl(actor: Exp006Actor, expedienteId: string, pendingId: string) {
    const pending = await this.pending(this.prisma, actor, expedienteId, pendingId);
    if (!pending.current_document_id) throw new ExpedienteArtifactsError(404, 'EXP006_DOCUMENT_NOT_FOUND', 'Este pendiente todavía no tiene un documento.');
    const document = await this.prisma.documento.findFirst({ where: { id: pending.current_document_id, organization_id: actor.organizationId, expediente_id: expedienteId }, select: { storage_key: true, nombre_original: true, mime_type: true } });
    if (!document) throw new ExpedienteArtifactsError(403, 'EXP006_DOCUMENT_ACCESS_DENIED', 'No tienes acceso a este documento.');
    return { url: await getSignedUrl(document.storage_key, 600), expires_in: 600, file_name: document.nombre_original, mime_type: document.mime_type };
  }

  private async persistDocument(actor: Exp006Actor, expedienteId: string, pending: any, file: { buffer: Buffer; storageKey: string; originalName: string; mimeType: string; via: 'IA' | 'CARGA_EXTERNA'; idempotencyKey: string; sourceRevision: string; sourceManifest: unknown; review: unknown; aiUsage?: AIUsageMetrics; aiOperationId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp006-document:${actor.organizationId}:${pending.id}`}))`);
      const current = await this.pending(tx, actor, expedienteId, pending.id);
      if (current.version !== pending.version) throw new ExpedienteArtifactsError(409, 'EXP006_PENDING_STALE', 'El pendiente cambió durante la operación. Recarga antes de continuar.');
      const existing = await tx.expedienteArtefactoDocumento.findFirst({ where: { organization_id: actor.organizationId, pendiente_id: pending.id, idempotency_key: file.idempotencyKey } });
      if (existing) return { document_id: existing.documento_id };
      const document = await tx.documento.create({ data: {
        organization_id: actor.organizationId, nombre_original: file.originalName, nombre_interno: `${randomUUID()}-${safe(file.originalName)}`,
        tipo: 'EXP006_PLANTILLA_FORMATO', categoria: 'PROYECTO', storage_key: file.storageKey, mime_type: file.mimeType,
        size_bytes: file.buffer.length, checksum_sha256: sha(file.buffer), estatus: 'PENDIENTE', subido_por_id: actor.id, expediente_id: expedienteId,
        observaciones: 'Documento operativo pendiente de revisión humana.', datos_extraidos: json({ exp006: { pending_id: pending.id, via: file.via, review: file.review } }),
      } });
      await tx.expedienteArtefactoDocumento.updateMany({ where: { organization_id: actor.organizationId, pendiente_id: pending.id, vigente: true }, data: { vigente: false } });
      await tx.expedienteArtefactoDocumento.create({ data: {
        organization_id: actor.organizationId, expediente_id: expedienteId, pendiente_id: pending.id, documento_id: document.id,
        via: file.via, source_manifest: file.sourceManifest ? json(file.sourceManifest) : Prisma.JsonNull,
        provenance: json({ source: 'EXP-006', cfg002_artifact_id: pending.artefacto_id, cfg002_rule_id: pending.regla_id, cfg002_master_version_id: pending.artefacto_version_id, via: file.via, generated_auto_validated: false }),
        source_revision: file.sourceRevision, idempotency_key: file.idempotencyKey, created_by: actor.id,
      } });
      await tx.expedienteArtefactoPendiente.update({ where: { id: pending.id }, data: { current_document_id: document.id, estado: 'PENDIENTE_REVISION', validado_at: null, validado_por_id: null, requiere_revision: Boolean((file.review as any)?.conflicts?.length), motivo_revision: (file.review as any)?.conflicts?.length ? 'Se detectaron datos contradictorios; requiere revisión humana.' : null, version: { increment: 1 } } });
      await tx.expedienteDocumento.create({ data: {
        organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: document.id, tipo_vinculo: 'EXP006_RESULTADO', creado_por_id: actor.id,
        origen: 'CFG002', source_entity_type: 'ExpedienteArtefactoPendiente', source_entity_id: pending.id, source_context: file.via,
        source_key: `CFG002:ExpedienteArtefactoPendiente:${pending.id}:${document.id}:${file.via}`.slice(0, 320), document_version: sha(file.buffer),
        provenance: json({ source: 'EXP-006', pending_id: pending.id, cfg002_artifact_id: pending.artefacto_id, cfg002_rule_id: pending.regla_id, via: file.via }),
      } });
      if (file.aiUsage) await recordAIUsageInDb(tx, file.aiUsage, {
        organizationId: actor.organizationId, usuarioId: actor.id, expedienteId,
        operacion: 'EXP006_GENERATE_OPERATIONAL_ARTIFACT', operationId: file.aiOperationId,
        metadata: { pending_id: pending.id, source_manifest: file.sourceManifest, document_id: document.id },
      });
      await this.audit(tx, actor, file.via === 'IA' ? 'EXP006_GENERATE_AI' : 'EXP006_UPLOAD_EXTERNAL', 'ExpedienteArtefactoPendiente', pending.id, { document_id: document.id, status: 'PENDIENTE_REVISION', auto_validated: false, storage_key: '[PRIVATE]' });
      return { document_id: document.id };
    }, { timeout: 25_000 });
  }

  private async applyResolution(tx: Prisma.TransactionClient, actor: Exp006Actor, expedienteId: string, resolution: Exp006Resolution[]) {
    const activeKeys = new Set(resolution.map((item) => item.identityKey));
    let created = 0; let updated = 0; let preserved = 0; let inactivated = 0;
    for (const item of resolution) {
      const existing = await tx.expedienteArtefactoPendiente.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, identity_key: item.identityKey } });
      if (!existing) {
        await tx.expedienteArtefactoPendiente.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, expediente_acto_id: item.expedienteActoId,
          artefacto_id: item.artifactId, regla_id: item.ruleId, artefacto_version_id: item.masterVersionId,
          sujeto_tipo: item.subjectType, sujeto_id: item.subjectId, ordinal: item.ordinal, identity_key: item.identityKey,
          obligatoria: item.mandatory, explicacion_snapshot: json(item.snapshot), source_revision: item.sourceRevision, created_by: actor.id,
        } });
        created += 1;
        continue;
      }
      const protectedWork = Boolean(existing.current_document_id) || existing.estado === 'VALIDADO' || existing.estado === 'PENDIENTE_REVISION';
      if (existing.source_revision !== item.sourceRevision && protectedWork) {
        await tx.expedienteArtefactoPendiente.update({ where: { id: existing.id }, data: {
          en_alcance: true, requiere_revision: true,
          motivo_revision: 'La regla o el contexto cambió; el trabajo existente se preservó para revisión humana.',
          version: { increment: 1 },
        } });
        preserved += 1;
      } else if (existing.source_revision !== item.sourceRevision || !existing.en_alcance) {
        await tx.expedienteArtefactoPendiente.update({ where: { id: existing.id }, data: {
          expediente_acto_id: item.expedienteActoId, artefacto_version_id: item.masterVersionId,
          sujeto_tipo: item.subjectType, sujeto_id: item.subjectId, ordinal: item.ordinal,
          obligatoria: item.mandatory, explicacion_snapshot: json(item.snapshot), source_revision: item.sourceRevision,
          en_alcance: true, estado: existing.current_document_id ? 'PENDIENTE_REVISION' : 'PENDIENTE',
          requiere_revision: false, motivo_revision: null, version: { increment: 1 },
        } });
        updated += 1;
      }
    }
    const obsolete = await tx.expedienteArtefactoPendiente.findMany({ where: {
      organization_id: actor.organizationId, expediente_id: expedienteId, en_alcance: true,
      ...(activeKeys.size ? { identity_key: { notIn: [...activeKeys] } } : {}),
    } });
    for (const row of obsolete) {
      const protectedWork = Boolean(row.current_document_id) || row.estado === 'VALIDADO' || row.estado === 'PENDIENTE_REVISION';
      await tx.expedienteArtefactoPendiente.update({ where: { id: row.id }, data: protectedWork
        ? { en_alcance: false, requiere_revision: true, motivo_revision: 'El requisito dejó de aplicar; el trabajo se conserva para decisión humana.', version: { increment: 1 } }
        : { en_alcance: false, estado: 'NO_APLICA', requiere_revision: false, motivo_revision: 'El requisito dejó de aplicar sin trabajo previo.', version: { increment: 1 } } });
      if (protectedWork) preserved += 1;
      else inactivated += 1;
    }
    return { created, updated, preserved, inactivated };
  }

  private async buildContext(db: Db, actor: Exp006Actor, expedienteId: string): Promise<Exp006Context> {
    const expediente = await this.assertExpediente(db, actor, expedienteId);
    const [acts, parties, properties, currentTracking] = await Promise.all([
      db.expedienteActo.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' }, include: { tipo_acto: { select: { nombre: true } } } }),
      db.expedienteCompareciente.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', archived_at: null, expediente_acto_id: { not: null } }, include: { compareciente: { select: { id: true, tipo_persona: true, nombre_busqueda: true } } } }),
      db.expedientePredio.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' }, include: { predio: { select: { id: true, apodo: true, ubicacion_texto: true } }, actos: { where: { estatus: 'ACTIVO' }, select: { expediente_acto_id: true } } } }),
      db.expedienteSeguimientoActividad.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, en_alcance: true, estado: { notIn: ['COMPLETADO', 'NO_APLICA'] } }, orderBy: [{ etapa_orden_snapshot: 'asc' }, { created_at: 'asc' }], select: { etapa_maestra_id: true } }),
    ]);
    return {
      expedienteId, notariaId: expediente.notaria_id, institutionIds: institutionIdsFrom(expediente.datos_operacion), currentStageId: currentTracking?.etapa_maestra_id || null,
      acts: acts.map((item) => ({ id: item.id, typeId: item.tipo_acto_id, name: item.tipo_acto.nombre })),
      parties: parties.map((item) => ({ relationId: item.id, partyId: item.compareciente_id, actId: item.expediente_acto_id!, personType: item.compareciente.tipo_persona, roleId: item.caracter_id, name: item.compareciente.nombre_busqueda })),
      properties: properties.map((item) => ({ relationId: item.id, propertyId: item.predio_id, actIds: item.actos.map((act) => act.expediente_acto_id), name: item.predio.apodo || item.predio.ubicacion_texto || 'Inmueble' })),
    };
  }

  private masterArtifacts(db: Db, organizationId: string) {
    return db.catalogoArtefacto.findMany({ where: { organization_id: organizationId, activo: true }, include: { actos: true, reglas: { where: { activa: true } }, versiones: { where: { activa: true }, orderBy: { version: 'desc' } } } });
  }

  private async partySources(db: Db, actor: Exp006Actor, pending: any) {
    const relation = await db.expedienteCompareciente.findFirst({ where: { id: pending.sujeto_id, organization_id: actor.organizationId, expediente_id: pending.expediente_id, estatus: 'ACTIVO', archived_at: null }, include: {
      compareciente: { include: { personaFisica: true, personaMoral: true, documentos: { where: { estatus: 'ACTIVO', archived_at: null }, include: { documento: true }, orderBy: { updated_at: 'desc' } } } },
    } });
    if (!relation) throw new ExpedienteArtifactsError(403, 'EXP006_PARTY_SOURCE_ACCESS_DENIED', 'La comparecencia ya no está disponible en este expediente.');
    const current = new Map<string, any>();
    for (const link of relation.compareciente.documentos) if (!current.has(link.categoria)) current.set(link.categoria, link);
    const documents = [...current.values()].filter((link) => link.documento.organization_id === actor.organizationId && link.documento.compareciente_id === relation.compareciente_id && link.documento.estatus !== 'RECHAZADO');
    const structuredData = relation.compareciente.tipo_persona === 'FISICA' ? relation.compareciente.personaFisica : relation.compareciente.personaMoral;
    const manifest = {
      policy: 'SAME_PARTY_CURRENT_ONLY',
      subjectComparecienteId: relation.compareciente_id,
      subjectRelationId: relation.id,
      structuredFieldsUsed: Object.keys(conditionObject(structuredData)),
      currentDocumentIds: documents.map((item) => item.documento.id),
      masterArtifactId: pending.artefacto_id,
      masterVersionId: pending.artefacto_version_id,
      structuredSource: relation.compareciente.tipo_persona,
      excluded: ['HISTORICAL_PARTY', 'OTHER_PARTY', 'GENERAL_EXPEDIENTE', 'PROPERTY', 'BANK', 'NOTARY'], frontend_sources_accepted: false,
    };
    const revision = sha(JSON.stringify({ relation_version: relation.updated_at, party_version: relation.compareciente.version, structuredData, docs: documents.map((item) => [item.documento.id, item.documento.checksum_sha256, item.updated_at]) }));
    return {
      revision, manifest, structuredData: json(structuredData || {}) as any,
      documents: documents.map((item) => ({ id: item.documento.id, name: item.documento.nombre_original, text: item.documento.datos_extraidos ? JSON.stringify(item.documento.datos_extraidos) : '[Documento vigente sin texto estructurado disponible]' })),
      missing: structuredData ? [] : ['Datos estructurados del compareciente'], conflicts: [],
    };
  }

  private async readText(buffer: Buffer, mimeType: string, fileName: string) {
    if (mimeType.includes('officedocument.wordprocessingml') || fileName.toLowerCase().endsWith('.docx')) return (await mammoth.extractRawText({ buffer })).value;
    if (mimeType.startsWith('text/')) return buffer.toString('utf8');
    return `[Archivo maestro ${fileName}; contenido binario no textual. Respetar estructura y requerir revisión humana.]`;
  }

  private async pending(db: Db, actor: Exp006Actor, expedienteId: string, pendingId: string) {
    await this.assertExpediente(db, actor, expedienteId);
    const row = await db.expedienteArtefactoPendiente.findFirst({ where: { id: pendingId, organization_id: actor.organizationId, expediente_id: expedienteId, en_alcance: true } });
    if (!row) throw new ExpedienteArtifactsError(403, 'EXP006_PENDING_ACCESS_DENIED', 'No tienes acceso a este pendiente.');
    return row;
  }

  private async assertExpediente(db: Db, actor: Exp006Actor, expedienteId: string) {
    const record = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor as any) }, select: { id: true, notaria_id: true, datos_operacion: true, estatus: true } });
    if (!record) throw new ExpedienteArtifactsError(403, 'EXP006_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return record;
  }

  private async completeLinkedTracking(tx: Prisma.TransactionClient, actor: Exp006Actor, expedienteId: string, actId: string | null, activityMasterId: string) {
    if (!actId) return false;
    const remaining = await tx.expedienteArtefactoPendiente.count({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, expediente_acto_id: actId, en_alcance: true, obligatoria: true, estado: { notIn: ['VALIDADO', 'NO_APLICA'] }, explicacion_snapshot: { path: ['conditions', 'actividad_id'], equals: activityMasterId } } });
    if (remaining) return false;
    const activity = await tx.expedienteSeguimientoActividad.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, expediente_acto_id: actId, actividad_maestra_id: activityMasterId, en_alcance: true } });
    if (!activity || ['COMPLETADO', 'NO_APLICA'].includes(activity.estado)) return false;
    const dependencies = await tx.expedienteSeguimientoDependencia.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, actividad_id: activity.id, bloqueante: true }, select: { depende_actividad_id: true } });
    if (dependencies.length && await tx.expedienteSeguimientoActividad.count({ where: { id: { in: dependencies.map((item) => item.depende_actividad_id) }, estado: { notIn: ['COMPLETADO', 'NO_APLICA'] } } })) return false;
    const next = await tx.expedienteSeguimientoActividad.update({ where: { id: activity.id }, data: { estado: 'COMPLETADO', primera_fecha_inicio: activity.primera_fecha_inicio || new Date(), fecha_completada_actual: new Date(), version: { increment: 1 } } });
    await tx.expedienteSeguimientoHistorial.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, actividad_id: activity.id, actor_user_id: actor.id, estado_anterior: activity.estado, estado_nuevo: 'COMPLETADO', version_anterior: activity.version, version_nueva: next.version, razon: 'Todos los documentos obligatorios EXP-006 vinculados fueron validados.', detalles: json({ source: 'EXP-006', activity_master_id: activityMasterId }) } });
    return true;
  }

  private toResponse(row: any) { return { id: row.id, artifact_id: row.artefacto_id, rule_id: row.regla_id, master_version_id: row.artefacto_version_id, act_id: row.expediente_acto_id, subject_type: row.sujeto_tipo, subject_id: row.sujeto_id, ordinal: row.ordinal, estado: row.estado, obligatoria: row.obligatoria, explanation: row.explicacion_snapshot, source_revision: row.source_revision, version: row.version, in_scope: row.en_alcance, review_required: row.requiere_revision, review_reason: row.motivo_revision, document_id: row.current_document_id, validated_at: row.validado_at }; }

  private audit(tx: Prisma.TransactionClient, actor: Exp006Actor, action: string, entity: string, entityId: string, details: unknown) {
    return tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: entity, entidad_id: entityId, valores_nuevos: json(details), correlation_id: randomUUID(), session_id: actor.sessionId } });
  }
}
