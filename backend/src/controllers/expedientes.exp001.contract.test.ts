import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  cotizacion: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('../config/prisma', () => ({ default: prismaMock }));

import { convertCotizacionToExpediente, createExpediente, getEligibleCotizacionesForExpediente } from './expedientes.controller';

const response = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const user = (role = 'ABOGADO') => ({
  id: 'user-1', email: 'user@example.test', nombre: 'Andrea', apellido: 'Ruiz', rol: role,
  organizationId: 'org-1', membershipId: 'membership-1', sessionId: 'session-1', scope: 'ASSIGNED_OBJECTS',
  permissions: ['expedientes.read', 'expedientes.write'], requiresPasswordChange: false,
});

const quote = (overrides: Record<string, unknown> = {}) => ({
  id: 'quote-1', numero_solicitud: 'SOL-2026-001', numero_cotizacion: 'COT-2026-001',
  estado: 'ACEPTADA', prospecto_id: 'prospect-1', expediente: null, total_cliente: 150_000,
  updated_at: new Date('2026-08-20T12:00:00Z'),
  prospecto: { id: 'prospect-1', nombre: 'Cliente', tipo_acto: 'Compraventa', email: null, telefono: null },
  notaria: null, creada_por: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' },
  versiones: [{ id: 'version-1', version: 1, aprobada: true }],
  pagos: [{ id: 'payment-1', categoria_ingreso: 'ANTICIPO_NOTARIA', estatus: 'VALIDADO', monto: 30_000 }],
  ...overrides,
});

describe('EXP-001 contrato de nacimiento de expediente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bloquea POST directo sin interpretar el payload legacy', async () => {
    const req: any = { user: user(), body: { tipo_acto_id: 'act-1', cliente_alias: 'Cliente' } };
    const res = response();
    await createExpediente(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EXPEDIENTE_QUOTE_ORIGIN_REQUIRED' }));
    expect(prismaMock.cotizacion.findMany).not.toHaveBeenCalled();
  });

  it('exige sesión incluso para el endpoint contractual bloqueado', async () => {
    const res = response();
    await createExpediente({ body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lista exclusivamente cotizaciones evaluadas como elegibles por el dominio', async () => {
    prismaMock.cotizacion.findMany.mockResolvedValue([
      quote(),
      quote({ id: 'draft', estado: 'BORRADOR', versiones: [], pagos: [] }),
      quote({ id: 'converted', expediente: { id: 'exp-1' } }),
    ]);
    const req: any = { user: user() };
    const res = response();
    await getEligibleCotizacionesForExpediente(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      total: 1,
      data: [expect.objectContaining({ id: 'quote-1', conversion: expect.objectContaining({ eligible: true }) })],
    }));
  });

  it('aplica alcance por objeto al consultar candidatos', async () => {
    prismaMock.cotizacion.findMany.mockResolvedValue([]);
    await getEligibleCotizacionesForExpediente({ user: user('ABOGADO') } as any, response());
    expect(prismaMock.cotizacion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user_id: 'user-1', expediente: null }),
    }));
  });

  it('bloquea la conversión de una cotización ajena aun con un ID válido', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(null);
    const res = response();
    await convertCotizacionToExpediente({
      user: user('ABOGADO'),
      body: { cotizacion_id: 'quote-from-another-tenant' },
    } as any, res);
    expect(prismaMock.cotizacion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'quote-from-another-tenant', user_id: 'user-1' }),
    }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'COTIZACION_ACCESS_DENIED' }));
  });
});
