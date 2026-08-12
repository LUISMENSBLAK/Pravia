import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { assessIsrCompleteness, ComplianceError, evaluateUif } from '../domain/compliance';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

const actorFrom = (req: Request) => req.user?.id;

async function activeUser(value: unknown) {
  if (!value) throw new ComplianceError('El usuario responsable es obligatorio.', 'COMPLIANCE_ACTOR_REQUIRED', 401);
  const user = await prisma.user.findFirst({ where: { id: String(value), activo: true }, select: { id: true } });
  if (!user) throw new ComplianceError('El usuario responsable no está activo.', 'COMPLIANCE_ACTOR_INVALID', 401);
  return user.id;
}

const reviewInclude = {
  expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true } },
  ruleSet: { select: { id: true, tipo: true, clave: true, version: true, nombre: true, fuente_nombre: true, fuente_url: true, parametros: true, cuestionario: true } },
  creado_por: { select: { id: true, nombre: true, apellido: true } },
  revisado_por: { select: { id: true, nombre: true, apellido: true } },
  evidencias: { include: { documento: { select: { id: true, nombre_original: true, tipo: true, estatus: true } } }, orderBy: { created_at: 'desc' as const } },
};

export class ComplianceController {
  static async catalogs(req: Request, res: Response) {
    try {
      if (!req.user) throw new ComplianceError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const access = expedienteAccessWhere(req.user);
      const [rules, expedientes, users, documents] = await Promise.all([
        prisma.complianceRuleSet.findMany({ where: { estatus: { not: 'RETIRADA' } }, orderBy: [{ tipo: 'asc' }, { vigencia_desde: 'desc' }] }),
        prisma.expediente.findMany({ where: { archived_at: null, ...access }, select: { id: true, numero_pravia: true, cliente_alias: true, estatus: true, valor_operacion: true }, orderBy: { updated_at: 'desc' }, take: 300 }),
        prisma.user.findMany({ where: { activo: true, ...(!['DIRECCION', 'ADMINISTRACION'].includes(req.user.rol) ? { id: req.user.id } : {}) }, select: { id: true, nombre: true, apellido: true, rol: true }, orderBy: { nombre: 'asc' } }),
        prisma.documento.findMany({
          where: { OR: [{ expediente: { is: { archived_at: null, ...access } } }, { expedienteVinculos: { some: { estatus: 'ACTIVO', expediente: { archived_at: null, ...access } } } }] },
          select: { id: true, nombre_original: true, tipo: true, estatus: true, expediente_id: true, expedienteVinculos: { where: { estatus: 'ACTIVO' }, select: { expediente_id: true } } },
          orderBy: { fecha_carga: 'desc' },
          take: 1000,
        }),
      ]);
      return res.json({ success: true, reglas: rules, expedientes, usuarios: users, documentos: documents });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible cargar el centro de cumplimiento.', detail: error.message });
    }
  }

  static async list(req: Request, res: Response) {
    try {
      if (!req.user) throw new ComplianceError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const reviews = await prisma.complianceReview.findMany({
        where: {
          expediente: { archived_at: null, ...expedienteAccessWhere(req.user) },
          ...(req.query.tipo && req.query.tipo !== 'TODOS' ? { tipo: String(req.query.tipo) } : {}),
          ...(req.query.estatus && req.query.estatus !== 'TODOS' ? { estatus: String(req.query.estatus) } : {}),
          ...(req.query.expediente_id ? { expediente_id: String(req.query.expediente_id) } : {}),
        },
        include: reviewInclude,
        orderBy: { updated_at: 'desc' },
        take: 500,
      });
      return res.json({ success: true, revisiones: reviews });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible cargar las revisiones.', detail: error.message });
    }
  }

