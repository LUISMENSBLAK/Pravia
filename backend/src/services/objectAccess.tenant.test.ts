import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  movimientoFinanciero: { findFirst: vi.fn() },
  comparecienteAltaSession: { findFirst: vi.fn() },
  cargaTemporalDocumento: { findFirst: vi.fn() },
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { canAccessAltaCarga, canAccessAltaSession, canAttachDocumento } from './objectAccess.service';

const actor = {
  id: 'user-a', organizationId: 'tenant-a', rol: 'FINANCIERO',
  permissions: ['finanzas.write', 'documentos.write'],
} as any;

describe('object access: tenant explícito en recursos auxiliares', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no adjunta a un movimiento de otra notaría aunque Finanzas tenga acceso global dentro de la propia', async () => {
    db.movimientoFinanciero.findFirst.mockImplementation(async ({ where }) =>
      where.organization_id === 'tenant-a' ? null : { id: 'movement-b' });
    expect(await canAttachDocumento(actor, { movimiento_id: 'movement-b' })).toBe(false);
    expect(db.movimientoFinanciero.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'movement-b', organization_id: 'tenant-a' }),
    }));
  });

  it('consulta sesiones y cargas temporales sólo dentro del tenant', async () => {
    db.comparecienteAltaSession.findFirst.mockImplementation(async ({ where }) =>
      where.organization_id === 'tenant-a' ? { id: 'session-a' } : null);
    db.cargaTemporalDocumento.findFirst.mockResolvedValue({ id: 'upload-a' });
    expect(await canAccessAltaSession(actor, 'session-a')).toBe(true);
    expect(await canAccessAltaCarga(actor, 'session-a', 'upload-a')).toBe(true);
    expect(db.comparecienteAltaSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 'tenant-a' }),
    }));
    expect(db.cargaTemporalDocumento.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 'tenant-a' }),
    }));
  });
});
