import { useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { financeService } from '../finance.service';
import type { FiscalProviderStatus } from '../finance.types';
import styles from '../Finance.module.css';
import { DocumentViewer } from '../../../components/documents/DocumentViewer';

type Item = { id: string; estado: string; updated_at?: string; emisor_rfc?: string; receptor_rfc?: string };
export function SandboxStampAction({ item, provider, onChanged }: { item: Item; provider: FiscalProviderStatus; onChanged: () => void }) {
  const { user } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewer, setViewer] = useState<{name:string;url?:string;loading:boolean;error?:string}|null>(null);
  const inFlight = useRef(false);
  if (!provider.sandboxStampingEnabled || provider.environment !== 'SANDBOX') return null;
  const allowed = Boolean(user?.permissions?.includes('finanzas.validate') && user.permissions.includes('documentos.write'));
  const completed = item.estado === 'TIMBRADO_SANDBOX';
  const processing = item.estado === 'TIMBRANDO_SANDBOX';
  const recovering = item.estado === 'RECUPERAR_SANDBOX';
  const identityReady = item.emisor_rfc === 'EKU9003173C9' && item.receptor_rfc === 'URE180429TM6';
  const submit = async () => {
    if (inFlight.current || !confirmed || !allowed || !item.updated_at || !identityReady) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await financeService.stampSandboxDraft(item.id, item.updated_at);
      setNotice('Timbrado de prueba guardado con XML y PDF. Sin validez fiscal.'); setConfirmed(false); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se confirmó el resultado. Recarga el registro; no crees otra factura para reintentar.'); onChanged(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const preview = async () => {
    setViewer({name:'CFDI sandbox · sin validez fiscal',loading:true});
    try { const file=await financeService.fiscalFileUrl(item.id,'pdf');setViewer({name:file.filename,url:file.url,loading:false}); }
    catch(reason){setViewer({name:'CFDI sandbox',loading:false,error:reason instanceof Error?reason.message:'No se pudo abrir el PDF.'});}
  };
  return <section className={styles.sandboxStamp} aria-label="Timbrado de prueba Facturama" aria-busy={busy}>
    <strong><ShieldCheck aria-hidden="true"/>Facturama SANDBOX · SIN VALIDEZ FISCAL</strong>
    {completed ? <><p role="status">Prueba terminada. Los archivos XML y PDF quedan disponibles en este registro.</p><button type="button" onClick={()=>void preview()}>Ver PDF de prueba</button></> : <>
      <p>Se utilizará exclusivamente el borrador guardado y los RFC públicos de prueba. No se envía al SAT productivo ni se registra un pago.</p>
      {!identityReady && <p>Esta fase sólo admite emisor EKU9003173C9 y receptor URE180429TM6. No reemplaces los datos de clientes reales para probar.</p>}
      {!allowed && <p>No tienes permiso de validación financiera y carga documental.</p>}
      {processing && <p role="status">Hay un intento en curso. Recarga para consultar su resultado; no se permite un segundo envío.</p>}
      {recovering && <p>El intento anterior está conservado. Recuperar consulta los archivos de la misma referencia; no emite otro CFDI.</p>}
      <label><input type="checkbox" checked={confirmed} disabled={busy || !allowed || !identityReady} onChange={(event) => setConfirmed(event.target.checked)}/>Confirmo que es una prueba sin validez fiscal y que guardé los datos.</label>
      <button type="button" disabled={!allowed || !identityReady || !confirmed || !item.updated_at || busy} onClick={() => void submit()}>
        {busy && <LoaderCircle className={styles.invoiceSpinner} aria-hidden="true"/>}{busy ? 'Esperando respuesta del sandbox…' : recovering ? 'Recuperar prueba guardada' : processing ? 'Consultar intento en curso' : 'Timbrar PRUEBA sandbox'}
      </button>
    </>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className={styles.fiscalError}>{error}</p>}
    <DocumentViewer open={Boolean(viewer)} name={viewer?.name||'CFDI sandbox'} mimeType="application/pdf" url={viewer?.url} loading={viewer?.loading} error={viewer?.error} onClose={()=>setViewer(null)}/>
  </section>;
}
