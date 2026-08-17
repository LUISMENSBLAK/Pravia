import { Download, Eye, FileCheck2, FileWarning, Trash2, UploadCloud, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DocumentViewer } from '../../../components/documents/DocumentViewer';
import { financeService } from '../finance.service';
import type { FinanceCatalogs, FinanceDocument, FinanceDocumentLink, FinanceMovement } from '../finance.types';
import { accountLabel, financeDate, money, statusLabel } from '../finance.utils';
import styles from '../Finance.module.css';

type Props = {
  movement: FinanceMovement;
  permissions?: FinanceCatalogs['permisos'];
  onChanged(): void;
  onClose(): void;
};

export function MovementDetail({ movement, permissions, onChanged, onClose }: Props) {
  const [evidence, setEvidence] = useState<FinanceDocumentLink[]>(movement.movimientoDocumentos || []);
  const [selected, setSelected] = useState<FinanceDocument | null>(null);
  const [viewerUrl, setViewerUrl] = useState('');
  const [viewerState, setViewerState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [deleteTarget, setDeleteTarget] = useState<FinanceDocument | null>(null);
  const [retireReason, setRetireReason] = useState('Comprobante retirado durante la revisión documental.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const openPreview = async (document: FinanceDocument) => {
    setSelected(document);
    setViewerState('loading');
    setViewerUrl('');
    setError('');
    try {
      const result = await financeService.receiptUrl(document.id);
      setViewerUrl(result.url);
      setViewerState('idle');
    } catch {
      setViewerState('error');
      setError('No pudimos preparar la vista previa. Puedes descargar el comprobante.');
    }
  };

  const download = async (document: FinanceDocument) => {
    setError('');
    try {
      await financeService.downloadReceipt(document.id, document.nombre_original);
    } catch {
      setError('No pudimos descargar el comprobante.');
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const document = await financeService.uploadReceipt(movement.id, file);
      setEvidence((current) => [{ id: document.id, tipo_vinculo: 'COMPROBANTE_PAGO', fecha_vinculo: new Date().toISOString(), documento: document }, ...current]);
      onChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'No pudimos adjuntar el comprobante.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const retire = async () => {
    if (!deleteTarget || !retireReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await financeService.retireReceipt(movement.id, deleteTarget.id, retireReason.trim());
      setEvidence((current) => current.filter((link) => link.documento.id !== deleteTarget.id));
      setDeleteTarget(null);
      onChanged();
    } catch (retireError) {
      setError(retireError instanceof Error ? retireError.message : 'No pudimos retirar el comprobante.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className={styles.drawerBackdrop}>
      <aside className={`${styles.drawer} ${styles.smallDrawer}`} role="dialog" aria-modal="true" aria-labelledby="movement-detail-title">
        <header className={styles.drawerHeader}>
          <div><small>{movement.folio || 'Movimiento histórico'}</small><h2 id="movement-detail-title">{movement.concepto}</h2></div>
          <button type="button" aria-label="Cerrar" onClick={onClose}><X /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.detailAmount} data-kind={movement.naturaleza}>
            <small>{movement.naturaleza === 'INGRESO' ? 'Ingreso' : 'Egreso'}</small>
            <strong>{money(movement.monto)}</strong>
            <span className={styles.statusPill} data-status={movement.estatus}>{statusLabel(movement.estatus)}</span>
          </div>
          <dl className={styles.detailList}>
            <div><dt>Fecha efectiva</dt><dd>{financeDate(movement.fecha_movimiento)}</dd></div>
            <div><dt>Expediente</dt><dd>{movement.expediente ? permissions?.expedientesLeer ? <Link to={`/expedientes/${movement.expediente.id}#finanzas`} onClick={onClose}>{movement.expediente.numero_pravia}</Link> : movement.expediente.numero_pravia : 'Movimiento general'}</dd></div>
            <div><dt>Cuenta</dt><dd>{accountLabel(movement.cuenta)}</dd></div>
            <div><dt>Referencia</dt><dd>{movement.referencia || 'Sin referencia'}</dd></div>
            <div><dt>Folio interno</dt><dd>{movement.comprobanteInterno?.folio || 'Pendiente de generar'}</dd></div>
          </dl>
          <section className={styles.detailDistribution}>
            <h3>Distribución económica</h3>
            {movement.distribuciones?.length ? movement.distribuciones.map((item, index) => <p key={item.id || index}><span>{item.categoria?.nombre || 'Clasificación'}</span><b>{money(item.monto)}</b></p>) : <p className={styles.legacyNote}>Clasificación histórica pendiente de revisión.</p>}
          </section>
          <section className={styles.movementEvidence} aria-labelledby="movement-evidence-title">
            <header>
              <div><h3 id="movement-evidence-title">Comprobantes</h3><p>Archivos privados vinculados directamente a este movimiento.</p></div>
              {permissions?.documentosEscribir && <><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => inputRef.current?.click()}><UploadCloud size={15} />Adjuntar</button><input ref={inputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.bmp,.doc,.docx" onChange={(event) => void upload(event.target.files?.[0])} /></>}
            </header>
            {evidence.length ? <div className={styles.evidenceList}>{evidence.map((link) => <article key={link.id}>
              <span><FileCheck2 /></span>
              <div><strong>{link.documento.nombre_original}</strong><small>{link.documento.mime_type || 'Archivo'}{link.documento.size_bytes ? ` · ${Math.max(1, Math.round(link.documento.size_bytes / 1024))} KB` : ''}</small></div>
              <nav aria-label={`Acciones de ${link.documento.nombre_original}`}>
                {permissions?.documentosLeer && <button type="button" aria-label={`Visualizar ${link.documento.nombre_original}`} onClick={() => void openPreview(link.documento)}><Eye /></button>}
                {permissions?.documentosLeer && <button type="button" aria-label={`Descargar ${link.documento.nombre_original}`} onClick={() => void download(link.documento)}><Download /></button>}
                {permissions?.documentosEliminar && <button type="button" aria-label={`Retirar ${link.documento.nombre_original}`} onClick={() => setDeleteTarget(link.documento)}><Trash2 /></button>}
              </nav>
            </article>)}</div> : <div className={styles.receiptAbsent}><FileWarning /><p><strong>Sin comprobante</strong><span>{permissions?.documentosEscribir ? 'Puedes adjuntarlo sin abandonar el movimiento.' : 'No hay evidencia documental vinculada.'}</span></p></div>}
          </section>
          {error && <p className={styles.formError} role="alert">{error}</p>}
        </div>
      </aside>
    </div>
    <DocumentViewer open={Boolean(selected)} name={selected?.nombre_original || ''} mimeType={selected?.mime_type} url={viewerUrl} loading={viewerState === 'loading'} error={viewerState === 'error' ? error : undefined} onClose={() => { setSelected(null); setViewerUrl(''); }} onDownload={selected ? () => void download(selected) : undefined} />
    {deleteTarget && <div className={styles.confirmBackdrop} role="presentation"><section className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="retire-receipt-title"><span><Trash2 /></span><h2 id="retire-receipt-title">Retirar comprobante</h2><p>El archivo dejará de mostrarse en este movimiento. La trazabilidad y el archivo privado se conservarán.</p><label><span>Motivo</span><textarea value={retireReason} onChange={(event) => setRetireReason(event.target.value)} rows={3} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<footer><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setDeleteTarget(null)}>Cancelar</button><button type="button" className={styles.dangerButton} disabled={busy || !retireReason.trim()} onClick={() => void retire()}>Retirar comprobante</button></footer></section></div>}
  </>;
}
