import { Building2, Download, Eye, FilePlus2, FileText, Landmark, LoaderCircle, Plus, RefreshCw, ShieldCheck, UploadCloud, UsersRound, WalletCards, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { DocumentViewer } from '../../../components/documents/DocumentViewer';
import styles from '../Finance.module.css';
import { financeService } from '../finance.service';
import { FiscalEntityDialog, FiscalEntityDetailDialog } from './FiscalEntityDialog';
import type { FiscalAccounts, FiscalConcept, FiscalDocument, FiscalEntity, FiscalProviderStatus, FiscalSupplier } from '../finance.types';

type Panel = 'documents'|'entities'|'concepts'|'suppliers'|'accounts';
const money = (value: unknown, currency = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(value || 0));
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
  const [dialog, setDialog] = useState<'manual'|'draft'|'entity'|'entityDetail'|'entityReplace'|'concept'|'supplier'|null>(null);
  const [selectedEntity,setSelectedEntity]=useState<FiscalEntity|null>(null);
  const [editingDraft,setEditingDraft]=useState<FiscalDocument|null>(null);
  const [notice, setNotice] = useState('');
  const canWrite = Boolean(user?.permissions?.includes('finanzas.write'));
  const canValidate = Boolean(user?.permissions?.includes('finanzas.validate'));
  const canReadDocuments = Boolean(user?.permissions?.includes('documentos.read'));
  const openSupplierCsf = async (supplierId:string, download:boolean) => {
    const preview = download ? null : window.open('', '_blank');
    try {
      const file = await financeService.fiscalSupplierCsfUrl(supplierId);
      if (download) {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error('El archivo de la constancia ya no está disponible.');
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = objectUrl; link.download = file.filename; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else if (preview) preview.location.href = file.url;
      else window.location.href = file.url;
    } catch (error) {
      preview?.close();
      setNotice(error instanceof Error ? error.message : 'No pudimos abrir la constancia.');
    }
  };

  const load = useCallback(async (signal?: AbortSignal, forceLoading = false) => {
    setStatus(previous=>forceLoading?'loading':previous==='ready'?'ready':'loading');
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
  const changed = (message: string) => { setDialog(null); setNotice(message); void load(undefined,true); window.setTimeout(() => setNotice(''), 3200); };

  return <section className={styles.fiscalWorkspace} aria-label="Facturación fiscal local">
    <header className={styles.fiscalHeader}>
      <div><small>Dominio fiscal canónico</small><h2>CFDI, cuentas y proveedores</h2><p>Borradores locales y XML/PDF reales, separados del movimiento financiero.</p></div>
      <div className={styles.fiscalActions}>{canWrite&&<button type="button" onClick={()=>setDialog('manual')}><UploadCloud/>Cargar XML/PDF</button>}{canWrite&&<button type="button" className={styles.fiscalPrimary} onClick={()=>{setEditingDraft(null);setDialog('draft');}}><FilePlus2/>Nueva factura</button>}</div>
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
    {status==='ready'&&panel==='documents'&&<Documents documents={documents} entities={entities} provider={provider} focusCfdiId={focusCfdiId} onEdit={canWrite?(item)=>{setEditingDraft(item);setDialog('draft');}:undefined} canGeneratePdf={canWrite&&canReadDocuments&&Boolean(user?.permissions?.includes('documentos.write'))} onChanged={()=>void load()} onDownload={async(id,kind)=>{const result=await financeService.fiscalFileUrl(id,kind);window.open(result.url,'_blank','noopener,noreferrer');}} onExport={()=>void financeService.downloadFiscalExport()}/>}
    {status==='ready'&&panel==='entities'&&<Cards title="Entidades fiscales" empty="Aún no hay entidades fiscales" action={canValidate?<button type="button" onClick={()=>setDialog('entity')}><Plus/>Agregar entidad fiscal</button>:null}>{entities.map(item=><article key={item.id}><header><span>{item.activa?'Activa':'Inactiva'}</span><small>{item.rfc}</small></header><h3>{item.razon_social}</h3><p>Régimen {item.regimen_fiscal} · CP {item.codigo_postal}</p><footer>{item.serie&&<span>Serie {item.serie}</span>}<span>{item.cuentas?.length||0} cuenta(s)</span><button type="button" onClick={()=>{setSelectedEntity(item);setDialog('entityDetail');}}>Abrir ficha</button></footer></article>)}</Cards>}
    {status==='ready'&&panel==='concepts'&&<Cards title="Conceptos fiscales configurados" empty="Todavía no hay conceptos fiscales para generar prefacturas" action={canValidate?<button type="button" onClick={()=>setDialog('concept')}><Plus/>Configurar concepto</button>:null}>{concepts.map(item=><article key={item.id}><header><span>{item.activo?'Activo':'Inactivo'}</span><small>{item.tipoActo?.nombre||'Cualquier acto'}</small></header><h3>{item.descripcion}</h3><p>Clave SAT {item.clave_prod_serv} · Unidad {item.clave_unidad} · Objeto {item.objeto_impuesto}</p><footer><span>IVA {item.iva_tasa}</span><span>Ret. IVA {item.iva_retencion_tasa}</span><span>Ret. ISR {item.isr_retencion_tasa}</span></footer></article>)}</Cards>}
    {status==='ready'&&panel==='suppliers'&&<Cards title="Proveedores" empty="Aún no hay proveedores fiscales" action={canWrite?<button type="button" onClick={()=>setDialog('supplier')}><Plus/>Agregar proveedor</button>:null}>{suppliers.map(item=><article key={item.id}><header><span>{item.activo?'Activo':'Inactivo'}</span><small>{item.rfc}</small></header><h3>{item.razon_social}</h3><p>{item.codigo_postal?`CP ${item.codigo_postal}`:'Sin CP'} · {item.regimenes_fiscales?.length||0} régimen(es)</p>{item.csf_extraction&&<p>CSF: {item.csf_extraction.confirmation_status==='CORRECTED'?'datos corregidos y confirmados':'datos confirmados'} · extracción {item.csf_extraction.extraction_status}</p>}{item.csf_documento_id&&canReadDocuments&&<footer><button type="button" onClick={()=>void openSupplierCsf(item.id,false)}>Ver CSF</button><button type="button" onClick={()=>void openSupplierCsf(item.id,true)}>Descargar CSF</button></footer>}</article>)}</Cards>}
    {status==='ready'&&panel==='accounts'&&<FiscalAccountsView data={accounts}/>}
    {dialog==='manual'&&<ManualDialog onClose={()=>setDialog(null)} onSaved={(message)=>changed(message)}/>}
    {dialog==='draft'&&<DraftDialog entities={entities} suppliers={suppliers} concepts={concepts} initial={editingDraft} onClose={()=>setDialog(null)} onSaved={()=>changed('Borrador fiscal guardado; no se invocó al PAC.')}/>}
    {dialog==='entity'&&<FiscalEntityDialog onClose={()=>setDialog(null)} onSaved={()=>changed('Entidad fiscal guardada.')}/>}
    {dialog==='entityReplace'&&selectedEntity&&<FiscalEntityDialog replacingEntity={selectedEntity} onClose={()=>setDialog('entityDetail')} onSaved={()=>changed('Nueva versión de CSF guardada.')}/>}
    {dialog==='entityDetail'&&selectedEntity&&<FiscalEntityDetailDialog entity={selectedEntity} canReadDocument={canReadDocuments} canReplace={canValidate&&Boolean(user?.permissions?.includes('documentos.write'))} onReplace={()=>setDialog('entityReplace')} onClose={()=>setDialog(null)}/>}
    {dialog==='concept'&&<FiscalConceptDialog entities={entities} acts={actOptions} onClose={()=>setDialog(null)} onSaved={()=>changed('Concepto fiscal configurado para esta organización.')}/>}
    {dialog==='supplier'&&<SupplierDialog onClose={()=>setDialog(null)} onSaved={changed}/>}
    {notice&&<div className={styles.fiscalToast} role="status">{notice}</div>}
  </section>;
}

function Documents({documents,entities,provider,focusCfdiId,onEdit,canGeneratePdf,onChanged,onDownload,onExport}:{documents:FiscalDocument[];entities:FiscalEntity[];provider:FiscalProviderStatus|null;focusCfdiId:string|null;onEdit?: (item:FiscalDocument)=>void;canGeneratePdf:boolean;onChanged:()=>void;onDownload:(id:string,kind:'xml'|'pdf')=>Promise<void>;onExport:()=>void}) {
  if (!documents.length) return <div className={styles.invoiceState}><FilePlus2/><strong>No hay CFDI ni prefacturas</strong><p>Crea una prefactura o carga XML/PDF sin simular timbrado.</p></div>;
  return <div className={styles.fiscalDocumentArea}><div className={styles.fiscalSectionTitle}><div><h3>Documentos fiscales</h3><p>{documents.length} registro(s) del tenant activo</p></div><button type="button" onClick={onExport}><Download/>Exportar XLSX</button></div><div className={styles.fiscalDocumentGrid}>{documents.map(item=><article key={item.id} id={`cfdi-${item.id}`} data-focused={focusCfdiId===item.id}><header><span data-state={item.estado}>{item.estado==='PREFACTURA'?'Prefactura':item.estado==='VIGENTE'?'Vigente':item.estado}</span><small>{item.direccion==='EMITIDO'?'Emitido':'Recibido'}</small></header><h3>{item.internal_folio||`${item.serie||''}${item.folio||item.uuid_fiscal?.slice(0,8)||'Sin folio fiscal'}`}</h3><p>{item.direccion==='EMITIDO'?item.receptor_nombre||'Receptor pendiente':item.emisor_nombre||'Emisor pendiente'}</p><strong>{money(item.total,item.moneda)}</strong><dl><div><dt>Método</dt><dd>{item.metodo_pago||'Sin definir'}</dd></div><div><dt>Saldo</dt><dd>{money(item.saldo,item.moneda)}</dd></div><div><dt>Registro</dt><dd>{date(item.created_at)}</dd></div></dl><footer>{item.xmlDocumento&&<button type="button" onClick={()=>void onDownload(item.id,'xml')}>XML</button>}{item.pdfDocumento&&<button type="button" onClick={()=>void onDownload(item.id,'pdf')}>PDF</button>}{onEdit&&item.source==='LOCAL_DRAFT'&&!item.ingreso_reportado_id&&['DRAFT','PREFACTURA'].includes(item.estado)&&<button type="button" onClick={()=>onEdit(item)}>Abrir borrador</button>}<small>{item.source==='MANUAL_XML'?'XML manual validado':'Borrador local'}</small></footer>{item.source==='LOCAL_DRAFT'&&item.direccion==='EMITIDO'&&['DRAFT','PREFACTURA'].includes(item.estado)&&<DraftPdfActions item={item} entity={entities.find(entity=>entity.id===item.entidad_fiscal_id)} provider={provider} canGenerate={canGeneratePdf} onChanged={onChanged}/>}</article>)}</div></div>;
}

export function fiscalStampBlockReason(item:FiscalDocument,provider:FiscalProviderStatus|null,entity?:FiscalEntity):string {
  const fiscal=item.draft_payload?.fiscal_comprobante;
  const missing=[
    !entity&&'entidad fiscal',!item.receptor_rfc&&'RFC receptor',!item.receptor_nombre&&'nombre receptor',
    entity&&(entity.regimenes_fiscales?.length||0)>1&&!fiscal?.regimen_emisor&&'régimen emisor',
    !item.receptor_regimen&&'régimen receptor',!item.receptor_codigo_postal&&'CP receptor',
    !item.uso_cfdi&&'Uso CFDI',!item.metodo_pago&&'método de pago',!item.forma_pago&&'forma de pago',
    !fiscal?.lugar_expedicion&&'lugar de expedición',!item.draft_payload?.concepts?.length&&'concepto fiscal',
    Number(item.total)<=0&&'importe mayor que cero',item.moneda!=='MXN'&&!fiscal?.tipo_cambio&&'tipo de cambio',
  ].filter((value):value is string=>typeof value==='string');
  if(missing.length)return `Faltan datos del borrador: ${missing.join(', ')}.`;
  if(!provider?.configured)return 'PAC no configurado.';
  if(!entity?.csd_key_configured||!entity.csd_password_configured)return 'CSD incompleto.';
  if(!provider.realStampingVerified)return 'PAC no certificado para timbrado real en este entorno.';
  return 'Timbrado real no habilitado en este entorno.';
}

function DraftPdfActions({item,entity,provider,canGenerate,onChanged}:{item:FiscalDocument;entity?:FiscalEntity;provider:FiscalProviderStatus|null;canGenerate:boolean;onChanged:()=>void}) {
  const [versions,setVersions]=useState<Awaited<ReturnType<typeof financeService.prefacturaVersions>>['versions']>([]);
  const [expanded,setExpanded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [viewer,setViewer]=useState<{version:number;name:string;url?:string;loading:boolean;error?:string}|null>(null);
  const refresh=async()=>{const result=await financeService.prefacturaVersions(item.id);setVersions(result.versions);setExpanded(true);};
  const generate=async()=>{setBusy(true);setError('');try{await financeService.generatePrefactura(item.id,crypto.randomUUID());await refresh();onChanged();}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos generar el PDF. El borrador permanece guardado.');}finally{setBusy(false);}};
  const open=async(version:number,name:string)=>{setViewer({version,name,loading:true});try{const file=await financeService.prefacturaVersionUrl(item.id,version);setViewer({version,name,url:file.url,loading:false});}catch(reason){setViewer({version,name,loading:false,error:reason instanceof Error?reason.message:'No pudimos abrir el PDF.'});}};
  const download=async(version:number)=>{try{const file=await financeService.prefacturaVersionUrl(item.id,version);const response=await fetch(file.url);if(!response.ok)throw new Error('El PDF no está disponible.');const blob=await response.blob();if(blob.type&&blob.type!=='application/pdf')throw new Error('El archivo recibido no es un PDF.');const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file.filename;document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60_000);}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos descargar el PDF.');}};
  const stampReason=fiscalStampBlockReason(item,provider,entity);
  return <section className={styles.fiscalPdfActions} aria-label={`Prefactura PDF de ${item.internal_folio||item.id}`}>
    <div><button type="button" disabled={busy} onClick={()=>void refresh().catch(reason=>setError(reason instanceof Error?reason.message:'No pudimos consultar las versiones.'))}><FileText/>Versiones PDF</button>{canGenerate&&<button type="button" disabled={busy} onClick={()=>void generate()}>{busy?<LoaderCircle className={styles.invoiceSpinner}/>:<FilePlus2/>}Generar nueva versión PDF</button>}</div>
    <div><button type="button" disabled title={stampReason}>Timbrar CFDI</button><p className={styles.fiscalHint}>Timbrado no disponible: {stampReason}</p></div>
    {error&&<p role="alert" className={styles.fiscalError}>{error}</p>}
    {expanded&&<>{versions.length?<ul className={styles.invoicePdfVersions}>{versions.map(version=><li key={version.id}><div><strong>v{version.version} · {version.documento.nombre_original}</strong><small>SHA-256 {version.pdf_sha256.slice(0,12)}… · {new Date(version.created_at).toLocaleString('es-MX')}</small></div><div><button type="button" onClick={()=>void open(version.version,version.documento.nombre_original)}><Eye/>Ver</button><button type="button" onClick={()=>void download(version.version)}><Download/>Descargar</button></div></li>)}</ul>:<p className={styles.fiscalHint}>Aún no hay PDF. Completa y guarda el borrador antes de generarlo.</p>}</>}
    <DocumentViewer open={Boolean(viewer)} name={viewer?.name||'Prefactura'} mimeType="application/pdf" url={viewer?.url} loading={viewer?.loading} error={viewer?.error} onClose={()=>setViewer(null)} onDownload={viewer?()=>void download(viewer.version):undefined}/>
  </section>;
}

function Cards({title,empty,action,children}:{title:string;empty:string;action:ReactNode;children:ReactNode}) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div className={styles.fiscalCardSection}><div className={styles.fiscalSectionTitle}><div><h3>{title}</h3><p>{count} registro(s)</p></div>{action}</div>{count?<div className={styles.fiscalCards}>{children}</div>:<div className={styles.invoiceState}><strong>{empty}</strong></div>}</div>;
}

function FiscalAccountsView({data}:{data:FiscalAccounts}) {
  return <div className={styles.fiscalAccounts}><AccountColumn title="Cuentas por cobrar" empty="Sin cuentas por cobrar" rows={data.receivables.map(item=>({id:item.id,title:item.concepto,total:item.monto_total,balance:item.saldo,status:item.estado}))}/><AccountColumn title="Cuentas por pagar" empty="Sin cuentas por pagar" rows={data.payables.map(item=>({id:item.id,title:item.proveedor?.razon_social||item.concepto,total:item.monto_total,balance:item.saldo,status:item.estado}))}/><AccountColumn title="Transferencias internas" empty="Sin transferencias" rows={data.transfers.map(item=>({id:item.id,title:`${item.cuentaOrigen.alias} → ${item.cuentaDestino.alias}`,total:item.monto,balance:0,status:'P&L 0'}))}/></div>;
}
function AccountColumn({title,empty,rows}:{title:string;empty:string;rows:Array<{id:string;title:string;total:unknown;balance:unknown;status:string}>}) {return <section><h3>{title}</h3>{!rows.length?<p>{empty}</p>:rows.map(row=><article key={row.id}><header><strong>{row.title}</strong><span>{row.status}</span></header><dl><div><dt>Total</dt><dd>{money(row.total)}</dd></div><div><dt>Saldo</dt><dd>{money(row.balance)}</dd></div></dl></article>)}</section>}

function Dialog({title,subtitle,onClose,children,wide=false}:{title:string;subtitle:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {return <div className={styles.fiscalOverlay} role="presentation" onMouseDown={(event)=>{if(event.currentTarget===event.target)onClose();}}><section className={`${styles.fiscalDialog} ${wide?styles.fiscalDialogWide:''}`} role="dialog" aria-modal="true" aria-label={title}><header><div><small>Facturación local</small><h2>{title}</h2><p>{subtitle}</p></div><button type="button" aria-label="Cerrar" onClick={onClose}><X/></button></header>{children}</section></div>}
function Field({label,children}:{label:string;children:ReactNode}) {return <label className={styles.fiscalField}><span>{label}</span>{children}</label>}

function ManualDialog({onClose,onSaved}:{onClose:()=>void;onSaved:(message:string)=>void}) {
  const [xml,setXml]=useState<File|null>(null);const [pdf,setPdf]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title="Cargar CFDI manual" subtitle="El XML es la fuente fiscal; el PDF es opcional." onClose={onClose}><form onSubmit={async(event)=>{event.preventDefault();if(!xml)return;setBusy(true);setError('');try{const result:any=await financeService.uploadFiscalDocument(xml,pdf||undefined);onSaved(result.supplierStatus==='UNREGISTERED'?'CFDI guardado. Proveedor no registrado: revisa el prellenado.':'CFDI y archivos guardados correctamente.');}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos cargar el CFDI.');}finally{setBusy(false);}}}><div className={styles.fiscalFormGrid}><Field label="XML CFDI 4.0"><input required type="file" accept=".xml,application/xml,text/xml" onChange={event=>setXml(event.target.files?.[0]||null)}/></Field><Field label="PDF opcional"><input type="file" accept=".pdf,application/pdf" onChange={event=>setPdf(event.target.files?.[0]||null)}/></Field></div><p className={styles.fiscalHint}>No se inventa UUID ni se convierte un borrador en timbrado.</p>{error&&<p className={styles.fiscalError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className={styles.fiscalPrimary} disabled={!xml||busy}>{busy?'Validando XML…':'Cargar CFDI'}</button></footer></form></Dialog>;
}

function scaledDecimal(raw:string,scale:number):bigint|null {
  const match=raw.trim().match(new RegExp(`^(\\d+)(?:\\.(\\d{1,${scale}}))?$`));
  if(!match)return null;
  return BigInt(match[1])*10n**BigInt(scale)+BigInt((match[2]||'').padEnd(scale,'0'));
}
function fiscalLinePreview(quantity:string,unitPrice:string,concept:FiscalConcept|null) {
  if(!concept)return null;
  const qty=scaledDecimal(quantity,6);const price=scaledDecimal(unitPrice,2);
  if(qty===null||price===null||qty<=0n||price<=0n)return null;
  const subtotal=(qty*price+500_000n)/1_000_000n;
  const tax=(rate:string)=>{const scaled=scaledDecimal(rate,6);return scaled===null?null:(subtotal*scaled+500_000n)/1_000_000n;};
  const iva=tax(concept.iva_tasa),ivaRetention=tax(concept.iva_retencion_tasa),isrRetention=tax(concept.isr_retencion_tasa);
  if(iva===null||ivaRetention===null||isrRetention===null)return null;
  const retained=ivaRetention+isrRetention,total=subtotal+iva-retained;
  if(total<=0n)return null;
  const format=(cents:bigint)=>`${cents/100n}.${(cents%100n).toString().padStart(2,'0')}`;
  return {subtotal:format(subtotal),transferred:format(iva),retained:format(retained),total:format(total)};
}
function DraftDialog({entities,suppliers,concepts,initial,onClose,onSaved}:{entities:FiscalEntity[];suppliers:FiscalSupplier[];concepts:FiscalConcept[];initial:FiscalDocument|null;onClose:()=>void;onSaved:()=>void}) {
  const [direction,setDirection]=useState<'EMITIDO'|'RECIBIDO'>(initial?.direccion||'EMITIDO');
  const [entityId,setEntityId]=useState(initial?.entidad_fiscal_id||'');
  const [place,setPlace]=useState(initial?.draft_payload?.fiscal_comprobante?.lugar_expedicion||'');
  const [emitterRegime,setEmitterRegime]=useState(initial?.draft_payload?.fiscal_comprobante?.regimen_emisor||'');
  const [currency,setCurrency]=useState(initial?.moneda||'MXN');
  const [exchangeRate,setExchangeRate]=useState(String(initial?.draft_payload?.fiscal_comprobante?.tipo_cambio||''));
  const [conceptId,setConceptId]=useState(initial?.draft_payload?.concepts?.length===1?initial.draft_payload.concepts[0].concepto_fiscal_id||'':'');
  const [quantity,setQuantity]=useState(initial?.draft_payload?.concepts?.length===1?initial.draft_payload.concepts[0].cantidad||'1':'1');
  const [unitPrice,setUnitPrice]=useState(initial?.draft_payload?.concepts?.length===1?initial.draft_payload.concepts[0].valor_unitario||'':'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [receiverRfc,setReceiverRfc]=useState(initial?.receptor_rfc||'');
  const [receiverRegime,setReceiverRegime]=useState(initial?.receptor_regimen||'');
  const [receiverUse,setReceiverUse]=useState(initial?.uso_cfdi||'');
  const [regimeQuery,setRegimeQuery]=useState('');
  const [regimes,setRegimes]=useState<Array<{clave:string;descripcion:string;tipo:string}>>([]);
  const [uses,setUses]=useState<Array<{clave:string;descripcion:string;tiposPersona:string[];regimenesReceptor:string[]}>>([]);
  useEffect(()=>{let active=true;void Promise.all([financeService.fiscalRegimes(),financeService.fiscalUses()])
    .then(([nextRegimes,nextUses])=>{if(active){setRegimes(nextRegimes?.items || []);setUses(nextUses?.items || []);}})
    .catch(()=>{if(active)setError('No pudimos cargar los catálogos SAT. Puedes guardar un borrador incompleto y reintentar.');});
    return()=>{active=false;};},[]);
  const receiverType=receiverRfc.trim().length===12?'MORAL':receiverRfc.trim().length===13?'FISICA':'';
  const visibleRegimes=regimes.filter(item=>(!receiverType||item.tipo===receiverType||item.tipo==='AMBAS')&&
    `${item.clave} ${item.descripcion}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .includes(regimeQuery.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()));
  const visibleUses=uses.filter(item=>receiverRegime&&receiverType&&item.regimenesReceptor.includes(receiverRegime)&&
    item.tiposPersona.includes(receiverType));
  const source=initial?.draft_payload?.fiscal_comprobante;
  const eligibleConcepts=useMemo(()=>concepts.filter(item=>item.activo&&item.entidad_fiscal_id===entityId&&!item.tipo_acto_id),[concepts,entityId]);
  const selectedConcept=eligibleConcepts.find(item=>item.id===conceptId)||null;
  const amounts=fiscalLinePreview(quantity,unitPrice,selectedConcept);
  const totalCents=amounts?scaledDecimal(amounts.total,2):null;
  const fxUnits=scaledDecimal(exchangeRate,6);
  const equivalentCents=currency==='MXN'||totalCents===null||fxUnits===null||fxUnits<=0n?null:(totalCents*fxUnits+500_000n)/1_000_000n;
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const value=(key:string)=>String(form.get(key)||'').trim();
    const payload:Record<string,unknown>={
      direccion:direction,tipo:initial?.tipo||'I',entidad_fiscal_id:entityId,
      regimen_emisor:direction==='EMITIDO'?emitterRegime:undefined,
      proveedor_id:direction==='RECIBIDO'?value('supplier'):undefined,
      emisor_rfc:value('emisor_rfc'),emisor_nombre:value('emisor_nombre'),
      receptor_rfc:value('receptor_rfc'),receptor_nombre:value('receptor_nombre'),
      receptor_regimen:value('receptor_regimen'),receptor_codigo_postal:value('receptor_cp'),
      uso_cfdi:value('uso_cfdi'),metodo_pago:value('metodo'),forma_pago:value('forma'),
      moneda:currency,tipo_cambio:currency==='MXN'?'':exchangeRate,
      lugar_expedicion:value('lugar_expedicion'),condiciones_pago:value('condiciones_pago'),
    };
    if(conceptId&&direction==='EMITIDO'){
      if(!amounts){setError('Indica cantidad y valor unitario válidos para el concepto fiscal configurado.');return;}
      payload.conceptos=[{concepto_fiscal_id:conceptId,cantidad:quantity,valor_unitario:unitPrice}];
      payload.subtotal=amounts.subtotal;payload.impuestos_trasladados=amounts.transferred;
      payload.impuestos_retenidos=amounts.retained;payload.total=amounts.total;
    }
    setBusy(true);setError('');
    try{
      if(initial) await financeService.updateFiscalDraft(initial.id,payload);
      else await financeService.createFiscalDraft({...payload,allow_incomplete:true,source_context:'CENTRAL',
        idempotency_key:crypto.randomUUID()});
      onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:'No pudimos guardar el borrador.');}
    finally{setBusy(false);}
  };
  return <Dialog wide title={initial?`Borrador ${initial.internal_folio||''}`:'Nueva factura'}
    subtitle="Guarda y retoma el borrador sin inventar importes ni invocar al PAC." onClose={onClose}>
    <form onSubmit={event=>void submit(event)}>
      <p className={styles.fiscalHint}>Origen: captura manual. Los datos que aún no conoces pueden quedar pendientes; el PDF exige un concepto fiscal configurado y un importe validado.</p>
      <fieldset className={styles.fiscalEditorSection}><legend>Origen y emisor</legend>
        <div className={styles.fiscalFormGrid}>
          <Field label="Dirección"><select value={direction} disabled={Boolean(initial)} onChange={event=>setDirection(event.target.value as 'EMITIDO'|'RECIBIDO')}><option value="EMITIDO">Emitido</option><option value="RECIBIDO">Recibido</option></select></Field>
          <Field label="Entidad fiscal"><select value={entityId} onChange={event=>{const nextId=event.target.value;
            const previousCp=entities.find(item=>item.id===entityId)?.codigo_postal;
            if(!place||place===previousCp)setPlace(entities.find(item=>item.id===nextId)?.codigo_postal||'');
            const nextEntity=entities.find(item=>item.id===nextId);
            const choices=nextEntity?.regimenes_fiscales?.length?nextEntity.regimenes_fiscales.map(item=>item.clave):nextEntity?[nextEntity.regimen_fiscal]:[];
            setEmitterRegime(choices.length===1?choices[0]:'');
            setEntityId(nextId);}}><option value="">Por definir</option>{entities.filter(item=>item.activa).map(item=><option key={item.id} value={item.id}>{item.razon_social} · {item.rfc}</option>)}</select></Field>
          {direction==='EMITIDO'&&entityId&&<Field label="Régimen emisor para esta factura"><select value={emitterRegime} onChange={event=>setEmitterRegime(event.target.value)}>
            <option value="">Seleccionar régimen confirmado</option>
            {(entities.find(item=>item.id===entityId)?.regimenes_fiscales?.length
              ? entities.find(item=>item.id===entityId)!.regimenes_fiscales!
              : [{clave:entities.find(item=>item.id===entityId)?.regimen_fiscal||'',descripcion:'Régimen histórico'}])
              .map(item=><option key={item.clave} value={item.clave}>{item.clave} — {item.descripcion}</option>)}
          </select></Field>}
          {direction==='RECIBIDO'&&<Field label="Proveedor"><select name="supplier" defaultValue={initial?.proveedor_id||''}><option value="">Por definir</option>{suppliers.filter(item=>item.activo).map(item=><option key={item.id} value={item.id}>{item.razon_social}</option>)}</select></Field>}
          {direction==='RECIBIDO'&&<Field label="RFC emisor"><input name="emisor_rfc" defaultValue={initial?.emisor_rfc||''}/></Field>}
          {direction==='RECIBIDO'&&<Field label="Nombre emisor"><input name="emisor_nombre" defaultValue={initial?.emisor_nombre||''}/></Field>}
          <Field label="Lugar de expedición"><input name="lugar_expedicion" inputMode="numeric" maxLength={5} value={place} onChange={event=>setPlace(event.target.value)} placeholder="CP confirmado"/></Field>
        </div>
      </fieldset>
      <fieldset className={styles.fiscalEditorSection}><legend>Receptor</legend>
        <div className={styles.fiscalFormGrid}>
          <Field label="RFC receptor"><input name="receptor_rfc" value={receiverRfc} onChange={event=>setReceiverRfc(event.target.value.toUpperCase())} placeholder="Capturar cuando se confirme"/></Field>
          <Field label="Nombre o razón social"><input name="receptor_nombre" defaultValue={initial?.receptor_nombre||''}/></Field>
          <Field label="Buscar régimen SAT"><input type="search" value={regimeQuery} onChange={event=>setRegimeQuery(event.target.value)} placeholder="Clave o descripción"/></Field>
          <Field label="Régimen receptor"><select name="receptor_regimen" value={receiverRegime} onChange={event=>{setReceiverRegime(event.target.value);setReceiverUse('');}}><option value="">Por confirmar</option>{receiverRegime&&!visibleRegimes.some(item=>item.clave===receiverRegime)&&<option value={receiverRegime} disabled>{receiverRegime} · Dato histórico por revisar</option>}{visibleRegimes.map(item=><option key={item.clave} value={item.clave}>{item.clave} — {item.descripcion}</option>)}</select></Field>
          <Field label="Código postal fiscal"><input name="receptor_cp" inputMode="numeric" maxLength={5} defaultValue={initial?.receptor_codigo_postal||''}/></Field>
          <Field label="Uso CFDI"><select name="uso_cfdi" value={receiverUse} onChange={event=>setReceiverUse(event.target.value)} disabled={!receiverRegime||!receiverType}><option value="">Por confirmar</option>{receiverUse&&!visibleUses.some(item=>item.clave===receiverUse)&&<option value={receiverUse} disabled>{receiverUse} · Dato histórico incompatible</option>}{visibleUses.map(item=><option key={item.clave} value={item.clave}>{item.clave} — {item.descripcion}</option>)}</select></Field>
        </div>
      </fieldset>
      <fieldset className={styles.fiscalEditorSection}><legend>Comprobante y pago</legend>
        <div className={styles.fiscalFormGrid}>
          <Field label="Moneda"><select value={currency} onChange={event=>setCurrency(event.target.value)}><option value="MXN">MXN</option><option value="USD">USD</option><option value="CAD">CAD</option></select></Field>
          {currency!=='MXN'&&<Field label="Tipo de cambio a MXN"><input name="tipo_cambio" inputMode="decimal" value={exchangeRate} onChange={event=>setExchangeRate(event.target.value)} placeholder="Captura una tasa comprobada antes de generar PDF"/></Field>}
          <Field label="Método de pago"><select name="metodo" defaultValue={initial?.metodo_pago||''}><option value="">Por definir</option><option value="PUE">PUE</option><option value="PPD">PPD</option></select></Field>
          <Field label="Forma de pago"><input name="forma" defaultValue={initial?.forma_pago||''} placeholder="Por confirmar"/></Field>
          <Field label="Condiciones de pago (opcional)"><input name="condiciones_pago" defaultValue={source?.condiciones_pago||''}/></Field>
        </div>
        {currency!=='MXN'&&<p className={styles.fiscalHint} role="status">{equivalentCents===null?'Indica un concepto y un tipo de cambio positivo para ver la equivalencia informativa.':`${money(amounts!.total,currency)} × ${exchangeRate} = MXN ${new Intl.NumberFormat('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(equivalentCents)/100)} equivalentes (informativo; no crea otra factura).`}</p>}
      </fieldset>
      <fieldset className={styles.fiscalEditorSection}><legend>Concepto e importe</legend>
        <p className={styles.fiscalHint}>El importe se verifica en el servidor contra el concepto fiscal configurado; no se toma una tasa escrita libremente.</p>
        <div className={styles.fiscalFormGrid}>
          <Field label="Concepto fiscal configurado"><select value={conceptId} disabled={direction==='RECIBIDO'} onChange={event=>setConceptId(event.target.value)}><option value="">Sin concepto: guardar sin importe</option>{eligibleConcepts.map(item=><option key={item.id} value={item.id}>{item.descripcion} · {item.clave_prod_serv}</option>)}</select></Field>
          {conceptId&&direction==='EMITIDO'&&<><Field label="Cantidad"><input inputMode="decimal" value={quantity} onChange={event=>setQuantity(event.target.value)}/></Field><Field label="Valor unitario"><input inputMode="decimal" value={unitPrice} onChange={event=>setUnitPrice(event.target.value)}/></Field></>}
        </div>
        {amounts&&<p className={styles.fiscalHint} role="status">Subtotal {money(amounts.subtotal,currency)} · Impuestos {money(amounts.transferred,currency)} · Retenciones {money(amounts.retained,currency)} · Total {money(amounts.total,currency)}.</p>}
        {direction==='EMITIDO'&&!eligibleConcepts.length&&entityId&&<p className={styles.fiscalHint}>No hay concepto fiscal general activo para este emisor. Puedes guardar el borrador sin importe; no se generará PDF hasta configurar uno.</p>}
      </fieldset>
      {initial&&<p className={styles.fiscalHint}>Importe guardado: {money(initial.total,initial.moneda)}. Esta vista no cambia el importe ni las versiones PDF existentes.</p>}
      {error&&<p className={styles.fiscalError} role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cerrar sin guardar</button><button className={styles.fiscalPrimary} disabled={busy}>{busy?'Guardando…':'Guardar borrador'}</button></footer>
    </form>
  </Dialog>;
}

function SupplierDialog({onClose,onSaved}:{onClose:()=>void;onSaved:(message:string)=>void}) {
  const [csf,setCsf]=useState<File|null>(null);
  const [fields,setFields]=useState({razon_social:'',rfc:'',codigo_postal:'',regimen_fiscal:'',correo:''});
  const [extracting,setExtracting]=useState(false);
  const [busy,setBusy]=useState(false);
  const [reviewed,setReviewed]=useState(false);
  const [regimes,setRegimes]=useState<Array<{clave:string;descripcion:string}>>([]);
  const [unmappedRegimes,setUnmappedRegimes]=useState<Array<{descripcion:string;fecha_inicio:string|null}>>([]);
  const [extractionStatus,setExtractionStatus]=useState('');
  const [csfSha256,setCsfSha256]=useState('');
  const [error,setError]=useState('');
  const choose=async(file:File|null)=>{
    setCsf(file);setReviewed(false);setError('');setRegimes([]);setUnmappedRegimes([]);setExtractionStatus('');setCsfSha256('');
    if(!file)return;
    setExtracting(true);
    try{
      const result=await financeService.extractCsf(file);
      setRegimes(result.regimenes_fiscales||[]);
      setUnmappedRegimes(result.regimenes_documentales||[]);
      setExtractionStatus(result.status==='EXTRACTED'?'Datos detectados':result.status==='PARTIALLY_EXTRACTED'?'Datos parciales':'Revisión requerida');
      setCsfSha256(result.sha256);
      setFields(previous=>({
        ...previous,
        razon_social:result.razon_social||previous.razon_social,
        rfc:result.rfc||previous.rfc,
        codigo_postal:result.codigo_postal||previous.codigo_postal,
        regimen_fiscal:result.regimenes_fiscales?.length===1?result.regimenes_fiscales[0].clave:'',
      }));
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo extraer la CSF. Revisa el archivo.');}
    finally{setExtracting(false);}
  };
  const update=(key:keyof typeof fields,value:string)=>setFields(previous=>({...previous,[key]:value}));
  return <Dialog title="Agregar proveedor" subtitle="Carga la constancia fiscal y confirma los datos extraídos antes de guardarlos." onClose={onClose}>
    <form onSubmit={async(event)=>{event.preventDefault();if(!csf||!reviewed||!csfSha256)return;setBusy(true);setError('');try{const result=await financeService.createFiscalSupplier({...fields,regimenes_fiscales:regimes,csf_sha256:csfSha256,csf_reviewed:true},csf) as {idempotent?:boolean};onSaved(result?.idempotent?'Proveedor existente reutilizado; no se guardó una segunda CSF.':'Proveedor fiscal y constancia guardados.');}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos guardar el proveedor.');}finally{setBusy(false);}}}>
      <div className={styles.fiscalFormGrid}>
        <Field label="Constancia de situación fiscal"><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={event=>void choose(event.target.files?.[0]||null)}/></Field>
        <Field label="Razón social"><input required value={fields.razon_social} onChange={event=>update('razon_social',event.target.value)}/></Field>
        <Field label="RFC"><input required value={fields.rfc} onChange={event=>update('rfc',event.target.value.toUpperCase())}/></Field>
        <Field label="Código postal fiscal"><input required inputMode="numeric" maxLength={5} value={fields.codigo_postal} onChange={event=>update('codigo_postal',event.target.value)}/></Field>
        <Field label="Régimen fiscal"><select required value={fields.regimen_fiscal} disabled={!regimes.length} onChange={event=>update('regimen_fiscal',event.target.value)}><option value="">{regimes.length?'Seleccionar':'Sin clave fiscal verificada'}</option>{regimes.map(item=><option key={item.clave} value={item.clave}>{item.clave} — {item.descripcion||'Descripción no detectada'}</option>)}</select></Field>
        <Field label="Correo (opcional)"><input type="email" value={fields.correo} onChange={event=>update('correo',event.target.value)}/></Field>
      </div>
      <p className={styles.fiscalHint} role="status">{extracting?'Extrayendo datos del archivo con el motor local…':extractionStatus?`Extracción: ${extractionStatus}. ${regimes.length} régimen(es) con clave detectada(s); se conservarán todos. Confirma los datos antes de guardar.`:'Carga un PDF o imagen. La extracción no sustituye la revisión fiscal humana.'}</p>
      {unmappedRegimes.length>0&&<p className={styles.fiscalHint} role="alert">La constancia menciona {unmappedRegimes.length} régimen(es) sin clave SAT explícita. Confirma la clave con el catálogo oficial antes de guardar; PRAVIA no la asigna por semejanza de nombre.</p>}
      {error&&csf&&!csfSha256&&<button type="button" disabled={extracting||busy} onClick={()=>void choose(csf)}>Reintentar extracción del archivo seleccionado</button>}
      <label className={styles.fiscalField}><span><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/> Confirmé los datos fiscales con el documento</span></label>
      {error&&<p className={styles.fiscalError} role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className={styles.fiscalPrimary} disabled={!csf||!csfSha256||!reviewed||!fields.regimen_fiscal||extracting||busy}>{busy?'Guardando…':'Guardar proveedor'}</button></footer>
    </form>
  </Dialog>;
}
function FiscalConceptDialog({entities,acts,onClose,onSaved}:{entities:FiscalEntity[];acts:Array<{id:string;nombre:string}>;onClose:()=>void;onSaved:()=>void}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title="Configurar concepto fiscal" subtitle="El responsable fiscal confirma claves y tasas; PRAVIA no las infiere del nombre del acto." onClose={onClose}><form onSubmit={async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');try{await financeService.createFiscalConcept({entidad_fiscal_id:form.get('entity'),tipo_acto_id:form.get('act')||null,descripcion:form.get('description'),clave_prod_serv:form.get('product'),clave_unidad:form.get('unit'),objeto_impuesto:form.get('taxObject'),iva_tasa:form.get('iva'),iva_retencion_tasa:form.get('ivaRetention'),isr_retencion_tasa:form.get('isrRetention')});onSaved();}catch(reason){setError(reason instanceof Error?reason.message:'No pudimos guardar el concepto fiscal.');}finally{setBusy(false);}}}><div className={styles.fiscalFormGrid}><Field label="Entidad emisora"><select name="entity" required><option value="">Seleccionar</option>{entities.filter(item=>item.activa).map(item=><option key={item.id} value={item.id}>{item.razon_social}</option>)}</select></Field><Field label="Acto (opcional)"><select name="act"><option value="">Cualquier acto</option>{acts.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></Field><Field label="Descripción"><input name="description" required maxLength={500}/></Field><Field label="Clave SAT producto/servicio"><input name="product" required inputMode="numeric" pattern="[0-9]{8}" maxLength={8}/></Field><Field label="Clave SAT unidad"><input name="unit" required maxLength={8}/></Field><Field label="Objeto de impuesto"><select name="taxObject" required><option value="">Seleccionar</option><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></Field><Field label="Tasa IVA (0 a 1)"><input name="iva" required inputMode="decimal" pattern="(?:0|1)(?:\.[0-9]{1,6})?" placeholder="Confirmar tasa"/></Field><Field label="Tasa retención IVA (0 a 1)"><input name="ivaRetention" required inputMode="decimal" pattern="(?:0|1)(?:\.[0-9]{1,6})?" placeholder="Confirmar tasa"/></Field><Field label="Tasa retención ISR (0 a 1)"><input name="isrRetention" required inputMode="decimal" pattern="(?:0|1)(?:\.[0-9]{1,6})?" placeholder="Confirmar tasa"/></Field></div><p className={styles.fiscalHint}>No se aplica una tasa universal. Si una retención no corresponde, registra explícitamente 0.</p>{error&&<p className={styles.fiscalError} role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className={styles.fiscalPrimary} disabled={busy||!entities.some(item=>item.activa)}>{busy?'Guardando…':'Guardar concepto'}</button></footer></form></Dialog>;
}
