import { useState, type FormEvent } from 'react';
import { FileCheck2, LoaderCircle } from 'lucide-react';
import { prospectsService } from '../prospects.service';
import type { Prospect, ProspectCatalogs, ProspectMutationInput } from '../prospects.types';
import { displayProspectName, uppercaseProspectNameInput } from '../prospects.types';
import { CatalogCombobox } from './CatalogCombobox';
import { DrawerShell } from './DrawerShell';
import { ProspectDocumentPicker } from './ProspectDocumentPicker';
import styles from '../ProspectsPage.module.css';

export function EditProspectDrawer({
  prospect,
  catalogs,
  canUpload,
  onClose,
  onSaved,
}: {
  prospect: Prospect;
  catalogs: ProspectCatalogs;
  canUpload: boolean;
  onClose: () => void;
  onSaved: (prospect: Prospect, message: string) => void;
}) {
  const [form, setForm] = useState<ProspectMutationInput>({
    nombre: displayProspectName(prospect.nombre),
    telefono: prospect.telefono ?? '',
    email: prospect.email ?? '',
    servicio_catalogo_codigo: prospect.servicio_catalogo_codigo ?? '',
    etapa_operativa_codigo: prospect.etapa_operativa_codigo ?? '',
    prioridad: prospect.prioridad,
    necesidad: prospect.necesidad ?? '',
    tiene_predial: Boolean(prospect.tiene_predial),
    tiene_antecedente: Boolean(prospect.tiene_antecedente),
  });
  const [predialFiles, setPredialFiles] = useState<File[]>([]);
  const [antecedenteFiles, setAntecedenteFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const update = <K extends keyof ProspectMutationInput>(field: K, value: ProspectMutationInput[K]) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.nombre.trim()) nextErrors.nombre = 'Escribe el nombre o razón social.';
    if (!form.etapa_operativa_codigo) nextErrors.etapa = 'Selecciona una etapa documental.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Escribe un correo válido.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      const payload = { ...form, nombre: displayProspectName(form.nombre) };
      if (!payload.servicio_catalogo_codigo) delete payload.servicio_catalogo_codigo;
      const updated = await prospectsService.update(prospect.id, {
        ...payload,
        tiene_predial: form.tiene_predial || predialFiles.length > 0,
        tiene_antecedente: form.tiene_antecedente || antecedenteFiles.length > 0,
      });
      const uploads = [
        ...predialFiles.map((file) => prospectsService.uploadDocument(prospect.id, file, 'PREDIAL')),
        ...antecedenteFiles.map((file) => prospectsService.uploadDocument(prospect.id, file, 'ANTECEDENTE')),
      ];
      const results = await Promise.allSettled(uploads);
      const failed = results.filter((result) => result.status === 'rejected').length;
      const predialSucceeded = results.slice(0, predialFiles.length).some((result) => result.status === 'fulfilled');
      const antecedenteSucceeded = results.slice(predialFiles.length).some((result) => result.status === 'fulfilled');
      onSaved({
        ...updated,
        tiene_predial: updated.tiene_predial || predialSucceeded,
        tiene_antecedente: updated.tiene_antecedente || antecedenteSucceeded,
      }, failed ? `Cambios guardados. ${failed} ${failed === 1 ? 'documento no pudo cargarse' : 'documentos no pudieron cargarse'}; puedes reintentar.` : 'Prospecto actualizado.');
    } catch {
      setErrors({ form: 'No pudimos guardar los cambios. Revisa los datos e inténtalo de nuevo.' });
      setSubmitting(false);
    }
  };

  return <DrawerShell title="Editar prospecto" subtitle="Actualiza los datos operativos sin alterar su historial." onClose={onClose} footer={<><button className={styles.secondaryButton} type="button" onClick={onClose}>Cancelar</button><button className={styles.primaryButton} type="submit" form="edit-prospect-form" disabled={submitting}>{submitting && <LoaderCircle className={styles.spin} size={17} />}Guardar cambios</button></>}>
    <form id="edit-prospect-form" className={styles.prospectForm} onSubmit={submit} noValidate>
      {errors.form && <div className={styles.formError} role="alert">{errors.form}</div>}
      <label className={styles.fullField}><span>Nombre o razón social <b aria-hidden="true">*</b></span><input autoFocus value={form.nombre} onChange={(event) => update('nombre', uppercaseProspectNameInput(event.target.value))} aria-invalid={Boolean(errors.nombre)} />{errors.nombre && <small>{errors.nombre}</small>}</label>
      <label><span>Teléfono</span><input type="tel" value={form.telefono} onChange={(event) => update('telefono', event.target.value)} /></label>
      <label><span>Correo</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} aria-invalid={Boolean(errors.email)} />{errors.email && <small>{errors.email}</small>}</label>
      <div className={styles.fullField}><CatalogCombobox label="Servicio / acto de interés" value={form.servicio_catalogo_codigo ?? ''} options={catalogs.services} placeholder="Selecciona un acto o servicio" legacyValue={!prospect.servicio_catalogo_codigo ? prospect.tipo_acto : null} onChange={(value) => update('servicio_catalogo_codigo', value)} /></div>
      <CatalogCombobox label="Etapa documental" required value={form.etapa_operativa_codigo ?? ''} options={catalogs.stages} placeholder="Selecciona una etapa" error={errors.etapa} onChange={(value) => update('etapa_operativa_codigo', value)} />
      <label><span>Prioridad</span><select value={form.prioridad} onChange={(event) => update('prioridad', event.target.value as ProspectMutationInput['prioridad'])}><option value="BAJA">Baja</option><option value="MEDIA">Media</option><option value="ALTA">Alta</option></select></label>
      <label className={styles.fullField}><span>Observaciones</span><textarea rows={4} value={form.necesidad} onChange={(event) => update('necesidad', event.target.value)} /></label>
      <fieldset className={`${styles.documentationSection} ${styles.fullField}`}><legend><FileCheck2 size={17} />Documentación</legend>
        <div className={styles.documentCategory}><label className={styles.checkField}><input type="checkbox" checked={form.tiene_predial} onChange={(event) => update('tiene_predial', event.target.checked)} /><span>Cuenta con predial</span></label>{canUpload && <ProspectDocumentPicker id="edit-prospect-predial" label="Adjuntar predial" files={predialFiles} disabled={submitting} onChange={setPredialFiles} />}</div>
        <div className={styles.documentCategory}><label className={styles.checkField}><input type="checkbox" checked={form.tiene_antecedente} onChange={(event) => update('tiene_antecedente', event.target.checked)} /><span>Cuenta con antecedente</span></label>{canUpload && <ProspectDocumentPicker id="edit-prospect-antecedente" label="Adjuntar antecedente" files={antecedenteFiles} disabled={submitting} onChange={setAntecedenteFiles} />}</div>
      </fieldset>
    </form>
  </DrawerShell>;
}
