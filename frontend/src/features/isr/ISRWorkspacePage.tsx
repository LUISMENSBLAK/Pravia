import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, Calculator, Check, ChevronDown, Download, ExternalLink, FilePlus2, FileSearch, History, Link2, Plus, Printer, Save, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DocumentViewer } from '../../components/documents/DocumentViewer';
import { useAuth } from '../auth/AuthProvider';
import { emptyISRInput, fixtureRecord } from './isr.fixtures';
import { isrService } from './isr.service';
import type { ISRDeduction, ISRInput, ISRProposal, ISRRecord } from './isr.types';
import styles from './ISR.module.css';

const statusLabel = { BORRADOR: 'Borrador', LISTO_PARA_CALCULAR: 'Listo para calcular', CALCULADO: 'Federal calculado', REQUIERE_REVISION: 'Requiere revisión' } as const;
const operationLabel = { ENAJENACION_INMUEBLE: 'Enajenación de inmueble', ADQUISICION_INMUEBLE: 'Adquisición de inmueble', CASO_ESPECIAL: 'Caso especial / requiere revisión' };
const treatmentLabels: Record<ISRDeduction['treatment'], string> = {
  COSTO_ADQUISICION_ACTUALIZADO: 'Costo de adquisición actualizado · LISR 121-I',
  CONSTRUCCIONES_MEJORAS_AMPLIACIONES_ACTUALIZADAS: 'Construcciones, mejoras o ampliaciones · LISR 121-II',
  GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS: 'Gastos notariales, impuestos, derechos o avalúo · LISR 121-III',
  COMISIONES_MEDIACIONES_ACTUALIZADAS: 'Comisiones o mediaciones · LISR 121-IV', NO_DEDUCIBLE: 'No deducible', REQUIERE_REVISION: 'Requiere revisión fiscal',
};
const updateOriginLabels: Record<ISRDeduction['updateOrigin'], string> = {
  MANUAL_CONFIRMED: 'Valor actualizado proporcionado y confirmado manualmente',
  PRAVIA_CALCULATION: 'Cálculo realizado por PRAVIA — no disponible',
  NORMATIVE_OPTION_TABLE: 'Opción o tabla normativa — no implementada',
};
const money = (value?: string) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const humanError = (reason: unknown) => reason instanceof Error ? reason.message : 'No fue posible completar la operación.';

type Viewer = { open: boolean; name: string; mime?: string; url?: string; loading?: boolean; error?: string; documentId?: string };

function FieldSource({ proposal }: { proposal?: ISRProposal }) {
  if (!proposal || proposal.status === 'RECHAZADA') return null;
  return <small className={styles.fieldSource}><FileSearch/>Fuente: {proposal.source_document_name}{proposal.source_page ? ` · pág. ${proposal.source_page}` : ''}</small>;
}

