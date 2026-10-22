import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { settingsService } from '../settings.service';
import type { CatalogAct, SupportingCatalogs } from './catalogs.types';
import { CatalogModal } from './CatalogModal';
import styles from './Catalogs.module.css';

type DefaultProcess = { code: string; name: string; stage: string; duration: number; dayType: 'HABILES' | 'NATURALES'; nature: string };
type ProcessException = { selector: 'JURISDICCION' | 'INSTITUCION'; targetId: string; jurisdiction: string; duration: number; dayType: 'HABILES' | 'NATURALES'; margin: number };
type SelectedProcess = DefaultProcess & { margin: number; parallelGroup: string; dependencyCodes: string[]; conditionText: string; exceptions: ProcessException[] };
const selectProcess = (item: DefaultProcess): SelectedProcess => ({ ...item, margin: 0, parallelGroup: '', dependencyCodes: [], conditionText: '', exceptions: [] });
const mainSuggestions = ['VENDEDOR', 'COMPRADOR', 'DONANTE', 'DONATARIO', 'OTORGANTE', 'ACREDITADO', 'ACREEDOR', 'FIDEICOMITENTE', 'FIDUCIARIO', 'FIDEICOMISARIO'];
const auxiliarySuggestions = ['APODERADO', 'ADMINISTRADOR', 'INTÉRPRETE', 'TUTOR', 'ALBACEA'];
const groupLabels: Record<string, string> = {
  REGISTRABLE: 'Procesos registrables — aplicar default',
  NO_REGISTRABLE: 'Procesos no registrables — aplicar default',
  ESPECIAL: 'Procesos especiales — aplicar default',
};

