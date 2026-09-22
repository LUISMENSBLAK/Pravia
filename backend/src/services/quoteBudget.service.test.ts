import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { QuoteBudgetService } from './quoteBudget.service';

type Actor = NonNullable<Request['user']>;

const timestamp = new Date('2026-09-16T12:00:00.000Z');
const actor = (permissions = ['cotizaciones.write']): Actor => ({
  id: '20000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000001',
  membershipId: '30000000-0000-4000-8000-000000000001',
  sessionId: '40000000-0000-4000-8000-000000000001',
  rol: 'ADMINISTRACION',
  nombre: 'QA',
  apellido: 'Local',
  email: 'qa.local@example.test',
  scope: 'GLOBAL',
  requiresPasswordChange: false,
  permissions,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  id: '50000000-0000-4000-8000-000000000001',
  organization_id: '10000000-0000-4000-8000-000000000001',
  user_id: '20000000-0000-4000-8000-000000000001',
  updated_at: timestamp,
  etapa_contractual: 'ACEPTADA',
  conceptos: [{ id: 'old', concepto: 'Anterior', categoria: 'HONORARIOS', importe: '10.00', orden: 0, origen: 'MANUAL' }],
  ...overrides,
});

const harness = (found: ReturnType<typeof quote> | null = quote()) => {
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    cotizacion: {
      findFirst: vi.fn().mockResolvedValue(found),
      update: vi.fn().mockResolvedValue({
        ...found,
        updated_at: new Date('2026-09-16T12:01:00.000Z'),
        etapa_contractual: found?.etapa_contractual,
        conceptos: [
          { id: 'new-1', concepto: 'Honorarios vigentes', categoria: 'HONORARIOS', importe: '100.00', orden: 0, origen: 'MANUAL' },
          { id: 'new-2', concepto: 'IVA', categoria: 'IVA_HONORARIOS', importe: '16.00', orden: 1, origen: 'MANUAL' },
        ],
      }),
    },
    cotizacionConcepto: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    cotizacionVersion: { create: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma: any = { $transaction: vi.fn((callback: (client: any) => unknown) => callback(tx)) };
  return { tx, service: new QuoteBudgetService(prisma) };
};

const input = {
  concepts: [
    { concepto: 'Honorarios vigentes', categoria: 'HONORARIOS', importe: '100.00' },
    { concepto: 'IVA', categoria: 'IVA_HONORARIOS', importe: '16.00' },
  ],
  origin: 'MANUAL',
  expectedUpdatedAt: timestamp.toISOString(),
};

describe('Corrección 002 v2 · presupuesto único editable', () => {
  it('edita una cotización aceptada sin cambiar etapa ni crear una versión editable', async () => {
    const { tx, service } = harness();
    const result = await service.save(actor(), quote().id, input);

    expect(result).toMatchObject({ stage: 'ACEPTADA', presupuesto: { totals: { honorarios: '100.00', iva_honorarios: '16.00', total: '116.00' } } });
    expect(tx.cotizacion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ total_cliente: '116.00', total_notaria: '116.00', honorarios_pravia: null }),
    }));
    expect(tx.cotizacion.update.mock.calls[0][0].data).not.toHaveProperty('etapa_contractual');
    expect(tx.cotizacionVersion.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      accion: 'QUOTE_BUDGET_UPDATED',
      detalles: { source: 'CORRECCION_002_V2', stage_changed: false, editable_version_created: false },
    }) }));
  });

  it('rechaza una revisión stale antes de reemplazar conceptos', async () => {
    const { tx, service } = harness(quote({ updated_at: new Date('2026-09-16T12:00:01.000Z') }));
    await expect(service.save(actor(), quote().id, input)).rejects.toMatchObject({ status: 409, code: 'QUOTE_BUDGET_STALE' });
    expect(tx.cotizacionConcepto.deleteMany).not.toHaveBeenCalled();
  });

  it('aplica permiso y object access/tenant antes de escribir', async () => {
    const denied = harness();
    await expect(denied.service.save(actor([]), quote().id, input)).rejects.toMatchObject({ status: 403, code: 'QUOTE_BUDGET_WRITE_DENIED' });
    expect(denied.tx.cotizacion.findFirst).not.toHaveBeenCalled();

    const inaccessible = harness(null);
    await expect(inaccessible.service.save(actor(), quote().id, input)).rejects.toMatchObject({ status: 404, code: 'QUOTE_NOT_FOUND' });
    expect(inaccessible.tx.cotizacionConcepto.deleteMany).not.toHaveBeenCalled();
  });

  it('rechaza campos de workflow inyectados en el endpoint económico', async () => {
    const { tx, service } = harness();
    await expect(service.save(actor(), quote().id, { ...input, etapa_contractual: 'BORRADOR' })).rejects.toMatchObject({ status: 400, code: 'QUOTE_BUDGET_FIELDS_DENIED' });
    expect(tx.cotizacion.findFirst).not.toHaveBeenCalled();
  });
});