export function ISRWorkspacePage() {
  const { id = 'nuevo' } = useParams(); const navigate = useNavigate(); const location = useLocation(); const { user } = useAuth();
  const query = new URLSearchParams(location.search); const mode = query.get('fixture') || ''; const fixture = import.meta.env.DEV && Boolean(mode); const localVisualAccess = fixture && query.get('visual') === '1';
  const [record, setRecord] = useState<ISRRecord | null>(fixture && id !== 'nuevo' ? fixtureRecord(mode) : null);
  const [input, setInput] = useState<ISRInput>(() => mode === 'new' || id === 'nuevo' ? emptyISRInput(2026) : fixtureRecord(mode).input_data);
  const [loading, setLoading] = useState(id !== 'nuevo' && !fixture); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [expedienteQuery, setExpedienteQuery] = useState(''); const [expedientes, setExpedientes] = useState<Array<{id:string;numero_pravia:string;cliente_alias?:string}>>([]); const [linkedExpediente, setLinkedExpediente] = useState<string | null | undefined>(record?.expediente_id || (id === 'nuevo' ? new URLSearchParams(location.search).get('expediente') : undefined));
  const [comparecienteQuery, setComparecienteQuery] = useState(''); const [comparecientes, setComparecientes] = useState<Array<{id:string;nombre:string;rfc?:string|null;curp?:string|null;tipo_persona:'FISICA'|'MORAL'}>>([]); const [linkedCompareciente, setLinkedCompareciente] = useState<string | null | undefined>(record?.compareciente_id);
  const [viewer, setViewer] = useState<Viewer>({ open: false, name: '' }); const fileRef = useRef<HTMLInputElement>(null);
  const canWrite = localVisualAccess || !user?.permissions || user.permissions.includes('isr.write'); const canCalculate = localVisualAccess || !user?.permissions || user.permissions.includes('isr.calculate');

  const reload = async (recordId = id) => { const next = await isrService.detail(recordId); setRecord(next); setInput(next.input_data); setLinkedExpediente(next.expediente_id); setLinkedCompareciente(next.compareciente_id); };
  useEffect(() => { if (id === 'nuevo' || fixture) return; const controller = new AbortController(); setLoading(true); isrService.detail(id, controller.signal).then((next)=>{setRecord(next);setInput(next.input_data);setLinkedExpediente(next.expediente_id);}).catch((reason)=>setError(humanError(reason))).finally(()=>setLoading(false)); return ()=>controller.abort(); }, [fixture,id]);
  useEffect(() => { if (fixture || expedienteQuery.trim().length < 2) { setExpedientes([]); return; } const controller = new AbortController(); const timer = window.setTimeout(()=>isrService.searchExpedientes(expedienteQuery, controller.signal).then(setExpedientes).catch(()=>setExpedientes([])),200); return()=>{controller.abort();window.clearTimeout(timer);}; }, [expedienteQuery,fixture]);
  useEffect(() => { if (fixture || comparecienteQuery.trim().length < 2) { setComparecientes([]); return; } const controller = new AbortController(); const timer = window.setTimeout(()=>isrService.searchComparecientes(comparecienteQuery, controller.signal).then(setComparecientes).catch(()=>setComparecientes([])),200); return()=>{controller.abort();window.clearTimeout(timer);}; }, [comparecienteQuery,fixture]);
  useEffect(() => () => { if (viewer.url?.startsWith('blob:')) URL.revokeObjectURL(viewer.url); }, [viewer.url]);

  const proposalsByField = useMemo(() => new Map((record?.propuestas || []).filter((proposal)=>proposal.status !== 'RECHAZADA').map((proposal)=>[proposal.field_path, proposal])), [record?.propuestas]);
  const latest = record?.versiones?.[0]; const determinationInput = latest?.input_snapshot || input; const conflicts = (record?.propuestas || []).filter((proposal)=>proposal.status==='CONFLICTO');
  const update = <K extends keyof ISRInput>(key: K, value: ISRInput[K]) => setInput((current)=>({ ...current, [key]: value }));
  const updateTaxpayer = (key: keyof ISRInput['taxpayer'], value: string | boolean) => update('taxpayer', { ...input.taxpayer, [key]: value });
  const updateProperty = (key: keyof ISRInput['property'], value: string | boolean) => update('property', { ...input.property, [key]: value });
  const save = async () => {
    if (!canWrite) return; setBusy('save'); setError(''); setNotice('');
    try {
      if (fixture) { const next = { ...(record || fixtureRecord('ready')), input_data: input, datos_modificados: Boolean(record?.ultima_version) }; setRecord(next); setNotice('Borrador guardado en la validación local.'); return next; }
      let target = record;
      if (!target) { target = await isrService.create({ ejercicio: input.taxYear, tipo_operacion: input.operationType, ...(linkedExpediente ? { expediente_id: linkedExpediente } : {}), ...(linkedCompareciente ? { compareciente_id: linkedCompareciente } : {}) }); }
      await isrService.update(target.id, input, { expediente_id: linkedExpediente || null, compareciente_id: linkedCompareciente || null, ...(linkedCompareciente ? { contribuyente_snapshot: { compareciente_id: linkedCompareciente, captured_at: new Date().toISOString(), nombre: input.taxpayer.fullName, rfc: input.taxpayer.rfc, curp: input.taxpayer.curp, tipo_persona: input.taxpayer.personType } } : {}) }); await reload(target.id);
      if (id === 'nuevo') navigate(`/calculo-isr/${target.id}`, { replace: true });
      setNotice('Borrador guardado.'); return target;
    } catch (reason) { setError(humanError(reason)); return null; } finally { setBusy(''); }
  };
  const calculate = async () => {
    if (!canCalculate) return; setBusy('calculate'); setError(''); setNotice('');
    try {
      if (fixture) { const next = fixtureRecord('result'); setRecord(next); setInput(next.input_data); setNotice('Se creó una nueva versión inmutable del cálculo.'); return; }
      const target = await save(); if (!target) return; await isrService.calculate(target.id); await reload(target.id); setNotice('Cálculo generado con desglose y versión normativa.');
    } catch (reason) { setError(humanError(reason)); } finally { setBusy(''); }
  };
  const addDeduction = () => update('deductions', [...input.deductions, { id: crypto.randomUUID(), concept: '', historicalAmount: '', updatedAmount: '', expenseDate: '', updateOrigin: 'MANUAL_CONFIRMED', updateMethod: 'Importe actualizado proporcionado por el usuario', treatment: 'REQUIERE_REVISION', included: false, confirmed: false, supportDocumentId: '', reason: '', confirmedBy: '', confirmedAt: '' }]);
  const changeDeduction = (index: number, patch: Partial<ISRDeduction>) => update('deductions', input.deductions.map((item,position)=>position===index?{...item,...patch}:item));
  const extract = async () => { if (!record || fixture) { if (fixture) { setRecord(fixtureRecord('extraction-after')); setNotice('La IA propuso datos; ningún campo fiscal se aplicó automáticamente.'); } return; } setBusy('extract'); setError(''); try { await isrService.extract(record.id); await reload(record.id); setNotice('Propuestas listas para revisión humana.'); } catch(reason){setError(humanError(reason));} finally{setBusy('');} };
  const applyProposal = async (proposal: ISRProposal, accept: boolean) => {
    if (accept) {
      const value = String(proposal.proposed_value ?? '');
      if (proposal.field_path === 'taxpayer.fullName' || proposal.field_path === 'nombre' || proposal.field_path === 'nombre_completo') updateTaxpayer('fullName',value);
      else if (proposal.field_path === 'taxpayer.rfc' || proposal.field_path === 'rfc') updateTaxpayer('rfc',value);
      else if (proposal.field_path === 'curp') updateTaxpayer('curp',value);
      else if (['salePrice','precio','precio_enajenacion','valor_operacion'].includes(proposal.field_path)) update('salePrice',value.replace(/[^\d.]/g,''));
      else if (['acquisitionDate','fecha_adquisicion'].includes(proposal.field_path)) update('acquisitionDate',value);
      else if (['saleDate','fecha_enajenacion'].includes(proposal.field_path)) update('saleDate',value);
      else if (['property.description','inmueble','domicilio_inmueble'].includes(proposal.field_path)) updateProperty('description',value);
    }
    if (!fixture && record) { setBusy(`proposal-${proposal.id}`); try { await isrService.reviewProposal(record.id, proposal.id, accept?'ACEPTADA':'RECHAZADA'); await reload(record.id); } catch(reason){setError(humanError(reason));} finally{setBusy('');} }
    else setRecord((current)=>current?{...current,propuestas:current.propuestas.map((item)=>item.id===proposal.id?{...item,status:accept?'ACEPTADA':'RECHAZADA'}:item)}:current);
  };
  const upload = async (file?: File) => { if (!file || !record || fixture) { if (fixture) setRecord(fixtureRecord('documents')); return; } setBusy('upload'); try { await isrService.upload(record.id,file); await reload(record.id); } catch(reason){setError(humanError(reason));} finally{setBusy('');if(fileRef.current)fileRef.current.value='';} };
  const preview = async (documentId:string,name:string,mime:string) => { if(fixture){setViewer({open:true,name,mime,error:'La vista previa protegida usa el archivo real cuando existe una carga local.'});return;} setViewer({open:true,name,mime,loading:true,documentId});try{const url=await isrService.preview(record!.id,documentId);setViewer({open:true,name,mime,url,documentId});}catch(reason){setViewer({open:true,name,mime,error:humanError(reason),documentId});} };
  const removeDocument = async (documentId:string) => { if(!record)return;if(fixture){setRecord({...record,documentos:record.documentos.filter((item)=>item.documento_id!==documentId)});return;}setBusy('document');try{await isrService.unlinkDocument(record.id,documentId);await reload(record.id);}catch(reason){setError(humanError(reason));}finally{setBusy('');} };
  const printSummary = async () => { if (!record) return; try { if (!fixture) await isrService.auditExport(record.id); window.print(); } catch (reason) { setError(humanError(reason)); } };

  if (loading) return <PageContainer title="Cálculo ISR"><div className={styles.loading} role="status">Preparando espacio fiscal…</div></PageContainer>;
  const title = record?.folio || 'Nuevo cálculo ISR';
  return <PageContainer title="" subtitle="">
    <form className={styles.workspace} onSubmit={(event)=>{event.preventDefault();void save();}}>
      <header className={styles.workspaceHeader}>
        <button type="button" className={styles.backButton} onClick={()=>navigate('/calculo-isr')}><ArrowLeft/><span>Volver</span></button>
        <div className={styles.workspaceTitle}><div><span>Cálculo fiscal notarial</span><h1>{title}</h1></div><Badge tone={record?.estado==='CALCULADO'?'success':record?.estado==='REQUIERE_REVISION'?'danger':'warning'}>{statusLabel[record?.estado || 'BORRADOR']}</Badge></div>
        <div className={styles.headerMeta}><span><strong>Ejercicio</strong>{input.taxYear}</span><span><strong>Operación</strong>{operationLabel[input.operationType]}</span><span><strong>Expediente</strong>{record?.expediente?.numero_pravia || 'Sin vincular'}</span><span><strong>Última actualización</strong>{record ? new Date(record.updated_at).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}) : 'Sin guardar'}</span></div>
        {record?.datos_modificados && <div className={styles.warning} role="status"><AlertTriangle/>Los datos cambiaron desde el último cálculo. Guarda y recalcula para crear una nueva versión.</div>}
        <div className={styles.headerActions}><Button type="button" variant="ghost" onClick={()=>navigate('/calculo-isr')}>Cancelar</Button><Button type="submit" variant="secondary" disabled={!canWrite||Boolean(busy)}><Save/>Guardar borrador</Button><Button type="button" onClick={calculate} disabled={!canCalculate||Boolean(busy)}><Calculator/>{record?.ultima_version?'Recalcular':'Generar cálculo ISR'}</Button></div>
      </header>

      {(error||notice) && <div className={error?styles.error:styles.successNotice} role={error?'alert':'status'}>{error||notice}</div>}
      <div className={styles.workspaceGrid}>
        <main className={styles.dataColumn}>
          <section className={styles.formSection}><header><div><span>01</span><div><h2>Operación fiscal</h2><p>El motor se selecciona por tipo y ejercicio; los supuestos no soportados se bloquean.</p></div></div></header><div className={styles.formGrid}>
            <label><span>Tipo de cálculo / operación fiscal</span><select value={input.operationType} disabled={Boolean(record)} onChange={(event)=>update('operationType',event.target.value as ISRInput['operationType'])}><option value="ENAJENACION_INMUEBLE">Enajenación de inmueble</option><option value="ADQUISICION_INMUEBLE">Adquisición de inmueble — no disponible</option><option value="CASO_ESPECIAL">Caso especial — requiere revisión</option></select></label>
            <label><span>Ejercicio fiscal</span><select value={input.taxYear} disabled={Boolean(record)} onChange={(event)=>update('taxYear',Number(event.target.value))}><option value={2026}>2026</option></select></label>
            <label className={styles.full}><span>Expediente vinculado</span><div className={styles.linkSearch}><Link2/><input value={expedienteQuery} onChange={(event)=>setExpedienteQuery(event.target.value)} placeholder={record?.expediente?.numero_pravia || 'Buscar por folio o cliente…'}/>{linkedExpediente&&<button type="button" aria-label="Quitar vínculo" onClick={()=>setLinkedExpediente(null)}><X/></button>}</div>{expedientes.length>0&&<div className={styles.searchResults}>{expedientes.map((item)=><button type="button" key={item.id} onClick={()=>{setLinkedExpediente(item.id);setExpedienteQuery(item.numero_pravia);setExpedientes([]);}}><strong>{item.numero_pravia}</strong><span>{item.cliente_alias||'Sin cliente principal'}</span></button>)}</div>}<small>El vínculo apunta al mismo cálculo canónico; no crea una copia.</small></label>
          </div></section>

          <section className={styles.formSection}><header><div><span>02</span><div><h2>Contribuyente</h2><p>Snapshot fiscal editable usado exclusivamente por esta versión.</p></div></div></header><div className={styles.formGrid}>
            <label className={styles.full}><span>Seleccionar compareciente existente</span><div className={styles.linkSearch}><Search/><input value={comparecienteQuery} onChange={(event)=>setComparecienteQuery(event.target.value)} placeholder={record?.compareciente?.nombre_busqueda || 'Buscar por nombre, RFC o CURP…'}/>{linkedCompareciente&&<button type="button" aria-label="Quitar compareciente" onClick={()=>setLinkedCompareciente(null)}><X/></button>}</div>{comparecientes.length>0&&<div className={styles.searchResults}>{comparecientes.map((item)=><button type="button" key={item.id} onClick={()=>{setLinkedCompareciente(item.id);setComparecienteQuery(item.nombre);setComparecientes([]);update('taxpayer',{...input.taxpayer,fullName:item.nombre,rfc:item.rfc||'',curp:item.curp||'',personType:item.tipo_persona,confirmed:false});}}><strong>{item.nombre}</strong><span>{item.rfc||'RFC pendiente'} · {item.tipo_persona==='FISICA'?'Persona física':'Persona moral'}</span></button>)}</div>}<small>Origen: Compareciente. Se copia un snapshot; debes confirmar los datos fiscales.</small></label>
            <label className={styles.full}><span>Nombre / razón social</span><input value={input.taxpayer.fullName} onChange={(event)=>updateTaxpayer('fullName',event.target.value)} required/><FieldSource proposal={proposalsByField.get('taxpayer.fullName')||proposalsByField.get('nombre')}/></label>
            <label><span>RFC</span><input value={input.taxpayer.rfc} onChange={(event)=>updateTaxpayer('rfc',event.target.value.toUpperCase())} maxLength={13} required/><FieldSource proposal={proposalsByField.get('rfc')}/></label>
            <label><span>CURP</span><input value={input.taxpayer.curp||''} onChange={(event)=>updateTaxpayer('curp',event.target.value.toUpperCase())} maxLength={18}/><FieldSource proposal={proposalsByField.get('curp')}/></label>
            <label><span>Tipo de persona</span><select value={input.taxpayer.personType} onChange={(event)=>updateTaxpayer('personType',event.target.value)}><option value="FISICA">Persona física</option><option value="MORAL">Persona moral — no soportada</option></select></label>
            <label><span>Residencia fiscal</span><select value={input.taxpayer.fiscalResidence} onChange={(event)=>updateTaxpayer('fiscalResidence',event.target.value)}><option value="NO_CONFIRMADA">No confirmada</option><option value="MEXICO">México</option><option value="EXTRANJERO">Extranjero — no soportado</option></select></label>
            <label className={`${styles.checkRow} ${styles.full}`}><input type="checkbox" checked={input.taxpayer.confirmed} onChange={(event)=>updateTaxpayer('confirmed',event.target.checked)}/><span>Confirmo que estos son los datos fiscales que deben conservarse en el snapshot.</span></label>
          </div></section>

          <section className={styles.formSection}><header><div><span>03</span><div><h2>Inmueble y operación</h2><p>Todos los importes y fechas son confirmados por una persona usuaria.</p></div></div></header><div className={styles.formGrid}>
            <label className={styles.full}><span>Descripción / ubicación del inmueble</span><textarea value={input.property.description} onChange={(event)=>updateProperty('description',event.target.value)} rows={2}/><FieldSource proposal={proposalsByField.get('property.description')||proposalsByField.get('inmueble')}/></label>
            <label><span>Fecha de adquisición</span><input type="date" value={input.acquisitionDate} onChange={(event)=>update('acquisitionDate',event.target.value)}/><FieldSource proposal={proposalsByField.get('fecha_adquisicion')}/></label>
            <label><span>Fecha de enajenación</span><input type="date" value={input.saleDate} onChange={(event)=>update('saleDate',event.target.value)}/><FieldSource proposal={proposalsByField.get('fecha_enajenacion')}/></label>
            <label><span>Años transcurridos confirmados</span><input type="number" min="1" step="1" value={input.yearsElapsed} onChange={(event)=>update('yearsElapsed',Number(event.target.value))}/><small>El motor aplica el límite legal máximo de 20 años.</small></label>
            <label><span>Precio de enajenación (MXN)</span><input inputMode="decimal" value={input.salePrice} onChange={(event)=>update('salePrice',event.target.value)} placeholder="0.00"/><FieldSource proposal={proposalsByField.get('salePrice')||proposalsByField.get('precio_enajenacion')}/></label>
            <label className={`${styles.checkRow} ${styles.full}`}><input type="checkbox" checked={input.property.landAndConstructionSameAcquisitionDate} onChange={(event)=>updateProperty('landAndConstructionSameAcquisitionDate',event.target.checked)}/><span>Terreno y construcción tienen la misma fecha fiscal de adquisición confirmada.</span></label>
          </div></section>

          <section className={styles.formSection}><header><div><span>04</span><div><h2>Deducciones</h2><p>Una partida solo se considera si está incluida, confirmada y tiene tratamiento soportado.</p></div></div><button type="button" className={styles.inlineButton} onClick={addDeduction}><Plus/>Añadir partida</button></header>
            <div className={styles.deductions}>
              {input.deductions.length===0&&<div className={styles.emptyInline}>No hay partidas. El motor no inventará deducciones.</div>}
              {input.deductions.map((item,index)=><article key={item.id} className={styles.deduction}>
                <div className={styles.deductionTop}>
                  <label><span>Concepto</span><input value={item.concept} onChange={(event)=>changeDeduction(index,{concept:event.target.value})}/></label>
                  <label><span>Importe histórico (MXN)</span><input inputMode="decimal" value={item.historicalAmount} onChange={(event)=>changeDeduction(index,{historicalAmount:event.target.value})}/></label>
                  <label><span>Importe actualizado utilizado (MXN)</span><input inputMode="decimal" value={item.updatedAmount} onChange={(event)=>changeDeduction(index,{updatedAmount:event.target.value})}/></label>
                  <button type="button" aria-label={`Eliminar ${item.concept||'partida'}`} onClick={()=>update('deductions',input.deductions.filter((_,position)=>position!==index))}><Trash2/></button>
                </div>
                <label><span>Fecha de erogación o adquisición</span><input type="date" value={item.expenseDate} onChange={(event)=>changeDeduction(index,{expenseDate:event.target.value})}/></label>
                <label><span>Origen de la actualización</span><select value={item.updateOrigin} onChange={(event)=>changeDeduction(index,{updateOrigin:event.target.value as ISRDeduction['updateOrigin']})}><option value="MANUAL_CONFIRMED">{updateOriginLabels.MANUAL_CONFIRMED}</option><option value="PRAVIA_CALCULATION" disabled>{updateOriginLabels.PRAVIA_CALCULATION}</option><option value="NORMATIVE_OPTION_TABLE" disabled>{updateOriginLabels.NORMATIVE_OPTION_TABLE}</option></select></label>
                <label><span>Método de actualización</span><input value={item.updateMethod} onChange={(event)=>changeDeduction(index,{updateMethod:event.target.value})}/></label>
                <label><span>Documento soporte</span><select value={item.supportDocumentId} onChange={(event)=>changeDeduction(index,{supportDocumentId:event.target.value})}><option value="">Seleccionar documento…</option>{(record?.documentos||[]).map((link)=><option key={link.documento_id} value={link.documento_id}>{link.documento.nombre_original}</option>)}</select></label>
                <label><span>Tratamiento fiscal</span><select value={item.treatment} onChange={(event)=>changeDeduction(index,{treatment:event.target.value as ISRDeduction['treatment']})}>{Object.entries(treatmentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Fundamento revisado</span><input value={item.reason} onChange={(event)=>changeDeduction(index,{reason:event.target.value})}/></label>
                <div className={styles.updateDisclosure}><ShieldCheck/><div><strong>Actualización manual confirmada</strong><span>Importe actualizado proporcionado y confirmado por el usuario. PRAVIA no calculó esta actualización.</span><small>{item.confirmedBy&&item.confirmedAt?`Confirmado por ${item.confirmedBy} · ${new Date(item.confirmedAt).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'})}`:'Pendiente de confirmación trazable'}</small></div></div>
                <div className={styles.inlineChecks}><label><input type="checkbox" checked={item.included} onChange={(event)=>changeDeduction(index,{included:event.target.checked})}/>Incluir</label><label><input type="checkbox" checked={item.confirmed} onChange={(event)=>changeDeduction(index,{confirmed:event.target.checked,confirmedBy:event.target.checked?(user?.name||'Usuario autenticado'):'',confirmedAt:event.target.checked?new Date().toISOString():''})}/>Tratamiento e importe confirmados</label></div>
              </article>)}
            </div>
          </section>

          <section className={styles.formSection}><header><div><span>05</span><div><h2>Tratamiento fiscal / Exenciones</h2><p>PRAVIA IA puede sugerir evidencia, pero nunca declara una exención.</p></div></div></header><div className={styles.reviewPanel}><ShieldCheck/><div><h3>Decisión humana obligatoria</h3><p>La versión inicial solo calcula operaciones ordinarias sin exención. Cualquier exención solicitada queda bloqueada para revisión.</p></div></div><div className={styles.formGrid}><label><span>Tratamiento de exención</span><select value={input.exemptionTreatment} onChange={(event)=>update('exemptionTreatment',event.target.value as ISRInput['exemptionTreatment'])}><option value="PENDIENTE_REVISION">Pendiente de revisión</option><option value="NO_APLICA_CONFIRMADO">No aplica — confirmado por revisor</option><option value="SOLICITADA">Posible exención — no calcular</option></select></label><label className={styles.checkRow}><input type="checkbox" checked={input.ordinaryCaseConfirmed} onChange={(event)=>update('ordinaryCaseConfirmed',event.target.checked)}/><span>Confirmo que es una operación ordinaria dentro del alcance soportado.</span></label></div></section>

          {latest&&<section className={`${styles.formSection} ${styles.resultSection}`} id="resultado">
            <header><div><span><Check/></span><div><h2>Resultado federal</h2><p>Versión {latest.version} · cálculo inmutable · {new Date(latest.calculated_at).toLocaleString('es-MX')}</p></div></div><button type="button" className={styles.inlineButton} onClick={()=>void printSummary()}><Printer/>Resumen de determinación</button></header>
            <div className={styles.resultHero}><div><span>ISR provisional federal</span><strong>{money(latest.result.provisionalFederalISR)}</strong><small>MXN · artículo 126 LISR · no es una declaración ni un acuse SAT</small></div><dl><div><dt>Ingreso considerado</dt><dd>{money(latest.result.taxableIncome)}</dd></div><div><dt>Deducciones</dt><dd>{money(latest.result.consideredDeductions)}</dd></div><div><dt>Ganancia</dt><dd>{money(latest.result.gain)}</dd></div><div><dt>Años considerados</dt><dd>{latest.result.yearsConsidered}</dd></div></dl></div>
            <div className={styles.federalScopeNotice} role="note"><AlertTriangle/><div><strong>Alcance federal</strong><span>Este cálculo no incluye el pago a la entidad federativa previsto en el artículo 127 de la LISR ni otras obligaciones fiscales no soportadas.</span></div></div>
            <details className={styles.breakdown} open={mode==='breakdown'}><summary>Ver desglose del cálculo federal <ChevronDown/></summary><div>{latest.result.breakdown.map((step,index)=><article key={step.key}><span>{String(index+1).padStart(2,'0')}</span><div><h3>{step.label}</h3><p>{step.operation}</p><small>{step.source}</small></div><strong>{money(step.amount)}</strong></article>)}</div><footer><div><span>Versión normativa</span><strong>{latest.result.ruleSet.version}</strong></div><a href={latest.result.ruleSet.sourceUrl} target="_blank" rel="noreferrer">Consultar fuente oficial <ExternalLink/></a></footer></details>
            <section className={`${styles.determinationSummary} ${mode==='print-summary'?styles.summaryPreview:''}`} aria-label="Resumen de determinación federal">
              <header><div><span>PRAVIA OS · Cálculo fiscal notarial</span><h2>Resumen de determinación — ISR provisional federal</h2><p>Enajenación ordinaria de inmueble · artículo 126 de la LISR</p></div><strong>{record?.folio}</strong></header>
              <dl className={styles.summaryMeta}><div><dt>Ejercicio</dt><dd>{input.taxYear}</dd></div><div><dt>Versión normativa</dt><dd>{latest.result.ruleSet.version}</dd></div><div><dt>Tarifa utilizada</dt><dd>Anexo 8 RMF 2026, apartado A.I</dd></div><div><dt>Rango aplicado</dt><dd>{money(latest.result.bracket.lower)} a {latest.result.bracket.upper?money(latest.result.bracket.upper):'en adelante'} · {latest.result.bracket.percentage}%</dd></div></dl>
              <div className={styles.summaryAmounts}><div><span>Ingreso considerado</span><strong>{money(latest.result.taxableIncome)}</strong></div><div><span>Deducciones actualizadas confirmadas</span><strong>{money(latest.result.consideredDeductions)}</strong></div><div><span>Ganancia</span><strong>{money(latest.result.gain)}</strong></div><div><span>ISR provisional federal</span><strong>{money(latest.result.provisionalFederalISR)}</strong></div></div>
              <h3>Deducciones incluidas y procedencia</h3>
              <div className={styles.summaryTable}><table><thead><tr><th>Concepto / tratamiento</th><th>Importe histórico</th><th>Importe actualizado</th><th>Origen</th><th>Confirmación</th></tr></thead><tbody>{determinationInput.deductions.filter((item)=>item.included).map((item)=><tr key={item.id}><td><strong>{item.concept}</strong><small>{treatmentLabels[item.treatment]} · {item.reason}</small></td><td>{money(item.historicalAmount)}</td><td>{money(item.updatedAmount)}</td><td>{item.updateOrigin==='MANUAL_CONFIRMED'?'Proporcionado manualmente; PRAVIA no calculó la actualización.':updateOriginLabels[item.updateOrigin]}<small>{item.updateMethod}</small></td><td>{item.confirmedBy}<small>{new Date(item.confirmedAt).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'})}</small></td></tr>)}</tbody></table></div>
              <footer><p><strong>Alcance:</strong> determinación provisional federal conforme al artículo 126 de la LISR. No constituye declaración, pago ni acuse del SAT.</p><p><strong>No incluido:</strong> pago a la entidad federativa previsto en el artículo 127 de la LISR y cualquier otra obligación fiscal no soportada.</p></footer>
            </section>
          </section>}

          {record&&<section className={styles.formSection}><header><div><span><History/></span><div><h2>Historial y versiones</h2><p>Cada recálculo conserva entrada, reglas, desglose y resultado originales.</p></div></div></header><div className={styles.timeline}>{record.versiones.length===0?<div className={styles.emptyInline}>Todavía no existe una versión calculada.</div>:record.versiones.map((version)=><article key={version.id}><span>v{version.version}</span><div><strong>Federal calculado · {new Date(version.calculated_at).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'})}</strong><small>Artículo 126 LISR · reglas {String((version.ruleset_snapshot as {version?:string}).version||version.result.ruleSet.version)}</small></div><strong>{money(version.result.provisionalFederalISR)}</strong></article>)}</div></section>}
        </main>

        <aside className={styles.documentColumn}>
          <section className={styles.documentPanel}><header><div><h2>Documentación</h2><p>Storage privado · acceso autenticado</p></div><span>{record?.documentos.length||0}</span></header>
            {!record&&<div className={styles.documentHint}>Guarda el borrador para habilitar la carga documental.</div>}
            {record&&<><input ref={fileRef} hidden type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(event)=>void upload(event.target.files?.[0])}/><button type="button" className={styles.uploadZone} onClick={()=>fileRef.current?.click()} disabled={!canWrite||Boolean(busy)}><FilePlus2/><strong>Cargar documento</strong><span>PDF, imagen, DOC o DOCX · hasta 25 MB</span></button><div className={styles.documentList}>{record.documentos.map((link)=><article key={link.id}><div className={styles.fileIcon}><FileSearch/></div><div><strong>{link.documento.nombre_original}</strong><small>{(link.documento.size_bytes/1024/1024).toFixed(1)} MB · {new Date(link.documento.fecha_carga).toLocaleDateString('es-MX')}</small></div><div><button type="button" onClick={()=>void preview(link.documento_id,link.documento.nombre_original,link.documento.mime_type)} aria-label={`Visualizar ${link.documento.nombre_original}`}><FileSearch/></button><button type="button" onClick={()=>record&&!fixture&&void isrService.download(record.id,link.documento_id,link.documento.nombre_original)} aria-label={`Descargar ${link.documento.nombre_original}`}><Download/></button><button type="button" onClick={()=>void removeDocument(link.documento_id)} aria-label={`Eliminar vínculo ${link.documento.nombre_original}`}><Trash2/></button></div></article>)}</div></>}
          </section>
          {record&&<section className={styles.aiPanel}><header><div><Bot/><div><h2>Extracción con PRAVIA IA</h2><p>Propone; tú confirmas.</p></div></div></header><button type="button" className={styles.aiButton} onClick={extract} disabled={!record.documentos.length||Boolean(busy)}><Bot/>{busy==='extract'?'Analizando documentos…':'Extraer información con IA'}</button>{mode==='extraction-before'&&<div className={styles.aiBefore}><strong>Antes de extraer</strong><p>Se analizarán todos los documentos disponibles. Ningún resultado modificará el cálculo automáticamente.</p></div>}
            {conflicts.length>0&&<div className={styles.conflict} role="alert"><AlertTriangle/><div><strong>Se encontraron valores distintos</strong><p>Selecciona la fuente correcta; PRAVIA no resolverá el conflicto silenciosamente.</p></div></div>}
            <div className={styles.proposalList}>{record.propuestas.filter((proposal)=>proposal.status!=='RECHAZADA').map((proposal)=><article key={proposal.id} className={proposal.status==='CONFLICTO'?styles.proposalConflict:''}><div className={styles.proposalMeta}><span>{proposal.field_path}</span><Badge tone={proposal.status==='CONFLICTO'?'danger':proposal.status==='ACEPTADA'?'success':'warning'}>{proposal.status==='CONFLICTO'?'Conflicto':proposal.status==='ACEPTADA'?'Confirmada':'Por revisar'}</Badge></div><strong>{String(proposal.proposed_value)}</strong><small>Fuente: {proposal.source_document_name}{proposal.source_page?` · pág. ${proposal.source_page}`:''} · confianza {proposal.confidence?`${Math.round(Number(proposal.confidence)*100)}%`:'no informada'}</small>{proposal.source_fragment&&<blockquote>{proposal.source_fragment}</blockquote>}{proposal.status!=='ACEPTADA'&&<div><button type="button" onClick={()=>void applyProposal(proposal,false)} disabled={Boolean(busy)}>Rechazar</button><button type="button" onClick={()=>void applyProposal(proposal,true)} disabled={Boolean(busy)}><Check/>Usar este dato</button></div>}</article>)}</div>
          </section>}
          <section className={styles.scopePanel}><strong>Alcance fiscal de esta versión</strong><p>Pago provisional federal 2026 conforme al artículo 126 de la LISR por enajenación ordinaria de inmueble, persona física residente en México, sin exención ni supuesto especial.</p><p>El pago a la entidad federativa del artículo 127 y otras obligaciones no soportadas no están incluidos.</p><a href="https://www.dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025" target="_blank" rel="noreferrer">Anexo 8 RMF 2026 <ExternalLink/></a></section>
        </aside>
      </div>
    </form>
    <DocumentViewer open={viewer.open} name={viewer.name} mimeType={viewer.mime} url={viewer.url} loading={viewer.loading} error={viewer.error} onClose={()=>setViewer({open:false,name:''})} onDownload={viewer.documentId&&record&&!fixture?()=>void isrService.download(record.id,viewer.documentId!,viewer.name):undefined}/>
  </PageContainer>;
}
