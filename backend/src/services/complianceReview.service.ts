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
  expediente: {
    select: {
      id: true,
      numero_pravia: true,
      cliente_alias: true,
      estatus: true,
      actos: {
        where: { estatus: 'ACTIVO' as const, removed_at: null },
        select: { id: true, tipo_acto: { select: { id: true, nombre: true } } },
        orderBy: { created_at: 'asc' as const },
      },
      notaria: { select: { nombre: true, numero_notaria: true } },
      abogado: { select: { id: true, nombre: true, apellido: true } },
      comparecientes: {
        where: { archived_at: null, estatus: 'ACTIVO' },
        select: {
          compareciente: {
            select: {
              id: true,
              personaFisica: { select: { nombre_completo_calculado: true } },
              personaMoral: { select: { razon_social: true } },
            },
          },
        },
      },
    },
  },
  ruleSet: { select: { id: true, tipo: true, clave: true, version: true, nombre: true, vigencia_desde: true, vigencia_hasta: true, fuente_nombre: true, fuente_url: true } },
  creado_por: { select: { id: true, nombre: true, apellido: true } },
  revisado_por: { select: { id: true, nombre: true, apellido: true } },
  evidencias: { include: { documento: { select: { id: true, nombre_original: true, tipo: true, mime_type: true, size_bytes: true, estatus: true, fecha_carga: true } }, agregado_por: { select: { nombre: true, apellido: true } } }, orderBy: { created_at: 'desc' as const } },
  decisiones: { include: { decidido_por: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { decidido_at: 'desc' as const } },
  supersedes: { select: { id: true, estatus: true, tipo: true, rule_version_snapshot: true, resultado_json: true, created_at: true } },
};

type User = NonNullable<Request['user']>;
const withCanonicalAct = (review: any) => review?.expediente
  ? { ...review, expediente: { ...review.expediente, tipo_acto: review.expediente.actos?.[0]?.tipo_acto || null } }
  : review;

async function actor(value: unknown) {
  if (!value) throw new ComplianceError('El usuario responsable es obligatorio.', 'COMPLIANCE_ACTOR_REQUIRED', 401);
  const user = await prisma.user.findFirst({ where: { id: String(value), activo: true }, select: { id: true } });
  if (!user) throw new ComplianceError('El usuario responsable no está activo.', 'COMPLIANCE_ACTOR_INVALID', 401);
  return user.id;
}

