import { FileCheck2, FileClock, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import styles from '../Finance.module.css';
import { financeService } from '../finance.service';
import type { ExpedienteInvoice } from '../finance.types';

const money = (value: unknown) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value));

export function InvoicesView() {
  const { user } = useAuth();
  const canOpenExpediente = user?.role !== 'FINANCIERO';
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<ExpedienteInvoice[]>([]);
  const load = async (signal?: AbortSignal) => {
    setStatus('loading');
    try { const result = await financeService.expedienteInvoices(filter, signal); setItems(result.items); setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [filter]);
  return <section className={styles.invoiceWorkspace} aria-label="Facturas de expedientes">
    <header><div><small>Fuente: finanzas de expedientes</small><h2>Facturación</h2><p>Consulta los documentos fiscales vinculados al ingreso original; este listado no duplica la contabilidad.</p></div><div className={styles.invoiceFilters}><button type="button" data-active={!filter} onClick={()=>setFilter('')}>Todas</button><button type="button" data-active={filter==='PENDIENTE'} onClick={()=>setFilter('PENDIENTE')}>Pendientes</button><button type="button" data-active={filter==='CARGADA'} onClick={()=>setFilter('CARGADA')}>Cargadas</button></div></header>
    {status==='loading'&&<div className={styles.invoiceState} role="status">Cargando facturas…</div>}
    {status==='error'&&<div className={styles.invoiceState} role="alert"><span>No pudimos cargar las facturas.</span><button type="button" onClick={()=>void load()}><RefreshCw/>Reintentar</button></div>}
    {status==='ready'&&!items.length&&<div className={styles.invoiceState}><FileClock/><strong>No hay facturas en este estado</strong><p>Los ingresos registrados desde expedientes aparecerán aquí.</p></div>}
    {status==='ready'&&items.length>0&&<div className={styles.invoiceTableWrap}><table className={styles.invoiceTable}><thead><tr><th>Expediente</th><th>Compareciente</th><th>Monto</th><th>Estado</th><th>Documentos</th><th>Registro</th><th></th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><strong>{item.expediente.numero_pravia}</strong><small>{item.expediente.cliente_alias||'Sin alias'}</small></td><td>{item.facturarAVinculo?.compareciente.nombre_busqueda||'Sin asignar'}</td><td>{money(item.monto_validado||item.monto_reportado)}</td><td><span data-state={item.factura_estado}>{item.factura_estado==='CARGADA'?<FileCheck2/>:<FileClock/>}{item.factura_estado==='CARGADA'?'Factura cargada':'Factura pendiente'}</span></td><td>{item.documentos.length}/2</td><td>{date(item.created_at)}</td><td>{canOpenExpediente?<Link to={`/expedientes/${item.expediente_id}#finanzas`}>{item.factura_estado==='PENDIENTE'?'Completar factura':'Abrir expediente'}</Link>:<small>Administración completa en expediente</small>}</td></tr>)}</tbody></table><div className={styles.invoiceCards}>{items.map(item=><article key={item.id}><header><strong>{item.expediente.numero_pravia}</strong><span data-state={item.factura_estado}>{item.factura_estado==='CARGADA'?'Cargada':'Pendiente'}</span></header><h3>{item.facturarAVinculo?.compareciente.nombre_busqueda||'Sin asignar'}</h3><b>{money(item.monto_validado||item.monto_reportado)}</b><small>{item.documentos.length}/2 documentos fiscales · {date(item.created_at)}</small>{canOpenExpediente?<Link to={`/expedientes/${item.expediente_id}#finanzas`}>{item.factura_estado==='PENDIENTE'?'Completar factura':'Abrir expediente'}</Link>:<small>Administración completa en expediente</small>}</article>)}</div></div>}
  </section>;
}
