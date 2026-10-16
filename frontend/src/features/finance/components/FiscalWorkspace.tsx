import { Building2, Download, FilePlus2, Landmark, Plus, RefreshCw, ShieldCheck, UploadCloud, UsersRound, WalletCards, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import styles from '../Finance.module.css';
import { financeService } from '../finance.service';
import type { FiscalAccounts, FiscalConcept, FiscalDocument, FiscalEntity, FiscalProviderStatus, FiscalSupplier } from '../finance.types';

type Panel = 'documents'|'entities'|'concepts'|'suppliers'|'accounts';
const money = (value: unknown) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value));
const emptyAccounts: FiscalAccounts = { receivables: [], payables: [], transfers: [] };

export function FiscalWorkspace() {
  const [searchParams] = useSearchParams();
  const focusCfdiId = searchParams.get('cfdi_id');
  const { user } = useAuth();
  const [panel, setPanel] = useState<Panel>('documents');
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [provider, setProvider] = useState<FiscalProviderStatus|null>(null);
  const [entities, setEntities] = useState<FiscalEntity[]>([]);
  const [concepts, setConcepts] = useState<FiscalConcept[]>([]);
  const [actOptions, setActOptions] = useState<Array<{id:string;nombre:string}>>([]);
  const [suppliers, setSuppliers] = useState<FiscalSupplier[]>([]);
  const [documents, setDocuments] = useState<FiscalDocument[]>([]);
  const [accounts, setAccounts] = useState<FiscalAccounts>(emptyAccounts);
  const [dialog, setDialog] = useState<'manual'|'draft'|'entity'|'concept'|'supplier'|null>(null);
  const [notice, setNotice] = useState('');
  const canWrite = Boolean(user?.permissions?.includes('finanzas.write'));
  const canValidate = Boolean(user?.permissions?.includes('finanzas.validate'));

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading');
    try {
      const [nextProvider, nextEntities, nextConcepts, nextActs, nextSuppliers, nextDocuments, nextAccounts] = await Promise.all([
        financeService.fiscalStatus(signal), financeService.fiscalEntities(signal), financeService.fiscalConcepts(undefined,signal), financeService.fiscalActOptions(signal), financeService.fiscalSuppliers(signal), financeService.fiscalDocuments(signal), financeService.fiscalAccounts(signal),
      ]);
      setProvider(nextProvider); setEntities(nextEntities); setConcepts(Array.isArray(nextConcepts)?nextConcepts:[]); setActOptions(Array.isArray(nextActs)?nextActs:[]); setSuppliers(nextSuppliers); setDocuments(nextDocuments.items); setAccounts(nextAccounts); setStatus('ready');
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (status !== 'ready' || !focusCfdiId) return;
    const target = document.getElementById(`cfdi-${focusCfdiId}`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [status, focusCfdiId]);
  const changed = (message: string) => { setDialog(null); setNotice(message); void load(); window.setTimeout(() => setNotice(''), 3200); };

  return <section className={styles.fiscalWorkspace} aria-label="Facturación fiscal local">
    <header className={styles.fiscalHeader}>
      <div><small>Dominio fiscal canónico</small><h2>CFDI, cuentas y proveedores</h2><p>Borradores locales y XML/PDF reales, separados del movimiento financiero.</p></div>
      <div className={styles.fiscalActions}>{canWrite&&<button type="button" onClick={()=>setDialog('manual')}><UploadCloud/>Cargar XML/PDF</button>}{canWrite&&<button type="button" className={styles.fiscalPrimary} onClick={()=>setDialog('draft')}><FilePlus2/>Nueva prefactura</button>}</div>
    </header>
    {provider&&<div className={provider.configured?styles.fiscalProviderReady:styles.fiscalProviderPending}><ShieldCheck/><div><strong>{provider.configured?'Proveedor fiscal configurado':'Timbrado externo no configurado'}</strong><p>{provider.message}</p></div><span>{provider.configured?'Requiere certificación':'Carga manual disponible'}</span></div>}
    <nav className={styles.fiscalNav} aria-label="Secciones fiscales">
      <button type="button" data-active={panel==='documents'} onClick={()=>setPanel('documents')}><WalletCards/>CFDI</button>
      <button type="button" data-active={panel==='entities'} onClick={()=>setPanel('entities')}><Landmark/>Entidades fiscales</button>
      <button type="button" data-active={panel==='concepts'} onClick={()=>setPanel('concepts')}><FilePlus2/>Conceptos fiscales</button>
      <button type="button" data-active={panel==='suppliers'} onClick={()=>setPanel('suppliers')}><UsersRound/>Proveedores</button>
      <button type="button" data-active={panel==='accounts'} onClick={()=>setPanel('accounts')}><Building2/>CxC / CxP</button>
    </nav>
    {status==='loading'&&<div className={styles.invoiceState} role="status">Cargando información fiscal…</div>}
    {status==='error'&&<div className={styles.invoiceState} role="alert"><strong>No pudimos cargar la información fiscal.</strong><button type="button" onClick={()=>void load()}><RefreshCw/>Reintentar</button></div>}
    {status==='ready'&&panel==='documents'&&<Documents documents={documents} focusCfdiId={focusCfdiId} onDownload={async(id,kind)=>{const result=await financeService.fiscalFileUrl(id,kind);window.open(result.url,'_blank','noopener,noreferrer');}} onExport={()=>void financeService.downloadFiscalExport()}/>}
    {status==='ready'&&panel==='entities'&&<Cards title="Entidades fiscales" empty="Aún no hay entidades fiscales" action={canValidate?<button type="button" onClick={()=>setDialog('entity')}><Plus/>Agregar entidad</button>:null}>{entities.map(item=><article key={item.id}><header><span>{item.activa?'Activa':'Inactiva'}</span><small>{item.rfc}</small></header><h3>{item.razon_social}</h3><p>Régimen {item.regimen_fiscal} · CP {item.codigo_postal}</p><footer>{item.serie&&<span>Serie {item.serie}</span>}<span>{item.cuentas?.length||0} cuenta(s)</span></footer></article>)}</Cards>}
    {status==='ready'&&panel==='concepts'&&<Cards title="Conceptos fiscales configurados" empty="Todavía no hay conceptos fiscales para generar prefacturas" action={canValidate?<button type="button" onClick={()=>setDialog('concept')}><Plus/>Configurar concepto</button>:null}>{concepts.map(item=><article key={item.id}><header><span>{item.activo?'Activo':'Inactivo'}</span><small>{item.tipoActo?.nombre||'Cualquier acto'}</small></header><h3>{item.descripcion}</h3><p>Clave SAT {item.clave_prod_serv} · Unidad {item.clave_unidad} · Objeto {item.objeto_impuesto}</p><footer><span>IVA {item.iva_tasa}</span><span>Ret. IVA {item.iva_retencion_tasa}</span><span>Ret. ISR {item.isr_retencion_tasa}</span></footer></article>)}</Cards>}
    {status==='ready'&&panel==='suppliers'&&<Cards title="Proveedores" empty="Aún no hay proveedores fiscales" action={canWrite?<button type="button" onClick={()=>setDialog('supplier')}><Plus/>Agregar proveedor</button>:null}>{suppliers.map(item=><article key={item.id}><header><span>{item.activo?'Activo':'Inactivo'}</span><small>{item.rfc}</small></header><h3>{item.razon_social}</h3><p>{item.codigo_postal?`CP ${item.codigo_postal}`:'Sin CP'} · {item.regimenes_fiscales?.length||0} régimen(es)</p></article>)}</Cards>}
    {status==='ready'&&panel==='accounts'&&<FiscalAccountsView data={accounts}/>}
    {dialog==='manual'&&<ManualDialog onClose={()=>setDialog(null)} onSaved={(message)=>changed(message)}/>}
    {dialog==='draft'&&<DraftDialog entities={entities} suppliers={suppliers} onClose={()=>setDialog(null)} onSaved={()=>changed('Prefactura creada sin invocar al PAC.')}/>}
    {dialog==='entity'&&<EntityDialog onClose={()=>setDialog(null)} onSaved={()=>changed('Entidad fiscal guardada.')}/>}
    {dialog==='concept'&&<FiscalConceptDialog entities={entities} acts={actOptions} onClose={()=>setDialog(null)} onSaved={()=>changed('Concepto fiscal configurado para esta organización.')}/>}
    {dialog==='supplier'&&<SupplierDialog onClose={()=>setDialog(null)} onSaved={changed}/>}
    {notice&&<div className={styles.fiscalToast} role="status">{notice}</div>}
  </section>;
}

function Documents({documents,focusCfdiId,onDownload,onExport}:{documents:FiscalDocument[];focusCfdiId:string|null;onDownload:(id:string,kind:'xml'|'pdf')=>Promise<void>;onExport:()=>void}) {
  if (!documents.length) return <div className={styles.invoiceState}><FilePlus2/><strong>No hay CFDI ni prefacturas</strong><p>Crea una prefactura o carga XML/PDF sin simular timbrado.</p></div>;
  return <div className={styles.fiscalDocumentArea}><div className={styles.fiscalSectionTitle}><div><h3>Documentos fiscales</h3><p>{documents.length} registro(s) del tenant activo</p></div><button type="button" onClick={onExport}><Download/>Exportar XLSX</button></div><div className={styles.fiscalDocumentGrid}>{documents.map(item=><article key={item.id} id={`cfdi-${item.id}`} data-focused={focusCfdiId===item.id}><header><span data-state={item.estado}>{item.estado==='PREFACTURA'?'Prefactura':item.estado==='VIGENTE'?'Vigente':item.estado}</span><small>{item.direccion==='EMITIDO'?'Emitido':'Recibido'}</small></header><h3>{item.serie||''}{item.folio||item.uuid_fiscal?.slice(0,8)||'Sin folio fiscal'}</h3><p>{item.direccion==='EMITIDO'?item.receptor_nombre:item.emisor_nombre}</p><strong>{money(item.total)}</strong><dl><div><dt>Método</dt><dd>{item.metodo_pago||'Sin definir'}</dd></div><div><dt>Saldo</dt><dd>{money(item.saldo)}</dd></div><div><dt>Registro</dt><dd>{date(item.created_at)}</dd></div></dl><footer>{item.xmlDocumento&&<button type="button" onClick={()=>void onDownload(item.id,'xml')}>XML</button>}{item.pdfDocumento&&<button type="button" onClick={()=>void onDownload(item.id,'pdf')}>PDF</button>}<small>{item.source==='MANUAL_XML'?'XML manual validado':'Borrador local'}</small></footer></article>)}</div></div>;
}

function Cards({title,empty,action,children}:{title:string;empty:string;action:ReactNode;children:ReactNode}) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div className={styles.fiscalCardSection}><div className={styles.fiscalSectionTitle}><div><h3>{title}</h3><p>{count} registro(s)</p></div>{action}</div>{count?<div className={styles.fiscalCards}>{children}</div>:<div className={styles.invoiceState}><strong>{empty}</strong></div>}</div>;
}

