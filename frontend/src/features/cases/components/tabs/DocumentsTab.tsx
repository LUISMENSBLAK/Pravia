import { AlertTriangle, Download, FileText, FolderOpen, LoaderCircle, LockKeyhole, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { expedientesService } from '../../expedientes.service';
import type { ExpedienteDetail, ExpedienteDocumentAppendix, ExpedienteDocumentAppendixItem } from '../../expedientes.types';
import { dateTime } from '../../expedienteFormatters';
import styles from '../../Expedientes.module.css';

const originLabels: Record<string, string> = {
  PROSPECTO: 'Prospecto', COTIZACION: 'Cotización', COTIZACION_NOTARIA: 'Cotización Notaría',
  COMPARECIENTE: 'Compareciente', PREDIO: 'Predio', CFG002: 'Formato', ISR: 'ISR',
  FINANZAS: 'Finanzas', EXPEDIENTE: 'Expediente',
};

export function DocumentsTab({ expediente, onChanged }: { expediente: ExpedienteDetail; onChanged(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [appendix, setAppendix] = useState<ExpedienteDocumentAppendix | null>(null);
  const [busy, setBusy] = useState<'load' | 'sync' | 'upload' | string>('load');
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try { setAppendix(await expedientesService.documentAppendix(expediente.id, signal)); }
    catch { if (!signal?.aborted) setError('No pudimos cargar el apéndice documental.'); }
    finally { if (!signal?.aborted) setBusy(''); }
  }, [expediente.id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy('upload'); setError('');
    try {
      await expedientesService.uploadDocument(expediente.id, file, { categoria: 'PROYECTO', carpeta: 'Carga directa' });
      await load(); onChanged();
    } catch { setError('No pudimos subir el documento. El archivo no fue registrado.'); }
    finally { setBusy(''); if (input.current) input.current.value = ''; }
  };
  const sync = async () => {
    setBusy('sync'); setError('');
    try { setAppendix(await expedientesService.syncDocumentAppendix(expediente.id)); onChanged(); }
    catch { setError('No pudimos sincronizar. Recarga el expediente e inténtalo nuevamente.'); }
    finally { setBusy(''); }
  };
  const download = async (item: ExpedienteDocumentAppendixItem) => {
    setBusy(item.id); setError('');
    try {
      const result = await expedientesService.appendixSignedUrl(expediente.id, item.id);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch { setError('El registro existe, pero el archivo no está disponible para descarga.'); }
    finally { setBusy(''); }
  };
  const frozen = appendix?.state === 'CONGELADO_AL_FIRMAR';
  const total = appendix?.groups.reduce((sum, group) => sum + group.items.length, 0) || 0;

  return <section className={`${styles.sectionCard} ${styles.appendixCard}`}>
    <header className={styles.appendixHeader}>
      <div><div className={styles.appendixEyebrow}>Documentos · Apéndice de la operación</div><h2>Archivo documental</h2><p>{frozen ? 'La evidencia corresponde exactamente al momento de firma.' : 'Documentos vigentes sincronizados desde las fuentes autorizadas.'}</p></div>
      <div className={styles.appendixActions}>
        {!frozen && expediente.capabilities.canUploadDocuments && <><input ref={input} className={styles.srOnly} type="file" onChange={(event) => void upload(event.target.files?.[0])} /><button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => input.current?.click()}>{busy === 'upload' ? <LoaderCircle className={styles.spin} size={16} /> : <Upload size={16} />}Subir</button></>}
        {!frozen && expediente.capabilities.canUploadDocuments && <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void sync()}>{busy === 'sync' ? <LoaderCircle className={styles.spin} size={16} /> : <RefreshCw size={16} />}Sincronizar</button>}
      </div>
    </header>
    {appendix && <div className={frozen ? styles.appendixStateFrozen : styles.appendixStateLive} role="status">
      {frozen ? <LockKeyhole size={17} /> : <RefreshCw size={17} />}
      <div><strong>{frozen ? 'Apéndice congelado al firmar' : 'Sincronizado · Pre-firma'}</strong><span>{frozen && appendix.frozen_at ? dateTime(appendix.frozen_at) : `${total} documento${total === 1 ? '' : 's'} vigente${total === 1 ? '' : 's'} · Revisión ${appendix.revision.slice(0, 10)}`}</span></div>
    </div>}
    {error && <div className={styles.inlineError} role="alert">{error}</div>}
    {busy === 'load' && <div className={styles.appendixLoading}><LoaderCircle className={styles.spin} size={22} /><span>Reuniendo documentos vigentes…</span></div>}
    {!busy && appendix && appendix.groups.length === 0 && <div className={styles.appendixEmpty}><FolderOpen size={26} /><h3>El apéndice todavía está vacío</h3><p>Sincroniza las fuentes o carga un documento específico de esta operación.</p></div>}
    {appendix?.groups.map((group) => <section key={group.origin} className={styles.appendixGroup} aria-labelledby={`document-group-${group.origin}`}>
      <header><div><span>{originLabels[group.origin]}</span><h3 id={`document-group-${group.origin}`}>{group.label}</h3></div><b>{group.items.length}</b></header>
      <div className={styles.appendixSources}>{groupItems(group.items).map(([source, items]) => <article key={`${group.origin}-${source}`} className={styles.appendixSource}>
        <div className={styles.appendixSourceTitle}><strong>{source}</strong>{['COMPARECIENTE', 'PREDIO'].includes(group.origin) && <small>{group.origin === 'COMPARECIENTE' ? 'Persona vinculada' : 'Inmueble vinculado'}</small>}</div>
        <div className={styles.appendixItems}>{items.map((item) => <div key={item.id} className={styles.appendixItem}>
          <span className={styles.appendixFileIcon}><FileText size={18} /></span>
          <div className={styles.appendixFileCopy}><strong>{item.name}</strong><small>{item.type.replaceAll('_', ' ')} · Versión {item.document_version.slice(0, 10)}</small></div>
          <span className={styles.appendixOriginBadge}>{originLabels[item.origin]}</span>
          <span className={item.file_available ? styles.appendixAvailable : styles.appendixUnavailable}>{item.file_available ? 'Disponible' : <><AlertTriangle size={13} />Archivo no disponible</>}</span>
          {item.file_available ? <button type="button" className={styles.appendixDownload} disabled={busy === item.id} aria-label={`Descargar ${item.name}`} onClick={() => void download(item)}>{busy === item.id ? <LoaderCircle className={styles.spin} size={16} /> : <Download size={17} />}</button> : <span className={styles.appendixNoAction} aria-label="Sin descarga disponible" />}
        </div>)}</div>
      </article>)}</div>
    </section>)}
  </section>;
}

function groupItems(items: ExpedienteDocumentAppendixItem[]) {
  const grouped = new Map<string, ExpedienteDocumentAppendixItem[]>();
  for (const item of items) grouped.set(item.source_name || 'Fuente registrada', [...(grouped.get(item.source_name || 'Fuente registrada') || []), item]);
  return [...grouped.entries()];
}
