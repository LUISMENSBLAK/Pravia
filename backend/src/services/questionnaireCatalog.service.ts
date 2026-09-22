import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import {
  questionnaireChecksum, QuestionnaireError,
  validateQuestionnaireDefinition, type QuestionnaireDefinition,
} from '../domain/questionnaire';
import { ComplianceH5Service } from './complianceH5.service';

type Actor = NonNullable<Request['user']>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const requireManage = (actor: Actor) => {
  if (!actor.permissions.includes('configuracion.plantillas_formatos.manage')) {
    throw new QuestionnaireError(403, 'QUESTIONNAIRE_MANAGE_DENIED', 'No tienes permiso para administrar cuestionarios.');
  }
};
const requestKey = (value: unknown) => {
  const result = String(value || '').trim();
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(result)) throw new QuestionnaireError(400, 'QUESTIONNAIRE_KEY_REQUIRED', 'No se pudo identificar el intento de guardado.');
  return result;
};
const audit = (tx: Prisma.TransactionClient, actor: Actor, action: string, entity: string, id: string, before?: unknown, after?: unknown) => tx.auditLog.create({ data: {
  organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: entity, entidad_id: id,
  valores_anteriores: before === undefined ? undefined : json(before), valores_nuevos: after === undefined ? undefined : json(after), session_id: actor.sessionId,
} });

