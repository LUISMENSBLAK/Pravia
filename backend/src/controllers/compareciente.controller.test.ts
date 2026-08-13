import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ buscarDuplicados: vi.fn(), listarMaster: vi.fn(), obtenerPorId: vi.fn() }));
vi.mock('../services/compareciente.service', () => ({ ComparecienteService: class { buscarDuplicados = service.buscarDuplicados; listarMaster = service.listarMaster; obtenerPorId = service.obtenerPorId; } }));
vi.mock('../config/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('../services/objectAccess.service', () => ({ comparecienteObjectWhere: vi.fn(() => ({ creado_por_id: 'user-1' })) }));
import { ComparecienteController } from './compareciente.controller';

const response = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const user = { id: 'user-1', rol: 'ABOGADO', permissions: ['comparecientes.read'] };

describe('ComparecienteController endpoints', () => {
  beforeEach(() => vi.clearAllMocks());
  it('propaga paginación, búsqueda, filtros, sort y object scope', async () => { service.listarMaster.mockResolvedValue({ data: [], metrics: {}, meta: {} }); const req: any = { query: { search: 'López', tipo_persona: 'FISICA', identidad: 'PENDIENTE', cumplimiento: 'NO_CONFIGURADO', actualizacion: '30_DIAS', sort: 'nombre:asc', page: '2', pageSize: '20' }, user }; const res = response(); await ComparecienteController.listarMaster(req,res); expect(service.listarMaster).toHaveBeenCalledWith(expect.objectContaining({ search:'López', tipo_persona:'FISICA', identidad:'PENDIENTE', cumplimiento:'NO_CONFIGURADO', actualizacion:'30_DIAS', sort:'nombre:asc', page:2, limit:20, accessWhere:{creado_por_id:'user-1'} })); expect(res.status).toHaveBeenCalledWith(200); });
  it('busca duplicados sin escapar del scope visible', async () => { service.buscarDuplicados.mockResolvedValue([]); const req: any = { query: { rfc:'ABC010203AA1', correo:'persona@example.mx', telefono:'3111234567' }, user }; const res=response(); await ComparecienteController.buscarDuplicados(req,res); expect(service.buscarDuplicados).toHaveBeenCalledWith(expect.objectContaining({ rfc:'ABC010203AA1', correo:'persona@example.mx', telefono:'3111234567', accessWhere:{creado_por_id:'user-1'} })); });
  it('oculta snapshots de cumplimiento cuando falta permiso específico', async () => { service.obtenerPorId.mockResolvedValue({ cumplimiento:'COMPLETO', health:[{key:'CUMPLIMIENTO',state:'COMPLETO'}], complianceSnapshots:[{id:'review-1'}], expedientes:[{expediente:{complianceReviews:[{id:'review-1'}]}}] }); const req:any={params:{id:'party-1'},user}; const res=response(); await ComparecienteController.obtenerPorId(req,res); const payload=res.json.mock.calls[0][0]; expect(payload.data).toMatchObject({ cumplimiento:'NO_CONFIGURADO', complianceSnapshots:[], health:[{key:'CUMPLIMIENTO',state:'NO_CONFIGURADO'}] }); expect(payload.data.expedientes[0].expediente.complianceReviews).toEqual([]); });
});
