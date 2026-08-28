import { AlertTriangle, Building2, LoaderCircle, Pencil, Plus, Search, ShieldAlert, Trash2, UserPlus, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../../../services/api/client';
import { expedienteReturnParams } from '../../expedienteNavigation';
import { expedientesService } from '../../expedientes.service';
import type { ExpedienteDetail, ExpedientePartyCatalogs, ExpedientePartyCommand, ExpedientePartyPreview, ExpedientePartyRelation, ExpedientePartySearchOption } from '../../expedientes.types';
import styles from '../../Expedientes.module.css';

type DialogState = { operation: 'LINK' | 'UPDATE' | 'UNLINK'; current?: ExpedientePartyRelation };
const appearanceLabels: Record<ExpedientePartyRelation['forma_comparecencia'], string> = {
  PROPIO_DERECHO: 'Por propio derecho',
  EN_REPRESENTACION_PERSONA_MORAL: 'En representación de persona moral',
  EN_REPRESENTACION_PERSONA_FISICA: 'En representación de persona física',
  POR_PROPIO_DERECHO_Y_REPRESENTACION: 'Por propio derecho y en representación',
  CARACTER_INSTITUCIONAL: 'Carácter institucional',
  OTRO: 'Otra comparecencia',
};
const requiresRepresentationDetails = (value: ExpedientePartyRelation['forma_comparecencia']) => [
  'EN_REPRESENTACION_PERSONA_MORAL',
  'EN_REPRESENTACION_PERSONA_FISICA',
  'POR_PROPIO_DERECHO_Y_REPRESENTACION',
].includes(value);
const relationName = (relation: ExpedientePartyRelation) => relation.compareciente.personaFisica?.nombre_completo_calculado || relation.compareciente.personaMoral?.razon_social || relation.compareciente.nombre_busqueda;
const representedName = (relation: ExpedientePartyRelation) => { const party = relation.representacionesComoRepresentante?.[0]?.representado; return party?.personaFisica?.nombre_completo_calculado || party?.personaMoral?.razon_social || party?.nombre_busqueda || ''; };

export function PartiesTab({ expediente, onChanged = () => undefined }: { expediente: ExpedienteDetail; onChanged?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returned = location.state as { exp003NewComparecienteId?: string; exp003ActId?: string | null } | null;
  const [relations, setRelations] = useState<ExpedientePartyRelation[]>(expediente.comparecientes || []);
  const [catalogs, setCatalogs] = useState<ExpedientePartyCatalogs | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ExpedientePartySearchOption[]>([]);
  const [representationSearch, setRepresentationSearch] = useState('');
  const [representationOptions, setRepresentationOptions] = useState<ExpedientePartySearchOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [actId, setActId] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [appearance, setAppearance] = useState<ExpedientePartyRelation['forma_comparecencia']>('PROPIO_DERECHO');
  const [participation, setParticipation] = useState('');
  const [representedId, setRepresentedId] = useState('');
  const [representationCharacterId, setRepresentationCharacterId] = useState('');
  const [representationDescription, setRepresentationDescription] = useState('');
  const [representationPowers, setRepresentationPowers] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ExpedientePartyPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [relationResult, catalogResult] = await Promise.all([expedientesService.listParties(expediente.id, signal), expedientesService.partyCatalogs(expediente.id, signal)]);
      setRelations(relationResult.data); setCatalogs(catalogResult); setStatus('ready');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(error instanceof ApiError && error.status === 403 ? 'denied' : 'error');
    }
  }, [expediente.id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!dialog || dialog.operation === 'UNLINK') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void expedientesService.searchParties(expediente.id, search, controller.signal).then((result) => setOptions(result.data)).catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage('No pudimos buscar en el maestro de comparecientes.'); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [dialog, expediente.id, search]);
  useEffect(() => {
    if (!dialog || dialog.operation === 'UNLINK' || appearance === 'PROPIO_DERECHO') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void expedientesService.searchParties(expediente.id, representationSearch, controller.signal).then((result) => setRepresentationOptions(result.data)).catch((error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage('No pudimos buscar a la persona representada.'); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [appearance, dialog, expediente.id, representationSearch]);

  const reset = () => {
    setSearch(''); setOptions([]); setRepresentationSearch(''); setRepresentationOptions([]); setPartyId(''); setActId(''); setCharacterId(''); setAppearance('PROPIO_DERECHO'); setParticipation('');
    setRepresentedId(''); setRepresentationCharacterId(''); setRepresentationDescription(''); setRepresentationPowers(''); setReason('');
    setPreview(null); setConfirmed(false); setMessage(''); setIdempotencyKey(crypto.randomUUID());
  };
  const open = (operation: DialogState['operation'], current?: ExpedientePartyRelation, returnedPartyId?: string, returnedActId?: string | null) => {
    reset(); setDialog({ operation, current });
    if (operation === 'LINK') { setPartyId(returnedPartyId || ''); setSearch(returnedPartyId || ''); setActId(returnedActId || catalogs?.acts[0]?.id || ''); }
    if (current) {
      const representation = current.representacionesComoRepresentante?.[0];
      setPartyId(current.compareciente_id); setActId(current.expediente_acto_id || ''); setCharacterId(current.caracter_id); setAppearance(current.forma_comparecencia || 'PROPIO_DERECHO');
      setParticipation(current.participacion_porcentaje == null ? '' : String(current.participacion_porcentaje));
      setRepresentedId(representation?.representado_compareciente_id || ''); setRepresentationCharacterId(representation?.caracter_representacion_id || '');
      setRepresentationSearch(representedName(current));
      setRepresentationDescription(representation?.cargo_o_caracter_descripcion || ''); setRepresentationPowers(representation?.facultades_aplicables || '');
    }
  };
  useEffect(() => {
    if (status !== 'ready' || !returned?.exp003NewComparecienteId) return;
    open('LINK', undefined, returned.exp003NewComparecienteId, returned.exp003ActId);
    navigate({ pathname: location.pathname, hash: '#comparecientes' }, { replace: true, state: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, returned?.exp003NewComparecienteId]);

  const activeAct = catalogs?.acts.find((act) => act.id === actId);
  const characters = useMemo(() => activeAct?.tipo_acto.tipoActoCaracteresCompareciente || [], [activeAct]);
  useEffect(() => { if (characterId && !characters.some((entry) => entry.caracter_id === characterId)) { setCharacterId(''); setPreview(null); } }, [actId, characterId, characters]);
  const requiresRepresentation = requiresRepresentationDetails(appearance);
  const command = useMemo<ExpedientePartyCommand | null>(() => {
    if (!dialog) return null;
    if (dialog.operation === 'UNLINK') return { operation: 'UNLINK', relation_id: dialog.current?.id, reason };
    return {
      operation: dialog.operation, relation_id: dialog.current?.id, expediente_acto_id: actId, compareciente_id: partyId,
      caracter_id: characterId, forma_comparecencia: appearance,
      participacion_porcentaje: participation.trim() ? Number(participation) : null,
      representation: requiresRepresentation ? { representado_compareciente_id: representedId, caracter_representacion_id: representationCharacterId || null, cargo_o_caracter_descripcion: representationDescription, facultades_aplicables: representationPowers || null } : null,
    };
  }, [actId, appearance, characterId, dialog, participation, partyId, reason, representedId, representationCharacterId, representationDescription, representationPowers, requiresRepresentation]);
  const formReady = dialog?.operation === 'UNLINK' ? reason.trim().length > 0 : Boolean(partyId && actId && characterId) && (!requiresRepresentation || Boolean(representedId && representationDescription.trim()));
  const requestPreview = async () => {
    if (!command) return; setWorking(true); setMessage(''); setConfirmed(false);
    try { setPreview(await expedientesService.previewParty(expediente.id, command)); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'No pudimos preparar la vista previa.'); }
    finally { setWorking(false); }
  };
  const apply = async () => {
    if (!command || !preview) return; setWorking(true); setMessage('');
    try {
      await expedientesService.applyParty(expediente.id, { ...command, idempotency_key: idempotencyKey, preview_fingerprint: preview.fingerprint, confirm_protected_work: confirmed });
      await load(); onChanged(); setDialog(null);
    } catch (error) {
      const code = error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'code' in error.payload ? String((error.payload as { code: unknown }).code) : '';
      setMessage(code === 'EXPEDIENTE_PARTY_PREVIEW_STALE' ? 'La vista previa quedó obsoleta porque el expediente cambió. Revísala nuevamente.' : error instanceof ApiError ? error.message : 'No pudimos aplicar el cambio.');
      setPreview(null);
    } finally { setWorking(false); }
  };
  const createNew = () => {
    const params = new URLSearchParams(expedienteReturnParams(expediente.id, 'comparecientes')); if (actId) params.set('fromActo', actId);
    navigate(`/comparecientes/nuevo?${params.toString()}`);
  };

  return <section className={styles.sectionCard}>
    <header className={styles.partyHeader}><div><h2>Comparecientes</h2><p>Participaciones vinculadas a cada acto, sin duplicar la ficha maestra de la persona.</p></div>{expediente.capabilities.canWrite && <button type="button" className={styles.primaryButton} onClick={() => open('LINK')}><Plus size={16} />Agregar compareciente</button>}</header>
    {status === 'loading' && <div className={styles.inlineState}><LoaderCircle className={styles.spin} />Cargando comparecientes…</div>}
    {status === 'denied' && <div className={styles.inlineState}><ShieldAlert />No tienes permiso para consultar los comparecientes de este expediente.</div>}
    {status === 'error' && <div className={styles.inlineState}><AlertTriangle />No pudimos cargar los comparecientes.<button type="button" className={styles.secondaryButton} onClick={() => void load()}>Reintentar</button></div>}
    {status === 'ready' && !relations.length && <p className={styles.sectionEmpty}>No hay comparecientes vinculados.</p>}
    {status === 'ready' && relations.length > 0 && <div className={styles.partyRelations}>{relations.map((relation) => { const physical = relation.compareciente.tipo_persona === 'FISICA'; const representation = representedName(relation); return <article key={relation.id}>
      <span>{physical ? <UserRound size={19} /> : <Building2 size={19} />}</span><div className={styles.partyRelationIdentity}><strong>{relationName(relation)}</strong><small>Ficha maestra única · {physical ? 'Persona física' : 'Persona moral'}</small></div>
      <dl><div><dt>Acto</dt><dd>{relation.expedienteActo?.tipo_acto.nombre || 'Acto pendiente de asignar'}</dd></div><div><dt>Rol</dt><dd>{relation.caracter?.nombre || 'Sin carácter'}</dd></div><div><dt>Comparecencia</dt><dd>{appearanceLabels[relation.forma_comparecencia || 'PROPIO_DERECHO']}</dd></div><div><dt>Participación</dt><dd>{relation.participacion_porcentaje == null ? 'No aplica' : `${Number(relation.participacion_porcentaje).toLocaleString('es-MX', { maximumFractionDigits: 6 })}%`}</dd></div>{representation && <div><dt>Representación</dt><dd>{representation}</dd></div>}</dl>
      {expediente.capabilities.canWrite && <div className={styles.partyRelationActions}><button type="button" aria-label={`Editar comparecencia de ${relationName(relation)}`} onClick={() => open('UPDATE', relation)}><Pencil size={16} /></button><button type="button" aria-label={`Desvincular ${relationName(relation)}`} onClick={() => open('UNLINK', relation)}><Trash2 size={16} /></button></div>}
    </article>; })}</div>}

    {dialog && <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setDialog(null); }}><section className={`${styles.dialog} ${styles.partyDialog}`} role="dialog" aria-modal="true" aria-labelledby="party-dialog-title">
      <header><div><h2 id="party-dialog-title">{dialog.operation === 'LINK' ? 'Agregar compareciente' : dialog.operation === 'UPDATE' ? 'Editar comparecencia' : 'Desvincular compareciente'}</h2><p>{dialog.operation === 'UNLINK' ? 'Se retirará únicamente esta relación. La ficha maestra permanecerá intacta.' : 'Configura la participación de la persona en el acto seleccionado.'}</p></div><button type="button" className={styles.iconButton} aria-label="Cerrar" onClick={() => !working && setDialog(null)}><X size={18} /></button></header>
      <div className={styles.dialogBody}>
        {dialog.operation === 'LINK' && <section className={styles.partySearchPanel}><label htmlFor="party-search">Buscar persona existente</label><div><Search size={16} /><input id="party-search" value={search} onChange={(event) => { setSearch(event.target.value); setPartyId(''); setPreview(null); }} placeholder="Nombre, RFC o CURP" /></div>{options.length > 0 && <div className={styles.partySearchResults} role="listbox" aria-label="Comparecientes encontrados">{options.map((option) => <button key={option.id} type="button" role="option" aria-selected={partyId === option.id} onClick={() => { setPartyId(option.id); setPreview(null); }}><strong>{option.nombre}</strong><small>{option.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'} · {option.identificador}</small></button>)}</div>}<button type="button" className={styles.createMasterLink} onClick={createNew}><UserPlus size={17} /><span><strong>Crear nuevo</strong><small>Abrir la ficha maestra completa y volver a este expediente</small></span></button></section>}
        {dialog.operation !== 'UNLINK' && <>
          <label>Acto<select value={actId} onChange={(event) => { setActId(event.target.value); setPreview(null); }}><option value="">Selecciona un acto</option>{catalogs?.acts.map((act) => <option key={act.id} value={act.id}>{act.tipo_acto.nombre}</option>)}</select></label>
          <label>Rol / carácter<select value={characterId} onChange={(event) => { setCharacterId(event.target.value); setPreview(null); }}><option value="">Selecciona un rol</option>{characters.map((entry) => <option key={entry.caracter_id} value={entry.caracter_id}>{entry.caracter.nombre}</option>)}</select></label>
          <div className={styles.inlineFields}><label>Comparecencia<select value={appearance} onChange={(event) => { setAppearance(event.target.value as ExpedientePartyRelation['forma_comparecencia']); setPreview(null); }}>{catalogs?.appearanceForms.map((value) => <option key={value} value={value}>{appearanceLabels[value]}</option>)}</select></label><label>Participación (%)<input inputMode="decimal" value={participation} onChange={(event) => { setParticipation(event.target.value); setPreview(null); }} placeholder="Opcional" /></label></div>
          {requiresRepresentation && <fieldset className={styles.representationFields}><legend>Representación</legend><label className={styles.representedPartyField}>Buscar persona representada<input value={representationSearch} onChange={(event) => { setRepresentationSearch(event.target.value); setRepresentedId(''); setPreview(null); }} placeholder="Nombre, RFC o CURP" /><select aria-label="Persona representada" value={representedId} onChange={(event) => { setRepresentedId(event.target.value); setPreview(null); }}><option value="">Selecciona una persona</option>{representationOptions.filter((option) => option.id !== partyId).map((option) => <option key={option.id} value={option.id}>{option.nombre}</option>)}</select></label><label>Carácter de representación<select value={representationCharacterId} onChange={(event) => { setRepresentationCharacterId(event.target.value); setPreview(null); }}><option value="">Sin catálogo específico</option>{catalogs?.representationCharacters.map((value) => <option key={value.id} value={value.id}>{value.nombre}</option>)}</select></label><label>Descripción del carácter<input value={representationDescription} onChange={(event) => { setRepresentationDescription(event.target.value); setPreview(null); }} placeholder="Ej. Apoderado general" /></label><label>Facultades aplicables<textarea rows={2} value={representationPowers} onChange={(event) => { setRepresentationPowers(event.target.value); setPreview(null); }} placeholder="Opcional" /></label></fieldset>}
        </>}
        {dialog.operation === 'UNLINK' && <label>Motivo<textarea rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} placeholder="Explica por qué se retira esta relación" /></label>}
        {message && <p className={styles.formError} role="alert">{message}</p>}
        {preview && <div className={styles.impactPreview} data-classification={preview.classification}><div className={styles.impactStatus}><ShieldAlert size={19} /><div><strong>{preview.classification === 'SAFE' ? 'Cambio seguro' : preview.classification === 'REVIEW_REQUIRED' ? 'Revisión humana requerida' : 'Cambio bloqueado'}</strong><small>CFG-002 reevaluado · trabajo protegido detectado: {preview.impact.protected_work.count}</small></div></div><section><h3>Documentos y artefactos <span>CFG-002</span></h3><dl><div><dt>Nuevos pendientes</dt><dd>{preview.impact.added.length ? preview.impact.added.map((item) => item.name).join(', ') : 'Sin cambios'}</dd></div><div><dt>Dejan de aplicar</dt><dd>{preview.impact.removed_or_no_longer_applicable.length ? preview.impact.removed_or_no_longer_applicable.map((item) => item.name).join(', ') : 'Sin cambios'}</dd></div><div><dt>Se conservan</dt><dd>{preview.impact.retained.length ? `${preview.impact.retained.length} elementos` : 'Ninguno'}</dd></div></dl></section>{preview.classification === 'REVIEW_REQUIRED' && <label className={styles.confirmImpact}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo que revisé el impacto sobre el trabajo existente.</label>}</div>}
      </div>
      <footer><button type="button" className={styles.secondaryButton} disabled={working} onClick={() => setDialog(null)}>Cancelar</button>{!preview ? <button type="button" className={styles.primaryButton} disabled={!formReady || working} onClick={() => void requestPreview()}>{working && <LoaderCircle className={styles.spin} size={16} />}Revisar impacto</button> : <button type="button" className={styles.primaryButton} disabled={preview.classification === 'BLOCKED' || (preview.classification === 'REVIEW_REQUIRED' && !confirmed) || working} onClick={() => void apply()}>{working && <LoaderCircle className={styles.spin} size={16} />}Confirmar cambio</button>}</footer>
    </section></div>}
  </section>;
}
