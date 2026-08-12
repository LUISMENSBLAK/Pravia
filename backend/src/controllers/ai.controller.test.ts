import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auditCreate: vi.fn() }));
vi.mock('../config/prisma', () => ({ default: { auditLog: { create: mocks.auditCreate } } }));
vi.mock('../services/openaiDocument.service', () => ({
  getOpenAIEscalationModelName: () => 'model-escalation',
  getOpenAIModelName: () => 'model-primary',
}));

import { AIController } from './ai.controller';

const response = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('confirmación humana de PRAVIA IA', () => {
  beforeEach(() => mocks.auditCreate.mockReset().mockResolvedValue({ id: 'audit-1' }));

  it('registra la confirmación de una acción preparada sin volver a ejecutarla', async () => {
    const req: any = {
      user: {
        id: 'user-1', sessionId: 'session-1', rol: 'ABOGADO',
        permissions: ['ai.use', 'ai.actions.prepare', 'agenda.write'],
      },
      correlationId: 'corr-confirm',
      body: {
        tool: 'prepareTask', prepared_correlation_id: 'corr-prepared',
        target_endpoint: '/agenda/tareas', result_entity_type: 'Tarea', result_entity_id: 'task-1',
      },
    };
    const res = response();
    await AIController.confirmPreparedAction(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      accion: 'AI_TOOL_CONFIRMED', correlation_id: 'corr-confirm',
      detalles: expect.objectContaining({ prepared_correlation_id: 'corr-prepared', result_entity_id: 'task-1' }),
    }) }));
  });

  it('rechaza confirmar una tool de solo lectura', async () => {
    const req: any = {
      user: { id: 'user-1', sessionId: 'session-1', rol: 'ABOGADO', permissions: ['ai.use', 'ai.expedientes.read', 'expedientes.read'] },
      body: { tool: 'getExpedienteSummary', prepared_correlation_id: 'corr-prepared' },
    };
    const res = response();
    await AIController.confirmPreparedAction(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
