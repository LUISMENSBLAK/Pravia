import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { ComplianceError } from '../domain/compliance';
import {
  semanticFingerprint,
  validateQuestionnaireDefinition,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
  type QuestionnaireScope,
} from '../domain/complianceH5';

type Actor = NonNullable<Request['user']>;
type BankKey = 'PERSONAL' | 'OPERACION';
type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const BANKS: Record<BankKey, { label: string; purpose: 'CUE_PERSONAL' | 'CUE_GENERAL'; scope: QuestionnaireScope; code: string }> = {
  PERSONAL: { label: 'Personal', purpose: 'CUE_PERSONAL', scope: 'PERSONAL', code: 'CFG-CUE-PERSONAL' },
  OPERACION: { label: 'Acto / Operación', purpose: 'CUE_GENERAL', scope: 'GENERAL', code: 'CFG-CUE-OPERACION' },
};

const bank = (value: string): BankKey => {
  const key = value.toUpperCase() as BankKey;
  if (!BANKS[key]) throw new ComplianceError('El banco de preguntas no existe.', 'QUESTIONNAIRE_BANK_INVALID', 400);
  return key;
};

const requireManage = (actor: Actor) => {
  if (!actor.permissions.includes('configuracion.plantillas_formatos.manage') && !actor.permissions.includes('compliance.rules.manage'))
    throw new ComplianceError('No tienes permiso para administrar preguntas.', 'QUESTIONNAIRE_BANK_MANAGE_DENIED', 403);
};

const question = (input: any, fallbackId?: string): QuestionnaireQuestion => {
  const type = String(input?.type || 'TEXT').toUpperCase();
  if (!['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'CHOICE', 'MULTI_CHOICE'].includes(type))
    throw new ComplianceError('El tipo de pregunta no es válido.', 'QUESTIONNAIRE_QUESTION_TYPE_INVALID', 400);
  const label = String(input?.label || '').trim();
  if (!label) throw new ComplianceError('Escribe la pregunta.', 'QUESTIONNAIRE_QUESTION_LABEL_REQUIRED', 400);
  const id = fallbackId || String(input?.id || crypto.randomUUID()).trim();
  const options = Array.isArray(input?.options)
    ? input.options.map((item: any) => typeof item === 'string'
      ? { code: item.trim(), label: item.trim() }
      : { code: String(item?.code || '').trim(), label: String(item?.label || '').trim() })
    : undefined;
  return {
    id,
    label,
    type: type as QuestionnaireQuestion['type'],
    required: input?.required === true,
    active: input?.active !== false,
    order: Number.isSafeInteger(input?.order) && input.order >= 0 ? input.order : 0,
    ...(options?.length ? { options } : {}),
  };
};

function orderedDefinition(scope: QuestionnaireScope, questions: QuestionnaireQuestion[]): QuestionnaireDefinition {
  return validateQuestionnaireDefinition({
    schema_version: 1,
    scope,
    sections: [{
      id: scope === 'PERSONAL' ? 'personal' : 'operacion',
      label: scope === 'PERSONAL' ? 'Personal' : 'Acto / Operación',
      questions: questions
        .map((item, index) => ({ ...item, order: Number.isSafeInteger(item.order) ? item.order : index }))
        .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id))
        .map((item, index) => ({ ...item, order: index })),
    }],
  });
}

async function activeBank(db: typeof prisma | Db, actor: Actor, key: BankKey) {
  const config = BANKS[key];
  const artifacts = await db.catalogoArtefacto.findMany({
    where: { organization_id: actor.organizationId, purpose: config.purpose, activo: true },
    include: { versiones: { where: { activa: true, content_kind: 'STRUCTURED_QUESTIONNAIRE' }, orderBy: { version: 'desc' } } },
    orderBy: { created_at: 'asc' },
  });
  const candidates = artifacts.flatMap((artifact) => artifact.versiones.map((version) => ({ artifact, version })));
  if (candidates.length > 1)
    throw new ComplianceError(`Existe más de una definición activa para el banco ${config.label}.`, 'QUESTIONNAIRE_BANK_AMBIGUOUS', 409);
  const candidate = candidates[0];
  if (!candidate) return null;
  const definition = validateQuestionnaireDefinition(candidate.version.definition_json);
  return { ...candidate, definition };
}