export class QuestionnaireCatalogService {
  async supporting(actor: Actor) {
    const [acts, stages, formats] = await Promise.all([
      prisma.tipoActo.findMany({ where: { OR: [{ organization_id: actor.organizationId }, { organization_id: null }], activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
      prisma.configuracionEtapa.findMany({ where: { configuracion: { organization_id: actor.organizationId, activa: true } }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
      prisma.catalogoArtefacto.findMany({ where: { organization_id: actor.organizationId, tipo: 'FORMATO', activo: true, OR: [{ purpose: null }, { purpose: { not: 'QUESTIONNAIRE' } }] }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
    ]);
    return { acts, stages, formats };
  }
  async list(actor: Actor, search = '') {
    return prisma.catalogoArtefacto.findMany({
      where: { organization_id: actor.organizationId, purpose: 'QUESTIONNAIRE', ...(search.trim() ? { nombre: { contains: search.trim(), mode: 'insensitive' as const } } : {}) },
      include: { versiones: { orderBy: { version: 'desc' } }, actos: true, cuestionarioFormatos: { include: { formato: { select: { id: true, nombre: true } } } } },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
  }

  private async validateLinks(actor: Actor, definition: QuestionnaireDefinition) {
    const actIds = [...new Set(definition.applicableActIds || [])];
    if (actIds.length) {
      const count = await prisma.tipoActo.count({ where: { id: { in: actIds }, OR: [{ organization_id: actor.organizationId }, { organization_id: null }], activo: true } });
      if (count !== actIds.length) throw new QuestionnaireError(400, 'QUESTIONNAIRE_ACT_OUTSIDE_TENANT', 'Uno o más actos aplicables no están disponibles.');
    }
    const formatIds = [...new Set((definition.formatMappings || []).map((item) => item.formatId))];
    if (formatIds.length) {
      const count = await prisma.catalogoArtefacto.count({ where: { id: { in: formatIds }, organization_id: actor.organizationId, tipo: 'FORMATO', OR: [{ purpose: null }, { purpose: { not: 'QUESTIONNAIRE' } }] } });
      if (count !== formatIds.length) throw new QuestionnaireError(400, 'QUESTIONNAIRE_FORMAT_OUTSIDE_TENANT', 'Uno o más formatos vinculados no están disponibles.');
    }
    if (definition.stageId) {
      const stage = await prisma.configuracionEtapa.findFirst({ where: { id: definition.stageId, configuracion: { organization_id: actor.organizationId } }, select: { id: true } });
      if (!stage) throw new QuestionnaireError(400, 'QUESTIONNAIRE_STAGE_OUTSIDE_TENANT', 'La etapa seleccionada no está disponible.');
    }
    return { actIds };
  }

  private async syncLinks(tx: Prisma.TransactionClient, actor: Actor, artifactId: string, definition: QuestionnaireDefinition, actIds: string[]) {
    await tx.catalogoArtefactoActo.deleteMany({ where: { organization_id: actor.organizationId, artefacto_id: artifactId } });
    if (actIds.length) await tx.catalogoArtefactoActo.createMany({ data: actIds.map((tipoActoId) => ({ organization_id: actor.organizationId, artefacto_id: artifactId, tipo_acto_id: tipoActoId })) });
    await tx.catalogoCuestionarioFormato.deleteMany({ where: { organization_id: actor.organizationId, cuestionario_artefacto_id: artifactId } });
    if (definition.formatMappings?.length) await tx.catalogoCuestionarioFormato.createMany({ data: definition.formatMappings.map((link) => ({ organization_id: actor.organizationId, cuestionario_artefacto_id: artifactId, formato_artefacto_id: link.formatId, mapping_json: json(link.mappings) })) });
  }

  async create(actor: Actor, input: any) {
    requireManage(actor);
    const definition = validateQuestionnaireDefinition(input.definition);
    const links = await this.validateLinks(actor, definition);
    return prisma.$transaction(async (tx) => {
      const notaria = await tx.notaria.findFirst({ where: { organization_id: actor.organizationId, activa: true }, orderBy: { created_at: 'asc' } });
      if (!notaria) throw new QuestionnaireError(409, 'QUESTIONNAIRE_NOTARY_REQUIRED', 'Configura la Notaría antes de crear cuestionarios.');
      const artifact = await tx.catalogoArtefacto.create({ data: { organization_id: actor.organizationId, tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: notaria.id, nombre: definition.title.trim(), descripcion: definition.description?.trim() || null, purpose: 'QUESTIONNAIRE', activo: true, creado_por_id: actor.id, actualizado_por_id: actor.id } });
      const version = await tx.catalogoArtefactoVersion.create({ data: { organization_id: actor.organizationId, artefacto_id: artifact.id, version: 1, origen: 'QUESTIONNAIRE_EDITOR', content_kind: 'STRUCTURED_QUESTIONNAIRE', definition_json: json(definition), definition_checksum: questionnaireChecksum(definition), schema_version: 1, creado_por_id: actor.id } });
      await this.syncLinks(tx, actor, artifact.id, definition, links.actIds);
      await audit(tx, actor, 'QUESTIONNAIRE_CREATED', 'CatalogoArtefacto', artifact.id, undefined, { version: 1, checksum: version.definition_checksum, definition });
      return { ...artifact, versiones: [version] };
    });
  }

  async version(actor: Actor, artifactId: string, input: any) {
    requireManage(actor);
    const definition = validateQuestionnaireDefinition(input.definition);
    const links = await this.validateLinks(actor, definition);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`questionnaire:${actor.organizationId}:${artifactId}`}))`);
      const artifact = await tx.catalogoArtefacto.findFirst({ where: { id: artifactId, organization_id: actor.organizationId, purpose: 'QUESTIONNAIRE' }, include: { versiones: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!artifact) throw new QuestionnaireError(404, 'QUESTIONNAIRE_NOT_FOUND', 'No se encontró el cuestionario.');
      const version = await tx.catalogoArtefactoVersion.create({ data: { organization_id: actor.organizationId, artefacto_id: artifact.id, version: (artifact.versiones[0]?.version || 0) + 1, origen: 'QUESTIONNAIRE_EDITOR', content_kind: 'STRUCTURED_QUESTIONNAIRE', definition_json: json(definition), definition_checksum: questionnaireChecksum(definition), schema_version: 1, creado_por_id: actor.id } });
      await tx.catalogoArtefacto.update({ where: { id: artifact.id }, data: { nombre: definition.title.trim(), descripcion: definition.description?.trim() || null, revision: { increment: 1 }, actualizado_por_id: actor.id } });
      await this.syncLinks(tx, actor, artifact.id, definition, links.actIds);
      await audit(tx, actor, 'QUESTIONNAIRE_VERSION_CREATED', 'CatalogoArtefactoVersion', version.id, artifact.versiones[0]?.definition_json, { artifact_id: artifact.id, version: version.version, definition });
      return version;
    });
  }

  async duplicate(actor: Actor, artifactId: string) {
    requireManage(actor);
    const source = await prisma.catalogoArtefacto.findFirst({ where: { id: artifactId, organization_id: actor.organizationId, purpose: 'QUESTIONNAIRE' }, include: { versiones: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!source?.versiones[0]?.definition_json) throw new QuestionnaireError(404, 'QUESTIONNAIRE_NOT_FOUND', 'No se encontró el cuestionario.');
    return this.create(actor, { definition: { ...(source.versiones[0].definition_json as any), title: `${source.nombre} (copia)` } });
  }

  async setActive(actor: Actor, artifactId: string, active: boolean) {
    requireManage(actor);
    return prisma.$transaction(async (tx) => {
      const before = await tx.catalogoArtefacto.findFirst({ where: { id: artifactId, organization_id: actor.organizationId, purpose: 'QUESTIONNAIRE' } });
      if (!before) throw new QuestionnaireError(404, 'QUESTIONNAIRE_NOT_FOUND', 'No se encontró el cuestionario.');
      const after = await tx.catalogoArtefacto.update({ where: { id: before.id }, data: { activo: active, revision: { increment: 1 }, actualizado_por_id: actor.id } });
      await audit(tx, actor, active ? 'QUESTIONNAIRE_ACTIVATED' : 'QUESTIONNAIRE_DEACTIVATED', 'CatalogoArtefacto', after.id, { activo: before.activo }, { activo: after.activo });
      return after;
    });
  }

  async listApplicable(actor: Actor, expedienteId: string) {
    const state = await prisma.expedienteComplianceState.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId },
      select: { current_review_id: true },
    });
    if (!state?.current_review_id) return [];
    const workspace = await ComplianceH5Service.readWorkspace(actor, state.current_review_id);
    return workspace.questionnaires.map((item: any) => ({
      assessmentId: item.id,
      bank: item.scope === 'PERSONAL' ? 'PERSONAL' : 'OPERACION',
      artifact: {
        id: item.definition_version_id,
        name: item.scope === 'PERSONAL' ? 'Personal' : 'Acto / Operación',
      },
      version: { id: item.definitionVersion.id, number: item.definitionVersion.version || 1 },
      definition: item.definitionVersion.definition_json,
      subject: {
        key: item.identity_key,
        label: item.targetCompareciente?.nombre_busqueda || item.requirement?.label || 'Acto / Operación',
      },
      prefill: {},
      latestResponse: item.currentRevision ? {
        id: item.currentRevision.id,
        estado: item.currentRevision.status === 'FINALIZED' ? 'FINALIZADO' : 'BORRADOR',
        revision: item.currentRevision.revision_number,
        answers_json: item.currentRevision.answers,
        completeness_json: {
          complete: item.currentRevision.completeness === 'COMPLETE',
          missing: item.currentRevision.missing_question_ids,
        },
        base_fingerprint: item.currentRevision.semantic_fingerprint,
        created_at: item.currentRevision.created_at,
      } : null,
      formats: [],
    }));
  }

  async ensureApplicable(actor: Actor, expedienteId: string) {
    const state = await prisma.expedienteComplianceState.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId },
      select: { current_review_id: true },
    });
    if (!state?.current_review_id) throw new QuestionnaireError(409, 'QUESTIONNAIRE_COMPLIANCE_REVIEW_REQUIRED', 'Primero debe existir una revisión de Cumplimiento vigente.');
    return ComplianceH5Service.ensureQuestionnaires(actor, state.current_review_id);
  }

  async listAnswers(actor: Actor, expedienteId: string) {
    return prisma.expedienteCuestionarioRespuesta.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId }, orderBy: { created_at: 'desc' } });
  }

  async saveAnswers(actor: Actor, expedienteId: string, input: any) {
    const assessmentId = String(input.assessmentId || '').trim();
    const assessment = await prisma.complianceQuestionnaireAssessment.findFirst({
      where: { id: assessmentId, organization_id: actor.organizationId, expediente_id: expedienteId },
      select: { id: true },
    });
    if (!assessment) throw new QuestionnaireError(404, 'QUESTIONNAIRE_CONTEXT_NOT_FOUND', 'No se encontró el cuestionario o expediente.');
    return ComplianceH5Service.saveQuestionnaire(actor, assessment.id, {
      answers: input.answers,
      base_fingerprint: String(input.baseFingerprint || ''),
      idempotency_key: requestKey(input.idempotencyKey),
    }, input.finalize === true);
  }
}

export const questionnaireCatalogService = new QuestionnaireCatalogService();
