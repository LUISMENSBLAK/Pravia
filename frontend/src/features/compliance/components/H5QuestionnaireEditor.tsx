import { useId, useState } from "react";
import { complianceService } from "../compliance.service";
import styles from "../Compliance.module.css";

type Question = { id: string; label: string; type: string; required?: boolean; required_when?: unknown; options?: { code: string; label: string }[] };

function QuestionInput({ question, value, onChange, prefix, missing }: { question: Question; value: any; onChange: (value: unknown) => void; prefix: string; missing: boolean }) {
  const id = `${prefix}-${question.id}`;
  const label = `${question.label}${question.required ? " · Obligatoria" : question.required_when ? " · Según respuestas" : ""}`;
  return <div className={styles.h5Field}>
    <label htmlFor={id}>{label}</label>
    {question.type === "BOOLEAN" ? <select id={id} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "yes")} aria-invalid={missing}>
      <option value="">Sin responder</option><option value="yes">Sí</option><option value="no">No</option>
    </select> : question.type === "CHOICE" ? <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)} aria-invalid={missing}>
      <option value="">Seleccionar</option>{question.options?.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
    </select> : question.type === "MULTI_CHOICE" ? <select id={id} multiple value={Array.isArray(value) ? value : []} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))} aria-invalid={missing}>
      {question.options?.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
    </select> : <input id={id} type={question.type === "DATE" ? "date" : "text"} inputMode={question.type === "NUMBER" ? "decimal" : undefined} value={value ?? ""} onChange={(event) => onChange(event.target.value)} aria-invalid={missing} />}
    {missing && <small role="status">Respuesta pendiente o no válida según la definición.</small>}
  </div>;
}

export function H5QuestionnaireEditor({ assessment, canFinalize, onRefresh }: { assessment: any; canFinalize: boolean; onRefresh: () => Promise<void> }) {
  const prefix = useId();
  const revision = assessment.currentRevision;
  const definition = assessment.definitionVersion?.definition_json;
  const [answers, setAnswers] = useState<Record<string, any>>(revision?.answers || {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [humanConfirmed, setHumanConfirmed] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const missing = new Set<string>(revision?.missing_question_ids || []);
  if (!definition?.sections) return <p>La definición fijada no está disponible para edición.</p>;
  const save = async (finalize: boolean) => {
    setBusy(true); setMessage("");
    try {
      await complianceService.saveH5Questionnaire(assessment.id, { answers, base_fingerprint: revision.semantic_fingerprint,
        idempotency_key: `${requestId}:${finalize ? "final" : "draft"}` }, finalize);
      await onRefresh();
      setMessage(finalize ? "Cuestionario finalizado. Su revisión queda inmutable." : "Borrador guardado. La completitud se verifica en el servidor.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No fue posible guardar el cuestionario."); }
    finally { setBusy(false); }
  };
  return <details className={styles.h5Editor}>
    <summary>Responder cuestionario</summary>
    <form onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      <p>Respuestas manuales. La metodología configurada determina el resultado; PRAVIA IA no responde ni clasifica este cuestionario.</p>
      <fieldset disabled={busy}>
        <legend>Definición fijada · revisión {revision.revision_number}</legend>
        {definition.sections.map((section: any) => <fieldset key={section.id}>
          <legend>{section.label}</legend>
          {section.questions?.map((question: Question) => <QuestionInput key={question.id} prefix={prefix} question={question} value={answers[question.id]} missing={missing.has(question.id)} onChange={(value) => { setHumanConfirmed(false); setAnswers((current) => ({ ...current, [question.id]: value })); }} />)}
          {section.repeatable_groups?.map((group: any) => {
            const rows: Record<string, unknown>[] = Array.isArray(answers[group.id]) ? answers[group.id] : [];
            return <fieldset key={group.id}><legend>{group.label}</legend>
              {rows.map((row, index) => <fieldset key={index}><legend>Registro {index + 1}</legend>
                {group.questions.map((question: Question) => <QuestionInput key={question.id} prefix={`${prefix}-${group.id}-${index}`} question={question} value={row[question.id]} missing={missing.has(`${group.id}[${index}].${question.id}`)} onChange={(value) => {
                  setHumanConfirmed(false); setAnswers((current) => ({ ...current, [group.id]: rows.map((item, rowIndex) => rowIndex === index ? { ...item, [question.id]: value } : item) }));
                }} />)}
                <button type="button" onClick={() => { setHumanConfirmed(false); setAnswers((current) => ({ ...current, [group.id]: rows.filter((_, rowIndex) => rowIndex !== index) })); }}>Quitar registro {index + 1}</button>
              </fieldset>)}
              <button type="button" disabled={group.max_items !== undefined && rows.length >= group.max_items} onClick={() => { setHumanConfirmed(false); setAnswers((current) => ({ ...current, [group.id]: [...rows, {}] })); }}>Añadir registro a {group.label}</button>
            </fieldset>;
          })}
        </fieldset>)}
        <div className={styles.h5Actions}><button type="submit">Guardar borrador</button></div>
        {canFinalize && <><label className={styles.h5Check}><input type="checkbox" checked={humanConfirmed} onChange={(event) => setHumanConfirmed(event.target.checked)} />He revisado estas respuestas y entiendo que la finalización no puede deshacerse en esta fase.</label>
          <button type="button" disabled={!humanConfirmed} onClick={() => void save(true)}>Confirmar y finalizar cuestionario</button></>}
      </fieldset>
      <p role="status" aria-live="polite">{busy ? "Guardando…" : message}</p>
    </form>
  </details>;
}
