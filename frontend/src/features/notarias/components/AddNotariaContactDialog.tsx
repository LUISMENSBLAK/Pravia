import { Check, LoaderCircle, X } from 'lucide-react';
import { useState } from 'react';
import { notariasService } from '../notarias.service';
import styles from '../Notarias.module.css';

export function AddNotariaContactDialog({ notariaId, onClose, onSaved }: { notariaId: string; onClose(): void; onSaved(): void }) {
  const [data, setData] = useState({ nombre: '', cargo: '', telefono: '', correo: '', observaciones: '', principal: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field: string, value: string | boolean) => setData((current) => ({ ...current, [field]: value }));
  const save = async () => {
    if (!data.nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true); setError('');
    try { await notariasService.addContact(notariaId, data); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No pudimos agregar el contacto.'); setBusy(false); }
  };
  return <div className={styles.dialogBackdrop} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="contact-title">
    <header><div><h2 id="contact-title">Agregar contacto</h2><p>Registra su función y los canales operativos confirmados.</p></div><button type="button" className={styles.iconButton} aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
    <div className={styles.editGrid}>
      <label className={styles.formField}><span>Nombre *</span><input value={data.nombre} onChange={(event) => set('nombre', event.target.value)} /></label>
      <label className={styles.formField}><span>Cargo o rol</span><input value={data.cargo} onChange={(event) => set('cargo', event.target.value)} /></label>
      <label className={styles.formField}><span>Teléfono</span><input value={data.telefono} inputMode="tel" onChange={(event) => set('telefono', event.target.value)} /></label>
      <label className={styles.formField}><span>Correo</span><input value={data.correo} type="email" onChange={(event) => set('correo', event.target.value)} /></label>
      <label className={`${styles.formField} ${styles.fieldWide}`}><span>Observaciones</span><input value={data.observaciones} onChange={(event) => set('observaciones', event.target.value)} /></label>
      <label className={`${styles.primaryContactChoice} ${styles.fieldWide}`}><input type="checkbox" checked={data.principal} onChange={(event) => set('principal', event.target.checked)} /><span><strong>Contacto principal</strong><small>Se mostrará como referencia rápida de esta notaría.</small></span></label>
    </div>
    {error && <p className={styles.blockedNote} role="alert">{error}</p>}
    <footer><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Check size={16} />}Agregar contacto</button></footer>
  </section></div>;
}