  static async create(req: Request, res: Response) {
    try {
      const actorId = await activeUser(actorFrom(req));
      const type = String(req.body.tipo || '').toUpperCase();
      if (!['UIF', 'ISR'].includes(type)) throw new ComplianceError('El tipo debe ser UIF o ISR.', 'COMPLIANCE_TYPE_INVALID');
      const operationDate = req.body.fecha_operacion ? new Date(req.body.fecha_operacion) : new Date();
      if (Number.isNaN(operationDate.getTime())) throw new ComplianceError('La fecha de operación no es válida.', 'COMPLIANCE_DATE_INVALID');
      const [expediente, rule] = await Promise.all([
        prisma.expediente.findFirst({ where: { id: String(req.body.expediente_id), archived_at: null, ...expedienteAccessWhere(req.user!) }, select: { id: true } }),
        prisma.complianceRuleSet.findFirst({ where: { id: String(req.body.rule_set_id), tipo: type, estatus: { not: 'RETIRADA' }, vigencia_desde: { lte: operationDate }, OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: operationDate } }] } }),
      ]);
      if (!expediente) throw new ComplianceError('El expediente no está activo.', 'COMPLIANCE_EXPEDIENTE_INVALID', 404);
      if (!rule) throw new ComplianceError('La versión de reglas no es aplicable a la fecha indicada.', 'COMPLIANCE_RULE_INVALID', 409);
      const review = await prisma.$transaction(async (tx) => {
        const created = await tx.complianceReview.create({
          data: {
            expediente_id: expediente.id,
            rule_set_id: rule.id,
            tipo: type,
            fecha_operacion: operationDate,
            rule_version_snapshot: rule.version,
            cuestionario_json: (req.body.cuestionario || {}) as Prisma.InputJsonObject,
            creado_por_id: actorId,
          },
          include: reviewInclude,
        });
        await tx.auditLog.create({ data: { user_id: actorId, accion: 'CREATE_COMPLIANCE_REVIEW', entidad: 'ComplianceReview', entidad_id: created.id, valores_nuevos: { tipo: type, expediente_id: expediente.id, rule_version: rule.version }, correlation_id: (req as any).correlationId } });
        return created;
      });
      return res.status(201).json({ success: true, revision: review });
    } catch (error: any) {
      const status = error instanceof ComplianceError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'COMPLIANCE_CREATE_FAILED' });
    }
  }

  static async evaluate(req: Request, res: Response) {
    try {
      const actorId = await activeUser(actorFrom(req));
      if (!req.user) throw new ComplianceError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const current = await prisma.complianceReview.findFirst({ where: { id: req.params.id, expediente: { archived_at: null, ...expedienteAccessWhere(req.user) } }, include: { ruleSet: true } });
      if (!current) throw new ComplianceError('Revisión no encontrada.', 'COMPLIANCE_REVIEW_NOT_FOUND', 404);
      if (current.estatus === 'CONFIRMADO') throw new ComplianceError('Una revisión confirmada no puede recalcularse silenciosamente; crea una nueva versión.', 'COMPLIANCE_REVIEW_LOCKED', 409);
      const answers = { ...((current.cuestionario_json as any) || {}), ...(req.body.cuestionario || {}) };
      const result = current.tipo === 'UIF'
        ? evaluateUif(current.ruleSet.parametros, answers)
        : assessIsrCompleteness(current.ruleSet.parametros, answers);
      const updated = await prisma.$transaction(async (tx) => {
        const review = await tx.complianceReview.update({
          where: { id: current.id },
          data: { cuestionario_json: answers as Prisma.InputJsonObject, resultado_json: result as Prisma.InputJsonObject, explicacion: result.disclaimer, estatus: 'PENDIENTE_REVISION' },
          include: reviewInclude,
        });
        await tx.auditLog.create({ data: { user_id: actorId, accion: 'EVALUATE_COMPLIANCE_REVIEW', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { clasificacion: result.clasificacion, rule_version: current.rule_version_snapshot }, correlation_id: (req as any).correlationId } });
        return review;
      });
      return res.json({ success: true, revision: updated });
    } catch (error: any) {
      const status = error instanceof ComplianceError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'COMPLIANCE_EVALUATE_FAILED' });
    }
  }

  static async review(req: Request, res: Response) {
    try {
      const actorId = await activeUser(actorFrom(req));
      const decision = String(req.body.decision || '').toUpperCase();
      if (!['CONFIRMAR', 'REQUIERE_AJUSTES'].includes(decision)) throw new ComplianceError('La decisión humana no es válida.', 'COMPLIANCE_DECISION_INVALID');
      if (!req.user) throw new ComplianceError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const current = await prisma.complianceReview.findFirst({ where: { id: req.params.id, expediente: { archived_at: null, ...expedienteAccessWhere(req.user) } } });
      if (!current) throw new ComplianceError('Revisión no encontrada.', 'COMPLIANCE_REVIEW_NOT_FOUND', 404);
      if (!current.resultado_json) throw new ComplianceError('Primero ejecuta la evaluación explicable.', 'COMPLIANCE_RESULT_REQUIRED', 409);
      const updated = await prisma.$transaction(async (tx) => {
        const review = await tx.complianceReview.update({ where: { id: current.id }, data: { estatus: decision === 'CONFIRMAR' ? 'CONFIRMADO' : 'REQUIERE_AJUSTES', revisado_por_id: actorId, revisado_at: new Date(), explicacion: String(req.body.observaciones || current.explicacion || '').trim() || null }, include: reviewInclude });
        await tx.auditLog.create({ data: { user_id: actorId, accion: 'REVIEW_COMPLIANCE_RESULT', entidad: 'ComplianceReview', entidad_id: review.id, valores_nuevos: { decision, observaciones: req.body.observaciones || null }, correlation_id: (req as any).correlationId } });
        return review;
      });
      return res.json({ success: true, revision: updated });
    } catch (error: any) {
      const status = error instanceof ComplianceError ? error.status : 500;
      return res.status(status).json({ success: false, error: error.message, code: error.code || 'COMPLIANCE_REVIEW_FAILED' });
    }
  }

  static async addEvidence(req: Request, res: Response) {
    try {
      const actorId = await activeUser(actorFrom(req));
      if (!req.user) throw new ComplianceError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
      const review = await prisma.complianceReview.findFirst({ where: { id: req.params.id, expediente: { archived_at: null, ...expedienteAccessWhere(req.user) } }, select: { id: true, expediente_id: true, estatus: true } });
      if (!review) throw new ComplianceError('Revisión no encontrada.', 'COMPLIANCE_REVIEW_NOT_FOUND', 404);
      if (review.estatus === 'CONFIRMADO') throw new ComplianceError('La revisión está cerrada; crea una nueva revisión para agregar evidencia.', 'COMPLIANCE_REVIEW_LOCKED', 409);
      const document = await prisma.documento.findFirst({ where: { id: String(req.body.documento_id), OR: [{ expediente_id: review.expediente_id }, { expedienteVinculos: { some: { expediente_id: review.expediente_id, estatus: 'ACTIVO' } } }] }, select: { id: true } });
      if (!document) throw new ComplianceError('El documento no pertenece al expediente.', 'COMPLIANCE_EVIDENCE_INVALID', 404);
      const evidence = await prisma.complianceEvidence.create({ data: { review_id: review.id, documento_id: document.id, tipo_evidencia: String(req.body.tipo_evidencia || 'SOPORTE').trim(), observaciones: String(req.body.observaciones || '').trim() || null, agregado_por_id: actorId }, include: { documento: { select: { id: true, nombre_original: true, tipo: true, estatus: true } } } });
      return res.status(201).json({ success: true, evidencia: evidence });
    } catch (error: any) {
      const status = error instanceof ComplianceError ? error.status : error.code === 'P2002' ? 409 : 500;
      return res.status(status).json({ success: false, error: error.code === 'P2002' ? 'La evidencia ya está vinculada.' : error.message, code: error.code || 'COMPLIANCE_EVIDENCE_FAILED' });
    }
  }
}
