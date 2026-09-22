import { ArrowDown, ArrowUp, ClipboardList, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { settingsService } from '../settings.service';
import type { QuestionnaireBank, QuestionnaireQuestion, QuestionnaireType } from './catalogs.types';
import styles from './Catalogs.module.css';

const types: Array<[QuestionnaireType, string]> = [
  ['TEXT', 'Texto'], ['NUMBER', 'Número'], ['BOOLEAN', 'Sí / No'], ['DATE', 'Fecha'],
  ['CHOICE', 'Opción única'], ['MULTI_CHOICE', 'Opción múltiple'],
];
const blank = (): Omit<QuestionnaireQuestion, 'id'> => ({ label: '', type: 'TEXT', required: false, active: true });

export function QuestionnairesCatalog() {
  const [banks, setBanks] = useState<QuestionnaireBank[]>([]);
  const [active, setActive] = useState<'PERSONAL' | 'OPERACION'>('PERSONAL');
  const [draft, setDraft] = useState<(Partial<QuestionnaireQuestion> & { id?: string }) | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setMessage('');
    try { setBanks((await settingsService.questionnaireBanks()).banks); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'No fue posible cargar los bancos de preguntas.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const current = banks.find((item) => item.key === active);
  const save = async () => {
    if (!draft?.label?.trim()) { setMessage('Escribe la pregunta.'); return; }
    setBusy(true); setMessage('');
    try {
      if (draft.id) await settingsService.updateQuestionnaireBankQuestion(active, draft.id, draft);
      else await settingsService.addQuestionnaireBankQuestion(active, draft);
      setDraft(null); setMessage('Pregunta guardada en una nueva versión del banco.'); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'No fue posible guardar la pregunta.'); }
    finally { setBusy(false); }
  };
  const reorder = async (index: number, direction: number) => {
    if (!current) return; const target = index + direction; if (target < 0 || target >= current.questions.length) return;
    const questions = [...current.questions]; [questions[index], questions[target]] = [questions[target], questions[index]];
    setBusy(true); try { await settingsService.reorderQuestionnaireBank(active, questions.map((item) => item.id)); await load(); } finally { setBusy(false); }
  };
  return <div className={styles.questionnaireLayout}>
    <section className={styles.questionnaireCatalog} aria-label="Bancos de preguntas">
      <div className={styles.catalogToolbar}>
        <div role="tablist" aria-label="Banco de preguntas">
          {banks.map((item) => <button key={item.key} type="button" role="tab" aria-selected={active === item.key} onClick={() => { setActive(item.key); setDraft(null); }}>{item.label}</button>)}
        </div>
        <Button onClick={() => setDraft(blank())}><Plus size={17} />Nueva pregunta</Button>
      </div>
      <p className={styles.catalogState}>La aplicabilidad la determina exclusivamente Cumplimiento PLD/UIF. Aquí sólo se administran las preguntas de los dos bancos globales.</p>
      {loading ? <div className={styles.catalogState} role="status">Cargando preguntas…</div> : message && !banks.length ? <div className={styles.catalogState} role="alert">{message}</div> : !current?.questions.length ? <div className={styles.catalogState}><ClipboardList /><strong>Sin preguntas</strong><span>Usa “Nueva pregunta” para comenzar este banco.</span></div> : <div className={styles.questionnaireList}>
        {current.questions.map((item, index) => <article key={item.id} className={styles.questionnaireCard}>
          <button type="button" onClick={() => setDraft({ ...item })}><span className={item.active === false ? styles.inactiveDot : styles.activeDot} /><span><strong>{item.label}</strong><small>{types.find(([type]) => type === item.type)?.[1]} · {item.required ? 'Obligatoria' : 'Opcional'}</small><em>{item.active === false ? 'Inactiva' : 'Activa'} · v{current.version}</em></span></button>
          <div><button type="button" onClick={() => void reorder(index, -1)} disabled={busy || index === 0} aria-label={`Subir ${item.label}`}><ArrowUp size={16} /></button><button type="button" onClick={() => void reorder(index, 1)} disabled={busy || index === current.questions.length - 1} aria-label={`Bajar ${item.label}`}><ArrowDown size={16} /></button><button type="button" onClick={async () => { await settingsService.updateQuestionnaireBankQuestion(active, item.id, { active: item.active === false }); await load(); }} aria-label={item.active === false ? `Activar ${item.label}` : `Desactivar ${item.label}`}>{item.active === false ? 'Activar' : 'Desactivar'}</button><button type="button" onClick={async () => { await settingsService.removeQuestionnaireBankQuestion(active, item.id); await load(); }} aria-label={`Eliminar ${item.label}`}><Trash2 size={16} /></button></div>
        </article>)}
      </div>}
    </section>
    {draft && <section className={styles.questionnaireEditor} aria-label={draft.id ? 'Editar pregunta' : 'Nueva pregunta'}>
      <header><div><small>{active === 'PERSONAL' ? 'BANCO PERSONAL' : 'BANCO ACTO / OPERACIÓN'}</small><h2>{draft.id ? 'Editar pregunta' : 'Nueva pregunta'}</h2><p>El cambio crea una versión inmutable; las respuestas anteriores conservan su snapshot.</p></div><Button onClick={() => void save()} disabled={busy}><Save size={17} />{busy ? 'Guardando…' : 'Guardar'}</Button></header>
      {message && <p className={styles.editorMessage} aria-live="polite">{message}</p>}
      <div className={styles.questionnaireBasics}>
        <label>Pregunta<textarea value={draft.label || ''} onChange={(event) => setDraft({ ...draft, label: event.target.value })} autoFocus /></label>
        <label>Tipo<select value={draft.type || 'TEXT'} onChange={(event) => setDraft({ ...draft, type: event.target.value as QuestionnaireType })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><input type="checkbox" checked={draft.required === true} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} />Obligatoria</label>
        <label><input type="checkbox" checked={draft.active !== false} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Activa</label>
        {(draft.type === 'CHOICE' || draft.type === 'MULTI_CHOICE') && <label>Opciones (una por línea)<textarea value={(draft.options || []).map((item) => item.label).join('\n')} onChange={(event) => setDraft({ ...draft, options: event.target.value.split('\n').map((label) => label.trim()).filter(Boolean).map((label) => ({ code: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), label })) })} /></label>}
      </div>
    </section>}
  </div>;
}
