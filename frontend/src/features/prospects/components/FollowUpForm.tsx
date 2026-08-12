import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { prospectsService } from '../prospects.service';
import type { ProspectFollowUp } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

export function FollowUpForm({ prospectId, onCreated, onCancel }: { prospectId: string; onCreated: (item: ProspectFollowUp) => void; onCancel: () => void }) {
  const [tipo, setTipo] = useState('Nota'); const [contenido, setContenido] = useState(''); const [next, setNext] = useState(''); const [date, setDate] = useState('');
  const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!contenido.trim()) { setError('Escribe una nota de seguimiento.'); return; }
    setSubmitting(true); setError('');
    try { onCreated(await prospectsService.addFollowUp(prospectId, { tipo, contenido: contenido.trim(), proxima_accion: next || undefined, fecha_proximo_seguimiento: date || undefined }) as ProspectFollowUp); }
    catch { setError('No pudimos registrar el seguimiento. Inténtalo de nuevo.'); setSubmitting(false); }
  };
  return <form className={styles.followUpForm} onSubmit={submit} noValidate><div className={styles.followUpGrid}><label><span>Tipo</span><select value={tipo} onChange={(event) => setTipo(event.target.value)}><option>Nota</option><option>Llamada</option><option>Correo</option><option>Reunión</option></select></label><label><span>Próxima fecha</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div><label><span>Nota <b aria-hidden="true">*</b></span><textarea autoFocus rows={3} value={contenido} onChange={(event) => setContenido(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'follow-up-error' : undefined} /></label><label><span>Siguiente acción</span><input value={next} onChange={(event) => setNext(event.target.value)} placeholder="Ej. Confirmar documentos" /></label>{error && <p className={styles.fieldError} id="follow-up-error" role="alert">{error}</p>}<footer><button className={styles.secondaryButton} type="button" onClick={onCancel}>Cancelar</button><button className={styles.primaryButton} type="submit" disabled={submitting}>{submitting && <LoaderCircle className={styles.spin} size={17} />}Guardar seguimiento</button></footer></form>;
}
