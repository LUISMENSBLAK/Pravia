import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { FinanceDomainError } from '../domain/financeCore';
import { BankReconciliationService } from '../services/bankReconciliation.service';
import { FinanceAnalyticsService, resolveFinancePeriod } from '../services/financeAnalytics.service';
import { FinancialMovementService } from '../services/financialMovement.service';

const movementService = new FinancialMovementService(prisma);
const analyticsService = new FinanceAnalyticsService(prisma);
const reconciliationService = new BankReconciliationService(prisma);
const correlation = (req: Request) => (req as Request & { correlationId?: string }).correlationId;

function failure(res: Response, error: unknown, fallback: string) {
  if (error instanceof FinanceDomainError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
  console.error(`[Finance] ${fallback}`, error);
  return res.status(500).json({ success: false, code: 'FINANCE_OPERATION_FAILED', error: fallback });
}

const actor = (req: Request) => {
  if (!req.user?.id) throw new FinanceDomainError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401);
  return req.user.id;
};

export class FinanceLedgerController {
  static async summary(req: Request, res: Response) {
    try {
      const period = resolveFinancePeriod(req.query as any);
      return res.json({ success: true, data: await analyticsService.summary(period) });
    } catch (error) { return failure(res, error, 'No pudimos cargar el resumen financiero.'); }
  }

  static async movements(req: Request, res: Response) {
    try {
      const period = resolveFinancePeriod(req.query as any);
      return res.json({ success: true, data: await movementService.list({ ...req.query, fecha_desde: period.from.toISOString().slice(0, 10), fecha_hasta: period.to.toISOString().slice(0, 10) }) });
    }
    catch (error) { return failure(res, error, 'No pudimos cargar los movimientos.'); }
  }

  static async createMovement(req: Request, res: Response) {
    try {
      const result = await movementService.createDraft(req.body, actor(req), correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return failure(res, error, 'No pudimos registrar este movimiento.'); }
  }

  static async replaceDistribution(req: Request, res: Response) {
    try {
      const data = await movementService.replaceDistribution(req.params.id, req.body.distribuciones || [], actor(req), correlation(req));
      return res.json({ success: true, data });
    } catch (error) { return failure(res, error, 'No pudimos actualizar la distribución.'); }
  }

  static async generateReceipt(req: Request, res: Response) {
    try {
      const result = await movementService.generateReceipt(req.params.id, actor(req), req.body?.observaciones, correlation(req));
      return res.status(result.idempotent ? 200 : 201).json({ success: true, data: result });
    } catch (error) { return failure(res, error, 'No pudimos generar el comprobante.'); }
  }

  static async applyMovement(req: Request, res: Response) {
    try { return res.json({ success: true, data: await movementService.apply(req.params.id, actor(req), correlation(req)) }); }
    catch (error) { return failure(res, error, 'No pudimos aplicar este movimiento.'); }
  }

  static async retireEvidence(req: Request, res: Response) {
    try {
      const data = await movementService.retireEvidence(req.params.id, req.params.documentId, actor(req), req.body?.motivo, correlation(req));
      return res.json({ success: true, data });
    } catch (error) { return failure(res, error, 'No pudimos retirar este comprobante.'); }
  }

  static async cancelMovement(req: Request, res: Response) {
    try { return res.json({ success: true, data: await movementService.cancelDraft(req.params.id, actor(req), req.body?.motivo, correlation(req)) }); }
    catch (error) { return failure(res, error, 'No pudimos cancelar este movimiento.'); }
  }

  static async reverseMovement(req: Request, res: Response) {
    try { return res.status(201).json({ success: true, data: await movementService.reverseApplied(req.params.id, actor(req), req.body?.motivo, correlation(req)) }); }
    catch (error) { return failure(res, error, 'No pudimos revertir este movimiento.'); }
  }

  static async receipts(req: Request, res: Response) {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
      const period = resolveFinancePeriod(req.query as any);
      const where: any = {
        fecha: { gte: period.from, lte: period.to },
        ...(req.query.tipo && req.query.tipo !== 'TODOS' ? { tipo: req.query.tipo } : {}),
        ...(req.query.search ? { OR: [{ folio: { contains: String(req.query.search), mode: 'insensitive' } }, { movimiento: { expediente: { numero_pravia: { contains: String(req.query.search), mode: 'insensitive' } } } }] } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.comprobanteFinanciero.findMany({ where, include: { movimiento: { include: { expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } }, cuenta: true } }, registrado_por: { select: { nombre: true, apellido: true } } }, orderBy: { fecha: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.comprobanteFinanciero.count({ where }),
      ]);
      return res.json({ success: true, data: { items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } } });
    } catch (error) { return failure(res, error, 'No pudimos cargar los comprobantes.'); }
  }

