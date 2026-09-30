import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { ProjectGenerationError, resolveAssignedProjectVersion } from './projectGeneration.service';
import { applyDirectedDocxPatches as applyDocxPatches, type DirectedDocxPatch } from './projectDocxPatch.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
type Actor = { id: string; organizationId: string; permissions?: string[] };
type Patch = DirectedDocxPatch;
const LEARNING_SCOPES = ['EXPEDIENTE', 'TIPO_ACTO', 'NOTARIA', 'BANCO', 'JURISDICCION', 'ORGANIZACION'] as const;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const safe = (value: string) => value.replace(/[^a-z0-9_.-]+/gi, '_');

export function normalizeDirectedPatches(value: unknown): Patch[] {
  if (!Array.isArray(value) || !value.length || value.length > 25) throw new ProjectGenerationError(400, 'PROJECT_PATCHES_REQUIRED', 'Agrega entre una y veinticinco correcciones dirigidas.');
  return value.map((raw, index) => {
    const item = record(raw); const find = String(item.find || '').trim(); const replace = String(item.replace || '').trim();
    if (!find || !replace || find === replace || find.length > 2_000 || replace.length > 5_000) throw new ProjectGenerationError(400, 'PROJECT_PATCH_INVALID', `La corrección ${index + 1} no es válida.`);
    return { find, replace };
  });
}

export async function applyDirectedDocxPatches(source: Buffer, patches: Patch[]) {
  return applyDocxPatches(source, patches, (status, code, message) => new ProjectGenerationError(status, code, message));
}

export function reconcileProjectMetadataAfterPatches(metadata: Record<string, any>, patches: Patch[], renderedText: string) {
  const resolvedTargets = patches
    .map((patch) => patch.find)
    .filter((target) => target && !renderedText.includes(target));
  const stillApplicable = (observation: unknown) => {
    const item = record(observation);
    if (item.kind === 'POSSIBLE_TEMPLATE_RESIDUE' && typeof item.value === 'string' && !renderedText.includes(item.value)) return false;
    const serialized = JSON.stringify(observation);
    return !resolvedTargets.some((target) => serialized.includes(target));
  };
  const reconcile = (value: unknown) => Array.isArray(value) ? value.filter(stillApplicable) : [];
  return {
    ...metadata,
    pending_count: (renderedText.match(/\[PENDIENTE(?::[^\]]*)?\]/g) || []).length,
    contradiction_observations: reconcile(metadata.contradiction_observations),
    generation_observations: reconcile(metadata.generation_observations),
    residual_observations: reconcile(metadata.residual_observations),
  };
}

