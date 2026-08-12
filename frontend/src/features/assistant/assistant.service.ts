import { apiRequest } from '../../services/api/client';
import { apiConfig } from '../../services/api/config';
import type { AssistantContext, AssistantReply, AssistantSuggestion } from './assistant.types';

export class AssistantUnavailableError extends Error {
  constructor() {
    super('PRAVIA IA todavía no está conectada al servicio de respuestas.');
    this.name = 'AssistantUnavailableError';
  }
}

export type SendAssistantInput = { message: string; context: AssistantContext; suggestionId?: string };

export type AssistantService = {
  getSuggestions(context: AssistantContext, signal?: AbortSignal): Promise<AssistantSuggestion[]>;
  sendMessage(input: SendAssistantInput, signal?: AbortSignal): Promise<AssistantReply>;
  confirmAction(confirmationId: string, context: AssistantContext, signal?: AbortSignal): Promise<AssistantReply>;
  dismissSuggestion(suggestionId: string, context: AssistantContext): Promise<void>;
  snoozeSuggestion(suggestionId: string, context: AssistantContext): Promise<void>;
};

const requirePath = (path?: string) => {
  if (!path) throw new AssistantUnavailableError();
  return path;
};

const unwrap = <T>(payload: T | { data: T }): T => (
  payload && typeof payload === 'object' && 'data' in payload ? (payload as { data: T }).data : payload as T
);

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
};
