import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparecienteService } from './compareciente.service';

const now = new Date('2026-08-12T17:00:00.000Z');
const prisma = {
  compareciente: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  comparecienteDocumento: { findFirst: vi.fn() },
  auditLog: { findMany: vi.fn() },
};

const row = {
  id: 'party-1', tipo_persona: 'FISICA', nombre_busqueda: 'MARIA LOPEZ', estatus: 'ACTIVO', created_at: now, updated_at: now,
  personaFisica: { nombre_completo_calculado: 'María López', rfc: 'LOPM900101AA1', curp: 'LOPM900101MNLYRX08', updated_at: now, pep_estado: 'NO' }, personaMoral: null,
  identificaciones: [{ estatus: 'VIGENTE', validado_at: now, updated_at: now }], datosFuente: [], documentos: [{ updated_at: now, documento: { fecha_carga: now, estatus: 'VIGENTE' } }], expedientes: [],
};

describe('ComparecienteService read model', () => {
  beforeEach(() => { vi.clearAllMocks(); prisma.compareciente.count.mockResolvedValue(0); });

  it('pagina, busca, filtra y ordena del lado servidor con métricas explicables', async () => {
    prisma.compareciente.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.compareciente.findMany.mockResolvedValue([row]);
    const service = new ComparecienteService(prisma as any);
    const result = await service.listarMaster({ search: 'María', tipo_persona: 'FISICA' as any, identidad: 'VERIFICADA', page: 2, limit: 20, sort: 'nombre:asc', accessWhere: { creado_por_id: 'user-1' } });
    expect(prisma.compareciente.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20, orderBy: { nombre_busqueda: 'asc' } }));
    const where = prisma.compareciente.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([expect.objectContaining({ contactos: expect.any(Object) })]));
    expect(where.identificaciones).toEqual(expect.objectContaining({ some: expect.any(Object) }));
    expect(result.data[0]).toMatchObject({ nombre: 'María López', identidad: 'VERIFICADA', documentos: { total: 1, vigentes: 1 }, expedientes_vinculados: 0 });
    expect(result.metrics).toEqual({ total: 1, verified: 1, pending: 0, observed: 0 });
    expect(result.meta).toMatchObject({ page: 2, pageSize: 20, hasPreviousPage: true });
    expect(result.definitions.documents).toContain('no existe catálogo global');
  });

  it('detecta RFC/CURP exactos como bloqueo y coincidencias de contacto como advertencia respetando scope', async () => {
    prisma.compareciente.findMany.mockResolvedValue([{ id: 'party-1', tipo_persona: 'FISICA', nombre_busqueda: 'MARIA LOPEZ', updated_at: now, personaFisica: { nombre_completo_calculado: 'María López', rfc: 'LOPM900101AA1', curp: 'LOPM900101MNLYRX08' }, personaMoral: null, contactos: [{ tipo: 'CORREO', valor: 'maria@example.mx' }] }]);
    const service = new ComparecienteService(prisma as any);
    const matches = await service.buscarDuplicados({ nombre: 'María López', rfc: 'lopm900101aa1', correo: 'maria@example.mx', accessWhere: { creado_por_id: 'user-1' } });
    expect(prisma.compareciente.findMany.mock.calls[0][0].where.AND).toEqual(expect.arrayContaining([{ creado_por_id: 'user-1' }]));
    expect(matches[0]).toMatchObject({ id: 'party-1', bloqueo_alta: true, razones: expect.arrayContaining(['RFC_EXACTO', 'CORREO_EXACTO', 'NOMBRE_SIMILAR']) });
  });

  it('no consulta todo el catálogo cuando no hay criterios de duplicidad', async () => {
    const service = new ComparecienteService(prisma as any);
    await expect(service.buscarDuplicados({})).resolves.toEqual([]);
    expect(prisma.compareciente.findMany).not.toHaveBeenCalled();
  });
});
