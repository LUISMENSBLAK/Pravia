import { ArrowUp, CheckCircle2, History, LoaderCircle, Mic, Paperclip, Plus, RotateCcw, Square, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useAssistant } from '../AssistantProvider';
import { useReducedMotion } from '../useReducedMotion';
import { AssistantConfirmationCard } from './AssistantConfirmationCard';
import { AssistantConversationPanel } from './AssistantConversationPanel';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantOwl } from './AssistantOwl';
import { AssistantSources } from './AssistantSources';
import styles from './AssistantDrawer.module.css';

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AssistantDrawer() {
  const assistant = useAssistant();
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder>();
  const recorderStreamRef = useRef<MediaStream>();
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    composerRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); assistant.closeAssistant(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const elements = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, [assistant.closeAssistant]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [assistant.messages, assistant.status, reducedMotion]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = 'auto';
    const nextHeight = Math.min(composer.scrollHeight, 116);
    composer.style.height = `${Math.max(nextHeight, 30)}px`;
    composer.style.overflowY = composer.scrollHeight > 116 ? 'auto' : 'hidden';
  }, [assistant.draft]);

  const submit = (event: FormEvent) => { event.preventDefault(); void assistant.sendMessage(); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void assistant.sendMessage(); }
  };
  const busy = assistant.status === 'thinking' || assistant.status === 'processing' || assistant.status === 'confirmation-required';
  const contextDetail = assistant.context.entityType && assistant.context.entityId
    ? `${assistant.context.entityType[0].toUpperCase()}${assistant.context.entityType.slice(1)} · ${assistant.context.entityId}`
    : assistant.context.label;

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void assistant.uploadAttachment(file);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = undefined;
    recorderStreamRef.current = undefined;
    assistant.setRecording(false);
  };

  const toggleRecording = async () => {
    if (assistant.recording) { stopRecording(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const audio = new File(audioChunksRef.current, `voz-pravia-${Date.now()}.${extension}`, { type: mimeType });
        audioChunksRef.current = [];
        if (audio.size) void assistant.transcribeAudio(audio);
      };
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorder.start();
      assistant.setRecording(true);
    } catch {
      assistant.setRecording(false);
      assistant.reportError('No pude acceder al micrófono. Revisa el permiso del navegador e intenta de nuevo.');
    }
  };

  useEffect(() => () => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return (
    <aside ref={panelRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="pravia-assistant-title">
      <header className={styles.header}>
        <div><div className={styles.titleLine}><h2 id="pravia-assistant-title">PRAVIA IA</h2><span className={styles.online}><i />En línea</span></div><p>{contextDetail}</p></div>
        <div className={styles.headerActions}><button type="button" onClick={() => assistant.setHistoryOpen(!assistant.historyOpen)} aria-label="Ver historial de conversaciones" aria-expanded={assistant.historyOpen}><History size={18}/></button>
          <button type="button" onClick={assistant.newConversation} aria-label="Nueva conversación"><Plus size={18}/></button>
          <button type="button" onClick={assistant.closeAssistant} aria-label="Cerrar PRAVIA IA"><X size={20}/></button></div>
      </header>

      <div className={styles.body}>
        <AssistantConversationPanel />
        {assistant.messages.length === 0 && <section className={styles.hero}><AssistantOwl status="idle" greeting /><div><strong>Estoy viendo {assistant.context.label === 'Mi Día' ? 'tu día' : 'esta pantalla'} contigo.</strong><p>¿Qué necesitas?</p></div></section>}

        <section className={styles.quickActions} aria-label="Acciones rápidas">
          {assistant.actions.map((action) => <button type="button" key={action.id} onClick={() => assistant.openAssistant({ prefill: action.prompt })}>{action.label}</button>)}
        </section>

        <div className={styles.conversation} role="log" aria-live="polite" aria-label="Conversación con PRAVIA IA">
          {assistant.messages.map((message) => <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            {message.role === 'assistant' && <span className={styles.messageAuthor}>PRAVIA IA</span>}
            {message.role === 'assistant' ? <AssistantMarkdown content={message.content} /> : <p>{message.content}</p>}
            {!!message.attachments?.length && <div className={styles.messageAttachments}>{message.attachments.map((item) => <span key={item.id}><Paperclip size={12}/>{item.original_name}</span>)}</div>}
            <AssistantSources sources={message.sources} />
          </article>)}

          {assistant.status === 'thinking' && <div className={styles.activity} role="status"><AssistantOwl status="thinking" compact /><div><LoaderCircle size={15} className={styles.spinner} /><span>Revisando la información…</span></div></div>}
          {assistant.status === 'processing' && <div className={styles.activity} role="status"><AssistantOwl status="processing" compact /><div><LoaderCircle size={15} className={styles.spinner} /><span>{assistant.processLabel ?? 'Preparando acción…'}</span></div></div>}
          {assistant.status === 'success' && <div className={`${styles.activity} ${styles.success}`} role="status"><AssistantOwl status="success" compact /><div><CheckCircle2 size={15} /><span>Acción completada.</span></div></div>}
          {assistant.status === 'error' && <div className={styles.error} role="alert"><p>{assistant.errorMessage ?? 'No pude completar esa consulta.'}</p><button type="button" onClick={() => void assistant.retry()}><RotateCcw size={14} />Reintentar</button></div>}
          <AssistantConfirmationCard />
          <div ref={endRef} />
        </div>
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="pravia-assistant-message">Pregúntame algo...</label>
        {!!assistant.pendingAttachments.length && <div className={styles.pendingAttachments} aria-label="Adjuntos temporales">{assistant.pendingAttachments.map((item) => <span key={item.id}><Paperclip size={13}/><b>{item.original_name}</b><small>Temporal · no forma parte del expediente</small><button type="button" onClick={() => void assistant.removeAttachment(item.id)} aria-label={`Retirar ${item.original_name}`}><X size={13}/></button></span>)}</div>}
        <div><div className={styles.composerTools}><input ref={fileInputRef} type="file" hidden onChange={selectFile} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.mp3,.m4a,.wav,.ogg,.webm" />
          <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()} aria-label="Adjuntar archivo temporal"><Paperclip size={17}/></button>
          <button type="button" disabled={busy && !assistant.recording} onClick={() => void toggleRecording()} aria-label={assistant.recording ? 'Detener grabación' : 'Grabar mensaje de voz'} className={assistant.recording ? styles.recordingButton : undefined}>{assistant.recording ? <Square size={15}/> : <Mic size={17}/>}</button></div>
          <textarea ref={composerRef} id="pravia-assistant-message" value={assistant.draft} onChange={(event) => assistant.setDraft(event.target.value)} onKeyDown={keyDown} placeholder="Pregúntame algo..." rows={1} disabled={busy} />
          <button type="submit" disabled={busy || !assistant.draft.trim()} aria-label="Enviar mensaje"><ArrowUp size={18} /></button></div>
        <small>Enter para enviar · Shift+Enter para nueva línea</small>
      </form>
    </aside>
  );
}
