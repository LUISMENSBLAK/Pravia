import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  open: vi.fn(),
  attachFee: vi.fn(),
}));

vi.mock('./expedienteOpening.service', () => ({
  ExpedienteOpeningService: class {
    openInTransaction(tx: unknown, input: unknown) { return dependencies.open(tx, input); }
  },
}));
vi.mock('./honorarioRecognition.service', () => ({
  attachGeneratedFeeToExpediente: dependencies.attachFee,
}));

import { CotizacionConversionService } from './cotizacionConversion.service';

function database(options: { failAudit?: boolean } = {}) {
  const state = { linked: null as any, quoteState: 'ACEPTADA' };
  let transactionTail = Promise.resolve();
  const candidate = () => ({
    id: 'quote-1', estado: state.quoteState, user_id: 'user-1', notaria_id: 'notary-1', prospecto_id: 'prospect-1',
    prospecto: { id: 'prospect-1', nombre: 'Cliente heredado', tipo_acto: 'Compraventa' }, expediente: state.linked,
    versiones: [{ id: 'version-1', version: 1, aprobada: true, desglose_notaria: { rubros: [{ concepto: 'Honorarios' }] }, total_notaria: 100_000, honorarios_pravia: 25_000, total_cliente: 125_000 }],
    pagos: [{ id: 'payment-1', categoria_ingreso: 'ANTICIPO_NOTARIA', estatus: 'VALIDADO', monto: 30_000 }],
  });
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    cotizacion: {
      findUnique: vi.fn(async () => candidate()),
      update: vi.fn(async () => { state.quoteState = 'CONVERTIDA_EXPEDIENTE'; return candidate(); }),
    },
    user: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })) },
    tipoActo: { findFirst: vi.fn().mockResolvedValue({ id: 'act-1', nombre: 'Compraventa' }), findMany: vi.fn() },
    documento: { findMany: vi.fn().mockResolvedValue([{ id: 'document-1' }]) },
    prospectoDocumento: { findMany: vi.fn().mockResolvedValue([{ documento_id: 'document-1' }]) },
    cotizacionDocumento: { findMany: vi.fn().mockResolvedValue([{ documento_id: 'document-2' }]) },
    expedienteDocumento: { upsert: vi.fn().mockResolvedValue({}) },
    pago: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    prospecto: { update: vi.fn().mockResolvedValue({}) },
    expedienteActividad: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: options.failAudit ? vi.fn().mockRejectedValue(new Error('audit failed')) : vi.fn().mockResolvedValue({}) },
    domainEventOutbox: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    $transaction: vi.fn((work: (client: any) => Promise<any>) => {
      const run = transactionTail.then(async () => {
        const snapshot = { ...state };
        try { return await work(tx); }
        catch (error) { state.linked = snapshot.linked; state.quoteState = snapshot.quoteState; throw error; }
      });
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
    }),
  };
  dependencies.open.mockImplementation(async (_tx, input: any) => {
    const expediente = { id: 'exp-1', numero_pravia: 'EXP-0001-2026', cotizacion_id: input.cotizacionId, abogado_id: input.abogadoId, datos_operacion: input.datosOperacion };
    state.linked = expediente;
    return expediente;
  });
  return { prisma, tx, state };
}

describe('EXP-001 conversión canónica y atómica', () => {
  beforeEach(() => { vi.clearAllMocks(); dependencies.attachFee.mockResolvedValue({ count: 1 }); });

  it('hereda cliente, acto, responsable, notaría, presupuesto, documentos y anticipo en una transacción', async () => {
    const { prisma, tx } = database();
    const result = await new CotizacionConversionService(prisma).convert({ cotizacionId: 'quote-1', actorUserId: 'user-1' });
    expect(result).toMatchObject({ alreadyConverted: false, validatedAdvanceTotal: 30_000, expediente: { numero_pravia: 'EXP-0001-2026', cotizacion_id: 'quote-1' } });
    expect(dependencies.open).toHaveBeenCalledWith(tx, expect.objectContaining({ clienteAlias: 'Cliente heredado', tipoActoId: 'act-1', abogadoId: 'user-1', notariaId: 'notary-1', datosOperacion: { presupuesto: expect.objectContaining({ total_cliente: 125_000, honorarios_pravia: 25_000 }) } }));
    expect(tx.expedienteDocumento.upsert).toHaveBeenCalledTimes(2);
    expect(tx.pago.updateMany).toHaveBeenCalledWith({ where: { cotizacion_id: 'quote-1' }, data: { expediente_id: 'exp-1' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'CONVERT_TO_EXPEDIENTE', entidad_id: 'quote-1' }) }));
    expect(tx.domainEventOutbox.create).toHaveBeenCalledTimes(1);
  });

  it('dos solicitudes concurrentes producen como máximo un expediente', async () => {
    const { prisma } = database(); const service = new CotizacionConversionService(prisma);
    const [first, second] = await Promise.all([service.convert({ cotizacionId: 'quote-1' }), service.convert({ cotizacionId: 'quote-1' })]);
    expect(dependencies.open).toHaveBeenCalledTimes(1);
    expect(first.expediente.id).toBe(second.expediente.id);
    expect([first.alreadyConverted, second.alreadyConverted].sort()).toEqual([false, true]);
  });

  it('revierte toda la conversión si falla una escritura posterior', async () => {
    const { prisma, state, tx } = database({ failAudit: true });
    await expect(new CotizacionConversionService(prisma).convert({ cotizacionId: 'quote-1' })).rejects.toThrow('audit failed');
    expect(state).toEqual({ linked: null, quoteState: 'ACEPTADA' });
    expect(tx.domainEventOutbox.create).not.toHaveBeenCalled();
  });
});