function FiscalAccountsView({data}:{data:FiscalAccounts}) {
  return <div className={styles.fiscalAccounts}><AccountColumn title="Cuentas por cobrar" empty="Sin cuentas por cobrar" rows={data.receivables.map(item=>({id:item.id,title:item.concepto,total:item.monto_total,balance:item.saldo,status:item.estado}))}/><AccountColumn title="Cuentas por pagar" empty="Sin cuentas por pagar" rows={data.payables.map(item=>({id:item.id,title:item.proveedor?.razon_social||item.concepto,total:item.monto_total,balance:item.saldo,status:item.estado}))}/><AccountColumn title="Transferencias internas" empty="Sin transferencias" rows={data.transfers.map(item=>({id:item.id,title:`${item.cuentaOrigen.alias} → ${item.cuentaDestino.alias}`,total:item.monto,balance:0,status:'P&L 0'}))}/></div>;
}
function AccountColumn({title,empty,rows}:{title:string;empty:string;rows:Array<{id:string;title:string;total:unknown;balance:unknown;status:string}>}) {return <section><h3>{title}</h3>{!rows.length?<p>{empty}</p>:rows.map(row=><article key={row.id}><header><strong>{row.title}</strong><span>{row.status}</span></header><dl><div><dt>Total</dt><dd>{money(row.total)}</dd></div><div><dt>Saldo</dt><dd>{money(row.balance)}</dd></div></dl></article>)}</section>}