  static async accounts(_req: Request, res: Response) {
    try {
      const items = await prisma.cuentaFinanciera.findMany({ orderBy: [{ predeterminada: 'desc' }, { activa: 'desc' }, { alias: 'asc' }], include: { _count: { select: { movimientos: true, transaccionesBanco: true } } } });
      const balances = await prisma.movimientoFinanciero.groupBy({ by: ['cuenta_id', 'naturaleza'], where: { cuenta_id: { not: null }, estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] } }, _sum: { monto: true } });
      return res.json({ success: true, data: items.map((item) => ({ ...item, saldo_pravia: Number(item.saldo_inicial) + balances.filter((row) => row.cuenta_id === item.id).reduce((sum, row) => sum + (row.naturaleza === 'INGRESO' ? 1 : -1) * Number(row._sum.monto || 0), 0), saldo_tipo: 'CALCULADO_PRAVIA' })) });
    } catch (error) { return failure(res, error, 'No pudimos cargar las cuentas.'); }
  }

  static async createAccount(req: Request, res: Response) {
    try {
      const body = req.body || {};
      if (!String(body.institucion || '').trim() || !String(body.alias || '').trim() || !String(body.tipo || '').trim()) throw new FinanceDomainError('Institución, alias y tipo son obligatorios.', 'ACCOUNT_REQUIRED_FIELDS');
      if (body.ultimos_cuatro && !/^\d{4}$/.test(String(body.ultimos_cuatro))) throw new FinanceDomainError('Captura únicamente los últimos cuatro dígitos.', 'ACCOUNT_LAST_FOUR_INVALID');
      const account = await prisma.$transaction(async (tx) => {
        if (body.predeterminada) await tx.cuentaFinanciera.updateMany({ data: { predeterminada: false } });
        const item = await tx.cuentaFinanciera.create({ data: { institucion: String(body.institucion).trim(), alias: String(body.alias).trim(), tipo: String(body.tipo).trim(), ultimos_cuatro: body.ultimos_cuatro || null, moneda: body.moneda || 'MXN', predeterminada: Boolean(body.predeterminada), saldo_inicial: Number(body.saldo_inicial || 0), creada_por_id: actor(req) } });
        await tx.auditLog.create({ data: { user_id: actor(req), accion: 'CREATE_FINANCIAL_ACCOUNT', entidad: 'CuentaFinanciera', entidad_id: item.id, valores_nuevos: { institucion: item.institucion, alias: item.alias, tipo: item.tipo, ultimos_cuatro: item.ultimos_cuatro }, correlation_id: correlation(req) } });
        return item;
      });
      return res.status(201).json({ success: true, data: account });
    } catch (error) { return failure(res, error, 'No pudimos registrar la cuenta.'); }
  }

  static async receivables(req: Request, res: Response) {
    try {
      const period = resolveFinancePeriod(req.query as any);
      return res.json({ success: true, data: await analyticsService.receivables({ ...req.query, fecha_desde: period.from, fecha_hasta: period.to } as any) });
    }
    catch (error) { return failure(res, error, 'No pudimos cargar la cartera.'); }
  }

  static async reconciliation(req: Request, res: Response) {
    try {
      const period = resolveFinancePeriod(req.query as any);
      return res.json({ success: true, data: await reconciliationService.list({ ...req.query, fecha_desde: period.from.toISOString().slice(0, 10), fecha_hasta: period.to.toISOString().slice(0, 10) } as any) });
    }
    catch (error) { return failure(res, error, 'No pudimos cargar la conciliación.'); }
  }

  static async registerBankTransaction(req: Request, res: Response) {
    try {
      const body = req.body || {};
      const amount = Number(body.importe);
      const date = new Date(body.fecha);
      if (!body.cuenta_id || !Number.isFinite(amount) || amount === 0 || Number.isNaN(date.getTime()) || !String(body.descripcion || '').trim()) throw new FinanceDomainError('Cuenta, fecha, importe y descripción son obligatorios.', 'BANK_TRANSACTION_REQUIRED_FIELDS');
      const fingerprint = crypto.createHash('sha256').update([body.cuenta_id, date.toISOString(), amount.toFixed(2), String(body.referencia || ''), String(body.descripcion).trim()].join('|')).digest('hex');
      const result = await prisma.transaccionEstadoCuenta.upsert({ where: { fingerprint }, create: { cuenta_id: body.cuenta_id, fecha: date, importe: amount, descripcion: String(body.descripcion).trim(), referencia: String(body.referencia || '').trim() || null, fingerprint, fuente: 'MANUAL', importado_por_id: actor(req) }, update: {} });
      return res.status(201).json({ success: true, data: result, note: 'Formato de importación bancaria pendiente de confirmar con el cliente.' });
    } catch (error) { return failure(res, error, 'No pudimos registrar la transacción bancaria.'); }
  }

  static async reconcile(req: Request, res: Response) {
    try { return res.json({ success: true, data: await reconciliationService.reconcile({ movementId: req.body.movimiento_id, bankTransactionId: req.body.transaccion_bancaria_id, method: req.body.metodo, justification: req.body.justificacion }, actor(req), correlation(req)) }); }
    catch (error) { return failure(res, error, 'No pudimos conciliar estos movimientos.'); }
  }

  static async catalogs(req: Request, res: Response) {
    try {
      const [categories, accounts, expedientes, notarias, responsables] = await Promise.all([
        prisma.categoriaFinanciera.findMany({ where: { activa: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
        prisma.cuentaFinanciera.findMany({ where: { activa: true }, select: { id: true, institucion: true, alias: true, ultimos_cuatro: true, moneda: true, tipo: true, predeterminada: true }, orderBy: [{ predeterminada: 'desc' }, { alias: 'asc' }] }),
        prisma.expediente.findMany({ where: { archived_at: null }, select: { id: true, numero_pravia: true, cliente_alias: true, notaria_id: true, abogado_id: true, cotizacion_id: true }, orderBy: { updated_at: 'desc' }, take: 200 }),
        prisma.notaria.findMany({ where: { activa: true }, select: { id: true, nombre: true, numero_notaria: true }, orderBy: { nombre: 'asc' } }),
        prisma.user.findMany({ where: { activo: true, rol: { in: ['DIRECCION', 'ADMINISTRACION', 'ABOGADO'] } }, select: { id: true, nombre: true, apellido: true, rol: true }, orderBy: { nombre: 'asc' } }),
      ]);
      return res.json({ success: true, data: { categories, accounts, expedientes, notarias, responsables, permisos: { escribir: Boolean(req.user?.permissions.includes('finanzas.write')), aplicar: Boolean(req.user?.permissions.includes('finanzas.validate')), conciliar: Boolean(req.user?.permissions.includes('finanzas.validate')), expedientesLeer: Boolean(req.user?.permissions.includes('expedientes.read')), documentosLeer: Boolean(req.user?.permissions.includes('documentos.read')), documentosEscribir: Boolean(req.user?.permissions.includes('documentos.write')), documentosEliminar: Boolean(req.user?.permissions.includes('documentos.unlink')) }, invoiceIntegration: { configured: false, status: 'PENDIENTE_CONFIGURACION', message: 'Integración de facturación pendiente de configuración.' }, bankImport: { configured: false, message: 'Formato de importación bancaria pendiente de confirmar con el cliente.' } } });
    } catch (error) { return failure(res, error, 'No pudimos cargar los catálogos financieros.'); }
  }

  static invoiceStatus(_req: Request, res: Response) {
    return res.json({ success: true, data: { configured: false, provider: null, cfdiEnabled: false, message: 'Integración de facturación pendiente de configuración.' } });
  }
}
