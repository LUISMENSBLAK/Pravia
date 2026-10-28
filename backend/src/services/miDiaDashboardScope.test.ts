import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { miDiaDashboardScope } from './miDiaDashboardScope';

type Actor = NonNullable<Request['user']>;
const actor = (role: Actor['rol'], scope: Actor['scope']): Actor => ({
  id: '11111111-1111-4111-8111-111111111111', email: 'qa@pravia.test', nombre: 'QA', apellido: 'Local',
  rol: role, scope, organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionId: 'local', permissions: [], requiresPasswordChange: false,
});

describe('Mi Día: límites de fuentes canónicas', () => {
  it('aplica tenant a Expedientes, Finanzas, tareas, Cotizaciones y Agenda aun con alcance global', () => {
    const scope = miDiaDashboardScope(actor('DIRECCION', 'GLOBAL'), '22222222-2222-4222-8222-222222222222');
    expect(scope.caseWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', archived_at: null });
    expect(scope.financialCaseWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', archived_at: null });
    expect(JSON.stringify(scope.taskWhere)).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(scope.eventWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: '22222222-2222-4222-8222-222222222222' });
    expect(scope.quoteWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: '22222222-2222-4222-8222-222222222222' });
    expect(scope.quoteWhere.etapa_contractual).toEqual({ in: ['ENVIADA_CLIENTE', 'EN_SEGUIMIENTO'] });
    expect(JSON.stringify(scope.quoteWhere)).not.toContain('ENVIADA_NOTARIA');
  });

  it('ignora user_id forjado y mantiene límites de objeto para actor asignado', () => {
    const scope = miDiaDashboardScope(actor('ABOGADO', 'ASSIGNED_OBJECTS'), '22222222-2222-4222-8222-222222222222');
    expect(scope.selectedUserId).toBeNull();
    expect(scope.caseWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OR: [
      { abogado_id: '11111111-1111-4111-8111-111111111111' }, { collaborators: { some: { organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: '11111111-1111-4111-8111-111111111111', active: true } } },
    ] });
    expect(JSON.stringify(scope.taskWhere)).toContain('asignado_a_id');
    expect(JSON.stringify(scope.taskWhere)).not.toContain('22222222-2222-4222-8222-222222222222');
    expect(scope.quoteWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: '11111111-1111-4111-8111-111111111111' });
  });

  it('permite lectura financiera del tenant sin conceder lectura general de Expedientes', () => {
    const scope = miDiaDashboardScope(actor('FINANCIERO', 'GLOBAL'));
    expect(scope.caseWhere).toMatchObject({ id: '00000000-0000-0000-0000-000000000000' });
    expect(scope.financialCaseWhere).toEqual({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', archived_at: null });
    expect(scope.eventWhere).toMatchObject({ organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  });

  it('reduce el alcance global a objetos propios por tarjeta sin ampliar el tenant', () => {
    const scope = miDiaDashboardScope(actor('DIRECCION', 'GLOBAL'), '22222222-2222-4222-8222-222222222222', 'OWN');
    expect(scope.selectedUserId).toBeNull();
    expect(scope.caseWhere).toMatchObject({
      organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      OR: [{ abogado_id: '11111111-1111-4111-8111-111111111111' },
        { creador_id: '11111111-1111-4111-8111-111111111111' },
        { gestor_id: '11111111-1111-4111-8111-111111111111' }],
    });
    expect(JSON.stringify(scope.taskWhere)).toContain('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(scope.taskWhere)).not.toContain('22222222-2222-4222-8222-222222222222');
    expect(scope.quoteWhere).toMatchObject({ user_id: '11111111-1111-4111-8111-111111111111' });
    expect(JSON.stringify(scope.eventWhere)).toContain('created_by_id');
    expect(JSON.stringify(scope.eventWhere)).not.toContain('22222222-2222-4222-8222-222222222222');
  });
});