async function ensureArtifact(tx: Db, actor: Actor, key: BankKey) {
  const existing = await activeBank(tx, actor, key);
  if (existing) return existing.artifact;
  const config = BANKS[key];
  const canonical = await tx.catalogoArtefacto.findMany({
    where: { organization_id: actor.organizationId, codigo_biblioteca: config.code, activo: true },
    orderBy: { created_at: 'asc' },
  });
  if (canonical.length > 1)
    throw new ComplianceError(`Existe más de un catálogo canónico para el banco ${config.label}.`, 'QUESTIONNAIRE_BANK_AMBIGUOUS', 409);
  if (canonical[0]) {
    if (canonical[0].purpose && canonical[0].purpose !== config.purpose)
      throw new ComplianceError('El catálogo canónico tiene un propósito incompatible.', 'QUESTIONNAIRE_BANK_PURPOSE_CONFLICT', 409);
    if (!canonical[0].purpose) await tx.catalogoArtefacto.update({ where: { id: canonical[0].id }, data: { purpose: config.purpose, actualizado_por_id: actor.id } });
    return canonical[0];
  }
  const notaria = await tx.notaria.findFirst({ where: { organization_id: actor.organizationId, activa: true }, orderBy: { created_at: 'asc' } });
  if (!notaria) throw new ComplianceError('Configura la Notaría antes de administrar preguntas.', 'QUESTIONNAIRE_NOTARY_REQUIRED', 409);
  return tx.catalogoArtefacto.create({ data: {
    organization_id: actor.organizationId,
    tipo: 'FORMATO',
    propietario_tipo: 'NOTARIA',
    notaria_id: notaria.id,
    nombre: `Banco de preguntas — ${config.label}`,
    descripcion: null,
    codigo_biblioteca: config.code,
    purpose: config.purpose,
    activo: true,
    creado_por_id: actor.id,
    actualizado_por_id: actor.id,
  } });
}

async function publish(tx: Db, actor: Actor, key: BankKey, artifactId: string, definition: QuestionnaireDefinition, action: string) {
  const current = await tx.catalogoArtefactoVersion.findFirst({
    where: { organization_id: actor.organizationId, artefacto_id: artifactId },
    orderBy: { version: 'desc' },
  });
  await tx.catalogoArtefactoVersion.updateMany({ where: { organization_id: actor.organizationId, artefacto_id: artifactId, activa: true }, data: { activa: false } });
  const checksum = semanticFingerprint(definition);
  const version = await tx.catalogoArtefactoVersion.create({ data: {
    organization_id: actor.organizationId,
    artefacto_id: artifactId,
    version: (current?.version || 0) + 1,
    origen: 'CFG_QUESTIONNAIRE_BANKS_V2',
    content_kind: 'STRUCTURED_QUESTIONNAIRE',
    definition_json: json(definition),
    definition_checksum: checksum,
    schema_version: 1,
    activa: true,
    creado_por_id: actor.id,
  } });
  await tx.catalogoArtefacto.update({ where: { id: artifactId }, data: { revision: { increment: 1 }, actualizado_por_id: actor.id } });
  await tx.auditLog.create({ data: {
    organization_id: actor.organizationId,
    user_id: actor.id,
    accion: action,
    entidad: 'CatalogoArtefactoVersion',
    entidad_id: version.id,
    valores_anteriores: current?.definition_json || undefined,
    valores_nuevos: json({ bank: key, version: version.version, checksum, definition }),
    session_id: actor.sessionId,
  } });
  return version;
}

export class QuestionnaireBanksService {
  async list(actor: Actor) {
    const entries = await Promise.all((Object.keys(BANKS) as BankKey[]).map(async (key) => {
      const current = await activeBank(prisma, actor, key);
      const questions = current?.definition.sections.flatMap((section) => section.questions || []) || [];
      return {
        key,
        label: BANKS[key].label,
        version: current?.version.version || 0,
        artifact_id: current?.artifact.id || null,
        questions: questions.sort((a, b) => (a.order || 0) - (b.order || 0)),
      };
    }));
    return { banks: entries, applicability_authority: 'CUMPLIMIENTO_PLD_UIF', editable_metadata: ['questions'] };
  }

