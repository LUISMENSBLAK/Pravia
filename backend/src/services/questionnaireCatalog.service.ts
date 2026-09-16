import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import {
  evaluateQuestionnaire, questionnaireChecksum, QuestionnaireError,
  validateQuestionnaireDefinition, type QuestionnaireDefinition,
} from '../domain/questionnaire';

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
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId }, select: {
      id: true, numero_pravia: true, cliente_alias: true, tipo_acto_id: true,
      actos: { where: { estatus: 'ACTIVO' }, select: { tipo_acto_id: true } },
      comparecientes: { where: { estatus: 'ACTIVO' }, select: { compareciente_id: true, compareciente: { select: { nombre_busqueda: true } } } },
      predios: { where: { estatus: 'ACTIVO' }, select: { predio_id: true, predio: { select: { apodo: true, clave_catastral: true } } } },
    } });
    if (!expediente) throw new QuestionnaireError(404, 'QUESTIONNAIRE_EXPEDIENTE_NOT_FOUND', 'No se encontró el expediente.');
    const actIds = [...new Set([expediente.tipo_acto_id, ...expediente.actos.map((item) => item.tipo_acto_id)].filter(Boolean) as string[])];
    const artifacts = await prisma.catalogoArtefacto.findMany({ where: { organization_id: actor.organizationId, purpose: 'QUESTIONNAIRE', activo: true, OR: [{ actos: { none: {} } }, { actos: { some: { tipo_acto_id: { in: actIds } } } }] }, include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' } }, cuestionarioFormatos: { where: { activo: true }, include: { formato: { select: { id: true, nombre: true } } } } }, orderBy: { nombre: 'asc' } });
    const prior = await prisma.expedienteCuestionarioRespuesta.findMany({ where: { organization_id: actor.organizationId, expediente_id: expediente.id }, orderBy: { revision: 'desc' } });
    return artifacts.flatMap((artifact) => {
      const newest = artifact.versiones[0]; if (!newest?.definition_json) return [];
      const newestDefinition = validateQuestionnaireDefinition(newest.definition_json);
      const subjects = newestDefinition.scope === 'EXPEDIENTE'
        ? [{ subjectKey: expediente.id, subjectLabel: expediente.numero_pravia, facts: { EXPEDIENTE_FOLIO: expediente.numero_pravia, EXPEDIENTE_CLIENTE: expediente.cliente_alias || '' } as Record<string, string> }]
        : newestDefinition.scope === 'COMPARECIENTE'
          ? expediente.comparecientes.map((item) => ({ subjectKey: item.compareciente_id, subjectLabel: item.compareciente.nombre_busqueda, facts: { COMPARECIENTE_NOMBRE: item.compareciente.nombre_busqueda } as Record<string, string> }))
          : expediente.predios.map((item) => ({ subjectKey: item.predio_id, subjectLabel: item.predio.apodo || item.predio.clave_catastral || 'Inmueble', facts: { INMUEBLE_CLAVE_CATASTRAL: item.predio.clave_catastral || '' } as Record<string, string> }));
      return subjects.map((subject) => {
        const existing = prior.find((row) => row.subject_key === subject.subjectKey && artifact.versiones.some((version) => version.id === row.artefacto_version_id));
        const pinned = existing ? artifact.versiones.find((version) => version.id === existing.artefacto_version_id) || newest : newest;
        const definition = validateQuestionnaireDefinition(pinned.definition_json);
        const prefill = Object.fromEntries(definition.sections.flatMap((section) => section.questions).filter((question) => question.prefill).map((question) => [question.id, subject.facts[question.prefill!] ?? '']));
        return { artifact: { id: artifact.id, name: artifact.nombre }, version: { id: pinned.id, number: pinned.version }, definition, subject: { key: subject.subjectKey, label: subject.subjectLabel }, prefill, latestResponse: existing || null, formats: artifact.cuestionarioFormatos.map((link) => link.formato) };
      });
    });
  }

  async listAnswers(actor: Actor, expedienteId: string) {
    return prisma.expedienteCuestionarioRespuesta.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId }, orderBy: { created_at: 'desc' } });
  }

  async saveAnswers(actor: Actor, expedienteId: string, input: any) {
    const version = await prisma.catalogoArtefactoVersion.findFirst({ where: { id: String(input.versionId || ''), organization_id: actor.organizationId, artefacto: { purpose: 'QUESTIONNAIRE', activo: true } } });
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId }, select: { id: true } });
    if (!version?.definition_json || !expediente) throw new QuestionnaireError(404, 'QUESTIONNAIRE_CONTEXT_NOT_FOUND', 'No se encontró el cuestionario o expediente.');
    const definition = validateQuestionnaireDefinition(version.definition_json);
    const scope = String(input.scope || definition.scope);
    const subjectKey = String(input.subjectKey || expedienteId).trim();
    const idempotencyKey = requestKey(input.idempotencyKey);
    if (scope !== definition.scope || !subjectKey) throw new QuestionnaireError(400, 'QUESTIONNAIRE_SUBJECT_INVALID', 'El sujeto no corresponde al alcance del cuestionario.');
    if (scope === 'EXPEDIENTE' && subjectKey !== expedienteId) throw new QuestionnaireError(400, 'QUESTIONNAIRE_SUBJECT_INVALID', 'El sujeto no corresponde al expediente.');
    if (scope === 'COMPARECIENTE' && !(await prisma.expedienteCompareciente.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, compareciente_id: subjectKey, estatus: 'ACTIVO' }, select: { id: true } }))) throw new QuestionnaireError(404, 'QUESTIONNAIRE_SUBJECT_NOT_FOUND', 'El compareciente no pertenece al expediente.');
    if (scope === 'INMUEBLE' && !(await prisma.expedientePredio.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, predio_id: subjectKey, estatus: 'ACTIVO' }, select: { id: true } }))) throw new QuestionnaireError(404, 'QUESTIONNAIRE_SUBJECT_NOT_FOUND', 'El inmueble no pertenece al expediente.');
    const answers = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? input.answers : {};
    const result = evaluateQuestionnaire(definition, answers);
    if (input.finalize && !result.complete) throw new QuestionnaireError(409, 'QUESTIONNAIRE_INCOMPLETE', 'Completa las preguntas obligatorias antes de finalizar.');
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`questionnaire-response:${actor.organizationId}:${expedienteId}:${version.id}:${scope}:${subjectKey}`}))`);
      const existing = await tx.expedienteCuestionarioRespuesta.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.expediente_id !== expedienteId || existing.artefacto_version_id !== version.id || existing.scope !== scope || existing.subject_key !== subjectKey) {
          throw new QuestionnaireError(409, 'QUESTIONNAIRE_KEY_REUSED', 'La clave del intento ya pertenece a otra respuesta de cuestionario.');
        }
        return existing;
      }
      const latest = await tx.expedienteCuestionarioRespuesta.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, artefacto_version_id: version.id, scope: scope as any, subject_key: subjectKey }, orderBy: { revision: 'desc' } });
      const row = await tx.expedienteCuestionarioRespuesta.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, artefacto_version_id: version.id, scope: scope as any, subject_key: subjectKey, revision: (latest?.revision || 0) + 1, estado: input.finalize ? 'FINALIZADO' : 'BORRADOR', definition_snapshot: json(definition), answers_json: json(answers), mapped_values_json: json(result.mapped), completeness_json: json({ complete: result.complete, missing: result.missing }), idempotency_key: idempotencyKey, created_by_id: actor.id, finalized_at: input.finalize ? new Date() : null } });
      await audit(tx, actor, input.finalize ? 'QUESTIONNAIRE_FINALIZED' : 'QUESTIONNAIRE_SAVED', 'ExpedienteCuestionarioRespuesta', row.id, latest?.answers_json, { scope, subjectKey, revision: row.revision, versionId: version.id, answers, mapped: result.mapped });
      return row;
    });
  }
}

export const questionnaireCatalogService = new QuestionnaireCatalogService();