export class ProjectInstructionService {
  async apply(actor: Actor, expedienteId: string, raw: Record<string, unknown>) {
    const instructions = String(raw.instructions || '').trim();
    const idempotencyKey = String(raw.idempotency_key || '').trim();
    if (!instructions || instructions.length > 10_000) throw new ProjectGenerationError(400, 'PROJECT_INSTRUCTIONS_REQUIRED', 'Describe las indicaciones que justifican la corrección.');
    if (!idempotencyKey || idempotencyKey.length > 160) throw new ProjectGenerationError(400, 'PROJECT_IDEMPOTENCY_INVALID', 'No fue posible identificar de forma segura esta aplicación.');
    const patches = normalizeDirectedPatches(raw.patches);
    const authorizeLearning = raw.authorize_learning === true;
    const learningScope = String(raw.learning_scope || 'EXPEDIENTE') as typeof LEARNING_SCOPES[number];
    const learningContent = String(raw.learning_content || instructions).trim();
    if (authorizeLearning) {
      if (!actor.permissions?.includes('configuracion.manage')) throw new ProjectGenerationError(403, 'PROJECT_LEARNING_FORBIDDEN', 'No tienes permiso para convertir esta corrección en criterio interno.');
      if (!LEARNING_SCOPES.includes(learningScope)) throw new ProjectGenerationError(400, 'PROJECT_LEARNING_SCOPE_INVALID', 'Selecciona un alcance válido para el criterio interno.');
      if (!learningContent || learningContent.length > 10_000) throw new ProjectGenerationError(400, 'PROJECT_LEARNING_CONTENT_INVALID', 'El criterio reutilizable no es válido.');
    }
    const prior = await prisma.projectInstructionApplication.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey } });
    if (prior) return { application: prior, idempotent: true };
    const currentLink = await prisma.expedienteDocumento.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' },
      include: { documento: true }, orderBy: { fecha_vinculo: 'desc' },
    });
    if (!currentLink || currentLink.documento.mime_type !== DOCX) throw new ProjectGenerationError(409, 'PROJECT_CURRENT_VERSION_REQUIRED', 'Genera o carga una versión DOCX antes de aplicar indicaciones.');
    const rendered = await applyDirectedDocxPatches(await downloadFile(currentLink.documento.storage_key), patches);
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null }, select: { numero_pravia: true, tipo_acto_id: true, notaria_id: true, datos_operacion: true } });
    if (!expediente) throw new ProjectGenerationError(404, 'PROJECT_CASE_NOT_FOUND', 'No se encontró el expediente.');
    const operationData = record(expediente.datos_operacion);
    const learningTarget = learningScope === 'TIPO_ACTO' ? expediente.tipo_acto_id
      : learningScope === 'NOTARIA' ? expediente.notaria_id
        : learningScope === 'BANCO' ? String(operationData.banco_id || '').trim()
          : learningScope === 'JURISDICCION' ? String(operationData.jurisdiccion || '').trim()
            : learningScope === 'EXPEDIENTE' ? expedienteId : actor.organizationId;
    if (authorizeLearning && !learningTarget) throw new ProjectGenerationError(409, 'PROJECT_LEARNING_SCOPE_TARGET_MISSING', 'El expediente no contiene el dato necesario para el alcance de aprendizaje seleccionado.');
    const metadata = record(record(currentLink.documento.datos_extraidos).proyecto);
    if (metadata.es_version_final === true || currentLink.document_role === 'DEFINITIVE_DEED') {
      throw new ProjectGenerationError(409, 'PROJECT_VALIDATED_REOPEN_REQUIRED', 'El proyecto está validado. Reábrelo explícitamente antes de crear una nueva versión con IA.');
    }
    const reconciledMetadata = reconcileProjectMetadataAfterPatches(metadata, patches, rendered.after);
    const planned = Number(metadata.version_numero || 1) + 1;
    const storageKey = `organizations/${actor.organizationId}/documentos/expedientes/${expedienteId}/proyectos/${crypto.randomUUID()}_Proyecto_${safe(expediente.numero_pravia)}_indicaciones.docx`;
    await uploadFile(rendered.buffer, storageKey, DOCX);
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:project-instructions:${actor.organizationId}:${expedienteId}`}))`);
        const duplicate = await tx.projectInstructionApplication.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey } });
        if (duplicate) return { application: duplicate, idempotent: true, discardUpload: true };
        const locked = await tx.expedienteDocumento.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' }, include: { documento: true }, orderBy: { fecha_vinculo: 'desc' } });
        if (!locked || locked.documento_id !== currentLink.documento_id) throw new ProjectGenerationError(409, 'PROJECT_CURRENT_VERSION_CHANGED', 'La versión vigente cambió; recarga antes de aplicar indicaciones.');
        const count = await tx.documento.count({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo: 'PROYECTO_ESCRITURA' } });
        const version = resolveAssignedProjectVersion(planned, count);
        await tx.expedienteDocumento.update({ where: { id: locked.id }, data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: `Sustituido por V${version} mediante indicaciones dirigidas` } });
        const created = await tx.documento.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, nombre_original: `Proyecto_${safe(expediente.numero_pravia)}_V${version}.docx`, nombre_interno: storageKey, storage_key: storageKey,
          tipo: 'PROYECTO_ESCRITURA', categoria: 'PROYECTO', mime_type: DOCX, size_bytes: rendered.buffer.length, checksum_sha256: crypto.createHash('sha256').update(rendered.buffer).digest('hex'),
          subido_por_id: actor.id, estatus: 'VIGENTE', observaciones: `V${version} · indicaciones aplicadas sobre V${metadata.version_numero || version - 1}`,
          datos_extraidos: json({ proyecto: { ...reconciledMetadata, version_numero: version, es_version_final: false, nota_version: `V${version} · indicaciones dirigidas`, instructions, instructions_consumed: true, instruction_application: { source_document_id: locked.documento_id, patch_count: patches.length } } }),
        } });
        await tx.expedienteDocumento.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: created.id, tipo_vinculo: 'PROYECTO_ESCRITURA', creado_por_id: actor.id, estatus: 'ACTIVO', origen: 'EXPEDIENTE', source_entity_type: 'Documento', source_entity_id: locked.documento_id, source_context: 'PROYECTO_INDICACIONES', source_key: `EXPEDIENTE:Documento:${locked.documento_id}:${created.id}:PROYECTO_INDICACIONES`, document_version: crypto.createHash('sha256').update(rendered.buffer).digest('hex'), provenance: json({ supersedes_project_document_id: locked.documento_id, instructions, directed_patches: patches.length }), document_role: 'PROJECT_DRAFT', idempotency_key: idempotencyKey } });
        const application = await tx.projectInstructionApplication.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, source_project_document_id: locked.documento_id, result_project_document_id: created.id, instructions, patches: json(patches), diff: json(rendered.diff), idempotency_key: idempotencyKey, created_by_id: actor.id } });
        const learnedCriterion = authorizeLearning ? await tx.knowledgeCriterion.create({ data: {
          organization_id: actor.organizationId,
          code: `PROJECT-${application.id}`,
          title: String(raw.learning_title || `Criterio aprobado desde ${expediente.numero_pravia}`).trim().slice(0, 300),
          content: learningContent,
          scope: json({ module: 'EXP-010', scope: learningScope, target_id: learningTarget, application_id: application.id, explicitly_authorized: true }),
          created_by_id: actor.id,
        } }) : null;
        const facts = await tx.projectFactSnapshot.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, project_document_id: locked.documento_id } });
        if (facts) await tx.projectFactSnapshot.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, project_document_id: created.id, project_version: version, facts: json(facts.facts), conflicts: json(facts.conflicts), created_by_id: actor.id } });
        await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA', titulo: `Indicaciones aplicadas al proyecto (V${version})`, descripcion: `${patches.length} corrección(es) dirigidas; la versión anterior permanece inmutable.`, metadatos: json({ source: 'EXP-010', action: 'APPLY_DIRECTED_INSTRUCTIONS', application_id: application.id, source_document_id: locked.documento_id, result_document_id: created.id }), seccion_relacionada: 'proyecto', entidad_relacionada: 'Documento', entidad_relacionada_id: created.id } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'APLICAR_INDICACIONES_PROYECTO', entidad: 'ProjectInstructionApplication', entidad_id: application.id, detalles: json({ expediente_id: expedienteId, source_document_id: locked.documento_id, result_document_id: created.id, patch_count: patches.length, learned_criterion_id: learnedCriterion?.id || null, learning_scope: learnedCriterion ? learningScope : null }) } });
        return { application, version: created, learnedCriterion, idempotent: false, discardUpload: false };
      }, { timeout: 20_000 });
      if (result.discardUpload) await deleteFile(storageKey).catch(() => undefined);
      return result;
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  }
}

export const projectInstructionService = new ProjectInstructionService();