function Dialog({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:ReactNode}) {return <div className={styles.fiscalOverlay} role="presentation" onMouseDown={(event)=>{if(event.currentTarget===event.target)onClose();}}><section className={styles.fiscalDialog} role="dialog" aria-modal="true" aria-label={title}><header><div><small>Facturación local</small><h2>{title}</h2><p>{subtitle}</p></div><button type="button" aria-label="Cerrar" onClick={onClose}><X/></button></header>{children}</section></div>}
function Field({label,children}:{label:string;children:ReactNode}) {return <label className={styles.fiscalField}><span>{label}</span>{children}</label>}

function ManualDialog({onClose,onSaved}:{onClose:()=>void;onSaved:(message:string)=>void}) {
  const [xml,setXml]=useState<File|null>(null);const [pdf,setPdf]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title="Cargar CFDI manual" subtitle="El XML es la fuente fiscal; el PDF es opcional." onClose={onClose}><form onSubmit={async(event)=>{event.preventDefault();if(!xml)return;setBusy(true);setError('');try{const result:any=await financeService.uploadFiscalDocument(xml,pdf||undefined);onSaved(result.supplierStatus==='UNREGISTERED'?'CFDI guardado. Proveedor no registrado: revisa el prellenado.':'CFDI y archivos guardados correctamente.');}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos cargar el CFDI.');}finally{setBusy(false);}}}><div className={styles.fiscalFormGrid}><Field label="XML CFDI 4.0"><input required type="file" accept=".xml,application/xml,text/xml" onChange={event=>setXml(event.target.files?.[0]||null)}/></Field><Field label="PDF opcional"><input type="file" accept=".pdf,application/pdf" onChange={event=>setPdf(event.target.files?.[0]||null)}/></Field></div><p className={styles.fiscalHint}>No se inventa UUID ni se convierte un borrador en timbrado.</p>{error&&<p className={styles.fiscalError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className={styles.fiscalPrimary} disabled={!xml||busy}>{busy?'Validando XML…':'Cargar CFDI'}</button></footer></form></Dialog>;
}

function DraftDialog({entities,suppliers,onClose,onSaved}:{entities:FiscalEntity[];suppliers:FiscalSupplier[];onClose:()=>void;onSaved:()=>void}) {
  const [direction,setDirection]=useState<'EMITIDO'|'RECIBIDO'>('EMITIDO');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const defaults=useMemo(()=>({entity:entities[0]?.id||'',supplier:suppliers[0]?.id||''}),[entities,suppliers]);
  return <Dialog title="Nueva prefactura" subtitle="Borrador editable; no invoca al PAC." onClose={onClose}><form onSubmit={async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');try{await financeService.createFiscalDraft({direccion:direction,tipo:'I',entidad_fiscal_id:form.get('entity'),proveedor_id:direction==='RECIBIDO'?form.get('supplier'):undefined,emisor_rfc:form.get('emisor_rfc'),emisor_nombre:form.get('emisor_nombre'),receptor_rfc:form.get('receptor_rfc'),receptor_nombre:form.get('receptor_nombre'),receptor_regimen:form.get('receptor_regimen'),receptor_codigo_postal:form.get('receptor_cp'),uso_cfdi:form.get('uso_cfdi'),subtotal:form.get('subtotal'),impuestos_trasladados:form.get('iva'),impuestos_retenidos:'0.00',total:form.get('total'),metodo_pago:form.get('metodo'),forma_pago:form.get('forma'),moneda:'MXN',concepto:form.get('concepto'),source_context:'CENTRAL',idempotency_key:crypto.randomUUID()});onSaved();}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos crear la prefactura.');}finally{setBusy(false);}}}><div className={styles.fiscalFormGrid}><Field label="Dirección"><select value={direction} onChange={event=>setDirection(event.target.value as 'EMITIDO'|'RECIBIDO')}><option value="EMITIDO">Emitido</option><option value="RECIBIDO">Recibido</option></select></Field><Field label="Entidad fiscal"><select name="entity" defaultValue={defaults.entity} required><option value="">Seleccionar</option>{entities.map(item=><option key={item.id} value={item.id}>{item.razon_social}</option>)}</select></Field>{direction==='RECIBIDO'&&<Field label="Proveedor"><select name="supplier" defaultValue={defaults.supplier}><option value="">Sin registrar</option>{suppliers.map(item=><option key={item.id} value={item.id}>{item.razon_social}</option>)}</select></Field>}<Field label="RFC emisor"><input name="emisor_rfc" placeholder="AAA010101AAA" required={direction==='RECIBIDO'}/></Field><Field label="Nombre emisor"><input name="emisor_nombre" required={direction==='RECIBIDO'}/></Field><Field label="RFC receptor"><input name="receptor_rfc" placeholder="XAXX010101000" required/></Field><Field label="Nombre receptor"><input name="receptor_nombre" required/></Field><Field label="Régimen receptor"><input name="receptor_regimen" placeholder="616"/></Field><Field label="CP receptor"><input name="receptor_cp" inputMode="numeric" pattern="[0-9]{5}" required/></Field><Field label="Uso CFDI"><input name="uso_cfdi" defaultValue="G03"/></Field><Field label="Método"><select name="metodo" defaultValue="PPD"><option>PUE</option><option>PPD</option></select></Field><Field label="Forma"><input name="forma" defaultValue="99"/></Field><Field label="Subtotal"><input name="subtotal" inputMode="decimal" required/></Field><Field label="IVA trasladado"><input name="iva" inputMode="decimal" defaultValue="0.00" required/></Field><Field label="Total"><input name="total" inputMode="decimal" required/></Field><Field label="Concepto"><input name="concepto" required/></Field></div>{error&&<p className={styles.fiscalError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className={styles.fiscalPrimary} disabled={busy||!entities.length}>{busy?'Guardando…':'Crear prefactura'}</button></footer></form></Dialog>;
}

function EntityDialog({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}) {return <SimpleDialog title="Agregar entidad fiscal" onClose={onClose} onSaved={onSaved} submit={data=>financeService.createFiscalEntity({...data,tipo_contribuyente:'MORAL'})} fields={[['razon_social','Razón social'],['rfc','RFC'],['regimen_fiscal','Régimen fiscal'],['codigo_postal','Código postal'],['serie','Serie opcional']]}/>}
function SupplierDialog({onClose,onSaved}:{onClose:()=>void;onSaved:(message:string)=>void}) {
  const [csf,setCsf]=useState<File|null>(null);
  const [fields,setFields]=useState({razon_social:'',rfc:'',codigo_postal:'',regimen_fiscal:'',correo:''});
  const [extracting,setExtracting]=useState(false);
  const [busy,setBusy]=useState(false);
  const [reviewed,setReviewed]=useState(false);
  const [error,setError]=useState('');
  const choose=async(file:File|null)=>{
    setCsf(file);setReviewed(false);setError('');
    if(!file)return;
    setExtracting(true);
    try{
      const result=await financeService.extractCsf(file);
      setFields(previous=>({
        ...previous,
        razon_social:result.razon_social||previous.razon_social,
        rfc:result.rfc||previous.rfc,
        codigo_postal:result.codigo_postal||previous.codigo_postal,
        regimen_fiscal:result.regimenes_fiscales?.[0]?.clave||previous.regimen_fiscal,
      }));
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo extraer la CSF. Revisa los datos manualmente.');}
    finally{setExtracting(false);}
  };
  const update=(key:keyof typeof fields,value:string)=>setFields(previous=>({...previous,[key]:value}));
  return <Dialog title="Agregar proveedor" subtitle="Carga la constancia fiscal y confirma los datos extraídos antes de guardarlos." onClose={onClose}>
    <form onSubmit={async(event)=>{event.preventDefault();if(!csf||!reviewed)return;setBusy(true);setError('');try{const result=await financeService.createFiscalSupplier(fields,csf) as {idempotent?:boolean};onSaved(result?.idempotent?'Proveedor existente reutilizado; no se guardó una segunda CSF.':'Proveedor fiscal y constancia guardados.');}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos guardar el proveedor.');}finally{setBusy(false);}}}>
      <div className={styles.fiscalFormGrid}>
        <Field label="Constancia de situación fiscal"><input type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={event=>void choose(event.target.files?.[0]||null)}/></Field>
        <Field label="Razón social"><input required value={fields.razon_social} onChange={event=>update('razon_social',event.target.value)}/></Field>
        <Field label="RFC"><input required value={fields.rfc} onChange={event=>update('rfc',event.target.value.toUpperCase())}/></Field>
        <Field label="Código postal fiscal"><input required inputMode="numeric" maxLength={5} value={fields.codigo_postal} onChange={event=>update('codigo_postal',event.target.value)}/></Field>
        <Field label="Régimen fiscal"><input required value={fields.regimen_fiscal} onChange={event=>update('regimen_fiscal',event.target.value)}/></Field>
        <Field label="Correo (opcional)"><input type="email" value={fields.correo} onChange={event=>update('correo',event.target.value)}/></Field>
      </div>
      <p className={styles.fiscalHint}>{extracting?'Extrayendo datos de la CSF…':'La extracción es una sugerencia: confirma RFC, régimen y domicilio fiscal. La CSF queda vinculada al proveedor.'}</p>
      <label className={styles.fiscalField}><span><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/> Confirmé los datos fiscales con el documento</span></label>
      {error&&<p className={styles.fiscalError} role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className={styles.fiscalPrimary} disabled={!csf||!reviewed||extracting||busy}>{busy?'Guardando…':'Guardar proveedor'}</button></footer>
    </form>
  </Dialog>;
}
function FiscalConceptDialog({entities,acts,onClose,onSaved}:{entities:FiscalEntity[];acts:Array<{id:string;nombre:string}>;onClose:()=>void;onSaved:()=>void}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title="Configurar concepto fiscal" subtitle="El responsable fiscal confirma claves y tasas; PRAVIA no las infiere del nombre del acto." onClose={onClose}><form onSubmit={async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');try{await financeService.createFiscalConcept({entidad_fiscal_id:form.get('entity'),tipo_acto_id:form.get('act')||null,descripcion:form.get('description'),clave_prod_serv:form.get('product'),clave_unidad:form.get('unit'),objeto_impuesto:form.get('taxObject'),iva_tasa:form.get('iva'),iva_retencion_tasa:form.get('ivaRetention'),isr_retencion_tasa:form.get('isrRetention')});onSaved();}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos guardar el concepto fiscal.');}finally{setBusy(false);}}}><div className={styles.fiscalFormGrid}><Field label="Entidad emisora"><select name="entity" required><option value="">Seleccionar</option>{entities.filter(item=>item.activa).map(item=><option key={item.id} value={item.id}>{item.razon_social}</option>)}</select></Field><Field label="Acto (opcional)"><select name="act"><option value="">Cualquier acto</option>{acts.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></Field><Field label="Descripción"><input name="description" required maxLength={500}/></Field><Field label="Clave SAT producto/servicio"><input name="product" required inputMode="numeric" pattern="[0-9]{8}" maxLength={8}/></Field><Field label="Clave SAT unidad"><input name="unit" required maxLength={8}/></Field><Field label="Objeto de impuesto"><select name="taxObject" required><option value="">Seleccionar</option><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></Field><Field label="Tasa IVA (0 a 1)"><input name="iva" required inputMode="decimal" pattern="(?:0|1)(?:\.[0-9]{1,6})?" placeholder="Confirmar tasa"/></Field><Field label="Tasa retención IVA (0 a 1)"><input name="ivaRetention" required inputMode="decimal" pattern="(?:0|1)(?:\.[0-9]{1,6})?" placeholder="Confirmar tasa"/></Field><Field label="Tasa retención ISR (0 a 1)"><input name="isrRetention" required inputMode="decimal" pattern="(?:0|1)(?:\.[0-9]{1,6})?" placeholder="Confirmar tasa"/></Field></div><p className={styles.fiscalHint}>No se aplica una tasa universal. Si una retención no corresponde, registra explícitamente 0.</p>{error&&<p className={styles.fiscalError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className={styles.fiscalPrimary} disabled={busy||!entities.some(item=>item.activa)}>{busy?'Guardando…':'Guardar concepto'}</button></footer></form></Dialog>;
}
function SimpleDialog({title,onClose,onSaved,submit,fields}:{title:string;onClose:()=>void;onSaved:()=>void;submit:(data:Record<string,string>)=>Promise<unknown>;fields:Array<[string,string]>}) {const [busy,setBusy]=useState(false);const [error,setError]=useState('');return <Dialog title={title} subtitle="Los datos se guardan sólo para la organización activa." onClose={onClose}><form onSubmit={async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const raw=new FormData(event.currentTarget);const data=Object.fromEntries(fields.map(([name])=>[name,String(raw.get(name)||'')]));setBusy(true);setError('');try{await submit(data);onSaved();}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos guardar.');}finally{setBusy(false);}}}><div className={styles.fiscalFormGrid}>{fields.map(([name,label])=><Field key={name} label={label}><input name={name} required={name!=='serie'} /></Field>)}</div>{error&&<p className={styles.fiscalError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className={styles.fiscalPrimary} disabled={busy}>{busy?'Guardando…':'Guardar'}</button></footer></form></Dialog>}
