import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { activeOrganizationMembershipWhere, organizationMembershipRoleSelect, usersWithEffectiveMembershipRoles } from '../auth/organizationMembership';
import prisma from '../config/prisma';
import { assessIsrCompleteness, ComplianceError, evaluateUif } from '../domain/compliance';
import { ordinaryNoticeDeadline, retentionUntil, type RelatedOperation } from '../domain/uifCompliance';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { captureMasterSnapshot, masterChangedSince, prefillFromSnapshot, snapshotRule } from './complianceSnapshot.service';

const allowedRuleStatuses = ['REFERENCIA_VERIFICADA', 'PREPARADO_SIN_CALCULO', 'APROBADA'];
const pageValue = (value: unknown, fallback: number, max: number) => Math.min(max, Math.max(1, Number(value) || fallback));

export const complianceReviewInclude = {
  expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, tipo_acto: { select: { nombre: true } }, notaria: { select: { nombre: true, numero_notaria: true } }, abogado: { select: { id: true, nombre: true, apellido: true } }, comparecientes: { where: { archived_at: null, estatus: 'ACTIVO' }, select: { compareciente: { select: { id: true, personaFisica: { select: { nombre_completo_calculado: true } }, personaMoral: { select: { razon_social: true } } } } } } } },
  ruleSet: { select: { id: true, tipo: true, clave: true, version: true, nombre: true, vigencia_desde: true, vigencia_hasta: true, fuente_nombre: true, fuente_url: true } },
  creado_por: { select: { id: true, nombre: true, apellido: true } },
  revisado_por: { select: { id: true, nombre: true, apellido: true } },
  evidencias: { include: { documento: { select: { id: true, nombre_original: true, tipo: true, mime_type: true, size_bytes: true, estatus: true, fecha_carga: true } }, agregado_por: { select: { nombre: true, apellido: true } } }, orderBy: { created_at: 'desc' as const } },
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
      prisma.expediente.findMany({ where: { archived_at: null, ...access }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, valor_operacion: true, tipo_acto: { select: { nombre: true } }, notaria: { select: { id: true, numero_notaria: true, nombre: true } } }, orderBy: { updated_at: 'desc' }, take: 300 }),
      prisma.user.findMany({
        where: { activo: true, organizationMemberships: { some: activeOrganizationMembershipWhere(user.organizationId) }, ...(!['DIRECCION', 'ADMINISTRACION'].includes(user.rol) ? { id: user.id } : {}) },
        select: { id: true, nombre: true, apellido: true, ...organizationMembershipRoleSelect(user.organizationId) },
        orderBy: { nombre: 'asc' },
      }),
      prisma.documento.findMany({ where: { OR: [{ expediente: { is: { archived_at: null, ...access } } }, { expedienteVinculos: { some: { estatus: 'ACTIVO', expediente: { archived_at: null, ...access } } } }] }, select: { id: true, nombre_original: true, tipo: true, estatus: true, expediente_id: true, expedienteVinculos: { where: { estatus: 'ACTIVO' }, select: { expediente_id: true } } }, orderBy: { fecha_carga: 'desc' }, take: 1000 }),
    ]);
    return { reglas: rules, expedientes, usuarios: usersWithEffectiveMembershipRoles(users), documentos: documents };
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
      ...(query.nivel && query.nivel !== 'TODOS' ? { resultado_json: { path: ['estado_evaluacion'], equals: String(query.nivel) } } : {}),
      ...(query.actividad && query.actividad !== 'TODOS' ? { resultado_json: { path: ['acto'], equals: String(query.actividad) } } : {}),
      ...(query.estado_aviso && query.estado_aviso !== 'TODOS' ? { resultado_json: { path: ['estado_aviso'], equals: String(query.estado_aviso) } } : {}),
      ...(query.expediente_id ? { expediente_id: String(query.expediente_id) } : {}),
      ...(query.desde || query.hasta ? { fecha_operacion: { ...(query.desde ? { gte: new Date(String(query.desde)) } : {}), ...(query.hasta ? { lte: new Date(`${query.hasta}T23:59:59.999Z`) } : {}) } } : {}),
    };
    const uifScope: any = { expediente: { archived_at: null, ...expedienteAccessWhere(user) }, tipo: 'UIF' };
    const scopedReviewIds = (await prisma.complianceReview.findMany({ where: uifScope, select: { id: true } })).map((item) => item.id);
    const [reviews, total, evaluatedCases, reviewRequired, noticesPending, overdue] = await Promise.all([
      prisma.complianceReview.findMany({ where, include: complianceReviewInclude, orderBy: { updated_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.complianceReview.count({ where }),
      prisma.complianceReview.findMany({ where: uifScope, distinct: ['expediente_id'], select: { expediente_id: true } }),
      prisma.complianceReview.count({ where: { ...uifScope, OR: [{ estatus: { in: ['BORRADOR', 'PENDIENTE_REVISION', 'REQUIERE_AJUSTES'] } }, { resultado_json: { path: ['estado_evaluacion'], equals: 'REQUIERE_REVISION' } }] } }),
      prisma.complianceObligation.count({ where: { status: { in: ['REQUIERE_AVISO', 'EN_PREPARACION'] }, review_id: { in: scopedReviewIds } } }),
      prisma.complianceObligation.count({ where: { status: { not: 'PRESENTADO_EXTERNAMENTE' }, due_at: { lt: new Date() }, review_id: { in: scopedReviewIds } } }),
    ]);
    return { revisiones: reviews, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, metrics: { expedientes_evaluados: evaluatedCases.length, requieren_revision: reviewRequired, avisos_por_presentar: noticesPending, obligaciones_vencidas: overdue } };
  }

  static async detail(user: User, id: string) {
    const review = await scopedReview(user, id);
    const [history, changed, parties, owners, pepReviews, screenings, payments, obligations, events, aiProposals] = await Promise.all([
      prisma.complianceReview.findMany({ where: { expediente_id: review.expediente_id, tipo: review.tipo, id: { not: review.id } }, include: { ruleSet: { select: { nombre: true, version: true } }, revisado_por: { select: { nombre: true, apellido: true } }, decisiones: { include: { decidido_por: { select: { nombre: true, apellido: true } } }, orderBy: { decidido_at: 'desc' }, take: 1 } }, orderBy: { created_at: 'desc' }, take: 20 }),
      masterChangedSince(prisma, review.master_snapshot),
      prisma.compliancePartySnapshot.findMany({ where: { review_id: review.id }, orderBy: { captured_at: 'asc' } }),
      prisma.complianceBeneficialOwner.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      prisma.compliancePepReview.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      prisma.complianceScreeningResult.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      prisma.compliancePayment.findMany({ where: { review_id: review.id, retired_at: null }, orderBy: { payment_date: 'asc' } }),
      prisma.complianceObligation.findMany({ where: { review_id: review.id }, orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }] }),
      prisma.complianceEvent.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.complianceAiProposal.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'desc' }, take: 50 }),
    ]);
    const sensitive = user.permissions.includes('compliance.sensitive.read');
    return { revision: { ...review, master_data_changed: changed }, historial: history, workspace: { parties, beneficialOwners: sensitive ? owners : [], pepReviews: sensitive ? pepReviews : [], screenings: sensitive ? screenings : [], payments, obligations, events, aiProposals: sensitive ? aiProposals : [], sensitiveRedacted: !sensitive } };
  }

  static async create(user: User, userId: unknown, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const type = String(body.tipo || '').toUpperCase();
    if (type !== 'UIF') throw new ComplianceError('Riesgos / UIF solo admite evaluaciones UIF. Cálculo ISR utiliza su módulo independiente.', 'COMPLIANCE_TYPE_INVALID');
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
      if (type === 'UIF') {
        for (const party of (master as any).comparecientes || []) {
          await tx.compliancePartySnapshot.create({ data: { review_id: created.id, compareciente_id: party.id, role: party.caracter?.clave || 'CLIENTE_USUARIO', snapshot: party as Prisma.InputJsonObject, snapshot_version: Number(party.version || 1) } });
          await tx.compliancePepReview.create({ data: { review_id: created.id, compareciente_id: party.id, status: 'NO_EVALUADO', declaration: party.pep_estado === 'SI' ? 'DECLARADO_SI' : party.pep_estado === 'NO' ? 'DECLARADO_NO' : null, snapshot: { source: 'MASTER_SNAPSHOT', party_version: party.version } } });
          await tx.complianceScreeningResult.create({ data: { review_id: created.id, compareciente_id: party.id, provider: 'OFFICIAL_UIF_PEP_QUERY', status: 'NOT_CONFIGURED' } });
        }
      }
      await tx.complianceEvent.create({ data: { review_id: created.id, event_type: body.supersedes_review_id ? 'REEVALUACION_CREADA' : 'EVALUACION_CREADA', actor_id: actorId, summary: body.supersedes_review_id ? 'Se creó una nueva versión de evaluación.' : 'Se creó la evaluación de cumplimiento.', detail: { rule_version: rule.version, snapshot_at: new Date().toISOString() }, correlation_id: correlationId } });
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
    let relatedOperations: RelatedOperation[] = [];
    if (current.tipo === 'UIF') {
      const clientId = String(answers.cliente_compareciente_id || current.master_snapshot?.comparecientes?.[0]?.id || '');
      answers.cliente_compareciente_id = clientId;
      const operationDate = new Date(current.fecha_operacion || new Date());
      const from = new Date(operationDate); from.setUTCMonth(from.getUTCMonth() - 6);
      const candidates = await prisma.complianceReview.findMany({ where: { id: { not: current.id }, tipo: 'UIF', fecha_operacion: { gte: from, lte: operationDate }, resultado_json: { not: Prisma.JsonNull }, expediente: { archived_at: null, ...expedienteAccessWhere(user) } }, select: { id: true, fecha_operacion: true, master_snapshot: true, resultado_json: true } });
      relatedOperations = candidates.flatMap((candidate: any) => {
        const result = candidate.resultado_json || {};
        const parties = candidate.master_snapshot?.comparecientes || [];
        return parties.some((party: any) => party.id === clientId) && result.acto === answers.tipo_acto_uif && Number(result.monto_base_mxn) >= 0
          ? [{ id: candidate.id, clientId, activity: result.acto, operationDate: candidate.fecha_operacion.toISOString().slice(0, 10), amountMxn: Number(result.monto_base_mxn), isIdentifiable: result.identificacion_requerida !== 'NO' }]
          : [];
      });
    }
    const result: any = current.tipo === 'UIF' ? evaluateUif(parameters, answers, { operationDate: current.fecha_operacion || new Date(), relatedOperations }) : assessIsrCompleteness(parameters, answers);
    return prisma.$transaction(async (tx) => {
      const review = await tx.complianceReview.update({ where: { id: current.id }, data: { cuestionario_json: answers as Prisma.InputJsonObject, resultado_json: result as Prisma.InputJsonObject, explicacion: result.disclaimer, estatus: 'PENDIENTE_REVISION' }, include: complianceReviewInclude });
      if (current.tipo === 'UIF') {
        const existing = await tx.complianceObligation.findFirst({ where: { review_id: current.id, type: 'AVISO_ORDINARIO' } });
        const noticeStatus = result.requiere_aviso ? 'REQUIERE_AVISO' : result.estado_aviso === 'POR_DETERMINAR' ? 'POR_DETERMINAR' : 'NO_APLICA';
        const obligationData = { legal_basis: result.fundamento, rule_version: current.rule_version_snapshot, rule_status: result.estatus_normativo || 'VIGENTE', origin_date: new Date(current.fecha_operacion || new Date()), due_at: result.requiere_aviso ? ordinaryNoticeDeadline(new Date(current.fecha_operacion || new Date()).toISOString().slice(0, 10)) : null, channel: result.canal_aviso || 'PENDIENTE_DE_DEFINIR', status: noticeStatus, checklist: { identity: answers.identidad_verificada === true, beneficial_owner: result.beneficiario_controlador_estado === 'EXISTE', pep_review: !['NO_EVALUADO', 'INFORMACION_INSUFICIENTE'].includes(result.pep_estado), payment_review: result.restriccion_efectivo?.status !== 'REQUIERE_INFORMACION' }, snapshot: result as Prisma.InputJsonObject };
        if (existing) await tx.complianceObligation.update({ where: { id: existing.id }, data: obligationData });
        else await tx.complianceObligation.create({ data: { review_id: current.id, type: 'AVISO_ORDINARIO', ...obligationData } });
        await tx.complianceEvent.create({ data: { review_id: current.id, event_type: 'ACTIVIDAD_VULNERABLE_EVALUADA', actor_id: actorId, summary: result.requiere_aviso ? 'La evaluación determinó una obligación de Aviso sujeta a revisión.' : 'Se evaluó la actividad vulnerable y su umbral.', detail: { clasificacion: result.clasificacion, version_normativa: result.version_normativa, operaciones_acumuladas: result.operaciones_acumuladas }, correlation_id: correlationId } });
      }
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
      await tx.complianceEvent.create({ data: { review_id: current.id, event_type: decision === 'CONFIRMAR' ? 'REVISION_COMPLETADA' : 'AJUSTES_SOLICITADOS', actor_id: actorId, summary: decision === 'CONFIRMAR' ? 'La evaluación fue confirmada por una persona autorizada.' : 'La evaluación requiere ajustes.', detail: { decision, observaciones: body.observaciones || null }, correlation_id: correlationId } });
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
      const evidence = await tx.complianceEvidence.create({ data: { review_id: review.id, documento_id: document.id, tipo_evidencia: String(body.tipo_evidencia || 'SOPORTE').trim(), observaciones: String(body.observaciones || '').trim() || null, agregado_por_id: actorId, retention_until: retentionUntil(new Date(review.fecha_operacion || review.created_at).toISOString().slice(0, 10)) }, include: { documento: { select: { id: true, nombre_original: true, tipo: true, estatus: true } } } });
      await tx.complianceEvent.create({ data: { review_id: review.id, event_type: 'EVIDENCIA_AGREGADA', actor_id: actorId, summary: `Se agregó evidencia: ${evidence.documento.nombre_original}.`, detail: { documento_id: document.id, tipo_evidencia: evidence.tipo_evidencia }, correlation_id: correlationId } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'ADD_COMPLIANCE_EVIDENCE', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { documento_id: document.id, tipo_evidencia: evidence.tipo_evidencia }, correlation_id: correlationId } });
      return evidence;
    });
  }

  static async addPayment(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const review = await scopedReview(user, id, {});
    if (review.estatus === 'CONFIRMADO') throw new ComplianceError('La evaluación cerrada es inmutable; crea una reevaluación.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    const amount = Number(body.amount_mxn);
    const date = new Date(body.payment_date);
    const methods = ['EFECTIVO_MXN', 'EFECTIVO_DIVISA', 'METALES_PRECIOSOS', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'OTRO'];
    if (!Number.isFinite(amount) || amount < 0) throw new ComplianceError('El importe del pago no es válido.', 'COMPLIANCE_PAYMENT_INVALID');
    if (Number.isNaN(date.getTime())) throw new ComplianceError('La fecha del pago no es válida.', 'COMPLIANCE_PAYMENT_DATE_INVALID');
    if (!methods.includes(String(body.method))) throw new ComplianceError('La forma de pago no es válida.', 'COMPLIANCE_PAYMENT_METHOD_INVALID');
    if (body.evidence_document_id) {
      const document = await prisma.documento.findFirst({ where: { id: String(body.evidence_document_id), OR: [{ expediente_id: review.expediente_id }, { expedienteVinculos: { some: { expediente_id: review.expediente_id, estatus: 'ACTIVO' } } }] }, select: { id: true } });
      if (!document) throw new ComplianceError('La evidencia de pago no pertenece al expediente.', 'COMPLIANCE_PAYMENT_EVIDENCE_INVALID', 404);
    }
    return prisma.$transaction(async (tx) => {
      const payment = await tx.compliancePayment.create({ data: { review_id: review.id, amount_mxn: amount, method: String(body.method), payment_date: date, instrument: String(body.instrument || '').trim() || null, institution: String(body.institution || '').trim() || null, reference: String(body.reference || '').trim() || null, masked_account: String(body.masked_account || '').replace(/[^*\d]/g, '').slice(-8) || null, evidence_document_id: body.evidence_document_id || null, source: String(body.source || 'CONFIRMACION_HUMANA'), created_by_id: actorId } });
      await tx.complianceEvent.create({ data: { review_id: review.id, event_type: 'FORMA_PAGO_REGISTRADA', actor_id: actorId, summary: 'Se registró una forma de pago para revisión UIF.', detail: { payment_id: payment.id, method: payment.method, amount_mxn: payment.amount_mxn }, correlation_id: correlationId } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'ADD_COMPLIANCE_PAYMENT', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { payment_id: payment.id, method: payment.method }, correlation_id: correlationId } });
      return payment;
    });
  }

  static async saveBeneficialOwner(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const review = await scopedReview(user, id, {});
    if (review.estatus === 'CONFIRMADO') throw new ComplianceError('La evaluación cerrada es inmutable; crea una reevaluación.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    const statuses = ['EXISTE', 'NO_DECLARADO', 'INFORMACION_INSUFICIENTE', 'EXCEPCION_NORMATIVA_APLICABLE', 'PENDIENTE_DE_CONFIRMAR'];
    const status = String(body.status || 'PENDIENTE_DE_CONFIRMAR');
    if (!statuses.includes(status)) throw new ComplianceError('El estado del beneficiario controlador no es válido.', 'COMPLIANCE_BENEFICIAL_OWNER_STATUS_INVALID');
    const partyId = body.compareciente_id ? String(body.compareciente_id) : null;
    if (partyId) {
      const party = await prisma.compliancePartySnapshot.findFirst({ where: { review_id: review.id, compareciente_id: partyId }, select: { id: true } });
      if (!party) throw new ComplianceError('La persona no pertenece al snapshot de esta evaluación.', 'COMPLIANCE_PARTY_SCOPE_DENIED', 404);
    }
    const percentage = body.documented_percentage === '' || body.documented_percentage == null ? null : Number(body.documented_percentage);
    if (percentage !== null && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) throw new ComplianceError('El porcentaje documentado debe estar entre 0 y 100.', 'COMPLIANCE_BENEFICIAL_OWNER_PERCENT_INVALID');
    return prisma.$transaction(async (tx) => {
      const owner = await tx.complianceBeneficialOwner.create({ data: { review_id: review.id, compareciente_id: partyId, status, control_type: String(body.control_type || '').trim() || null, documented_percentage: percentage, declaration: String(body.declaration || '').trim() || null, support_document_id: body.support_document_id || null, source: String(body.source || 'CONFIRMACION_HUMANA'), confirmed_by_id: body.confirmed === true ? actorId : null, confirmed_at: body.confirmed === true ? new Date() : null, snapshot: { proposal: body.proposal === true, warning: body.proposal === true ? 'PROPUESTA — REQUIERE CONFIRMACIÓN HUMANA.' : null, values: body } } });
      await tx.complianceEvent.create({ data: { review_id: review.id, event_type: body.confirmed === true ? 'BENEFICIARIO_CONTROLADOR_CONFIRMADO' : 'BENEFICIARIO_CONTROLADOR_PROPUESTO', actor_id: actorId, summary: body.confirmed === true ? 'Se confirmó información de beneficiario controlador.' : 'Se registró información pendiente de confirmación humana.', detail: { owner_id: owner.id, status }, correlation_id: correlationId } });
      return owner;
    });
  }

  static async savePepReview(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const review = await scopedReview(user, id, {});
    if (review.estatus === 'CONFIRMADO') throw new ComplianceError('La evaluación cerrada es inmutable; crea una reevaluación.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    const partyId = String(body.compareciente_id || '');
    const status = String(body.status || 'NO_EVALUADO');
    const statuses = ['NO_EVALUADO', 'INFORMACION_INSUFICIENTE', 'NO_IDENTIFICADO', 'POSIBLE_COINCIDENCIA', 'CONFIRMADO_POR_REVISION'];
    if (!statuses.includes(status)) throw new ComplianceError('El estado PEP no es válido.', 'COMPLIANCE_PEP_STATUS_INVALID');
    const party = await prisma.compliancePartySnapshot.findFirst({ where: { review_id: review.id, compareciente_id: partyId }, select: { id: true } });
    if (!party) throw new ComplianceError('La persona no pertenece al snapshot de esta evaluación.', 'COMPLIANCE_PARTY_SCOPE_DENIED', 404);
    if (['NO_IDENTIFICADO', 'CONFIRMADO_POR_REVISION'].includes(status) && body.human_confirmed !== true) throw new ComplianceError('Este resultado requiere confirmación humana explícita.', 'COMPLIANCE_PEP_HUMAN_CONFIRMATION_REQUIRED', 409);
    return prisma.$transaction(async (tx) => {
      const pep = await tx.compliancePepReview.upsert({ where: { review_id_compareciente_id: { review_id: review.id, compareciente_id: partyId } }, create: { review_id: review.id, compareciente_id: partyId, status, declaration: String(body.declaration || '').trim() || null, official_source: String(body.official_source || '').trim() || null, official_query_at: body.official_query_at ? new Date(body.official_query_at) : null, evidence_document_id: body.evidence_document_id || null, human_reviewed_by_id: body.human_confirmed === true ? actorId : null, human_reviewed_at: body.human_confirmed === true ? new Date() : null, notes: String(body.notes || '').trim() || null, snapshot: { source: body.official_source || 'DECLARACION_MANUAL', official_integration: false } }, update: { status, declaration: String(body.declaration || '').trim() || null, official_source: String(body.official_source || '').trim() || null, official_query_at: body.official_query_at ? new Date(body.official_query_at) : null, evidence_document_id: body.evidence_document_id || null, human_reviewed_by_id: body.human_confirmed === true ? actorId : null, human_reviewed_at: body.human_confirmed === true ? new Date() : null, notes: String(body.notes || '').trim() || null, snapshot: { source: body.official_source || 'DECLARACION_MANUAL', official_integration: false } } });
      await tx.complianceEvent.create({ data: { review_id: review.id, event_type: 'PEP_REVISADA', actor_id: actorId, summary: status === 'CONFIRMADO_POR_REVISION' ? 'La condición PEP fue confirmada mediante revisión humana.' : 'Se actualizó la revisión PEP sin inferencias automáticas.', detail: { pep_review_id: pep.id, status, official_integration: false }, correlation_id: correlationId } });
      return pep;
    });
  }

  static async confirmExternalNotice(user: User, userId: unknown, reviewId: string, obligationId: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const review = await scopedReview(user, reviewId, {});
    const obligation = await prisma.complianceObligation.findFirst({ where: { id: obligationId, review_id: review.id } });
    if (!obligation) throw new ComplianceError('La obligación no pertenece a esta evaluación.', 'COMPLIANCE_OBLIGATION_NOT_FOUND', 404);
    const filedAt = new Date(body.external_filed_at);
    const folio = String(body.external_folio || '').trim();
    const receiptId = String(body.external_receipt_id || '');
    if (Number.isNaN(filedAt.getTime()) || !folio || !receiptId) throw new ComplianceError('Fecha, folio y acuse son obligatorios para registrar la presentación externa.', 'COMPLIANCE_NOTICE_EVIDENCE_REQUIRED', 409);
    const receipt = await prisma.complianceEvidence.findFirst({ where: { review_id: review.id, documento_id: receiptId, estatus: 'ACTIVO' }, select: { id: true } });
    if (!receipt) throw new ComplianceError('El acuse debe estar vinculado como evidencia de esta evaluación.', 'COMPLIANCE_NOTICE_RECEIPT_INVALID', 404);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.complianceObligation.update({ where: { id: obligation.id }, data: { status: 'PRESENTADO_EXTERNAMENTE', external_filed_at: filedAt, external_folio: folio, external_receipt_id: receiptId, external_confirmed_by: actorId, notes: String(body.notes || '').trim() || null } });
      await tx.complianceEvent.create({ data: { review_id: review.id, event_type: 'AVISO_PRESENTADO_EXTERNAMENTE', actor_id: actorId, summary: 'Se registró con confirmación humana la presentación externa del Aviso.', detail: { obligation_id: updated.id, channel: updated.channel, external_folio: folio, receipt_document_id: receiptId }, correlation_id: correlationId } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'CONFIRM_EXTERNAL_COMPLIANCE_NOTICE', entidad: 'ComplianceObligation', entidad_id: updated.id, valores_nuevos: { status: updated.status, channel: updated.channel, external_filed_at: filedAt }, correlation_id: correlationId } });
      return updated;
    });
  }

  static async retireEvidence(user: User, userId: unknown, reviewId: string, evidenceId: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const review = await scopedReview(user, reviewId, {});
    const evidence = await prisma.complianceEvidence.findFirst({ where: { id: evidenceId, review_id: review.id, estatus: 'ACTIVO' } });
    if (!evidence) throw new ComplianceError('La evidencia no pertenece a esta evaluación.', 'COMPLIANCE_EVIDENCE_NOT_FOUND', 404);
    if (evidence.legal_hold) throw new ComplianceError('La evidencia está sujeta a conservación legal y no puede retirarse.', 'COMPLIANCE_EVIDENCE_LEGAL_HOLD', 409);
    const reason = String(body.reason || '').trim();
    if (!reason) throw new ComplianceError('Indica el motivo del retiro lógico.', 'COMPLIANCE_EVIDENCE_RETIRE_REASON_REQUIRED');
    return prisma.$transaction(async (tx) => {
      const retired = await tx.complianceEvidence.update({ where: { id: evidence.id }, data: { estatus: 'RETIRADO', retired_at: new Date(), retired_by_id: actorId, retirement_reason: reason } });
      await tx.complianceEvent.create({ data: { review_id: review.id, event_type: 'EVIDENCIA_RETIRADA', actor_id: actorId, summary: 'Se retiró lógicamente una evidencia; el archivo se conserva.', detail: { evidence_id: evidence.id, reason, retention_until: evidence.retention_until }, correlation_id: correlationId } });
      return retired;
    });
  }

  static async evidenceDocument(user: User, reviewId: string, evidenceId: string) {
    const review = await scopedReview(user, reviewId, {});
    const evidence = await prisma.complianceEvidence.findFirst({ where: { id: evidenceId, review_id: review.id }, include: { documento: { select: { id: true, nombre_original: true, mime_type: true, storage_key: true } } } });
    if (!evidence) throw new ComplianceError('La evidencia no pertenece a esta evaluación.', 'COMPLIANCE_EVIDENCE_NOT_FOUND', 404);
    return evidence.documento;
  }
}
