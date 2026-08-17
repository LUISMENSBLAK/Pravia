import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  prospecto: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('../config/prisma', () => ({ default: db }));
vi.mock('../services/objectAccess.service', () => ({ prospectoObjectWhere: vi.fn(() => ({ user_id: 'user-1' })) }));
vi.mock('../utils/auditLogger', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import { createProspecto, getProspectCatalogs, updateProspecto } from './prospectos.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const user = { id: 'user-1', rol: 'ABOGADO', permissions: ['prospectos.read', 'prospectos.write'] };

describe('Prospectos endpoints de catálogo y escritura', () => {
  beforeEach(() => vi.clearAllMocks());

  it('expone una sola lectura con 3 etapas y 38 servicios', async () => {
    const res = response();
    await getProspectCatalogs({} as any, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.stages).toHaveLength(3);
    expect(payload.services).toHaveLength(38);
  });

  it('crea con nombre uppercase, etapa inicial y servicio canónico', async () => {
    db.prospecto.create.mockImplementation(async ({ data }: any) => ({ id: 'prospect-1', ...data }));
    const req: any = { user, body: { nombre: '  josé   ñuñez ', servicio_catalogo_codigo: 'COMPRAVENTA', prioridad: 'ALTA', tiene_predial: false, tiene_antecedente: true } };
    const res = response();
    await createProspecto(req, res);
    expect(db.prospecto.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      nombre: 'JOSÉ ÑUÑEZ', tipo_acto: 'Compraventa', servicio_catalogo_codigo: 'COMPRAVENTA', etapa_operativa_codigo: 'PROSPECTO_RECIBIDO', tiene_predial: false, tiene_antecedente: true,
    }) }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rechaza serviceId inválido sin escribir', async () => {
    const req: any = { user, body: { nombre: 'Persona', servicio_catalogo_codigo: 'INVENTADO' } };
    const res = response();
    await createProspecto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PROSPECT_SERVICE' }));
    expect(db.prospecto.create).not.toHaveBeenCalled();
  });

  it('rechaza stageId inválido sin modificar el registro', async () => {
    const req: any = { user, params: { id: 'prospect-1' }, body: { etapa_operativa_codigo: 'INVENTADA' } };
    const res = response();
    await updateProspecto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PROSPECT_STAGE' }));
    expect(db.prospecto.update).not.toHaveBeenCalled();
  });

  it('preserva servicio legacy cuando una edición no selecciona un reemplazo', async () => {
    db.prospecto.update.mockImplementation(async ({ data }: any) => ({ id: 'prospect-1', tipo_acto: 'General / No Especificado', servicio_catalogo_codigo: null, ...data }));
    const req: any = { user, params: { id: 'prospect-1' }, body: { nombre: ' empresa legacy ', tiene_predial: true } };
    const res = response();
    await updateProspecto(req, res);
    const data = db.prospecto.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ nombre: 'EMPRESA LEGACY', tiene_predial: true });
    expect(data).not.toHaveProperty('tipo_acto');
    expect(data).not.toHaveProperty('servicio_catalogo_codigo');
  });
});