export function ActCreationConfigurator({ acts, support, returnTo, onCancel, onSaved }: {
  acts: CatalogAct[]; support?: SupportingCatalogs | null; returnTo: string | null; onCancel: () => void; onSaved: (act: CatalogAct) => void;
}) {
  const [form, setForm] = useState({ nombre: '', descripcion: '', clasificacion: 'TRASLATIVOS', familia: '', tipo_definicion: 'ACTO_BASE', acto_base_id: '', jurisdiccion: '', registrable: true, actividad_vulnerable: false });
  const [defaults, setDefaults] = useState<Record<string, DefaultProcess[]>>({});
  const [processes, setProcesses] = useState<SelectedProcess[]>([]);
  const [mainRoles, setMainRoles] = useState<string[]>([]);
  const [auxiliaryRoles, setAuxiliaryRoles] = useState<string[]>([]);
  const [customRole, setCustomRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void settingsService.actCreationDefaults().then((result) => { if (active) setDefaults(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No fue posible cargar los procesos base.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const catalogProcesses = useMemo(() => [...new Map(Object.values(defaults).flat().map((item) => [item.code, item])).values()], [defaults]);
  const toggleRole = (role: string, kind: 'main' | 'auxiliary') => {
    const update = kind === 'main' ? setMainRoles : setAuxiliaryRoles;
    update((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  };
  const applyDefault = (group: string) => {
    const selected = defaults[group] || [];
    setProcesses(selected.map(selectProcess));
    setForm((current) => ({ ...current, registrable: group === 'REGISTRABLE' }));
    setError('');
  };
  const updateProcess = (code: string, change: Partial<SelectedProcess>) => setProcesses((current) => current.map((item) => item.code === code ? { ...item, ...change } : item));
  const updateException = (code: string, index: number, change: Partial<ProcessException>) => setProcesses((current) => current.map((item) => item.code === code ? {
    ...item, exceptions: item.exceptions.map((exception, position) => position === index ? { ...exception, ...change } : exception),
  } : item));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!processes.length) return setError('Aplica un default y conserva al menos un proceso.');
    if (!mainRoles.length) return setError('Selecciona al menos un carácter principal de compareciente.');
    setSaving(true); setError('');
    try {
      const configuredProcesses = processes.map(({ code, duration, dayType, margin, parallelGroup, dependencyCodes, conditionText, exceptions }) => {
        let condition: unknown;
        if (conditionText.trim()) {
          try { condition = JSON.parse(conditionText); }
          catch { throw new Error('La condición declarativa debe ser JSON válido.'); }
        }
        return { code, duration, dayType, margin, parallelGroup: parallelGroup.trim() || null, dependencyCodes, condition, exceptions };
      });
      const created = await settingsService.createCatalogAct({
        ...form,
        processes: configuredProcesses,
        characters: [...mainRoles.map((name) => ({ name, principal: true })), ...auxiliaryRoles.map((name) => ({ name, principal: false }))],
      });
      onSaved(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el acto.');
    } finally { setSaving(false); }
  };

  return <CatalogModal title="Dar de alta nuevo acto" description="Datos generales, procesos y caracteres se guardan juntos. Ningún acto se precarga automáticamente." onClose={onCancel}>
    <form className={styles.modalForm} onSubmit={(event) => void submit(event)}>
      <section className={styles.formSection} aria-label="Datos generales del acto">
        <span>1. DATOS GENERALES</span>
        <label>Tipo de definición<select value={form.tipo_definicion} onChange={(event) => setForm({ ...form, tipo_definicion: event.target.value, acto_base_id: '' })}><option value="ACTO_BASE">Acto base</option><option value="VARIANTE">Variante</option></select></label>
        {form.tipo_definicion === 'VARIANTE' && <label>Acto base<select required value={form.acto_base_id} onChange={(event) => {
          const base = acts.find((act) => act.id === event.target.value);
          setForm({ ...form, acto_base_id: event.target.value, clasificacion: base?.configuration?.clasificacion || form.clasificacion, familia: base?.configuration?.familia || form.familia });
        }}><option value="">Selecciona</option>{acts.filter((act) => act.complete && !act.configuration?.hereda_configuracion_id).map((act) => <option value={act.id} key={act.id}>{act.nombre}</option>)}</select></label>}
        <label>Nombre del acto<input required maxLength={180} value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></label>
        <div className={styles.formColumns}>
          <label>Clasificación<select required disabled={form.tipo_definicion === 'VARIANTE'} value={form.clasificacion} onChange={(event) => setForm({ ...form, clasificacion: event.target.value })}><option value="TRASLATIVOS">Traslativos</option><option value="NO TRASLATIVOS">No traslativos</option></select></label>
          <label>Familia<input required disabled={form.tipo_definicion === 'VARIANTE'} list="act-creation-families" value={form.familia} onChange={(event) => setForm({ ...form, familia: event.target.value })} /></label>
          <label>Jurisdicción<input required maxLength={120} value={form.jurisdiccion} onChange={(event) => setForm({ ...form, jurisdiccion: event.target.value })} /></label>
        </div>
        <datalist id="act-creation-families">{[...new Set(acts.map((act) => act.configuration?.familia).filter(Boolean))].map((family) => <option key={family} value={family!} />)}</datalist>
        <div className={styles.formColumns}>
          <label>Registro<select value={String(form.registrable)} onChange={(event) => setForm({ ...form, registrable: event.target.value === 'true' })}><option value="true">Registrable</option><option value="false">No registrable</option></select></label>
          <label>Actividad vulnerable<select value={String(form.actividad_vulnerable)} onChange={(event) => setForm({ ...form, actividad_vulnerable: event.target.value === 'true' })}><option value="false">No</option><option value="true">Sí</option></select></label>
        </div>
        <label>Descripción<textarea value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></label>
      </section>

      <section className={styles.formSection} aria-label="Procesos y tiempos del acto">
        <span>2. PROCESOS Y TIEMPOS</span>
        <p className={styles.helper}>Aplica una base reutilizable; después quita lo que no corresponda y ajusta los tiempos. Los días proceden de CFG-001 y pueden configurarse.</p>
        <div className={styles.creationDefaults}>{Object.entries(groupLabels).map(([key, label]) => <Button key={key} type="button" variant="secondary" disabled={loading || !defaults[key]?.length} onClick={() => applyDefault(key)}>{label}</Button>)}</div>
        {processes.length > 0 && <div className={styles.creationProcesses}>{processes.map((process) => <div key={process.code} className={styles.creationProcess}>
          <div><strong>{process.name}</strong><small>{process.stage}</small></div>
          <label>Duración<input aria-label={`Duración de ${process.name}`} type="number" min="0" max="3650" required value={process.duration} onChange={(event) => updateProcess(process.code, { duration: Number(event.target.value) })} /></label>
          <label>Tipo de días<select aria-label={`Tipo de días de ${process.name}`} value={process.dayType} onChange={(event) => updateProcess(process.code, { dayType: event.target.value as SelectedProcess['dayType'] })}><option value="HABILES">Hábiles</option><option value="NATURALES">Naturales</option></select></label>
          <button type="button" onClick={() => setProcesses((current) => current.filter((item) => item.code !== process.code).map((remaining) => ({ ...remaining, dependencyCodes: remaining.dependencyCodes.filter((code) => code !== process.code) })))} aria-label={`Quitar ${process.name}`}>Quitar</button>
          <details className={styles.creationAdvanced}><summary>Dependencias, paralelismo y excepciones</summary>
            <label>Margen de seguridad<input aria-label={`Margen de ${process.name}`} type="number" min="0" max="3650" value={process.margin} onChange={(event) => updateProcess(process.code, { margin: Number(event.target.value) })} /></label>
            <label>Grupo paralelo<input aria-label={`Grupo paralelo de ${process.name}`} maxLength={80} value={process.parallelGroup} onChange={(event) => updateProcess(process.code, { parallelGroup: event.target.value })} placeholder="Opcional" /></label>
            <fieldset className={styles.creationRoles}><legend>Depende de</legend>{processes.filter((candidate) => candidate.code !== process.code).map((candidate) => <label key={candidate.code}><input type="checkbox" checked={process.dependencyCodes.includes(candidate.code)} onChange={(event) => updateProcess(process.code, { dependencyCodes: event.target.checked ? [...process.dependencyCodes, candidate.code] : process.dependencyCodes.filter((code) => code !== candidate.code) })} />{candidate.name}</label>)}</fieldset>
            <label>Condición declarativa (opcional)<textarea aria-label={`Condición de ${process.name}`} value={process.conditionText} onChange={(event) => updateProcess(process.code, { conditionText: event.target.value })} placeholder={'{"op":"eq","field":"expediente.tiene_credito","value":true}'} /></label>
            <small>Se valida con el lenguaje declarativo cerrado de CFG-001; no se ejecuta código.</small>
            {process.exceptions.map((exception, index) => <div key={index} className={styles.creationException}>
              <label>Excepción<select aria-label={`Tipo de excepción ${index + 1} de ${process.name}`} value={exception.selector} onChange={(event) => updateException(process.code, index, { selector: event.target.value as ProcessException['selector'], targetId: '', jurisdiction: '' })}><option value="JURISDICCION">Jurisdicción</option><option value="INSTITUCION">Institución</option></select></label>
              {exception.selector === 'JURISDICCION' ? <label>Jurisdicción<input required value={exception.jurisdiction} onChange={(event) => updateException(process.code, index, { jurisdiction: event.target.value })} /></label> : <label>Institución<select required value={exception.targetId} onChange={(event) => updateException(process.code, index, { targetId: event.target.value })}><option value="">Selecciona</option>{support?.institutions?.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>}
              <label>Duración<input type="number" min="0" max="3650" required value={exception.duration} onChange={(event) => updateException(process.code, index, { duration: Number(event.target.value) })} /></label>
              <label>Tipo de días<select value={exception.dayType} onChange={(event) => updateException(process.code, index, { dayType: event.target.value as ProcessException['dayType'] })}><option value="HABILES">Hábiles</option><option value="NATURALES">Naturales</option></select></label>
              <label>Margen<input type="number" min="0" max="3650" value={exception.margin} onChange={(event) => updateException(process.code, index, { margin: Number(event.target.value) })} /></label>
              <button type="button" onClick={() => updateProcess(process.code, { exceptions: process.exceptions.filter((_, position) => position !== index) })}>Quitar excepción</button>
            </div>)}
            <Button type="button" variant="secondary" onClick={() => updateProcess(process.code, { exceptions: [...process.exceptions, { selector: 'JURISDICCION', targetId: '', jurisdiction: '', duration: process.duration, dayType: process.dayType, margin: process.margin }] })}>Agregar excepción</Button>
          </details>
        </div>)}</div>}
        <label>Agregar proceso del catálogo default<select value="" onChange={(event) => {
          const item = catalogProcesses.find((candidate) => candidate.code === event.target.value);
          if (item && !processes.some((current) => current.code === item.code)) setProcesses((current) => [...current, selectProcess(item)]);
        }}><option value="">Selecciona un proceso adicional</option>{catalogProcesses.filter((item) => !processes.some((current) => current.code === item.code)).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      </section>

      <section className={styles.formSection} aria-label="Caracteres de comparecientes">
        <span>3. CARACTERES DE COMPARECIENTES</span>
        <p className={styles.helper}>Selecciona las partes principales del acto. Los auxiliares son opcionales; “representante legal” no se agrega automáticamente.</p>
        <fieldset className={styles.creationRoles}><legend>Principales</legend>{mainSuggestions.map((role) => <label key={role}><input type="checkbox" checked={mainRoles.includes(role)} onChange={() => toggleRole(role, 'main')} />{role}</label>)}</fieldset>
        <fieldset className={styles.creationRoles}><legend>Auxiliares opcionales</legend>{auxiliarySuggestions.map((role) => <label key={role}><input type="checkbox" checked={auxiliaryRoles.includes(role)} onChange={() => toggleRole(role, 'auxiliary')} />{role}</label>)}</fieldset>
        <label>Otro carácter principal<input value={customRole} onChange={(event) => setCustomRole(event.target.value)} placeholder="Carácter jurídico específico" /></label>
        <Button type="button" variant="secondary" disabled={!customRole.trim()} onClick={() => { const value = customRole.trim().toLocaleUpperCase('es-MX'); if (value && !mainRoles.includes(value) && !auxiliaryRoles.includes(value)) setMainRoles((current) => [...current, value]); setCustomRole(''); }}>Agregar carácter principal</Button>
        {mainRoles.filter((role) => !mainSuggestions.includes(role)).map((role) => <button type="button" key={role} onClick={() => toggleRole(role, 'main')}>Quitar {role}</button>)}
      </section>

      {error && <p role="alert" className={styles.contextError}>{error}</p>}
      {returnTo && <p className={styles.helper}>Al guardar, volverás al registro de origen con el acto seleccionado.</p>}
      <footer><Button variant="secondary" type="button" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={saving || loading}>{saving ? 'Guardando acto…' : 'Guardar acto'}</Button></footer>
    </form>
  </CatalogModal>;
}
