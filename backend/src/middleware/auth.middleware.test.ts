import { describe, expect, it, vi } from 'vitest';
import { authorizeCotizacionRequest, authorizeExpedienteRequest, expedienteAccessWhere, expedienteReadWhere, permissionForExpedienteRequest } from './auth.middleware';

const user = (rol: any, id = 'user-1') => ({ id, rol, email: 'a@b.mx', nombre: 'A', apellido: 'B', sessionId: 's', permissions: [], requiresPasswordChange: false });

describe('enrutamiento de capacidades de expediente', () => {
  it('separa entrega, postfirma y edición general', () => {
    expect(permissionForExpedienteRequest('POST', '/exp-1/entrega')).toBe('expedientes.deliver');
    expect(permissionForExpedienteRequest('PATCH', '/exp-1/postfirma/tramites/task-1')).toBe('expedientes.postfirma.manage');
    expect(permissionForExpedienteRequest('PATCH', '/exp-1')).toBe('expedientes.write');
    expect(permissionForExpedienteRequest('POST', '/exp-1/proyecto/upload')).toBe('expedientes.write');
    expect(permissionForExpedienteRequest('POST', '/exp-1/movimientos')).toBe('expedientes.write');
    expect(permissionForExpedienteRequest('GET', '/exp-1/finanzas-operativas')).toBe('expedientes.read');
    expect(permissionForExpedienteRequest('POST', '/exp-1/presupuesto/vista-previa')).toBe('expedientes.read');
    expect(permissionForExpedienteRequest('POST', '/exp-1/finanzas-operativas/ingresos')).toBe('expedientes.write');
  });

  it('trata únicamente la vista previa de Cotización como POST de lectura', () => {
    const next = vi.fn(); const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const base = { user: { permissions: ['cotizaciones.read'] } };
    authorizeCotizacionRequest({ ...base, method: 'POST', path: '/quote-1/presupuesto/vista-previa' } as any, res, next);
    expect(next).toHaveBeenCalledOnce();
    authorizeCotizacionRequest({ ...base, method: 'PUT', path: '/quote-1/presupuesto' } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('permite la ruta financiera a Contabilidad sin conceder edición jurídica', () => {
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    authorizeExpedienteRequest({ method: 'POST', path: '/exp-1/finanzas-operativas/ingresos', user: {
      rol: 'FINANCIERO', permissions: ['finanzas.write', 'expedientes.read'],
    } } as any, res, next);
    expect(next).toHaveBeenCalledOnce();
    authorizeExpedienteRequest({ method: 'PATCH', path: '/exp-1', user: {
      rol: 'FINANCIERO', permissions: ['finanzas.write', 'expedientes.read'],
    } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('acota recepción a la cola de entrega', () => {
    expect(expedienteAccessWhere(user('RECEPCION') as any)).toEqual({ estatus: { in: ['LISTO_ENTREGA', 'ENTREGADO'] } });
  });

  it('acota gestoría por asignación al expediente o a una tarea activa', () => {
    expect(expedienteAccessWhere({ ...user('GESTORIA'), organizationId: 'org-1' } as any)).toEqual({ OR: [
      { gestor_id: 'user-1' },
      { tareas: { some: { asignado_a_id: 'user-1', estatus: { not: 'CANCELADA' } } } },
      { tareas_externas: { some: { gestionado_por_id: 'user-1' } } },
      { collaborators: { some: { organization_id: 'org-1', user_id: 'user-1', active: true } } },
    ] });
  });

  it('lee por organización pero sólo permite editar al responsable, no al creador anterior', () => {
    const actor = { ...user('ABOGADO'), organizationId: 'org-1' } as any;
    expect(expedienteReadWhere(actor)).toEqual({ organization_id: 'org-1', archived_at: null });
    expect(expedienteAccessWhere(actor)).toEqual({ OR: [
      { abogado_id: 'user-1' },
      { collaborators: { some: { organization_id: 'org-1', user_id: 'user-1', active: true } } },
    ] });
  });
});
