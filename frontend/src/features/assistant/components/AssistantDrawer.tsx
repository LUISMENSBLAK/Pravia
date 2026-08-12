import { ArrowUp, CheckCircle2, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useAssistant } from '../AssistantProvider';
import { useReducedMotion } from '../useReducedMotion';
import { AssistantConfirmationCard } from './AssistantConfirmationCard';
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

  return (
    <aside ref={panelRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="pravia-assistant-title">
      <header className={styles.header}>
        <div><div className={styles.titleLine}><h2 id="pravia-assistant-title">PRAVIA IA</h2><span className={styles.online}><i />En línea</span></div><p>{contextDetail}</p></div>
        <button type="button" onClick={assistant.closeAssistant} aria-label="Cerrar PRAVIA IA"><X size={20} /></button>
      </header>

      <div className={styles.body}>
        {assistant.messages.length === 0 && <section className={styles.hero}><AssistantOwl status="idle" greeting /><div><strong>Estoy viendo {assistant.context.label === 'Mi Día' ? 'tu día' : 'esta pantalla'} contigo.</strong><p>¿Qué necesitas?</p></div></section>}

        <section className={styles.quickActions} aria-label="Acciones rápidas">
          {assistant.actions.map((action) => <button type="button" key={action.id} onClick={() => assistant.openAssistant({ prefill: action.prompt })}>{action.label}</button>)}
        </section>

        <div className={styles.conversation} role="log" aria-live="polite" aria-label="Conversación con PRAVIA IA">
          {assistant.messages.map((message) => <article key={message.id} className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            {message.role === 'assistant' && <span className={styles.messageAuthor}>PRAVIA IA</span>}
            <p>{message.content}</p>
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
        <div><textarea ref={composerRef} id="pravia-assistant-message" value={assistant.draft} onChange={(event) => assistant.setDraft(event.target.value)} onKeyDown={keyDown} placeholder="Pregúntame algo..." rows={1} disabled={busy} /><button type="submit" disabled={busy || !assistant.draft.trim()} aria-label="Enviar mensaje"><ArrowUp size={18} /></button></div>
        <small>Enter para enviar · Shift+Enter para nueva línea</small>
      </form>
    </aside>
  );
}
