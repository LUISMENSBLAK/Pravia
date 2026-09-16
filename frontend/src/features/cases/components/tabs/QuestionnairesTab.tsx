import { CheckCircle2, ClipboardList, LoaderCircle, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { expedientesService } from '../../expedientes.service';
import type { ExpedienteDetail, ExpedienteQuestionnaireInstance } from '../../expedientes.types';
import type { QuestionnaireQuestion } from '../../../settings/catalogs/catalogs.types';
import styles from '../../Expedientes.module.css';

const isVisible = (question: QuestionnaireQuestion, answers: Record<string, unknown>) => {
  const condition = question.condition; if (!condition) return true; const value = answers[condition.questionId];
  if (condition.operator === 'NOT_EMPTY') return value !== undefined && value !== null && value !== '';
  if (condition.operator === 'EQUALS') return value === condition.value;
  if (condition.operator === 'NOT_EQUALS') return value !== condition.value;
  return Array.isArray(value) && value.includes(condition.value);
};
const answerValue = (value: unknown) => value === undefined || value === null ? '' : String(value);

function AnswerField({ question, value, onChange }: { question: QuestionnaireQuestion; value: unknown; onChange: (value: unknown) => void }) {
  if (question.type === 'YES_NO') return <select value={answerValue(value)} onChange={(event) => onChange(event.target.value === '' ? '' : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select>;
  if (question.type === 'LONG_TEXT') return <textarea value={answerValue(value)} onChange={(event) => onChange(event.target.value)} />;
  if (question.type === 'SINGLE_CHOICE' || question.type === 'CATALOG') return <select value={answerValue(value)} onChange={(event) => onChange(event.target.value)}><option value="">Selecciona…</option>{(question.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (question.type === 'MULTIPLE_CHOICE') return <fieldset className={styles.questionnaireMulti}>{(question.options || []).map((option) => <label key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => { const current = Array.isArray(value) ? value : []; onChange(event.target.checked ? [...current, option] : current.filter((item) => item !== option)); }} />{option}</label>)}</fieldset>;
  const type = question.type === 'DATE' ? 'date' : ['NUMBER', 'CURRENCY', 'PERCENTAGE'].includes(question.type) ? 'number' : 'text';
  return <input type={type} value={answerValue(value)} onChange={(event) => onChange(type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />;
}

export function QuestionnairesTab({ expediente }: { expediente: ExpedienteDetail }) {
  const [instances, setInstances] = useState<ExpedienteQuestionnaireInstance[]>([]); const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => { setLoading(true); setMessage(''); try { const data = await expedientesService.questionnaires(expediente.id); setInstances(data); setAnswers(Object.fromEntries(data.map((item) => [`${item.version.id}:${item.subject.key}`, { ...item.prefill, ...(item.latestResponse?.answers_json || {}) }]))); } catch { setMessage('No pudimos cargar los cuestionarios aplicables.'); } finally { setLoading(false); } }, [expediente.id]);
  useEffect(() => { void load(); }, [load]);
  const save = async (item: ExpedienteQuestionnaireInstance, finalize: boolean) => { const instanceKey = `${item.version.id}:${item.subject.key}`; setBusy(instanceKey); setMessage(''); try { await expedientesService.saveQuestionnaire(expediente.id, { versionId: item.version.id, scope: item.definition.scope, subjectKey: item.subject.key, answers: answers[instanceKey] || {}, finalize, idempotencyKey: crypto.randomUUID() }); setMessage(finalize ? 'Cuestionario finalizado y registrado.' : 'Borrador guardado.'); await load(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'No fue posible guardar las respuestas.'); } finally { setBusy(''); } };
  if (loading) return <section className={styles.sectionCard}><div className={styles.inlineState} role="status"><LoaderCircle className={styles.spin} />Detectando cuestionarios aplicables…</div></section>;
  return <div className={styles.tabStack}><section className={styles.sectionCard}><header><div><h2>Cuestionarios</h2><p>Captura estructurada por expediente, compareciente o inmueble, vinculada a formatos CFG-002.</p></div></header>{message && <div className={styles.sectionError} role="status">{message}</div>}{instances.length === 0 ? <p className={styles.sectionEmpty}>No hay cuestionarios aplicables al acto y contexto actuales.</p> : <div className={styles.questionnaireInstances}>{instances.map((item) => { const instanceKey = `${item.version.id}:${item.subject.key}`; const current = answers[instanceKey] || {}; const finalized = item.latestResponse?.estado === 'FINALIZADO'; return <article key={instanceKey} className={styles.questionnaireInstance}><header><span><ClipboardList size={18} /></span><div><small>{item.definition.scope === 'COMPARECIENTE' ? 'COMPARECIENTE' : item.definition.scope === 'INMUEBLE' ? 'INMUEBLE' : 'EXPEDIENTE'} · v{item.version.number}</small><h3>{item.artifact.name}</h3><p>{item.subject.label}{item.formats.length ? ` · Alimenta ${item.formats.map((format) => format.nombre).join(', ')}` : ''}</p></div>{finalized && <em><CheckCircle2 size={14} />Finalizado</em>}</header>{item.definition.sections.map((section) => <fieldset key={section.id} disabled={finalized}><legend>{section.title}</legend>{section.questions.filter((question) => isVisible(question, current)).map((question) => <label key={question.id}><span>{question.label}{question.required && <b aria-label="Requerida"> *</b>}</span>{question.help && <small>{question.help}</small>}<AnswerField question={question} value={current[question.id]} onChange={(value) => setAnswers((state) => ({ ...state, [instanceKey]: { ...(state[instanceKey] || {}), [question.id]: value } }))} /></label>)}</fieldset>)}{expediente.capabilities.canWrite && !finalized && <footer><button type="button" className={styles.secondaryButton} disabled={busy === instanceKey} onClick={() => void save(item, false)}><Save size={15} />Guardar borrador</button><button type="button" className={styles.primaryButton} disabled={busy === instanceKey} onClick={() => void save(item, true)}>{busy === instanceKey && <LoaderCircle className={styles.spin} size={15} />}Finalizar cuestionario</button></footer>}</article>; })}</div>}</section></div>;
}
