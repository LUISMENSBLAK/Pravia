import { Download, FileWarning, LoaderCircle, X, ZoomIn, ZoomOut } from 'lucide-react';
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
  if (value.includes('wordprocessingml') || value.includes('msword') || value.endsWith('.docx')) return 'docx';
  if (value.includes('image/') || /\.(png|jpe?g|webp|bmp)$/.test(value)) return 'image';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState<Array<{ number: number; page: any }>>([]);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let active = true;
    let loadingTask: { destroy(): Promise<void> } | undefined;

    const loadPages = async () => {
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
        const loaded = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => ({ number: index + 1, page: await pdf.getPage(index + 1) })));
        if (active) { setPages(loaded); setState('ready'); }
      } catch (error) {
        if (active && !(error instanceof Error && error.name === 'RenderingCancelledException')) setState('error');
      }
    };

    void loadPages();
    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [url]);

  return <div ref={containerRef} className={styles.pdfPreview} aria-label={`Vista previa de ${name}`}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Renderizando documento…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    {state === 'ready' && <><div className={styles.zoomToolbar} aria-label="Controles de zoom"><button type="button" aria-label="Reducir zoom" onClick={() => setZoom((value) => Math.max(.6, value - .15))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(2, value + .15))}><ZoomIn /></button></div><div className={styles.pdfPages}>{pages.map((item) => <PdfCanvas key={item.number} page={item.page} number={item.number} total={pages.length} name={name} zoom={zoom} container={containerRef.current} />)}</div></>}
  </div>;
}

function PdfCanvas({ page, number, total, name, zoom, container }: { page: any; number: number; total: number; name: string; zoom: number; container: HTMLDivElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true; let task: { promise: Promise<void>; cancel(): void } | undefined;
    const render = async () => {
      const canvas = ref.current; if (!canvas) return;
      const base = page.getViewport({ scale: 1 });
      const available = Math.max(280, (container?.clientWidth || 860) - 64);
      const viewport = page.getViewport({ scale: Math.min(1.7, available / base.width) * zoom });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2); const context = canvas.getContext('2d', { alpha: false }); if (!context) return;
      canvas.width = Math.floor(viewport.width * pixelRatio); canvas.height = Math.floor(viewport.height * pixelRatio); canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
      const renderTask = page.render({ canvas, canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      task = renderTask;
      await renderTask.promise; if (active) setReady(true);
    };
    void render(); return () => { active = false; task?.cancel(); };
  }, [page, zoom, container]);
  return <figure><canvas ref={ref} data-preview-loaded={ready ? 'true' : 'false'} aria-label={`Página ${number} de ${name}`} /><figcaption>Página {number} de {total}</figcaption></figure>;
}

const sanitizeDocx = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,iframe,object,embed,form').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((node) => [...node.attributes].forEach((attribute) => {
    if (attribute.name.toLowerCase().startsWith('on') || (/^(href|src)$/i.test(attribute.name) && /^javascript:/i.test(attribute.value))) node.removeAttribute(attribute.name);
  }));
  return document.body.innerHTML;
};

function DocxPreview({ url, name, onDownload }: { url: string; name: string; onDownload?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [html, setHtml] = useState('');
  const [zoom, setZoom] = useState(1);
  useEffect(() => { let active = true; const load = async () => { try { const [response, mammoth] = await Promise.all([fetch(url), import('mammoth')]); if (!response.ok) throw new Error('download failed'); const result = await mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() }); if (active) { setHtml(sanitizeDocx(result.value)); setState('ready'); } } catch { if (active) setState('error'); } }; void load(); return () => { active = false; }; }, [url]);
  return <div className={styles.docxPreview} aria-label={`Vista previa de ${name}`}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Interpretando documento Word…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    {state === 'ready' && <><div className={styles.zoomToolbar} aria-label="Controles de zoom"><button type="button" aria-label="Reducir zoom" onClick={() => setZoom((value) => Math.max(.7, value - .1))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(1.6, value + .1))}><ZoomIn /></button></div><article className={styles.docxPage} style={{ zoom }} data-preview-loaded="true" dangerouslySetInnerHTML={{ __html: html }} /></>}
  </div>;
}

function ImagePreview({ url, name, onDownload }: { url: string; name: string; onDownload?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1);
  return <div className={styles.imagePreview}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Preparando imagen…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    {state === 'ready' && <div className={styles.zoomToolbar} aria-label="Controles de zoom"><button type="button" aria-label="Reducir zoom" onClick={() => setZoom((value) => Math.max(.5, value - .15))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(2.5, value + .15))}><ZoomIn /></button></div>}
    <img
      src={url}
      alt={`Vista previa de ${name}`}
      data-preview-loaded={state === 'ready' ? 'true' : 'false'}
      hidden={state === 'error'}
      style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
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
        {!loading && !error && url && kind === 'docx' && <DocxPreview url={url} name={name} onDownload={onDownload} />}
        {!loading && !error && url && kind === 'image' && <ImagePreview url={url} name={name} onDownload={onDownload} />}
        {!loading && !error && !url && kind !== 'unsupported' && <PreviewFallback onDownload={onDownload} />}
        {!loading && !error && kind === 'unsupported' && <div className={styles.unsupported}><strong>Vista previa no disponible para este formato</strong><p>Puedes descargar el archivo para abrirlo con una aplicación compatible.</p>{onDownload && <button type="button" onClick={onDownload}><Download />Descargar documento</button>}</div>}
      </div>
    </section>
  </div>;
}
