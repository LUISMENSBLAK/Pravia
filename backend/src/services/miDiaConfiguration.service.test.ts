import { describe, expect, it, vi } from 'vitest';
import { MiDiaConfigurationService } from './miDiaConfiguration.service';

const actor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scope: 'ASSIGNED_OBJECTS',
  permissions: ['mi_dia.read', 'expedientes.read', 'agenda.read'],
} as any;

const db = () => {
  const client = {
  miDiaTenantConfig: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ version: 1 }), update: vi.fn() },
  miDiaUserLayout: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'layout-1', version: 1 }), update: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  miDiaCardPermission: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({ id: 'grant-1', enabled: true, max_scope: 'OWN' }) },
  organizationMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  return Object.assign(client, { $transaction: vi.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)) });
};

describe('Mi Día · configuración efectiva', () => {
  it('deniega configuración y reset sin permiso de lectura de Mi Día', async () => {
    const client = db();
    const denied = { ...actor, permissions: ['expedientes.read'] };
    const service = new MiDiaConfigurationService(client as any);
    await expect(service.get(denied)).rejects.toMatchObject({ status: 403, code: 'MIDIA_READ_DENIED' });
    await expect(service.resetLayout(denied)).rejects.toMatchObject({ status: 403, code: 'MIDIA_READ_DENIED' });
    expect(client.miDiaTenantConfig.findUnique).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('filtra el catálogo por permiso real y no ofrece alcance equipo sin membresía', async () => {
    const client = db();
    const result = await new MiDiaConfigurationService(client as any).get(actor);
    expect(result.catalog.some((card) => card.key === 'RECEIVABLE')).toBe(false);
    expect(result.catalog.some((card) => card.key === 'CASES')).toBe(true);
    expect(result.catalog.some((card) => card.key === 'TODAY_SIGNINGS')).toBe(true);
    expect(result.catalog.some((card) => card.key === 'UPCOMING_APPOINTMENTS')).toBe(true);
    expect(result.catalog.find((card) => card.key === 'CASES')?.allowedScopes).toEqual(['OWN']);
    expect(result.layout.every((item) => item.scope === 'OWN')).toBe(true);
    expect(result.tenantAdministration).toBeUndefined();
  });

  it('sólo a quien configura muestra tarjetas conectadas, incluso las deshabilitadas', async () => {
    const client = db();
    client.miDiaTenantConfig.findUnique.mockResolvedValueOnce({ version: 2, enabled_cards: ['CASES'],
      default_layout: [{ key: 'CASES', fixed: true }], recommended_cards: ['CASES'] });
    const admin = { ...actor, permissions: [...actor.permissions, 'mi_dia.configure'] };
    const result = await new MiDiaConfigurationService(client as any).get(admin);
    expect(result.tenantAdministration).toMatchObject({ version: 2, enabledCards: ['CASES'],
      defaultLayout: [expect.objectContaining({ key: 'CASES', fixed: true })] });
    expect(result.tenantAdministration?.catalog.some((card) => card.key === 'PRAVIA_ASSISTANT')).toBe(true);
    expect(result.tenantAdministration?.catalog.some((card) => card.key === 'REP_PENDING')).toBe(true);
    expect(result.tenantAdministration?.catalog.some((card) => card.key === 'ADVANCES_PENDING')).toBe(true);
  });

  it('no permite guardar una tarjeta financiera ni ampliar el alcance', async () => {
    const service = new MiDiaConfigurationService(db() as any);
    await expect(service.saveLayout(actor, { version: 0, layout: [{ key: 'RECEIVABLE', size: 'S', scope: 'OWN' }] }))
      .rejects.toMatchObject({ status: 403, code: 'MIDIA_CARD_DENIED' });
    await expect(service.saveLayout(actor, { version: 0, layout: [{ key: 'CASES', size: 'S', scope: 'ORGANIZATION' }] }))
      .rejects.toMatchObject({ status: 403, code: 'MIDIA_SCOPE_DENIED' });
    await expect(service.saveLayout(actor, { version: 0, layout: [{ key: 'CASES', size: 'S', scope: 'TEAM' }] }))
      .rejects.toMatchObject({ status: 403, code: 'MIDIA_SCOPE_DENIED' });
  });

  it('guarda versión y registra auditoría para el layout personal', async () => {
    const client = db();
    const service = new MiDiaConfigurationService(client as any);
    const result = await service.saveLayout(actor, { version: 0, layout: [{ key: 'CASES', size: 'S', scope: 'OWN' }] });
    expect(result.version).toBe(1);
    expect(client.miDiaUserLayout.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor.organizationId, user_id: actor.id }) }));
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'PERSONALIZE_MI_DIA' }) }));
  });

  it('permite a Dirección elegir OWN u ORGANIZATION y conserva OWN tras recarga', async () => {
    const client = db();
    const director = { ...actor, scope: 'GLOBAL' };
    const service = new MiDiaConfigurationService(client as any);
    const initial = await service.get(director);
    expect(initial.catalog.find((card) => card.key === 'CASES')?.allowedScopes).toEqual(['OWN', 'ORGANIZATION']);
    await service.saveLayout(director, { version: 0, layout: [{ key: 'CASES', size: 'S', scope: 'OWN' }] });
    client.miDiaUserLayout.findUnique.mockResolvedValueOnce({ id: 'layout-1', version: 1, personalized: true,
      layout: [{ key: 'CASES', size: 'S', scope: 'OWN', parameters: {} }] });
    const reloaded = await service.get(director);
    expect(reloaded.layout).toEqual([{ key: 'CASES', size: 'S', scope: 'OWN', parameters: {}, fixed: false }]);
  });

  it('respeta la versión y rechaza guardar un tablero obsoleto', async () => {
    const client = db();
    client.miDiaUserLayout.findUnique.mockResolvedValueOnce({ id: 'layout-1', version: 2, layout: [], personalized: true });
    await expect(new MiDiaConfigurationService(client as any).saveLayout(actor, { version: 1, layout: [] }))
      .rejects.toMatchObject({ status: 409, code: 'MIDIA_LAYOUT_CHANGED' });
    expect(client.miDiaUserLayout.update).not.toHaveBeenCalled();
  });

  it('no permite quitar una tarjeta fijada por la notaría', async () => {
    const client = db();
    client.miDiaTenantConfig.findUnique.mockResolvedValue({ version: 4, enabled_cards: ['CASES'],
      default_layout: [{ key: 'CASES', size: 'S', scope: 'OWN', parameters: {}, fixed: true }],
      recommended_cards: [] });
    await expect(new MiDiaConfigurationService(client as any).saveLayout(actor, { version: 0, layout: [] }))
      .rejects.toMatchObject({ status: 409, code: 'MIDIA_FIXED_CARD_REQUIRED' });
    expect(client.miDiaUserLayout.create).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('rechaza parámetros no canónicos sin guardar ni auditar', async () => {
    const client = db();
    const service = new MiDiaConfigurationService(client as any);
    await expect(service.saveLayout(actor, { version: 0, layout: [{
      key: 'CASES', size: 'S', scope: 'OWN', parameters: { limit: 500 },
    }] })).rejects.toMatchObject({ status: 400, code: 'MIDIA_LIMIT_INVALID' });
    expect(client.miDiaUserLayout.create).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('resetea el layout y audita en la misma transacción', async () => {
    const client = db();
    await new MiDiaConfigurationService(client as any).resetLayout(actor);
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(client.miDiaUserLayout.deleteMany).toHaveBeenCalledWith({ where: { organization_id: actor.organizationId, user_id: actor.id } });
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'RESET_MI_DIA' }) }));
  });

  it('configura el tablero tenant y su auditoría de forma atómica', async () => {
    const client = db();
    const admin = { ...actor, permissions: [...actor.permissions, 'mi_dia.configure'] };
    const result = await new MiDiaConfigurationService(client as any).updateTenant(admin, {
      version: 0, enabled_cards: ['CASES'], default_layout: [{ key: 'CASES', size: 'S', scope: 'ORGANIZATION' }],
      fixed_cards: ['CASES'], recommended_cards: ['CASES'],
    });
    expect(result.version).toBe(1);
    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(client.miDiaTenantConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor.organizationId }) }));
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'CONFIGURE_MI_DIA_TENANT' }) }));
  });

  it('rechaza una configuración tenant obsoleta antes de cualquier write', async () => {
    const client = db();
    client.miDiaTenantConfig.findUnique.mockResolvedValue({ version: 7, enabled_cards: ['CASES'],
      default_layout: [{ key: 'CASES', size: 'S', scope: 'OWN', parameters: {} }], recommended_cards: [] });
    const admin = { ...actor, permissions: [...actor.permissions, 'mi_dia.configure'] };
    await expect(new MiDiaConfigurationService(client as any).updateTenant(admin, {
      version: 6, enabled_cards: ['CASES'], default_layout: [{ key: 'CASES', size: 'S', scope: 'OWN' }],
      fixed_cards: [], recommended_cards: [],
    })).rejects.toMatchObject({ status: 409, code: 'MIDIA_CONFIG_CHANGED' });
    expect(client.miDiaTenantConfig.update).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('deniega usuario ajeno antes de crear permiso y auditoría', async () => {
    const client = db();
    client.organizationMembership.findFirst.mockResolvedValueOnce(null);
    const admin = { ...actor, permissions: [...actor.permissions, 'mi_dia.permissions.manage'] };
    await expect(new MiDiaConfigurationService(client as any).setCardPermission(admin, 'other-tenant-user', {
      card_key: 'CASES', enabled: true, max_scope: 'OWN',
    })).rejects.toMatchObject({ status: 404, code: 'MIDIA_USER_NOT_FOUND' });
    expect(client.miDiaCardPermission.upsert).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });
});
