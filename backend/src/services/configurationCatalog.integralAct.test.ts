import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db: any = {
    tipoActo: { findFirst: vi.fn(), create: vi.fn() },
    configuracionActo: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    configuracionConceptoActividad: { findMany: vi.fn() },
    configuracionEtapa: { create: vi.fn() },
    configuracionActividad: { create: vi.fn() },
    caracterCompareciente: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    tipoActoCaracterCompareciente: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { db };
});
vi.mock('../config/prisma', () => ({ default: mocks.db }));
vi.mock('./supabase.service', () => ({ uploadFile: vi.fn(), deleteFile: vi.fn(), getSignedUrl: vi.fn() }));

import { actsAndTimesService } from './configurationCatalog.service';

const actor = { id: '11111111-1111-4111-8111-111111111111', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'session-1' } as any;
const configured = {
  nombre: 'Compraventa', clasificacion: 'TRASLATIVOS', familia: 'Compraventas', jurisdiccion: 'Nayarit',
  registrable: true, actividad_vulnerable: false,
  processes: [{ code: 'REVISION_INICIAL', duration: 3, dayType: 'HABILES', margin: 0 }, { code: 'FIRMA', duration: 0, dayType: 'NATURALES', margin: 0 }],
  characters: [{ name: 'VENDEDOR', principal: true }, { name: 'COMPRADOR', principal: true }, { name: 'APODERADO', principal: false }],
};

describe('alta integral de actos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (run: any) => run(mocks.db));
    mocks.db.tipoActo.findFirst.mockResolvedValue(null);
    mocks.db.tipoActo.create.mockResolvedValue({ id: 'act-1', organization_id: actor.organizationId, nombre: 'COMPRAVENTA', activo: true });
    mocks.db.configuracionActo.create.mockResolvedValue({ id: 'config-1', clasificacion: 'TRASLATIVOS', familia: 'COMPRAVENTAS', etapas: [] });
    mocks.db.configuracionConceptoActividad.findMany.mockResolvedValue([]);
    mocks.db.configuracionEtapa.create.mockImplementation(async ({ data }: any) => ({ id: `stage-${data.nombre}`, ...data }));
    mocks.db.configuracionActividad.create.mockResolvedValue({ id: 'activity-1' });
    mocks.db.caracterCompareciente.findFirst.mockResolvedValue(null);
    mocks.db.caracterCompareciente.create.mockImplementation(async ({ data }: any) => ({ id: `role-${data.nombre}`, activo: true }));
    mocks.db.tipoActoCaracterCompareciente.create.mockResolvedValue({ id: 'link-1' });
    mocks.db.tipoActoCaracterCompareciente.findFirst.mockResolvedValue(null);
    mocks.db.tipoActoCaracterCompareciente.aggregate.mockResolvedValue({ _max: { orden: 2 } });
    mocks.db.configuracionActo.update.mockResolvedValue({ id: 'config-1' });
    mocks.db.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('expone defaults configurables sin crear actos', async () => {
    const defaults = await actsAndTimesService.creationDefaults(actor);
    expect(defaults.REGISTRABLE.some((item: any) => item.code === 'RPP_INGRESO')).toBe(true);
    expect(defaults.NO_REGISTRABLE.some((item: any) => item.code === 'RPP_INGRESO')).toBe(false);
    expect(mocks.db.tipoActo.create).not.toHaveBeenCalled();
  });

  it('rechaza antes de escribir un acto sin procesos o carácter principal', async () => {
    await expect(actsAndTimesService.create(actor, { ...configured, processes: [] })).rejects.toMatchObject({ code: 'ACT_PROCESSES_REQUIRED' });
    await expect(actsAndTimesService.create(actor, { ...configured, characters: [{ name: 'APODERADO', principal: false }] })).rejects.toMatchObject({ code: 'ACT_MAIN_CHARACTER_REQUIRED' });
    expect(mocks.db.tipoActo.create).not.toHaveBeenCalled();
  });

  it('guarda metadatos, procesos y caracteres en una sola transacción del acto', async () => {
    const result = await actsAndTimesService.create(actor, configured);
    expect(result.complete).toBe(true);
    expect(mocks.db.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.db.configuracionActo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      jurisdiccion: 'NAYARIT', registrable: true, actividad_vulnerable: false, requiere_revision: false,
    }) }));
    expect(mocks.db.configuracionEtapa.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.configuracionActividad.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.tipoActoCaracterCompareciente.create).toHaveBeenCalledTimes(3);
    expect(mocks.db.tipoActoCaracterCompareciente.create).toHaveBeenCalledWith({ data: { tipo_acto_id: 'act-1', caracter_id: 'role-APODERADO', sugerido: false, orden: 3 } });
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_ACT_CREATED', organization_id: actor.organizationId }) });
  });

  it('agrega un carácter al acto existente con aislamiento, orden y auditoría', async () => {
    mocks.db.tipoActo.findFirst.mockResolvedValue({ id: 'act-1' });
    mocks.db.configuracionActo.findFirst.mockResolvedValue({ id: 'config-1' });
    const get = vi.spyOn(actsAndTimesService, 'get').mockResolvedValue({ id: 'act-1' } as any);
    try {
      await actsAndTimesService.addCharacter(actor, 'act-1', { name: 'Adquirente', principal: true });
      expect(mocks.db.tipoActo.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ organization_id: actor.organizationId }, { organization_id: null }] }) }));
      expect(mocks.db.tipoActoCaracterCompareciente.create).toHaveBeenCalledWith({ data: { tipo_acto_id: 'act-1', caracter_id: 'role-ADQUIRENTE', sugerido: true, orden: 3 } });
      expect(mocks.db.configuracionActo.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requiere_revision: true }) }));
      expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_ACT_CHARACTER_ADDED', organization_id: actor.organizationId }) });
      mocks.db.tipoActoCaracterCompareciente.findFirst.mockResolvedValueOnce({ id: 'link-1' });
      await expect(actsAndTimesService.addCharacter(actor, 'act-1', { name: 'Adquirente', principal: true })).rejects.toMatchObject({ status: 409, code: 'ACT_CHARACTER_DUPLICATE' });
    } finally { get.mockRestore(); }
  });

  it('impide agregar caracteres a un acto de otra organización', async () => {
    mocks.db.tipoActo.findFirst.mockResolvedValue(null);
    await expect(actsAndTimesService.addCharacter(actor, 'foreign-act', { name: 'Adquirente', principal: true })).rejects.toMatchObject({ status: 404, code: 'ACT_NOT_FOUND' });
    expect(mocks.db.tipoActoCaracterCompareciente.create).not.toHaveBeenCalled();
  });
});
