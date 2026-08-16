import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { getAssistantActions, resolveAssistantContext } from './assistantContext';
import { assistantService, type AssistantService } from './assistant.service';
import type { AssistantConfirmation, AssistantContext, AssistantMessage, AssistantOpenOptions, AssistantReply, AssistantStatus, AssistantSuggestion, AssistantViewState } from './assistant.types';

const SUPPRESSION_KEY = 'pravia.assistant.suppressed-suggestions';
const now = () => new Date().toISOString();
const messageId = () => globalThis.crypto?.randomUUID?.() ?? `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type SuppressedSuggestions = Record<string, number>;
const readSuppressed = (): SuppressedSuggestions => {
  try { return JSON.parse(sessionStorage.getItem(SUPPRESSION_KEY) ?? '{}') as SuppressedSuggestions; } catch { return {}; }
};
const suppressLocally = (id: string, until: number) => {
  const next = { ...readSuppressed(), [id]: until };
  sessionStorage.setItem(SUPPRESSION_KEY, JSON.stringify(next));
};

type AssistantContextValue = {
  isOpen: boolean;
  viewState: AssistantViewState;
  status: AssistantStatus;
  context: AssistantContext;
  messages: AssistantMessage[];
  suggestion: AssistantSuggestion | null;
  selectedSuggestion: AssistantSuggestion | null;
  draft: string;
  processLabel?: string;
  errorMessage?: string;
  confirmation: AssistantConfirmation | null;
  actions: ReturnType<typeof getAssistantActions>;
  openAssistant(options?: AssistantOpenOptions): void;
  closeAssistant(): void;
  setDraft(value: string): void;
  sendMessage(message?: string): Promise<void>;
  retry(): Promise<void>;
  confirmAction(): Promise<void>;
  editConfirmation(): void;
  cancelConfirmation(): void;
  dismissSuggestion(mode?: 'dismiss' | 'snooze'): void;
};

const AssistantContextStore = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children, service = assistantService }: PropsWithChildren<{ service?: AssistantService }>) {
  const location = useLocation();
  const context = useMemo(() => resolveAssistantContext(location), [location.pathname, location.hash]);
  const [isOpen, setOpen] = useState(false);
  const [status, setStatus] = useState<AssistantStatus>('idle');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [suggestion, setSuggestion] = useState<AssistantSuggestion | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<AssistantSuggestion | null>(null);
  const [draft, setDraft] = useState('');
  const [processLabel, setProcessLabel] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [confirmation, setConfirmation] = useState<AssistantConfirmation | null>(null);
  const lastPrompt = useRef('');
  const lastActivator = useRef<HTMLElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const successTimer = useRef<number>();

  useEffect(() => {
    const controller = new AbortController();
    service.getSuggestions(context, controller.signal).then((items) => {
      const suppressed = readSuppressed();
      const timestamp = Date.now();
      setSuggestion(items.find((item) => !suppressed[item.id] || suppressed[item.id] < timestamp) ?? null);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setSuggestion(null);
    });
    return () => controller.abort();
  }, [context, service]);

  useEffect(() => () => {
    activeRequest.current?.abort();
    if (successTimer.current) window.clearTimeout(successTimer.current);
  }, []);

  const applyReply = useCallback((reply: AssistantReply) => {
    setProcessLabel(reply.processLabel);
    setConfirmation(reply.confirmation ?? null);
    const nextStatus = reply.confirmation ? 'confirmation-required' : reply.status;
    setStatus(nextStatus);
    if (reply.message) {
      setMessages((current) => [...current, {
        id: messageId(), role: 'assistant', content: reply.message!, timestamp: now(),
        ...(reply.sources?.length ? { sources: reply.sources } : {}),
        ...(reply.confirmation ? { confirmation: reply.confirmation } : {}),
      }]);
    }
    if (nextStatus === 'success') {
      if (successTimer.current) window.clearTimeout(successTimer.current);
      successTimer.current = window.setTimeout(() => setStatus('idle'), 2200);
    }
  }, []);

  const openAssistant = useCallback((options?: AssistantOpenOptions) => {
    lastActivator.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
    if (options?.prefill) setDraft(options.prefill);
    if (options?.suggestion) {
      const selected = options.suggestion;
      setSelectedSuggestion(selected);
      setSuggestion(null);
      suppressLocally(selected.id, Number.MAX_SAFE_INTEGER);
      setMessages((current) => current.some((item) => item.id === `suggestion-${selected.id}`) ? current : [...current, {
        id: `suggestion-${selected.id}`, role: 'assistant', content: selected.message, timestamp: selected.timestamp,
      }]);
    }
    if (options?.seedMessage) {
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', content: options.seedMessage!.content, timestamp: now(), sources: options.seedMessage!.sources }]);
    }
  }, []);

  const closeAssistant = useCallback(() => {
    setOpen(false);
    activeRequest.current?.abort();
    activeRequest.current = null;
    if (status === 'thinking' || status === 'processing') setStatus('idle');
    window.setTimeout(() => {
      const target = lastActivator.current;
      if (target?.isConnected) target.focus();
      else document.querySelector<HTMLElement>('button[aria-label="Abrir PRAVIA IA"]')?.focus();
    }, 0);
  }, [status]);

  const sendMessage = useCallback(async (value?: string) => {
    const prompt = (value ?? draft).trim();
    if (!prompt || status === 'thinking' || status === 'processing') return;
    lastPrompt.current = prompt;
    setDraft('');
    setErrorMessage(undefined);
    setConfirmation(null);
    setMessages((current) => [...current, { id: messageId(), role: 'user', content: prompt, timestamp: now() }]);
    setStatus('thinking');
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    try {
      const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
      const reply = await service.sendMessage({ message: prompt, context, suggestionId: selectedSuggestion?.id, history }, controller.signal);
      applyReply(reply);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
      setErrorMessage('No pude completar esa consulta.');
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [applyReply, context, draft, messages, selectedSuggestion?.id, service, status]);

  const retry = useCallback(async () => {
    if (lastPrompt.current) await sendMessage(lastPrompt.current);
  }, [sendMessage]);

  const confirmAction = useCallback(async () => {
    if (!confirmation || status === 'processing') return;
    setStatus('processing');
    setProcessLabel('Preparando acción…');
    setErrorMessage(undefined);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      applyReply(await service.confirmAction(confirmation.id, context, controller.signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
      setErrorMessage('No pude completar esa acción.');
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [applyReply, confirmation, context, service, status]);

  const cancelConfirmation = useCallback(() => {
    setConfirmation(null);
    setStatus('idle');
  }, []);

  const editConfirmation = useCallback(() => {
    setConfirmation(null);
    setStatus('idle');
    setDraft('Necesito editar los datos de esta acción.');
  }, []);

  const dismissSuggestion = useCallback((mode: 'dismiss' | 'snooze' = 'dismiss') => {
    if (!suggestion) return;
    const target = suggestion;
    suppressLocally(target.id, mode === 'snooze' ? Date.now() + 60 * 60 * 1000 : Number.MAX_SAFE_INTEGER);
    setSuggestion(null);
    const operation = mode === 'snooze' ? service.snoozeSuggestion(target.id, context) : service.dismissSuggestion(target.id, context);
    operation.catch(() => undefined);
  }, [context, service, suggestion]);

  const value = useMemo<AssistantContextValue>(() => ({
    isOpen, viewState: isOpen ? status : 'closed', status, context, messages, suggestion, selectedSuggestion, draft,
    processLabel, errorMessage, confirmation, actions: getAssistantActions(context), openAssistant, closeAssistant,
    setDraft, sendMessage, retry, confirmAction, editConfirmation, cancelConfirmation, dismissSuggestion,
  }), [isOpen, status, context, messages, suggestion, selectedSuggestion, draft, processLabel, errorMessage, confirmation, openAssistant, closeAssistant, sendMessage, retry, confirmAction, editConfirmation, cancelConfirmation, dismissSuggestion]);

  return <AssistantContextStore.Provider value={value}>{children}</AssistantContextStore.Provider>;
}

export function useAssistant() {
  const value = useContext(AssistantContextStore);
  if (!value) throw new Error('useAssistant debe utilizarse dentro de AssistantProvider.');
  return value;
}
