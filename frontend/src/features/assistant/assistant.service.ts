import { apiRequest } from '../../services/api/client';
import { apiConfig } from '../../services/api/config';
import type {
  AssistantAttachment,
  AssistantContext,
  AssistantConversation,
  AssistantConversationDetail,
  AssistantConversationStatus,
  AssistantReply,
  AssistantSuggestion,
} from './assistant.types';

export class AssistantUnavailableError extends Error {
  constructor() {
    super('PRAVIA IA todavía no está conectada al servicio de respuestas.');
    this.name = 'AssistantUnavailableError';
  }
}

export type SendAssistantInput = {
  message: string;
  context: AssistantContext;
  suggestionId?: string;
  conversationId?: string;
  clientMessageId?: string;
  attachmentIds?: string[];
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export type AssistantService = {
  getSuggestions(context: AssistantContext, signal?: AbortSignal): Promise<AssistantSuggestion[]>;
  sendMessage(input: SendAssistantInput, signal?: AbortSignal): Promise<AssistantReply>;
  confirmAction(confirmationId: string, context: AssistantContext, signal?: AbortSignal): Promise<AssistantReply>;
  dismissSuggestion(suggestionId: string, context: AssistantContext): Promise<void>;
  snoozeSuggestion(suggestionId: string, context: AssistantContext): Promise<void>;
  createConversation(context: AssistantContext): Promise<AssistantConversation>;
  listConversations(status?: AssistantConversationStatus): Promise<AssistantConversation[]>;
  getConversation(id: string): Promise<AssistantConversationDetail>;
  renameConversation(id: string, title: string): Promise<AssistantConversation>;
  archiveConversation(id: string): Promise<AssistantConversation>;
  trashConversation(id: string): Promise<AssistantConversation>;
  restoreConversation(id: string): Promise<AssistantConversation>;
  uploadAttachment(conversationId: string, file: File, signal?: AbortSignal): Promise<AssistantAttachment>;
  archiveAttachment(conversationId: string, attachmentId: string): Promise<AssistantAttachment>;
  transcribeAttachment(conversationId: string, attachmentId: string, signal?: AbortSignal): Promise<{ attachmentId: string; transcript: string }>;
};

const requirePath = (path?: string) => {
  if (!path) throw new AssistantUnavailableError();
  return path;
};

const unwrap = <T>(payload: T | { data: T }): T => (
  payload && typeof payload === 'object' && 'data' in payload ? (payload as { data: T }).data : payload as T
);

const conversationsPath = () => requirePath(apiConfig.assistantConversationsPath);
const conversationPath = (id: string, suffix = '') => `${conversationsPath()}/${encodeURIComponent(id)}${suffix}`;

const suggestionQuery = (path: string, context: AssistantContext) => {
  const params = new URLSearchParams({ route: context.route, module: context.module });
  if (context.entityType) params.set('entityType', context.entityType);
  if (context.entityId) params.set('entityId', context.entityId);
  if (context.subview) params.set('subview', context.subview);
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;
};

export const assistantService: AssistantService = {
  async getSuggestions(context, signal) {
    if (!apiConfig.assistantSuggestionsPath) return [];
    const payload = await apiRequest<AssistantSuggestion[] | { data: AssistantSuggestion[] }>(suggestionQuery(apiConfig.assistantSuggestionsPath, context), { signal });
    const result = unwrap(payload);
    return Array.isArray(result) ? result : [];
  },
  async sendMessage(input, signal) {
    const payload = await apiRequest<AssistantReply | { data: AssistantReply }>(requirePath(apiConfig.assistantMessagePath), {
      method: 'POST', signal, body: JSON.stringify(input),
    });
    return unwrap(payload);
  },
  async confirmAction(confirmationId, context, signal) {
    const payload = await apiRequest<AssistantReply | { data: AssistantReply }>(requirePath(apiConfig.assistantConfirmPath), {
      method: 'POST', signal, body: JSON.stringify({ confirmationId, context }),
    });
    return unwrap(payload);
  },
  async dismissSuggestion(suggestionId, context) {
    if (!apiConfig.assistantDismissPath) return;
    await apiRequest(apiConfig.assistantDismissPath, { method: 'POST', body: JSON.stringify({ suggestionId, context }) });
  },
  async snoozeSuggestion(suggestionId, context) {
    if (!apiConfig.assistantSnoozePath) return;
    await apiRequest(apiConfig.assistantSnoozePath, { method: 'POST', body: JSON.stringify({ suggestionId, context }) });
  },
  async createConversation(context) {
    return unwrap(await apiRequest<AssistantConversation | { data: AssistantConversation }>(conversationsPath(), {
      method: 'POST', body: JSON.stringify({ context }),
    }));
  },
  async listConversations(status = 'ACTIVE') {
    const payload = await apiRequest<AssistantConversation[] | { data: AssistantConversation[] }>(`${conversationsPath()}?status=${encodeURIComponent(status)}`);
    const result = unwrap(payload);
    return Array.isArray(result) ? result : [];
  },
  async getConversation(id) {
    return unwrap(await apiRequest<AssistantConversationDetail | { data: AssistantConversationDetail }>(conversationPath(id)));
  },
  async renameConversation(id, title) {
    return unwrap(await apiRequest<AssistantConversation | { data: AssistantConversation }>(conversationPath(id), {
      method: 'PATCH', body: JSON.stringify({ title }),
    }));
  },
  async archiveConversation(id) {
    return unwrap(await apiRequest<AssistantConversation | { data: AssistantConversation }>(conversationPath(id, '/archive'), { method: 'POST' }));
  },
  async trashConversation(id) {
    return unwrap(await apiRequest<AssistantConversation | { data: AssistantConversation }>(conversationPath(id, '/trash'), { method: 'POST' }));
  },
  async restoreConversation(id) {
    return unwrap(await apiRequest<AssistantConversation | { data: AssistantConversation }>(conversationPath(id, '/restore'), { method: 'POST' }));
  },
  async uploadAttachment(conversationId, file, signal) {
    const form = new FormData();
    form.append('file', file);
    return unwrap(await apiRequest<AssistantAttachment | { data: AssistantAttachment }>(conversationPath(conversationId, '/attachments'), {
      method: 'POST', body: form, signal,
    }));
  },
  async archiveAttachment(conversationId, attachmentId) {
    return unwrap(await apiRequest<AssistantAttachment | { data: AssistantAttachment }>(conversationPath(conversationId, `/attachments/${encodeURIComponent(attachmentId)}/archive`), { method: 'POST' }));
  },
  async transcribeAttachment(conversationId, attachmentId, signal) {
    return unwrap(await apiRequest<{ attachmentId: string; transcript: string } | { data: { attachmentId: string; transcript: string } }>(conversationPath(conversationId, `/attachments/${encodeURIComponent(attachmentId)}/transcribe`), { method: 'POST', signal }));
  },
};
