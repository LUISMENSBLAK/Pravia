import { describe, expect, it } from 'vitest';
import { expedienteAccessWhere, permissionForExpedienteRequest } from './auth.middleware';

const user = (rol: any, id = 'user-1') => ({ id, rol, email: 'a@b.mx', nombre: 'A', apellido: 'B', sessionId: 's', permissions: [], requiresPasswordChange: false });

describe('enrutamiento de capacidades de expediente', () => {
  it('separa entrega, postfirma y edición general', () => {
    expect(permissionForExpedienteRequest('POST', '/exp-1/entrega')).toBe('expedientes.deliver');
    expect(permissionForExpedienteRequest('PATCH', '/exp-1/postfirma/tramites/task-1')).toBe('expedientes.postfirma.manage');
    expect(permissionForExpedienteRequest('PATCH', '/exp-1')).toBe('expedientes.write');
    expect(permissionForExpedienteRequest('POST', '/exp-1/proyecto/upload')).toBe('expedientes.write');
    expect(permissionForExpedienteRequest('POST', '/exp-1/movimientos')).toBe('expedientes.write');
  });

  it('acota recepción a la cola de entrega', () => {
    expect(expedienteAccessWhere(user('RECEPCION') as any)).toEqual({ estatus: { in: ['LISTO_ENTREGA', 'ENTREGADO'] } });
  });

  it('acota gestoría por asignación al expediente o a una tarea activa', () => {
    expect(expedienteAccessWhere(user('GESTORIA') as any)).toEqual({ OR: [
      { gestor_id: 'user-1' },
      { tareas: { some: { asignado_a_id: 'user-1', estatus: { not: 'CANCELADA' } } } },
      { tareas_externas: { some: { gestionado_por_id: 'user-1' } } },
    ] });
  });
});
