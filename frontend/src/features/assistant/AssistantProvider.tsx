import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { getAssistantActions, resolveAssistantContext } from './assistantContext';
import { assistantService, type AssistantService } from './assistant.service';
import type {
  AssistantAttachment, AssistantConfirmation, AssistantContext, AssistantConversation, AssistantConversationDetail,
  AssistantConversationStatus, AssistantMessage, AssistantOpenOptions, AssistantReply, AssistantStatus,
  AssistantSuggestion, AssistantViewState,
} from './assistant.types';

const SUPPRESSION_KEY = 'pravia.assistant.suppressed-suggestions';
const now = () => new Date().toISOString();
const messageId = () => globalThis.crypto?.randomUUID?.() ?? `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type SuppressedSuggestions = Record<string, number>;
const readSuppressed = (): SuppressedSuggestions => { try { return JSON.parse(sessionStorage.getItem(SUPPRESSION_KEY) ?? '{}') as SuppressedSuggestions; } catch { return {}; } };
const suppressLocally = (id: string, until: number) => sessionStorage.setItem(SUPPRESSION_KEY, JSON.stringify({ ...readSuppressed(), [id]: until }));

type AssistantContextValue = {
  isOpen: boolean; viewState: AssistantViewState; status: AssistantStatus; context: AssistantContext; messages: AssistantMessage[];
  suggestion: AssistantSuggestion | null; selectedSuggestion: AssistantSuggestion | null; draft: string; processLabel?: string;
  errorMessage?: string; confirmation: AssistantConfirmation | null; actions: ReturnType<typeof getAssistantActions>;
  conversations: AssistantConversation[]; conversationScope: AssistantConversationStatus; activeConversationId?: string;
  pendingAttachments: AssistantAttachment[]; historyOpen: boolean; historyLoading: boolean; recording: boolean;
  openAssistant(options?: AssistantOpenOptions): void; closeAssistant(): void; setDraft(value: string): void;
  sendMessage(message?: string): Promise<void>; retry(): Promise<void>; confirmAction(): Promise<void>; editConfirmation(): void;
  cancelConfirmation(): void; dismissSuggestion(mode?: 'dismiss' | 'snooze'): void; setHistoryOpen(open: boolean): void;
  loadConversations(scope?: AssistantConversationStatus): Promise<void>; selectConversation(id: string): Promise<void>; newConversation(): void;
  renameConversation(id: string, title: string): Promise<void>; archiveConversation(id: string): Promise<void>;
  trashConversation(id: string): Promise<void>; restoreConversation(id: string): Promise<void>;
  uploadAttachment(file: File): Promise<void>; removeAttachment(id: string): Promise<void>; transcribeAudio(file: File): Promise<void>;
  setRecording(value: boolean): void; reportError(message: string): void;
};

type Submission = { prompt: string; conversationId: string; clientMessageId: string; attachmentIds: string[]; history: Array<{ role: 'user' | 'assistant'; content: string }> };
const AssistantContextStore = createContext<AssistantContextValue | null>(null);

function mapConversationMessages(detail: AssistantConversationDetail): AssistantMessage[] {
  return detail.messages.map((item) => ({ id: item.id, role: item.role === 'ASSISTANT' ? 'assistant' : 'user', content: item.content,
    timestamp: item.created_at, sources: item.sources || undefined, attachments: item.attachments || [] }));
}

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
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [conversationScope, setConversationScope] = useState<AssistantConversationStatus>('ACTIVE');
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [pendingAttachments, setPendingAttachments] = useState<AssistantAttachment[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const lastSubmission = useRef<Submission>();
  const lastActivator = useRef<HTMLElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const successTimer = useRef<number>();

  useEffect(() => {
    const controller = new AbortController();
    service.getSuggestions(context, controller.signal).then((items) => {
      const suppressed = readSuppressed(); const timestamp = Date.now();
      setSuggestion(items.find((item) => !suppressed[item.id] || suppressed[item.id] < timestamp) ?? null);
    }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setSuggestion(null); });
    return () => controller.abort();
  }, [context, service]);

  useEffect(() => () => { activeRequest.current?.abort(); if (successTimer.current) window.clearTimeout(successTimer.current); }, []);

  const applyReply = useCallback((reply: AssistantReply) => {
    setProcessLabel(reply.processLabel); setConfirmation(reply.confirmation ?? null);
    const nextStatus = reply.confirmation ? 'confirmation-required' : reply.status;
    setStatus(nextStatus); if (reply.conversationId) setActiveConversationId(reply.conversationId);
    if (reply.message) setMessages((current) => [...current, { id: reply.messageId || messageId(), role: 'assistant', content: reply.message!, timestamp: now(),
      ...(reply.sources?.length ? { sources: reply.sources } : {}), ...(reply.confirmation ? { confirmation: reply.confirmation } : {}) }]);
    if (nextStatus === 'success') { if (successTimer.current) window.clearTimeout(successTimer.current); successTimer.current = window.setTimeout(() => setStatus('idle'), 2200); }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setHistoryLoading(true); setErrorMessage(undefined);
    try { const detail = await service.getConversation(id); setActiveConversationId(detail.id); setMessages(mapConversationMessages(detail));
      setPendingAttachments(detail.attachments || []); setHistoryOpen(false); setStatus('idle'); }
    catch { setErrorMessage('No pude abrir esa conversación.'); }
    finally { setHistoryLoading(false); }
  }, [service]);

  const loadConversations = useCallback(async (scope: AssistantConversationStatus = conversationScope) => {
    setHistoryLoading(true);
    try { const items = await service.listConversations(scope); setConversationScope(scope); setConversations(items);
      if (scope === 'ACTIVE' && !activeConversationId && !messages.length && items[0]) await selectConversation(items[0].id); }
    catch { setConversations([]); }
    finally { setHistoryLoading(false); }
  }, [activeConversationId, conversationScope, messages.length, selectConversation, service]);

  useEffect(() => { if (isOpen && !conversations.length && !activeConversationId) void loadConversations('ACTIVE'); }, [activeConversationId, conversations.length, isOpen, loadConversations]);

  const openAssistant = useCallback((options?: AssistantOpenOptions) => {
    lastActivator.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true);
    if (options?.prefill) setDraft(options.prefill);
    if (options?.suggestion) { const selected = options.suggestion; setSelectedSuggestion(selected); setSuggestion(null); suppressLocally(selected.id, Number.MAX_SAFE_INTEGER);
      setMessages((current) => current.some((item) => item.id === `suggestion-${selected.id}`) ? current : [...current, { id: `suggestion-${selected.id}`, role: 'assistant', content: selected.message, timestamp: selected.timestamp }]); }
    if (options?.seedMessage) setMessages((current) => [...current, { id: messageId(), role: 'assistant', content: options.seedMessage!.content, timestamp: now(), sources: options.seedMessage!.sources }]);
  }, []);

  const closeAssistant = useCallback(() => {
    setOpen(false); setHistoryOpen(false); setRecording(false); activeRequest.current?.abort(); activeRequest.current = null;
    if (status === 'thinking' || status === 'processing') setStatus('idle');
    window.setTimeout(() => { const target = lastActivator.current; if (target?.isConnected) target.focus(); else document.querySelector<HTMLElement>('button[aria-label="Abrir PRAVIA IA"]')?.focus(); }, 0);
  }, [status]);

  const ensureConversation = useCallback(async () => {
    if (activeConversationId) return activeConversationId;
    const created = await service.createConversation(context); setActiveConversationId(created.id);
    setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]); return created.id;
  }, [activeConversationId, context, service]);

  const performSubmission = useCallback(async (submission: Submission, appendUser: boolean) => {
    setErrorMessage(undefined); setConfirmation(null);
    if (appendUser) setMessages((current) => [...current, { id: submission.clientMessageId, role: 'user', content: submission.prompt, timestamp: now(), attachments: pendingAttachments }]);
    setStatus('thinking'); const controller = new AbortController(); activeRequest.current?.abort(); activeRequest.current = controller;
    try { const reply = await service.sendMessage({ message: submission.prompt, context, suggestionId: selectedSuggestion?.id, conversationId: submission.conversationId,
        clientMessageId: submission.clientMessageId, attachmentIds: submission.attachmentIds, history: submission.history }, controller.signal);
      setPendingAttachments([]); applyReply(reply); void loadConversations('ACTIVE'); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; setStatus('error'); setErrorMessage('No pude completar esa consulta.'); }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }, [applyReply, context, loadConversations, pendingAttachments, selectedSuggestion?.id, service]);

  const sendMessage = useCallback(async (value?: string) => {
    const prompt = (value ?? draft).trim(); if (!prompt || status === 'thinking' || status === 'processing') return; setDraft('');
    try { const conversationId = await ensureConversation(); const submission: Submission = { prompt, conversationId, clientMessageId: messageId(),
        attachmentIds: pendingAttachments.map((item) => item.id), history: messages.slice(-8).map(({ role, content }) => ({ role, content })) };
      lastSubmission.current = submission; await performSubmission(submission, true); }
    catch { setStatus('error'); setErrorMessage('No pude preparar la conversación.'); }
  }, [draft, ensureConversation, messages, pendingAttachments, performSubmission, status]);

  const retry = useCallback(async () => { if (lastSubmission.current) await performSubmission(lastSubmission.current, false); }, [performSubmission]);
  const newConversation = useCallback(() => {
    activeRequest.current?.abort();
    if (activeConversationId && pendingAttachments.length) {
      void Promise.allSettled(pendingAttachments.map((item) => service.archiveAttachment(activeConversationId, item.id)));
    }
    setActiveConversationId(undefined); setMessages([]); setPendingAttachments([]); setDraft('');
    setConfirmation(null); setErrorMessage(undefined); setStatus('idle'); setHistoryOpen(false); lastSubmission.current = undefined;
  }, [activeConversationId, pendingAttachments, service]);
  const renameConversation = useCallback(async (id: string, title: string) => { const updated = await service.renameConversation(id, title); setConversations((current) => current.map((item) => item.id === id ? updated : item)); }, [service]);
  const transitionConversation = useCallback(async (id: string, action: 'archive' | 'trash' | 'restore') => {
    if (action === 'archive') await service.archiveConversation(id); else if (action === 'trash') await service.trashConversation(id); else await service.restoreConversation(id);
    if (activeConversationId === id && action !== 'restore') newConversation(); await loadConversations(conversationScope);
  }, [activeConversationId, conversationScope, loadConversations, newConversation, service]);

  const uploadAttachment = useCallback(async (file: File) => {
    setProcessLabel('Adjuntando archivo…'); setStatus('processing');
    try { const conversationId = await ensureConversation(); const attachment = await service.uploadAttachment(conversationId, file);
      setPendingAttachments((current) => current.some((item) => item.id === attachment.id) ? current : [...current, attachment]); setStatus('idle'); }
    catch { setStatus('error'); setErrorMessage('No pude adjuntar ese archivo.'); }
  }, [ensureConversation, service]);
  const removeAttachment = useCallback(async (id: string) => { if (!activeConversationId) return;
    try { await service.archiveAttachment(activeConversationId, id); setPendingAttachments((current) => current.filter((item) => item.id !== id)); }
    catch { setErrorMessage('No pude retirar ese adjunto.'); }
  }, [activeConversationId, service]);
  const transcribeAudio = useCallback(async (file: File) => {
    setRecording(false); setProcessLabel('Transcribiendo audio…'); setStatus('processing');
    try { const conversationId = await ensureConversation(); const attachment = await service.uploadAttachment(conversationId, file);
      setPendingAttachments((current) => current.some((item) => item.id === attachment.id) ? current : [...current, attachment]);
      const result = await service.transcribeAttachment(conversationId, attachment.id);
      setDraft((current) => [current.trim(), result.transcript.trim()].filter(Boolean).join(current.trim() ? '\n' : ''));
      setPendingAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, transcription: result.transcript, transcribed_at: now() } : item)); setStatus('idle'); }
    catch { setStatus('error'); setErrorMessage('No pude transcribir la grabación.'); }
  }, [ensureConversation, service]);

  const confirmAction = useCallback(async () => { if (!confirmation || status === 'processing') return; setStatus('processing'); setProcessLabel('Preparando acción…'); setErrorMessage(undefined);
    const controller = new AbortController(); activeRequest.current = controller;
    try { applyReply(await service.confirmAction(confirmation.id, context, controller.signal)); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; setStatus('error'); setErrorMessage('No pude completar esa acción.'); }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }, [applyReply, confirmation, context, service, status]);
  const cancelConfirmation = useCallback(() => { setConfirmation(null); setStatus('idle'); }, []);
  const editConfirmation = useCallback(() => { setConfirmation(null); setStatus('idle'); setDraft('Necesito editar los datos de esta acción.'); }, []);
  const dismissSuggestion = useCallback((mode: 'dismiss' | 'snooze' = 'dismiss') => { if (!suggestion) return; const target = suggestion;
    suppressLocally(target.id, mode === 'snooze' ? Date.now() + 60 * 60 * 1000 : Number.MAX_SAFE_INTEGER); setSuggestion(null);
    (mode === 'snooze' ? service.snoozeSuggestion(target.id, context) : service.dismissSuggestion(target.id, context)).catch(() => undefined);
  }, [context, service, suggestion]);
  const reportError = useCallback((message: string) => { setStatus('error'); setErrorMessage(message); }, []);

  const value = useMemo<AssistantContextValue>(() => ({ isOpen, viewState: isOpen ? status : 'closed', status, context, messages, suggestion, selectedSuggestion, draft,
    processLabel, errorMessage, confirmation, actions: getAssistantActions(context), conversations, conversationScope, activeConversationId, pendingAttachments,
    historyOpen, historyLoading, recording, openAssistant, closeAssistant, setDraft, sendMessage, retry, confirmAction, editConfirmation, cancelConfirmation,
    dismissSuggestion, setHistoryOpen, loadConversations, selectConversation, newConversation, renameConversation,
    archiveConversation: (id) => transitionConversation(id, 'archive'), trashConversation: (id) => transitionConversation(id, 'trash'), restoreConversation: (id) => transitionConversation(id, 'restore'),
    uploadAttachment, removeAttachment, transcribeAudio, setRecording, reportError,
  }), [isOpen, status, context, messages, suggestion, selectedSuggestion, draft, processLabel, errorMessage, confirmation, conversations, conversationScope,
    activeConversationId, pendingAttachments, historyOpen, historyLoading, recording, openAssistant, closeAssistant, sendMessage, retry, confirmAction,
    editConfirmation, cancelConfirmation, dismissSuggestion, loadConversations, selectConversation, newConversation, renameConversation, transitionConversation,
    uploadAttachment, removeAttachment, transcribeAudio, reportError]);
  return <AssistantContextStore.Provider value={value}>{children}</AssistantContextStore.Provider>;
}

export function useAssistant() { const value = useContext(AssistantContextStore); if (!value) throw new Error('useAssistant debe utilizarse dentro de AssistantProvider.'); return value; }
