import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { assessIsrCompleteness, ComplianceError, evaluateUif } from '../domain/compliance';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { captureMasterSnapshot, masterChangedSince, prefillFromSnapshot, snapshotRule } from './complianceSnapshot.service';

const allowedRuleStatuses = ['REFERENCIA_VERIFICADA', 'PREPARADO_SIN_CALCULO', 'APROBADA'];
const pageValue = (value: unknown, fallback: number, max: number) => Math.min(max, Math.max(1, Number(value) || fallback));

export const complianceReviewInclude = {
  expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, tipo_acto: { select: { nombre: true } }, notaria: { select: { nombre: true, numero_notaria: true } }, abogado: { select: { id: true, nombre: true, apellido: true } }, comparecientes: { where: { archived_at: null, estatus: 'ACTIVO' }, select: { compareciente: { select: { id: true, personaFisica: { select: { nombre_completo_calculado: true } }, personaMoral: { select: { razon_social: true } } } } } } } },
  ruleSet: { select: { id: true, tipo: true, clave: true, version: true, nombre: true, vigencia_desde: true, vigencia_hasta: true, fuente_nombre: true, fuente_url: true } },
  creado_por: { select: { id: true, nombre: true, apellido: true } },
  revisado_por: { select: { id: true, nombre: true, apellido: true } },
  evidencias: { include: { documento: { select: { id: true, nombre_original: true, tipo: true, estatus: true, fecha_carga: true } }, agregado_por: { select: { nombre: true, apellido: true } } }, orderBy: { created_at: 'desc' as const } },
  decisiones: { include: { decidido_por: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { decidido_at: 'desc' as const } },
  supersedes: { select: { id: true, estatus: true, tipo: true, rule_version_snapshot: true, resultado_json: true, created_at: true } },
};

type User = NonNullable<Request['user']>;

async function actor(value: unknown) {
  if (!value) throw new ComplianceError('El usuario responsable es obligatorio.', 'COMPLIANCE_ACTOR_REQUIRED', 401);
  const user = await prisma.user.findFirst({ where: { id: String(value), activo: true }, select: { id: true } });
  if (!user) throw new ComplianceError('El usuario responsable no está activo.', 'COMPLIANCE_ACTOR_INVALID', 401);
  return user.id;
}

async function scopedReview(user: User, id: string, include: any = complianceReviewInclude) {
  const review = await prisma.complianceReview.findFirst({ where: { id, expediente: { archived_at: null, ...expedienteAccessWhere(user) } }, include });
  if (!review) throw new ComplianceError('Revisión no encontrada.', 'COMPLIANCE_REVIEW_NOT_FOUND', 404);
  return review as any;
}

const currentRule = (snapshot: any) => {
  const params = snapshot?.parametros;
  if (!params) throw new ComplianceError('La revisión no conserva parámetros de regla utilizables.', 'COMPLIANCE_SNAPSHOT_INVALID', 409);
  return params;
};