async function scopedReview(user: User, id: string, include: any = complianceReviewInclude) {
  const review = await prisma.complianceReview.findFirst({ where: { id, expediente: { archived_at: null, ...expedienteAccessWhere(user) } }, include });
  if (!review) throw new ComplianceError('Revisión no encontrada.', 'COMPLIANCE_REVIEW_NOT_FOUND', 404);
  return withCanonicalAct(review);
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
      prisma.expediente.findMany({ where: { archived_at: null, ...access }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, valor_operacion: true, actos: { where: { estatus: 'ACTIVO', removed_at: null }, select: { tipo_acto: { select: { nombre: true } } }, orderBy: { created_at: 'asc' } }, notaria: { select: { id: true, numero_notaria: true, nombre: true } } }, orderBy: { updated_at: 'desc' }, take: 300 }),
      prisma.user.findMany({
        where: { activo: true, organizationMemberships: { some: activeOrganizationMembershipWhere(user.organizationId) }, ...(!['DIRECCION', 'ADMINISTRACION'].includes(user.rol) ? { id: user.id } : {}) },
        select: { id: true, nombre: true, apellido: true, ...organizationMembershipRoleSelect(user.organizationId) },
        orderBy: { nombre: 'asc' },
      }),
      prisma.documento.findMany({ where: { OR: [{ expediente: { is: { archived_at: null, ...access } } }, { expedienteVinculos: { some: { estatus: 'ACTIVO', expediente: { archived_at: null, ...access } } } }] }, select: { id: true, nombre_original: true, tipo: true, estatus: true, expediente_id: true, expedienteVinculos: { where: { estatus: 'ACTIVO' }, select: { expediente_id: true } } }, orderBy: { fecha_carga: 'desc' }, take: 1000 }),
    ]);
    return { reglas: rules, expedientes: expedientes.map((item) => ({ ...item, tipo_acto: item.actos[0]?.tipo_acto || null })), usuarios: usersWithEffectiveMembershipRoles(users), documentos: documents };
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
    return { revisiones: reviews.map(withCanonicalAct), meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, metrics: { expedientes_evaluados: evaluatedCases.length, requieren_revision: reviewRequired, avisos_por_presentar: noticesPending, obligaciones_vencidas: overdue } };
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
    const canonical = review.is_canonical_legal_engine ? await Promise.all([
      prisma.expedienteComplianceState.findFirst({ where: { current_review_id: review.id } }),
      prisma.complianceRuleResult.findMany({ where: { review_id: review.id }, orderBy: { created_at: 'asc' } }),
      prisma.complianceRequirement.findMany({ where: { review_id: review.id }, orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }] }),
      prisma.complianceAlert.findMany({ where: { review_id: review.id }, orderBy: [{ level: 'desc' }, { created_at: 'asc' }] }),
    ]) : [null, [], [], []];
    return { revision: { ...review, master_data_changed: changed }, historial: history, workspace: { parties, beneficialOwners: sensitive ? owners : [], pepReviews: sensitive ? pepReviews : [], screenings: sensitive ? screenings : [], payments, obligations, events, aiProposals: sensitive ? aiProposals : [], sensitiveRedacted: !sensitive, state: canonical[0], ruleResults: canonical[1], requirements: canonical[2], alerts: canonical[3] } };
  }

  static async create(user: User, userId: unknown, body: any, correlationId?: string) : Promise<any> {
    throw new ComplianceError('El flujo anterior es de consulta histórica. Usa la evaluación canónica y los registros versionados de cumplimiento.', 'H5_LEGACY_WRITER_RETIRED', 410);
  }

  static async evaluate(user: User, userId: unknown, id: string, body: any, correlationId?: string) : Promise<any> {
    throw new ComplianceError('El flujo anterior es de consulta histórica. Usa la evaluación canónica y los registros versionados de cumplimiento.', 'H5_LEGACY_WRITER_RETIRED', 410);
  }

  static async decide(user: User, userId: unknown, id: string, body: any, correlationId?: string) {
    const actorId = await actor(userId);
    const decision = String(body.decision || '').toUpperCase();
    if (!['CONFIRMAR', 'REQUIERE_AJUSTES'].includes(decision)) throw new ComplianceError('La decisión humana no es válida.', 'COMPLIANCE_DECISION_INVALID');
    const current = await scopedReview(user, id, {});
    if (current.is_canonical_legal_engine) throw new ComplianceError('El estado canónico se deriva de requisitos y no admite cierre manual.', 'COMPLIANCE_CANONICAL_STATE_DERIVED', 409);
    if (current.estatus === 'CONFIRMADO') throw new ComplianceError('La revisión confirmada es histórica y no puede sobrescribirse.', 'COMPLIANCE_REVIEW_LOCKED', 409);
    if (!current.resultado_json) throw new ComplianceError('Primero ejecuta la evaluación explicable.', 'COMPLIANCE_RESULT_REQUIRED', 409);
    const status = decision === 'CONFIRMAR' ? 'CONFIRMADO' : 'REQUIERE_AJUSTES';
    return prisma.$transaction(async (tx) => {
      await tx.complianceDecision.create({ data: { review_id: current.id, decision, observaciones: String(body.observaciones || '').trim() || null, resultado_snapshot: current.resultado_json as Prisma.InputJsonObject, rule_snapshot: current.rule_snapshot as Prisma.InputJsonObject, master_snapshot: current.master_snapshot as Prisma.InputJsonObject, decidido_por_id: actorId } });
      const review = await tx.complianceReview.update({ where: { id: current.id }, data: { estatus: status, revisado_por_id: actorId, revisado_at: new Date(), explicacion: String(body.observaciones || current.explicacion || '').trim() || null }, include: complianceReviewInclude });
      await tx.complianceEvent.create({ data: { review_id: current.id, event_type: decision === 'CONFIRMAR' ? 'REVISION_COMPLETADA' : 'AJUSTES_SOLICITADOS', actor_id: actorId, summary: decision === 'CONFIRMAR' ? 'La evaluación fue confirmada por una persona autorizada.' : 'La evaluación requiere ajustes.', detail: { decision, observaciones: body.observaciones || null }, correlation_id: correlationId } });
      await tx.auditLog.create({ data: { user_id: actorId, accion: 'REVIEW_COMPLIANCE_RESULT', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { decision, observaciones: body.observaciones || null }, correlation_id: correlationId } });
      return withCanonicalAct(review);
    });
  }

  static async reevaluate(user: User, userId: unknown, id: string, body: any, correlationId?: string) : Promise<any> {
    throw new ComplianceError('El flujo anterior es de consulta histórica. Usa la evaluación canónica y los registros versionados de cumplimiento.', 'H5_LEGACY_WRITER_RETIRED', 410);
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

  static async addPayment(user: User, userId: unknown, id: string, body: any, correlationId?: string) : Promise<any> {
    throw new ComplianceError('El flujo anterior es de consulta histórica. Usa la evaluación canónica y los registros versionados de cumplimiento.', 'H5_LEGACY_WRITER_RETIRED', 410);
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
