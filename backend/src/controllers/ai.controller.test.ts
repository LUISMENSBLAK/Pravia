import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(), assistantMessageFind: vi.fn(), sendAssistantMessage: vi.fn(), preferenceFind: vi.fn(), recordAIUsages: vi.fn(), recordAIFailure: vi.fn(),
  confirmAssistantAction: vi.fn(), cancelAssistantConfirmation: vi.fn(),
  conversation: {
    ensureActive: vi.fn(), addUserMessage: vi.fn(), linkAttachmentsToMessage: vi.fn(), history: vi.fn(), actionState: vi.fn(), addAssistantMessage: vi.fn(), refreshExtractiveSummary: vi.fn(),
  },
  attachmentContext: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: { auditLog: { create: mocks.auditCreate }, assistantMessage: { findFirst: mocks.assistantMessageFind }, userPreference: { findUnique: mocks.preferenceFind } } }));
vi.mock('../services/openaiDocument.service', () => ({
  getOpenAIAssistantModelName: () => 'model-assistant',
  getOpenAIEscalationModelName: () => 'model-escalation',
  getOpenAIModelName: () => 'model-primary',
}));
vi.mock('../services/assistantChat.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/assistantChat.service')>();
  return { ...original, sendAssistantMessage: mocks.sendAssistantMessage };
});
vi.mock('../services/assistantConversation.service', () => ({
  AssistantConversationError: class AssistantConversationError extends Error {},
  assistantConversationService: mocks.conversation,
}));
vi.mock('../services/assistantAttachmentContext.service', () => ({ prepareAssistantAttachmentContext: mocks.attachmentContext }));
vi.mock('../services/aiUsage.service', () => ({ recordAIUsages: mocks.recordAIUsages, recordAIFailure: mocks.recordAIFailure }));
vi.mock('../services/assistantActions.service', () => ({
  AssistantActionError: class AssistantActionError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); } },
  assistantActionCatalog: vi.fn(() => []),
  prepareOrExecuteAssistantAction: vi.fn(),
  cancelPendingAssistantAction: vi.fn(),
  confirmAssistantAction: mocks.confirmAssistantAction,
  cancelAssistantConfirmation: mocks.cancelAssistantConfirmation,
}));

import { AIController } from './ai.controller';

const response = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('confirmación humana de PRAVIA IA', () => {
  beforeEach(() => {
    mocks.auditCreate.mockReset().mockResolvedValue({ id: 'audit-1' });
    mocks.assistantMessageFind.mockReset().mockResolvedValue(null);
    mocks.sendAssistantMessage.mockReset();
    mocks.preferenceFind.mockReset().mockResolvedValue({ timezone: 'America/Bahia_Banderas' });
    mocks.conversation.ensureActive.mockReset().mockResolvedValue({ id: 'conversation-1' });
    mocks.conversation.addUserMessage.mockReset().mockResolvedValue({ message: { id: 'message-user', created_at: new Date() }, duplicate: false });
    mocks.conversation.linkAttachmentsToMessage.mockReset().mockResolvedValue([]);
    mocks.conversation.history.mockReset().mockResolvedValue({ messages: [{ role: 'assistant', content: 'Respuesta persistida' }], summary: 'Resumen anterior' });
    mocks.conversation.actionState.mockReset().mockResolvedValue(undefined);
    mocks.conversation.addAssistantMessage.mockReset().mockResolvedValue({ id: 'message-assistant' });
    mocks.conversation.refreshExtractiveSummary.mockReset().mockResolvedValue(undefined);
    mocks.attachmentContext.mockReset().mockResolvedValue({ usages: [], context: undefined });
    mocks.recordAIUsages.mockReset().mockResolvedValue(undefined);
    mocks.recordAIFailure.mockReset().mockResolvedValue(undefined);
    mocks.confirmAssistantAction.mockReset().mockResolvedValue({ status: 'success', message: 'El evento quedó cancelado.', refresh: 'agenda' });
    mocks.cancelAssistantConfirmation.mockReset().mockResolvedValue(undefined);
  });

  it('rechaza una consulta conversacional sin usuario autenticado', async () => {
    const res = response();
    await AIController.message({ body: { message: 'Muéstrame mis pendientes' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.sendAssistantMessage).not.toHaveBeenCalled();
  });

  it('devuelve la respuesta conversacional estructurada sin modificarla', async () => {
    const reply = { status: 'success', message: 'Tienes dos pendientes.' };
    mocks.sendAssistantMessage.mockResolvedValue(reply);
    const req: any = { user: { id: 'user-1' }, correlationId: 'corr-message', body: { message: 'Pendientes', context: { module: 'mi-dia' }, history: [{ role: 'assistant', content: 'Respuesta anterior' }] } };
    const res = response();
    await AIController.message(req, res);
    expect(mocks.sendAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Pendientes', history: [{ role: 'assistant', content: 'Respuesta persistida' }], historySummary: 'Resumen anterior', timezone: 'America/Bahia_Banderas',
    }), req.user, 'corr-message');
    expect(res.json).toHaveBeenCalledWith({ ...reply, conversationId: 'conversation-1', messageId: 'message-assistant' });
  });

  it('un retry idempotente reutiliza la respuesta persistida sin nueva llamada ni usage duplicado', async () => {
    mocks.conversation.addUserMessage.mockResolvedValue({ message: { id: 'message-user' }, duplicate: true });
    mocks.assistantMessageFind.mockResolvedValue({ id: 'message-assistant-existing', content: 'Respuesta ya calculada', sources: [{ label: 'Expedientes' }] });
    const req: any = { user: { id: 'user-1', organizationId: 'org-a' }, correlationId: 'corr-retry', body: {
      message: 'Pendientes', conversationId: 'conversation-1', clientMessageId: 'client-message-1', attachmentIds: ['attachment-1'],
    } };
    const res = response();
    await AIController.message(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true, messageId: 'message-assistant-existing' }));
    expect(mocks.sendAssistantMessage).not.toHaveBeenCalled();
    expect(mocks.attachmentContext).not.toHaveBeenCalled();
    expect(mocks.recordAIUsages).not.toHaveBeenCalled();
  });

  it('ejecuta la acción preparada mediante su confirmación persistida', async () => {
    const req: any = {
      user: {
        id: 'user-1', sessionId: 'session-1', rol: 'ABOGADO',
        permissions: ['ai.use', 'ai.actions.prepare', 'agenda.write'],
      },
      correlationId: 'corr-confirm',
      body: {
        conversationId: 'conversation-1', confirmationId: 'confirmation-1',
      },
    };
    const res = response();
    await AIController.confirmPreparedAction(req, res);
    expect(mocks.confirmAssistantAction).toHaveBeenCalledWith(expect.objectContaining({ actor: req.user, conversationId: 'conversation-1', confirmationId: 'confirmation-1', correlationId: 'corr-confirm' }));
    expect(mocks.conversation.addAssistantMessage).toHaveBeenCalledWith(req.user, 'conversation-1', expect.objectContaining({ content: 'El evento quedó cancelado.' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', refresh: 'agenda', conversationId: 'conversation-1', messageId: 'message-assistant' }));
  });

  it('rechaza una confirmación sin referencias persistidas', async () => {
    const req: any = {
      user: { id: 'user-1', sessionId: 'session-1', rol: 'ABOGADO', permissions: ['ai.use'] },
      body: {},
    };
    const res = response();
    await AIController.confirmPreparedAction(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.confirmAssistantAction).not.toHaveBeenCalled();
  });
});