export class ComplianceReviewService {
  static async catalogs(user: User) {
    const access = expedienteAccessWhere(user);
    const [rules, expedientes, users, documents] = await Promise.all([
      prisma.complianceRuleSet.findMany({ where: { estatus: { in: allowedRuleStatuses } }, orderBy: [{ tipo: 'asc' }, { vigencia_desde: 'desc' }] }),
      prisma.expediente.findMany({ where: { archived_at: null, ...access }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, valor_operacion: true, tipo_acto: { select: { nombre: true } } }, orderBy: { updated_at: 'desc' }, take: 300 }),
      prisma.user.findMany({ where: { activo: true, ...(!['DIRECCION', 'ADMINISTRACION'].includes(user.rol) ? { id: user.id } : {}) }, select: { id: true, nombre: true, apellido: true, rol: true }, orderBy: { nombre: 'asc' } }),
      prisma.documento.findMany({ where: { OR: [{ expediente: { is: { archived_at: null, ...access } } }, { expedienteVinculos: { some: { estatus: 'ACTIVO', expediente: { archived_at: null, ...access } } } }] }, select: { id: true, nombre_original: true, tipo: true, estatus: true, expediente_id: true, expedienteVinculos: { where: { estatus: 'ACTIVO' }, select: { expediente_id: true } } }, orderBy: { fecha_carga: 'desc' }, take: 1000 }),
    ]);
    return { reglas: rules, expedientes, usuarios: users, documentos: documents };
  }

  static async list(user: User, query: any) {
    const page = pageValue(query.page, 1, 100000);
    const pageSize = pageValue(query.pageSize, 12, 50);
    const search = String(query.search || '').trim();
    const expedienteWhere: any = { archived_at: null, ...expedienteAccessWhere(user) };
    if (search) expedienteWhere.AND = [{ OR: [{ numero_pravia: { contains: search, mode: 'insensitive' } }, { cliente_alias: { contains: search, mode: 'insensitive' } }] }];
    if (query.responsable_id) expedienteWhere.abogado_id = String(query.responsable_id);
    if (query.notaria_id) expedienteWhere.notaria_id = String(query.notaria_id);
    const where: any = {
      expediente: expedienteWhere,
      ...(query.tipo && query.tipo !== 'TODOS' ? { tipo: String(query.tipo) } : {}),
      ...(query.estatus && query.estatus !== 'TODOS' ? { estatus: String(query.estatus) } : {}),
      ...(query.resultado && query.resultado !== 'TODOS' ? { resultado_json: { path: ['clasificacion'], equals: String(query.resultado) } } : {}),
      ...(query.expediente_id ? { expediente_id: String(query.expediente_id) } : {}),
      ...(query.desde || query.hasta ? { updated_at: { ...(query.desde ? { gte: new Date(String(query.desde)) } : {}), ...(query.hasta ? { lte: new Date(`${query.hasta}T23:59:59.999Z`) } : {}) } } : {}),
    };
    const [reviews, total, grouped] = await prisma.$transaction([
      prisma.complianceReview.findMany({ where, include: complianceReviewInclude, orderBy: { updated_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.complianceReview.count({ where }),
      prisma.complianceReview.groupBy({ by: ['estatus'], where: { expediente: { archived_at: null, ...expedienteAccessWhere(user) } }, orderBy: { estatus: 'asc' }, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(grouped.map((item: any) => [item.estatus, item._count._all]));
    return { revisiones: reviews, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, metrics: { requieren_revision: (counts.BORRADOR || 0) + (counts.PENDIENTE_REVISION || 0), pendientes: counts.PENDIENTE_REVISION || 0, observaciones: counts.REQUIERE_AJUSTES || 0, confirmadas: counts.CONFIRMADO || 0 } };
  }

  static async detail(user: User, id: string) {
    const review = await scopedReview(user, id);
    const [history, changed] = await Promise.all([
      prisma.complianceReview.findMany({ where: { expediente_id: review.expediente_id, tipo: review.tipo, id: { not: review.id } }, include: { ruleSet: { select: { nombre: true, version: true } }, revisado_por: { select: { nombre: true, apellido: true } }, decisiones: { include: { decidido_por: { select: { nombre: true, apellido: true } } }, orderBy: { decidido_at: 'desc' }, take: 1 } }, orderBy: { created_at: 'desc' }, take: 20 }),
      masterChangedSince(prisma, review.master_snapshot),
    ]);
    return { revision: { ...review, master_data_changed: changed }, historial: history };
  }

  static async create(user: User, userId: unknown, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const type = String(body.tipo || '').toUpperCase();
    if (!['UIF', 'ISR'].includes(type)) throw new ComplianceError('El tipo debe ser UIF o ISR.', 'COMPLIANCE_TYPE_INVALID');
    const operationDate = body.fecha_operacion ? new Date(body.fecha_operacion) : new Date();
    if (Number.isNaN(operationDate.getTime())) throw new ComplianceError('La fecha de operación no es válida.', 'COMPLIANCE_DATE_INVALID');
    const [expediente, rule] = await Promise.all([
      prisma.expediente.findFirst({ where: { id: String(body.expediente_id), archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } }),
      prisma.complianceRuleSet.findFirst({ where: { id: String(body.rule_set_id), tipo: type, estatus: { in: allowedRuleStatuses }, vigencia_desde: { lte: operationDate }, OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: operationDate } }] } }),
    ]);
    if (!expediente) throw new ComplianceError('El expediente no está activo o no está dentro de tu alcance.', 'COMPLIANCE_EXPEDIENTE_INVALID', 404);
    if (!rule) throw new ComplianceError('La versión de reglas no es aplicable a la fecha indicada.', 'COMPLIANCE_RULE_INVALID', 409);
    const master = await captureMasterSnapshot(prisma, expediente.id);
    if (!master) throw new ComplianceError('No fue posible capturar el expediente.', 'COMPLIANCE_SNAPSHOT_FAILED', 409);
    const ruleSnapshot = snapshotRule(rule);
    const questionnaire = { ...prefillFromSnapshot(type, master), ...(body.cuestionario || {}) };
    return prisma.$transaction(async (tx) => {
      const created = await tx.complianceReview.create({ data: { expediente_id: expediente.id, rule_set_id: rule.id, tipo: type, fecha_operacion: operationDate, rule_version_snapshot: rule.version, rule_snapshot: ruleSnapshot, master_snapshot: master, snapshot_captured_at: new Date(), cuestionario_json: questionnaire as Prisma.InputJsonObject, creado_por_id: actorId, supersedes_review_id: body.supersedes_review_id || null }, include: complianceReviewInclude });
      await tx.auditLog.create({ data: { user_id: actorId, accion: body.supersedes_review_id ? 'REEVALUATE_COMPLIANCE_REVIEW' : 'CREATE_COMPLIANCE_REVIEW', entidad: 'ComplianceReview', entidad_id: created.id, valores_nuevos: { tipo: type, expediente_id: expediente.id, rule_version: rule.version, supersedes_review_id: body.supersedes_review_id || null }, correlation_id: correlationId } });
      return created;
    });
  }

  static async evaluate(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const current = await scopedReview(user, id, { ruleSet: { select: { id: true } } });
    if (current.estatus === 'CONFIRMADO') throw new ComplianceError('Una revisión confirmada no puede recalcularse; crea una reevaluación.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    const answers = { ...((current.cuestionario_json as any) || {}), ...(body.cuestionario || {}) };
    const parameters = currentRule(current.rule_snapshot);
    const result = current.tipo === 'UIF' ? evaluateUif(parameters, answers) : assessIsrCompleteness(parameters, answers);
    return prisma.$transaction(async (tx) => {
      const review = await tx.complianceReview.update({ where: { id: current.id }, data: { cuestionario_json: answers as Prisma.InputJsonObject, resultado_json: result as Prisma.InputJsonObject, explicacion: result.disclaimer, estatus: 'PENDIENTE_REVISION' }, include: complianceReviewInclude });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'EVALUATE_COMPLIANCE_REVIEW', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { clasificacion: result.clasificacion, rule_version: current.rule_version_snapshot }, correlation_id: correlationId } });
      return review;
    });
  }

  static async decide(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const decision = String(body.decision || '').toUpperCase();
    if (!['CONFIRMAR', 'REQUIERE_AJUSTES'].includes(decision)) throw new ComplianceError('La decisión humana no es válida.', 'COMPLIANCE_DECISION_INVALID');
    const current = await scopedReview(user, id, {});
    if (current.estatus === 'CONFIRMADO') throw new ComplianceError('La revisión confirmada es histórica y no puede sobrescribirse.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    if (!current.resultado_json) throw new ComplianceError('Primero ejecuta la evaluación explicable.', 'COMPLIANCE_RESULT_REQUIRED', 409);
    const status = decision === 'CONFIRMAR' ? 'CONFIRMADO' : 'REQUIERE_AJUSTES';
    return prisma.$transaction(async (tx) => {
      await tx.complianceDecision.create({ data: { review_id: current.id, decision, observaciones: String(body.observaciones || '').trim() || null, resultado_snapshot: current.resultado_json as Prisma.InputJsonObject, rule_snapshot: current.rule_snapshot as Prisma.InputJsonObject, master_snapshot: current.master_snapshot as Prisma.InputJsonObject, decidido_por_id: actorId } });
      const review = await tx.complianceReview.update({ where: { id: current.id }, data: { estatus: status, revisado_por_id: actorId, revisado_at: new Date(), explicacion: String(body.observaciones || current.explicacion || '').trim() || null }, include: complianceReviewInclude });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'REVIEW_COMPLIANCE_RESULT', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { decision, observaciones: body.observaciones || null }, correlation_id: correlationId } });
      return review;
    });
  }

  static async reevaluate(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const current = await scopedReview(user, id, { ruleSet: true });
    const operationDate = body.fecha_operacion || current.fecha_operacion || new Date();
    let ruleId = body.rule_set_id;
    if (!ruleId) {
      const rule = await prisma.complianceRuleSet.findFirst({ where: { tipo: current.tipo, estatus: { in: allowedRuleStatuses }, vigencia_desde: { lte: new Date(operationDate) }, OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: new Date(operationDate) } }] }, orderBy: { vigencia_desde: 'desc' } });
      if (!rule) throw new ComplianceError('No existe una versión aplicable para reevaluar.', 'COMPLIANCE_RULE_INVALID', 409);
      ruleId = rule.id;
    }
    return this.create(user, userId, { expediente_id: current.expediente_id, tipo: current.tipo, rule_set_id: ruleId, fecha_operacion: operationDate, cuestionario: body.conservar_respuestas ? current.cuestionario_json : {}, supersedes_review_id: current.id }, correlationId);
  }

  static async addEvidence(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const review = await scopedReview(user, id, {});
    if (review.estatus === 'CONFIRMADO') throw new ComplianceError('La revisión está cerrada; crea una reevaluación para agregar evidencia.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    const document = await prisma.documento.findFirst({ where: { id: String(body.documento_id), OR: [{ expediente_id: review.expediente_id }, { expedienteVinculos: { some: { expediente_id: review.expediente_id, estatus: 'ACTIVO' } } }] }, select: { id: true } });
    if (!document) throw new ComplianceError('El documento no pertenece al expediente.', 'COMPLIANCE_EVIDENCE_INVALID', 404);
    return prisma.$transaction(async (tx) => {
      const evidence = await tx.complianceEvidence.create({ data: { review_id: review.id, documento_id: document.id, tipo_evidencia: String(body.tipo_evidencia || 'SOPORTE').trim(), observaciones: String(body.observaciones || '').trim() || null, agregado_por_id: actorId }, include: { documento: { select: { id: true, nombre_original: true, tipo: true, estatus: true } } } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'ADD_COMPLIANCE_EVIDENCE', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { documento_id: document.id, tipo_evidencia: evidence.tipo_evidencia }, correlation_id: correlationId } });
      return evidence;
    });
  }
}