  async add(actor: Actor, rawKey: string, input: any) {
    requireManage(actor); const key = bank(rawKey);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`questionnaire-bank:${actor.organizationId}:${key}`}))`);
      const artifact = await ensureArtifact(tx, actor, key);
      const current = await activeBank(tx, actor, key);
      const questions = current?.definition.sections.flatMap((section) => section.questions || []) || [];
      const next = question(input, undefined);
      next.order = questions.length;
      await publish(tx, actor, key, artifact.id, orderedDefinition(BANKS[key].scope, [...questions, next]), 'QUESTIONNAIRE_BANK_QUESTION_CREATED');
      return { id: next.id };
    });
  }

  async update(actor: Actor, rawKey: string, questionId: string, input: any) {
    requireManage(actor); const key = bank(rawKey);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`questionnaire-bank:${actor.organizationId}:${key}`}))`);
      const current = await activeBank(tx, actor, key);
      if (!current) throw new ComplianceError('El banco todavía no contiene preguntas.', 'QUESTIONNAIRE_BANK_EMPTY', 404);
      const questions = current.definition.sections.flatMap((section) => section.questions || []);
      const index = questions.findIndex((item) => item.id === questionId);
      if (index < 0) throw new ComplianceError('No se encontró la pregunta.', 'QUESTIONNAIRE_QUESTION_NOT_FOUND', 404);
      questions[index] = question({ ...questions[index], ...input }, questionId);
      await publish(tx, actor, key, current.artifact.id, orderedDefinition(BANKS[key].scope, questions), 'QUESTIONNAIRE_BANK_QUESTION_UPDATED');
      return { id: questionId };
    });
  }

  async remove(actor: Actor, rawKey: string, questionId: string) {
    requireManage(actor); const key = bank(rawKey);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`questionnaire-bank:${actor.organizationId}:${key}`}))`);
      const current = await activeBank(tx, actor, key);
      if (!current) throw new ComplianceError('El banco todavía no contiene preguntas.', 'QUESTIONNAIRE_BANK_EMPTY', 404);
      const questions = current.definition.sections.flatMap((section) => section.questions || []);
      if (!questions.some((item) => item.id === questionId)) throw new ComplianceError('No se encontró la pregunta.', 'QUESTIONNAIRE_QUESTION_NOT_FOUND', 404);
      const versions = await tx.catalogoArtefactoVersion.findMany({ where: { organization_id: actor.organizationId, artefacto_id: current.artifact.id }, select: { id: true } });
      const finalized = versions.length ? await tx.complianceQuestionnaireAssessmentRevision.findMany({
        where: { organization_id: actor.organizationId, definition_version_id: { in: versions.map((version) => version.id) }, status: 'FINALIZED' },
        select: { answers: true },
      }) : [];
      if (finalized.some((revision) => Object.prototype.hasOwnProperty.call(record(revision.answers), questionId))) {
        throw new ComplianceError('La pregunta ya forma parte de una respuesta finalizada. Inactívala para nuevas instancias.', 'QUESTIONNAIRE_QUESTION_IN_USE', 409);
      }
      await publish(tx, actor, key, current.artifact.id, orderedDefinition(BANKS[key].scope, questions.filter((item) => item.id !== questionId)), 'QUESTIONNAIRE_BANK_QUESTION_REMOVED');
      return { removed: true };
    });
  }

  async reorder(actor: Actor, rawKey: string, orderedIds: unknown) {
    requireManage(actor); const key = bank(rawKey);
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string'))
      throw new ComplianceError('El nuevo orden no es válido.', 'QUESTIONNAIRE_ORDER_INVALID', 400);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`questionnaire-bank:${actor.organizationId}:${key}`}))`);
      const current = await activeBank(tx, actor, key);
      if (!current) throw new ComplianceError('El banco todavía no contiene preguntas.', 'QUESTIONNAIRE_BANK_EMPTY', 404);
      const questions = current.definition.sections.flatMap((section) => section.questions || []);
      if (new Set(orderedIds).size !== questions.length || questions.some((item) => !orderedIds.includes(item.id)))
        throw new ComplianceError('El orden debe incluir cada pregunta exactamente una vez.', 'QUESTIONNAIRE_ORDER_INVALID', 400);
      const byId = new Map(questions.map((item) => [item.id, item]));
      const reordered = orderedIds.map((id, order) => ({ ...byId.get(id)!, order }));
      await publish(tx, actor, key, current.artifact.id, orderedDefinition(BANKS[key].scope, reordered), 'QUESTIONNAIRE_BANK_REORDERED');
      return { reordered: true };
    });
  }
}

export const questionnaireBanksService = new QuestionnaireBanksService();
