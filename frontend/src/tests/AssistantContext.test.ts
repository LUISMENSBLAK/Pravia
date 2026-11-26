import { describe, expect, it } from 'vitest';
import { resolveAssistantContext, getAssistantActions } from '../features/assistant/assistantContext';

describe('El chat no inventa un registro actual en las pantallas de alta', () => {
  it.each(['/comparecientes/nuevo', '/predios/nuevo', '/cotizaciones/nueva', '/prospectos/nuevo', '/calculo-isr/nuevo'])('%s sólo contiene contexto del módulo', pathname => {
    const context = resolveAssistantContext({ pathname, hash: '' });
    expect(context.entityId).toBeUndefined(); expect(context.entityType).toBeUndefined();
    expect(Object.values(context)).not.toContain('nuevo');
    expect(getAssistantActions(context).length).toBeGreaterThan(0);
  });
  it('conserva el detalle real y el expediente de origen en una nueva alta', () => {
    expect(resolveAssistantContext({ pathname: '/comparecientes/party-1', hash: '' })).toMatchObject({ entityId: 'party-1', comparecienteId: 'party-1' });
    const create = resolveAssistantContext({ pathname: '/comparecientes/nuevo', hash: '', search: '?expediente_id=exp-1' });
    expect(create.expedienteId).toBe('exp-1'); expect(create.entityId).toBeUndefined();
  });
});
