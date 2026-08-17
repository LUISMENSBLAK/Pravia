import { useState, type FormEvent } from 'react';
import { FileCheck2, LoaderCircle } from 'lucide-react';
import { prospectsService } from '../prospects.service';
import type { NewProspectInput, Prospect, ProspectCatalogs } from '../prospects.types';
import { displayProspectName, uppercaseProspectNameInput } from '../prospects.types';
import { CatalogCombobox } from './CatalogCombobox';
import { DrawerShell } from './DrawerShell';
import { ProspectDocumentPicker } from './ProspectDocumentPicker';
import styles from '../ProspectsPage.module.css';

const initial: NewProspectInput = {
  nombre: '', telefono: '', email: '', servicio_catalogo_codigo: '', prioridad: 'MEDIA', necesidad: '',
  tiene_predial: false, tiene_antecedente: false,
};

export function NewProspectDrawer({
  catalogs,
  canUpload,
  onClose,
  onCreated,
}: {
  catalogs: ProspectCatalogs;
  canUpload: boolean;
  onClose: () => void;
  onCreated: (prospect: Prospect, message: string) => void;
}) {
  const [form, setForm] = useState(initial);
  const [predialFiles, setPredialFiles] = useState<File[]>([]);
  const [antecedenteFiles, setAntecedenteFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const update = <K extends keyof NewProspectInput>(field: K, value: NewProspectInput[K]) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.nombre.trim()) nextErrors.nombre = 'Escribe el nombre o razón social.';
    if (!form.servicio_catalogo_codigo) nextErrors.servicio = 'Selecciona un servicio del catálogo.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Escribe un correo válido.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      const created = await prospectsService.create({
        ...form,
        nombre: displayProspectName(form.nombre),
        tiene_predial: form.tiene_predial || predialFiles.length > 0,
        tiene_antecedente: form.tiene_antecedente || antecedenteFiles.length > 0,
      });
      const uploads = [
        ...predialFiles.map((file) => prospectsService.uploadDocument(created.id, file, 'PREDIAL')),
        ...antecedenteFiles.map((file) => prospectsService.uploadDocument(created.id, file, 'ANTECEDENTE')),
      ];
      const results = await Promise.allSettled(uploads);
      const failed = results.filter((result) => result.status === 'rejected').length;
      onCreated(created, failed
        ? `Prospecto creado. ${failed} ${failed === 1 ? 'documento no pudo cargarse' : 'documentos no pudieron cargarse'}; puedes reintentar desde el detalle.`
        : uploads.length ? 'Prospecto y documentación guardados.' : 'Prospecto creado.');
    } catch {
      setErrors({ form: 'No pudimos crear el prospecto. Revisa los datos e inténtalo de nuevo.' });
      setSubmitting(false);
    }
  };

  return (
    <DrawerShell title="Nuevo prospecto" subtitle="Registra la oportunidad y su documentación disponible." onClose={onClose} footer={<><button className={styles.secondaryButton} type="button" onClick={onClose}>Cancelar</button><button className={styles.primaryButton} type="submit" form="new-prospect-form" disabled={submitting}>{submitting && <LoaderCircle className={styles.spin} size={17} />}{submitting ? 'Guardando…' : 'Crear prospecto'}</button></>}>
      <form id="new-prospect-form" className={styles.prospectForm} onSubmit={submit} noValidate>
        {errors.form && <div className={styles.formError} role="alert">{errors.form}</div>}
        <label className={styles.fullField}><span>Nombre o razón social <b aria-hidden="true">*</b></span><input autoFocus value={form.nombre} onChange={(event) => update('nombre', uppercaseProspectNameInput(event.target.value))} aria-invalid={Boolean(errors.nombre)} aria-describedby={errors.nombre ? 'nombre-error' : undefined} />{errors.nombre && <small id="nombre-error">{errors.nombre}</small>}</label>
        <label><span>Teléfono</span><input type="tel" inputMode="tel" value={form.telefono} onChange={(event) => update('telefono', event.target.value)} /></label>
        <label><span>Correo</span><input type="email" inputMode="email" value={form.email} onChange={(event) => update('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} />{errors.email && <small id="email-error">{errors.email}</small>}</label>
        <div className={styles.fullField}><CatalogCombobox label="Servicio / acto de interés" required value={form.servicio_catalogo_codigo ?? ''} options={catalogs.services} placeholder="Selecciona un acto o servicio" error={errors.servicio} onChange={(value) => update('servicio_catalogo_codigo', value)} /></div>
        <label><span>Prioridad</span><select value={form.prioridad} onChange={(event) => update('prioridad', event.target.value as NewProspectInput['prioridad'])}><option value="BAJA">Baja</option><option value="MEDIA">Media</option><option value="ALTA">Alta</option></select></label>
        <label className={styles.fullField}><span>Observaciones</span><textarea rows={4} value={form.necesidad} onChange={(event) => update('necesidad', event.target.value)} /></label>
        <fieldset className={`${styles.documentationSection} ${styles.fullField}`}><legend><FileCheck2 size={17} />Documentación</legend>
          <div className={styles.documentCategory}>
            <label className={styles.checkField}><input type="checkbox" checked={form.tiene_predial} onChange={(event) => update('tiene_predial', event.target.checked)} /><span>Cuenta con predial</span></label>
            {canUpload && <ProspectDocumentPicker id="new-prospect-predial" label="Adjuntar predial" files={predialFiles} disabled={submitting} onChange={setPredialFiles} />}
          </div>
          <div className={styles.documentCategory}>
            <label className={styles.checkField}><input type="checkbox" checked={form.tiene_antecedente} onChange={(event) => update('tiene_antecedente', event.target.checked)} /><span>Cuenta con antecedente</span></label>
            {canUpload && <ProspectDocumentPicker id="new-prospect-antecedente" label="Adjuntar antecedente" files={antecedenteFiles} disabled={submitting} onChange={setAntecedenteFiles} />}
          </div>
          {!canUpload && <p className={styles.permissionNote}>Puedes declarar la disponibilidad. Tu perfil no permite subir archivos.</p>}
        </fieldset>
      </form>
    </DrawerShell>
  );
}
