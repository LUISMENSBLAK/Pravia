import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { prospectsService, type ProspectDocumentReview } from '../prospects.service';
import styles from '../ProspectsPage.module.css';

export function ProspectDocumentReviewPanel({ prospectId, sourceKey, canRun }: {
  prospectId: string; sourceKey: string; canRun: boolean;
}) {
  const [data, setData] = useState<ProspectDocumentReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [omitted, setOmitted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    prospectsService.documentReview(prospectId, controller.signal).then((result) => {
      setData(result); setError('');
    }).catch((caught) => {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError('No pudimos cargar la revisión documental. Reintenta.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [prospectId, sourceKey]);

  const run = async () => {
    if (running) return;
    setRunning(true); setError(''); setOmitted(false);
    try {
      const result = await prospectsService.runDocumentReview(prospectId);
      setData({ ...result, available: data?.available ?? true, requiresManualReview: data?.requiresManualReview });
    } catch (caught) {
      const response = caught as { message?: string };
      setError(response.message || 'La revisión con IA no pudo completarse. Puedes continuar sin ella.');
    } finally { setRunning(false); }
  };

  const review = data?.review;
  const documentNames = new Map((review?.documents || []).map((document) => [document.id, document.name]));
  const unreadableIds = new Set((review?.unreadable || []).map((document) => document.id));
  return <section className={styles.detailSection} aria-label="Revisión documental con IA">
    <header><div><h2>Revisión documental con IA</h2><p>Preliminar y opcional. No modifica documentos ni datos del prospecto.</p></div><Sparkles size={20} aria-hidden="true" /></header>
    {loading && <p className={styles.sectionEmpty}>Cargando última revisión…</p>}
    {error && <p className={styles.formError} role="alert">{error}</p>}
    {!loading && review && <div className={styles.reviewResult}>
      {!data?.current && <p className={styles.reviewStale} role="status">Documentación o actos modificados después del último análisis. Vuelve a revisar con IA.</p>}
      <p><strong>Resultado preliminar · {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(review.reviewedAt))}</strong></p>
      <p>{review.summary}</p>
      {review.findings.length > 0 && <ul>{review.findings.map((finding, index) => <li key={index}>{finding.detail}
        {finding.document_ids.length > 0 && <small>Fuente: {finding.document_ids.map((id) => documentNames.get(id) || 'Documento vinculado').join(', ')}</small>}
      </li>)}</ul>}
      <small>Documentos analizados: {review.documents.filter((doc) => !unreadableIds.has(doc.id)).map((doc) => doc.name).join(', ') || 'Ninguno'}.</small>
      {review.unreadable.length > 0 && <p className={styles.reviewStale}>Revisión manual pendiente: {review.unreadable.map((doc) => doc.name).join(', ')}.</p>}
    </div>}
    {!loading && !data?.available && <p className={styles.sectionEmpty}>{data?.requiresManualReview?.length
      ? 'No hay archivos legibles automáticamente para esta revisión.'
      : 'Selecciona un acto y carga documentos para habilitar esta revisión.'}</p>}
    {!loading && Boolean(data?.requiresManualReview?.length) && <p className={styles.sectionEmpty}>Revisión manual necesaria para: {data?.requiresManualReview?.map((document) => document.name).join(', ')}. Estos archivos no se tratarán como analizados por IA.</p>}
    {!loading && omitted && <p className={styles.sectionEmpty} role="status">Continuarás sin revisión automática. Puedes volver a solicitarla después.</p>}
    {!loading && <div className={styles.reviewActions}>
      {canRun && data?.available && <button type="button" className={styles.secondaryButton} disabled={running} onClick={() => void run()}>
        {running ? <LoaderCircle size={16} className={styles.spin} /> : <Sparkles size={16} />}
        {running ? 'Analizando documentos…' : review ? 'Volver a revisar con IA' : 'Revisar con IA'}
      </button>}
      <button type="button" disabled={running} onClick={() => setOmitted(true)}>Omitir revisión por ahora</button>
    </div>}
  </section>;
}
