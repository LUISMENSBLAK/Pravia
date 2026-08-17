import { Download, FileWarning, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import styles from './DocumentViewer.module.css';

type Props = {
  open: boolean;
  name: string;
  mimeType?: string | null;
  url?: string;
  loading?: boolean;
  error?: string;
  onClose(): void;
  onDownload?(): void;
};

const previewKind = (mime = '', name = '') => {
  const value = `${mime} ${name}`.toLowerCase();
  if (value.includes('pdf') || value.endsWith('.pdf')) return 'pdf';
  if (value.includes('image/') || /\.(png|jpe?g|bmp)$/.test(value)) return 'image';
  return 'unsupported';
};

function PreviewFallback({ onDownload }: { onDownload?: () => void }) {
  return <div className={styles.previewFallback} role="alert">
    <FileWarning aria-hidden="true" />
    <strong>No pudimos mostrar la vista previa de este documento.</strong>
    <p>Puedes descargar el archivo para abrirlo con una aplicación compatible.</p>
    {onDownload && <button type="button" onClick={onDownload}><Download />Descargar documento</button>}
  </div>;
}

function PdfPreview({ url, name, onDownload }: { url: string; name: string; onDownload?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let active = true;
    let loadingTask: { destroy(): Promise<void> } | undefined;
    let renderTask: { cancel(): void } | undefined;

    const renderFirstPage = async () => {
      setState('loading');
      try {
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ url });
        loadingTask = task;
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        if (!active || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, (canvas.parentElement?.clientWidth || 860) - 56);
        const viewport = page.getViewport({ scale: Math.min(1.55, availableWidth / baseViewport.width) });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas unavailable');

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const pageRender = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        renderTask = pageRender;
        await pageRender.promise;
        if (active) {
          setPages(pdf.numPages);
          setState('ready');
        }
      } catch (error) {
        if (active && !(error instanceof Error && error.name === 'RenderingCancelledException')) setState('error');
      }
    };

    void renderFirstPage();
    return () => {
      active = false;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [url]);

  return <div className={styles.pdfPreview} aria-label={`Vista previa de ${name}`}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Renderizando documento…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    <canvas ref={canvasRef} hidden={state !== 'ready'} style={state === 'ready' ? undefined : { display: 'none' }} data-preview-loaded={state === 'ready' ? 'true' : 'false'} aria-label={`Página 1 de ${name}`} />
    {state === 'ready' && <small>Página 1 de {pages}</small>}
  </div>;
}

function ImagePreview({ url, name, onDownload }: { url: string; name: string; onDownload?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  return <div className={styles.imagePreview}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Preparando imagen…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    <img
      src={url}
      alt={`Vista previa de ${name}`}
      data-preview-loaded={state === 'ready' ? 'true' : 'false'}
      hidden={state === 'error'}
      onLoad={() => setState('ready')}
      onError={() => setState('error')}
    />
  </div>;
}

export function DocumentViewer({ open, name, mimeType, url, loading, error, onClose, onDownload }: Props) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);
  if (!open) return null;
  const kind = previewKind(mimeType || '', name);
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.viewer} role="dialog" aria-modal="true" aria-labelledby="document-viewer-title">
      <header><div><span>Vista previa protegida</span><h2 id="document-viewer-title">{name}</h2></div><div>{onDownload && <button type="button" onClick={onDownload} aria-label={`Descargar ${name}`}><Download /></button>}<button type="button" onClick={onClose} aria-label="Cerrar vista previa"><X /></button></div></header>
      <div className={styles.canvas}>
        {loading && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Preparando vista previa…</p>}
        {error && <PreviewFallback onDownload={onDownload} />}
        {!loading && !error && url && kind === 'pdf' && <PdfPreview url={url} name={name} onDownload={onDownload} />}
        {!loading && !error && url && kind === 'image' && <ImagePreview url={url} name={name} onDownload={onDownload} />}
        {!loading && !error && !url && kind !== 'unsupported' && <PreviewFallback onDownload={onDownload} />}
        {!loading && !error && kind === 'unsupported' && <div className={styles.unsupported}><strong>Vista previa no disponible para este formato</strong><p>Puedes descargar el archivo para abrirlo con una aplicación compatible.</p>{onDownload && <button type="button" onClick={onDownload}><Download />Descargar documento</button>}</div>}
      </div>
    </section>
  </div>;
}
