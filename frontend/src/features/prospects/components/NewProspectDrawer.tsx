import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { prospectsService } from '../prospects.service';
import type { NewProspectInput, Prospect } from '../prospects.types';
import { DrawerShell } from './DrawerShell';
import styles from '../ProspectsPage.module.css';

const initial: NewProspectInput = { nombre: '', telefono: '', email: '', tipo_acto: '', ciudad: '', fuente: '', prioridad: 'MEDIA', necesidad: '', tiempo_estimado: '' };

export function NewProspectDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (prospect: Prospect) => void }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const update = (field: keyof NewProspectInput, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.nombre.trim()) nextErrors.nombre = 'Escribe el nombre o razón social.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Escribe un correo válido.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try { onCreated(await prospectsService.create({ ...form, nombre: form.nombre.trim() })); }
    catch { setErrors({ form: 'No pudimos crear el prospecto. Revisa los datos e inténtalo de nuevo.' }); setSubmitting(false); }
  };
  return (
    <DrawerShell title="Nuevo prospecto" subtitle="Registra lo esencial para iniciar el seguimiento." onClose={onClose} footer={<><button className={styles.secondaryButton} type="button" onClick={onClose}>Cancelar</button><button className={styles.primaryButton} type="submit" form="new-prospect-form" disabled={submitting}>{submitting && <LoaderCircle className={styles.spin} size={17} />}Crear prospecto</button></>}>
      <form id="new-prospect-form" className={styles.prospectForm} onSubmit={submit} noValidate>
        {errors.form && <div className={styles.formError} role="alert">{errors.form}</div>}
        <label className={styles.fullField}><span>Nombre o razón social <b aria-hidden="true">*</b></span><input autoFocus value={form.nombre} onChange={(event) => update('nombre', event.target.value)} aria-invalid={Boolean(errors.nombre)} aria-describedby={errors.nombre ? 'nombre-error' : undefined} />{errors.nombre && <small id="nombre-error">{errors.nombre}</small>}</label>
        <label><span>Teléfono</span><input type="tel" inputMode="tel" value={form.telefono} onChange={(event) => update('telefono', event.target.value)} /></label>
        <label><span>Correo</span><input type="email" inputMode="email" value={form.email} onChange={(event) => update('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} />{errors.email && <small id="email-error">{errors.email}</small>}</label>
        <label className={styles.fullField}><span>Servicio / acto de interés</span><input value={form.tipo_acto} onChange={(event) => update('tipo_acto', event.target.value)} placeholder="Ej. Compraventa" /></label>
        <label><span>Origen</span><input value={form.fuente} onChange={(event) => update('fuente', event.target.value)} placeholder="Ej. Referido" /></label>
        <label><span>Ciudad</span><input value={form.ciudad} onChange={(event) => update('ciudad', event.target.value)} /></label>
        <label><span>Prioridad</span><select value={form.prioridad} onChange={(event) => update('prioridad', event.target.value)}><option value="BAJA">Baja</option><option value="MEDIA">Media</option><option value="ALTA">Alta</option></select></label>
        <label><span>Tiempo estimado</span><input value={form.tiempo_estimado} onChange={(event) => update('tiempo_estimado', event.target.value)} placeholder="Ej. Este mes" /></label>
        <label className={styles.fullField}><span>Necesidad inicial</span><textarea rows={4} value={form.necesidad} onChange={(event) => update('necesidad', event.target.value)} /></label>
      </form>
    </DrawerShell>
  );
}
