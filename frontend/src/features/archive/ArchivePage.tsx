import { useCallback, useEffect, useState } from 'react';
import { PageContainer } from '../../components/layout/PageContainer';
import { useAuth } from '../auth/AuthProvider';
import { expedientesService } from '../cases/expedientes.service';
import { archivoService, type ArchivoOverview } from './archive.service';
import { ArchiveInstrument } from './ArchiveInstrument';
import styles from './Archive.module.css';

type CaseOption = { id: string; numero_pravia: string; cliente_alias?: string | null };
export function ArchivePage() {
  const { user } = useAuth();
  const canWrite = Boolean(user?.permissions?.includes('expedientes.write'));
  const canConfigure = canWrite && Boolean(user?.permissions?.includes('configuracion.actos_tiempos.manage'));
  const [overview, setOverview] = useState<ArchivoOverview | null>(null);
  const [selected, setSelected] = useState('');
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [deedSearch, setDeedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof archivoService.records>>>();
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [unused, setUnused] = useState({ folio_inicio: '', folio_fin: '', fecha_instrumento: new Date().toISOString().slice(0, 10), motivo: '' });
  const [saving, setSaving] = useState(false);
  const [protocolForm, setProtocolForm] = useState({ anchor_folio: '', anchor_libro: '', anchor_tomo: '', tomos_por_libro: '', folios_por_tomo: '', reason: '' });
  const [protocolEditing, setProtocolEditing] = useState(false);
  const editProtocol = () => {
    const config = overview?.protocol?.config;
    setProtocolForm({ anchor_folio: config?.anchor_folio || '', anchor_libro: String(config?.anchor_libro || ''), anchor_tomo: String(config?.anchor_tomo || ''), tomos_por_libro: String(config?.tomos_por_libro || ''), folios_por_tomo: String(config?.folios_por_tomo || ''), reason: '' }); setProtocolEditing(true);
  };
  const saveProtocol = async () => {
    setSaving(true); setError('');
    try { await archivoService.configureProtocol({ revision: overview?.protocol?.config.revision || 0, anchor_folio: protocolForm.anchor_folio, anchor_libro: Number(protocolForm.anchor_libro), anchor_tomo: Number(protocolForm.anchor_tomo), tomos_por_libro: Number(protocolForm.tomos_por_libro), folios_por_tomo: Number(protocolForm.folios_por_tomo), reason: protocolForm.reason }); setProtocolEditing(false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos guardar la configuración de protocolo.'); }
    finally { setSaving(false); }
  };
  const load = useCallback(async () => { try { setOverview(await archivoService.overview()); setError(''); } catch { setError('No pudimos cargar Archivo.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const controller = new AbortController(); setRecordsLoading(true); setRecordsError('');
    const timer = window.setTimeout(() => { void archivoService.records(deedSearch, page, controller.signal).then(value => { if (!controller.signal.aborted) setRecords(value); }).catch(() => { if (!controller.signal.aborted) setRecordsError('No pudimos consultar las escrituras. Usa un número positivo o borra la búsqueda.'); }).finally(() => { if (!controller.signal.aborted) setRecordsLoading(false); }); }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [deedSearch, page, overview]);
  useEffect(() => { if (!canWrite) return; const timer = window.setTimeout(() => { void expedientesService.list({ search, page: 1, pageSize: 20 }).then((value) => setCases(value.data)).catch(() => setCases([])); }, 200); return () => window.clearTimeout(timer); }, [search, canWrite]);
  const markUnused = async () => { setSaving(true); setError(''); try { await archivoService.registerUnused(unused); setUnused({ ...unused, folio_inicio: '', folio_fin: '', motivo: '' }); await load(); } catch { setError('No pudimos registrar esos folios. Revisa secuencia, rango y motivo.'); } finally { setSaving(false); } };
  return <PageContainer title="Archivo" subtitle="Control de protocolo, escrituras y folios de la organización.">
    <div className={styles.page}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {overview && <>
        <div className={styles.overview} aria-label="Resumen de protocolo">
          <div className={styles.metric}><span>Siguiente escritura</span><strong>{overview.next_numero_escritura ?? 'Sin base'}</strong></div>
          <div className={styles.metric}><span>Siguiente folio</span><strong>{overview.next_folio ?? 'Sin base'}</strong></div>
          <div className={styles.metric}><span>Último libro / tomo registrado</span><strong>{overview.libro_tomo ?? 'Pendiente'}</strong>{overview.protocol?.position ? <small>Siguiente: Libro {overview.protocol.position.libro} / Tomo {overview.protocol.position.tomo} · {overview.protocol.position.folios_restantes} folios disponibles en ese tomo</small> : <small>No hay regla configurada para calcular el siguiente.</small>}{canConfigure&&<button type="button" className={styles.secondary} onClick={editProtocol}>Configurar protocolo</button>}</div>
        </div>
        {protocolEditing&&<section className={styles.card} aria-label="Configuración de protocolo"><h2>Configurar libro, tomo y capacidad</h2><p>El folio de referencia debe ser el primero del tomo indicado. Esta regla calcula posiciones futuras; no renumera ni modifica escrituras históricas.</p><form onSubmit={event=>{event.preventDefault();void saveProtocol();}}><div className={styles.form}>{([['anchor_folio','Primer folio del tomo de referencia'],['anchor_libro','Libro de referencia'],['anchor_tomo','Tomo de referencia'],['tomos_por_libro','Tomos por libro'],['folios_por_tomo','Folios por tomo']] as const).map(([field,label])=><label key={field}>{label}<input required inputMode="numeric" value={protocolForm[field]} disabled={saving} onChange={event=>setProtocolForm(value=>({...value,[field]:event.target.value}))}/></label>)}<label>Motivo de la configuración<input required maxLength={500} value={protocolForm.reason} disabled={saving} onChange={event=>setProtocolForm(value=>({...value,reason:event.target.value}))}/></label></div><div className={styles.actions}><button type="button" className={styles.secondary} disabled={saving} onClick={()=>setProtocolEditing(false)}>Cancelar</button><button type="submit" className={styles.primary} disabled={saving}>{saving?'Guardando…':'Guardar configuración'}</button></div></form></section>}
        {overview.legacy_reconciliation_required && <p className={styles.warning}>Hay {overview.legacy_count} expediente(s) históricos con datos de escritura/folios pendientes de conciliación. No se permitirá asignar una secuencia nueva hasta resolverlos sin pérdida.</p>}
        {canWrite && <section className={styles.card}><header><div><h2>Asignar escritura y folios</h2><p>Selecciona un expediente; la asignación se guarda directamente y se refleja en su resumen.</p></div></header><div className={styles.form}><label>Buscar expediente<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Folio o cliente" /></label><label>Expediente<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Selecciona un expediente</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.numero_pravia} · {item.cliente_alias || 'Sin alias'}</option>)}</select></label></div>{selected && <ArchiveInstrument key={selected} expedienteId={selected} onSaved={() => void load()} />}</section>}
        <section className={styles.card}><header><div><h2>Escrituras</h2><p>Instrumentos asignados, de la escritura más reciente a la más antigua.</p></div></header><label>Buscar por número de escritura<input inputMode="numeric" value={deedSearch} onChange={event=>{setDeedSearch(event.target.value);setPage(1);}} placeholder="Número exacto" /></label>{recordsLoading&&<p role="status">Consultando escrituras…</p>}{recordsError&&<p className={styles.error} role="alert">{recordsError}</p>}<div className={styles.recordList} aria-busy={recordsLoading}>{(records?.data || []).map((item) => <button type="button" className={styles.record} key={item.id} onClick={() => { if (item.expediente_id) setSelected(item.expediente_id); }}><strong>{item.numero_escritura}{item.no_paso ? ' · No pasó' : ''}</strong><span>{item.folio_inicio}–{item.folio_fin}<small>{item.numero_folios} folios</small></span><span>{item.libro_tomo ?? '—'}</span><span>{item.fecha_instrumento}</span><span>{item.expediente?.numero_pravia ?? '—'}</span><span>{item.expediente?.abogado ? `${item.expediente.abogado.nombre} ${item.expediente.abogado.apellido || ''}` : '—'}</span><span>{item.expediente?.acto ?? '—'}</span><span>{item.expediente?.vulnerable ?? 'Sin evaluar'}</span></button>)}{!recordsLoading&&!recordsError&&!records?.data.length && <p className={styles.empty}>Todavía no hay escrituras canónicas asignadas.</p>}</div><nav className={styles.actions} aria-label="Páginas de escrituras"><button type="button" className={styles.secondary} disabled={recordsLoading||page<=1} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page} de {Math.max(1,records?.pages||1)} · {records?.total??0} escrituras</span><button type="button" className={styles.secondary} disabled={recordsLoading||!records||page>=records.pages} onClick={()=>setPage(value=>value+1)}>Siguiente</button></nav></section>
        {canWrite && <section className={styles.card}><header><div><h2>Registrar folio(s) inutilizado(s)</h2><p>Consumo excepcional de la secuencia; no reserva ni libera folios.</p></div></header><div className={styles.form}><label>Folio inicial<input inputMode="numeric" value={unused.folio_inicio} onChange={(event) => setUnused({ ...unused, folio_inicio: event.target.value })} /></label><label>Folio final<input inputMode="numeric" value={unused.folio_fin} onChange={(event) => setUnused({ ...unused, folio_fin: event.target.value })} /></label><label>Fecha<input type="date" value={unused.fecha_instrumento} onChange={(event) => setUnused({ ...unused, fecha_instrumento: event.target.value })} /></label><label>Motivo<input value={unused.motivo} onChange={(event) => setUnused({ ...unused, motivo: event.target.value })} /></label></div><div className={styles.actions}><button type="button" className={styles.secondary} disabled={saving || overview.legacy_reconciliation_required || !unused.motivo.trim()} onClick={() => void markUnused()}>Registrar folio(s) inutilizado(s)</button></div>{overview.unused_folios.length > 0 && <div className={styles.recordList}>{overview.unused_folios.map((item) => <div className={styles.record} key={item.id}><strong>Inutilizado</strong><span>{item.folio_inicio}–{item.folio_fin}</span><span>{item.numero_folios} folio(s)</span><span>{item.fecha_instrumento}</span><span>{item.motivo}</span></div>)}</div>}</section>}
      </>}
    </div>
  </PageContainer>;
}
