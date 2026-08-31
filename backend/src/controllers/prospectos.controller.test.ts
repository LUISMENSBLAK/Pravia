import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  prospecto: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  prospectoTransicion: { create: vi.fn() }, $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn(),
  auditLog: { create: vi.fn() },
}));
vi.mock('../config/prisma', () => ({ default: db }));
vi.mock('../services/objectAccess.service', () => ({ prospectoObjectWhere: vi.fn(() => ({ user_id: 'user-1' })) }));
vi.mock('../utils/auditLogger', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import { createProspecto, getProspectCatalogs, getProspectos, updateProspecto } from './prospectos.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const user = { id: 'user-1', organizationId: 'org-1', rol: 'ABOGADO', permissions: ['prospectos.read', 'prospectos.write'] };

describe('Prospectos endpoints de catálogo y escritura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation((fn) => fn(db));
    db.$executeRaw.mockResolvedValue(1); db.$queryRaw.mockResolvedValue([]);
    db.prospectoTransicion.create.mockImplementation(async ({data}) => ({id:'event-1',...data}));
    db.prospecto.findFirst.mockImplementation(async ({where}) => where.creation_key ? null : ({id:'prospect-1',user_id:user.id,organization_id:user.organizationId,version_operativa:0,etapa_contractual:null}));
  });

  it('expone una sola lectura con 3 etapas y 38 servicios', async () => {
    const res = response();
    await getProspectCatalogs({} as any, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.stages).toHaveLength(3);
    expect(payload.services).toHaveLength(38);
  });

  it('crea con nombre uppercase, etapa inicial y servicio canónico', async () => {
    db.prospecto.create.mockImplementation(async ({ data }: any) => ({ id: 'prospect-1', etapa_contractual:null, version_operativa:0, ...data }));
    const req: any = { user, get: () => 'test-create-key', body: { nombre: '  josé   ñuñez ', servicio_catalogo_codigo: 'COMPRAVENTA', prioridad: 'ALTA', tiene_predial: false, tiene_antecedente: true } };
    const res = response();
    await createProspecto(req, res);
    expect(db.prospecto.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      nombre: 'JOSÉ ÑUÑEZ', tipo_acto: 'Compraventa', servicio_catalogo_codigo: 'COMPRAVENTA', estado: 'NUEVO', tiene_predial: false, tiene_antecedente: true,
    }) }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(db.prospectoTransicion.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({etapa_nueva:'NUEVO',accion:'CREAR'})}));
  });

  it('rechaza serviceId inválido sin escribir', async () => {
    const req: any = { user, get: () => 'test-create-key', body: { nombre: 'Persona', servicio_catalogo_codigo: 'INVENTADO' } };
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
    const req: any = { user, params: { id: 'prospect-1' }, body: { nombre: ' empresa legacy ', tiene_predial: true, expectedVersion:0 } };
    const res = response();
    await updateProspecto(req, res);
    const data = db.prospecto.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ nombre: 'EMPRESA LEGACY', tiene_predial: true });
    expect(data).not.toHaveProperty('tipo_acto');
    expect(data).not.toHaveProperty('servicio_catalogo_codigo');
  });

  it('deriva el pipeline desde la etapa contractual y usa subestado solo para legacy desconocido', async () => {
    db.prospecto.findMany.mockResolvedValue([]);
    db.prospecto.count.mockResolvedValue(0);
    const req: any = { user, query: { page: '1', pipeline: 'quote', summary: 'false' } };
    const res = response();
    await getProspectos(req, res);
    const where = db.prospecto.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ OR: [
      { etapa_contractual: { in: ['COTIZACION_RECIBIDA'] } },
      { etapa_contractual: null, estado: { in: ['COTIZACION_SOLICITADA', 'COTIZACION_ENVIADA'] } },
    ] });
  });

  it('calcula convertidos y activos desde la etapa canónica con fallback legacy explícito', async () => {
    db.prospecto.findMany.mockResolvedValue([]);
    db.prospecto.groupBy.mockResolvedValue([]);
    db.prospecto.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);
    const req: any = { user, query: { page: '1' } };
    const res = response();
    await getProspectos(req, res);
    expect(res.json.mock.calls[0][0].meta.metrics).toEqual({ withQuote: 1, accepted: 1, active: 3 });
    expect(db.prospecto.count.mock.calls[2][0].where).toEqual(expect.objectContaining({ AND: expect.arrayContaining([
      expect.objectContaining({ OR: expect.arrayContaining([{ etapa_contractual: 'CONVERTIDO_COTIZACION' }]) }),
    ]) }));
  });
});
