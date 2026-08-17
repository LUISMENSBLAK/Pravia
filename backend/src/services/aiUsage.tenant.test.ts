import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), upsert: vi.fn() }));
vi.mock('../config/prisma', () => ({ default: { aIUsageLog: { create: mocks.create, upsert: mocks.upsert } } }));

import { runWithActorContext } from '../auth/actorContext';
import { recordAIUsage } from './aiUsage.service';

const actor = {
  userId: 'user-a', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'membership-a',
  role: 'DIRECCION' as const, permissions: [], scope: 'GLOBAL' as const, sessionId: 'session-a',
};
const metrics = {
  modelo: 'gpt-test', input_tokens: 10, cached_input_tokens: 2, output_tokens: 4, reasoning_tokens: 1,
  total_tokens: 15, duracion_ms: 25, costo_estimado_usd: 0.001, documentos_enviados: 1,
  escalamiento_utilizado: false, precios_version: 'provider-usage-only:test',
};

describe('ledger IA tenant-aware', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.upsert.mockResolvedValue({}); });

  it('registra organización, usuario, conversación y operación idempotente en el ledger canónico', async () => {
    await runWithActorContext(actor, () => recordAIUsage(metrics as any, {
      operacion: 'ASSISTANT_CHAT', usuarioId: 'user-a', assistantConversationId: 'conversation-a', operationId: 'provider-call-a',
    }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operation_id: 'provider-call-a' },
      create: expect.objectContaining({ organization_id: actor.organizationId, usuario_id: 'user-a', assistant_conversation_id: 'conversation-a', costo_estimado_usd: null }),
      update: {},
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('falla cerrado sin ActorContext cuando no se proporciona una organización interna explícita', async () => {
    await expect(recordAIUsage(metrics as any, { operacion: 'ASSISTANT_CHAT' }))
      .rejects.toMatchObject({ code: 'TENANT_CONTEXT_REQUIRED' });
  });
});
