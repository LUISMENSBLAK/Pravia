import { Archive, Clock3, LoaderCircle, MessageSquareText, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAssistant } from '../AssistantProvider';
import type { AssistantConversationStatus } from '../assistant.types';
import styles from './AssistantDrawer.module.css';

const scopes: Array<{ value: AssistantConversationStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Recientes' },
  { value: 'ARCHIVED', label: 'Archivadas' },
  { value: 'TRASHED', label: 'Papelera' },
];

const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(value));

export function AssistantConversationPanel() {
  const assistant = useAssistant();
  if (!assistant.historyOpen) return null;
  return <section className={styles.historyPanel} aria-label="Historial de conversaciones">
    <header><div><strong>Conversaciones</strong><small>Tu historial privado de PRAVIA IA</small></div><button type="button" onClick={assistant.newConversation}><Plus size={16}/>Nueva</button></header>
    <div className={styles.historyTabs} role="tablist" aria-label="Estado de conversaciones">
      {scopes.map((scope) => <button key={scope.value} type="button" role="tab" aria-selected={assistant.conversationScope === scope.value}
        onClick={() => void assistant.loadConversations(scope.value)}>{scope.label}</button>)}
    </div>
    {assistant.historyLoading ? <div className={styles.historyLoading} role="status"><LoaderCircle size={18}/>Cargando conversaciones…</div>
      : assistant.conversations.length ? <ul className={styles.historyList}>{assistant.conversations.map((conversation) => <li key={conversation.id}>
        <button type="button" className={styles.historySelect} onClick={() => void assistant.selectConversation(conversation.id)}>
          <MessageSquareText size={16}/><span><strong>{conversation.title}</strong><small><Clock3 size={11}/>{formatDate(conversation.last_message_at)} · {conversation.message_count} mensajes</small></span>
        </button>
        <div className={styles.historyActions}>
          {assistant.conversationScope === 'ACTIVE' && <><button type="button" onClick={() => void assistant.archiveConversation(conversation.id)} aria-label={`Archivar ${conversation.title}`}><Archive size={15}/></button>
            <button type="button" onClick={() => void assistant.trashConversation(conversation.id)} aria-label={`Enviar ${conversation.title} a papelera`}><Trash2 size={15}/></button></>}
          {assistant.conversationScope === 'ARCHIVED' && <button type="button" onClick={() => void assistant.restoreConversation(conversation.id)} aria-label={`Restaurar ${conversation.title}`}><RotateCcw size={15}/></button>}
          {assistant.conversationScope === 'TRASHED' && <button type="button" onClick={() => void assistant.restoreConversation(conversation.id)} aria-label={`Restaurar ${conversation.title}`}><RotateCcw size={15}/></button>}
        </div>
      </li>)}</ul> : <div className={styles.historyEmpty}><MessageSquareText size={24}/><strong>No hay conversaciones aquí</strong><p>Las conversaciones eliminadas pueden restaurarse desde la papelera.</p></div>}
  </section>;
}
