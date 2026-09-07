import { useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { prospectsService } from '../prospects.service';
import type { Prospect } from '../prospects.types';
import { displayProspectName, uppercaseProspectNameInput } from '../prospects.types';
import { DrawerShell } from './DrawerShell';
import styles from '../ProspectsPage.module.css';

export function NewProspectDrawer({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (prospect: Prospect) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const attempt = useRef(crypto.randomUUID());
  const busy = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    if (!name.trim()) return setError('Escribe el nombre o razón social.');
    busy.current = true;
    setSubmitting(true);
    setError('');
    try {
      onCreated(await prospectsService.create({ nombre: displayProspectName(name) }, attempt.current));
    } catch {
      setError('No pudimos crear el prospecto. Revisa el nombre e inténtalo de nuevo.');
      busy.current = false;
      setSubmitting(false);
    }
  };

  return <DrawerShell
    title="Nuevo prospecto"
    subtitle="Sólo necesitas el solicitante. La ficha se abrirá para completar el asunto."
    onClose={onClose}
    footer={<><button className={styles.secondaryButton} type="button" onClick={onClose}>Cancelar</button><button className={styles.primaryButton} type="submit" form="new-prospect-form" disabled={submitting}>{submitting && <LoaderCircle className={styles.spin} size={17} />}{submitting ? 'Creando…' : 'Crear prospecto'}</button></>}
  >
    <form id="new-prospect-form" className={styles.prospectForm} onSubmit={submit} noValidate>
      {error && <div className={styles.formError} role="alert">{error}</div>}
      <label className={styles.fullField}><span>Nombre o razón social <b aria-hidden="true">*</b></span><input autoFocus value={name} onChange={(event) => setName(uppercaseProspectNameInput(event.target.value))} aria-invalid={Boolean(error)} /></label>
      <p className={`${styles.permissionNote} ${styles.fullField}`}>El folio, la fecha y la etapa Nuevo se asignan automáticamente.</p>
    </form>
  </DrawerShell>;
}
