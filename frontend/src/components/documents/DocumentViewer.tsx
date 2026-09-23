import { ChevronLeft, ChevronRight, Download, FileWarning, LoaderCircle, Maximize2, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  onAsk?(): void;
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
  const [pages, setPages] = useState<Array<{ number: number; page: any; text: string }>>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [query, setQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');

  useEffect(() => {
    let active = true;
    let loadingTask: { destroy(): Promise<void> } | undefined;

    const loadPages = async () => {
      setState('loading');
      setPages([]);
      setTotalPages(0);
      setCurrentPage(1);
      setSearchMessage('');
      try {
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ url });
        loadingTask = task;
        const pdf = await task.promise;
        if (!active) return;
        setTotalPages(pdf.numPages);
        setState('ready');

        // Publish each page as soon as PDF.js resolves it. Text extraction remains
        // asynchronous so a large/searchable PDF never blocks its first visible page.
        for (let number = 1; number <= pdf.numPages; number += 1) {
          const page = await pdf.getPage(number);
          if (!active) return;
          setPages((current) => [...current, { number, page, text: '' }]);
          if (typeof page.getTextContent === 'function') {
            void page.getTextContent().then((content: { items?: unknown[] }) => {
              if (!active) return;
              const text = (content.items || []).map((item) => typeof item === 'object' && item !== null && 'str' in item ? String((item as { str?: unknown }).str || '') : '').join(' ');
              setPages((current) => current.map((entry) => entry.number === number ? { ...entry, text } : entry));
            }).catch(() => undefined);
          }
        }
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

  const goToPage = (page: number) => {
    const next = Math.min(Math.max(page, 1), totalPages || 1);
    if (!pages.some((item) => item.number === next)) {
      setSearchMessage(`La página ${next} todavía se está cargando.`);
      return;
    }
    setCurrentPage(next);
    containerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const search = () => {
    const term = query.trim().toLocaleLowerCase('es');
    if (!term) { setSearchMessage('Escribe un texto para buscar.'); return; }
    const found = pages.find((item, index) => index >= currentPage && item.text.toLocaleLowerCase('es').includes(term))
      || pages.find((item) => item.text.toLocaleLowerCase('es').includes(term));
    if (!found && pages.length < totalPages) { setSearchMessage(`Buscando mientras se cargan ${pages.length} de ${totalPages} páginas…`); return; }
    if (!found) { setSearchMessage('No se encontró el texto en el PDF.'); return; }
    goToPage(found.number); setSearchMessage(`Coincidencia en la página ${found.number}.`);
  };
  return <div ref={containerRef} className={styles.pdfPreview} aria-label={`Vista previa de ${name}`}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Renderizando documento…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    {state === 'ready' && <><div className={styles.pdfToolbar}><div className={styles.searchControl} role="search"><label htmlFor="document-viewer-search">Buscar en documento</label><div><input id="document-viewer-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} /><button type="button" aria-label="Buscar en PDF" onClick={search}><Search /></button></div></div><div className={styles.pageControl} aria-label="Navegación de páginas"><button type="button" aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}><ChevronLeft /></button><span>{currentPage} / {totalPages || '—'}</span><button type="button" aria-label="Página siguiente" disabled={currentPage >= totalPages || !pages.some((item) => item.number === currentPage + 1)} onClick={() => goToPage(currentPage + 1)}><ChevronRight /></button></div><div className={styles.zoomToolbar} aria-label="Controles de zoom"><button type="button" aria-label="Ajustar a página" onClick={() => setZoom(1)}><Maximize2 /></button><button type="button" aria-label="Reducir zoom" onClick={() => setZoom((value) => Math.max(.6, value - .15))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(2, value + .15))}><ZoomIn /></button></div></div><p className={styles.visuallyHidden} aria-live="polite">{searchMessage}</p>{pages.length < totalPages && <p className={styles.pageLoadProgress} role="status"><LoaderCircle aria-hidden="true" />Cargando páginas {pages.length} de {totalPages}…</p>}<div className={styles.pdfPages}>{pages.map((item) => <PdfCanvas key={item.number} page={item.page} number={item.number} total={totalPages} name={name} zoom={zoom} container={containerRef.current} />)}</div></>}
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
  return <figure data-pdf-page={number}><canvas ref={ref} data-preview-loaded={ready ? 'true' : 'false'} aria-label={`Página ${number} de ${name}`} /><figcaption>Página {number} de {total}</figcaption></figure>;
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
    {state === 'ready' && <><div className={styles.zoomToolbar} aria-label="Controles de zoom"><button type="button" aria-label="Ajustar a página" onClick={() => setZoom(1)}><Maximize2 /></button><button type="button" aria-label="Reducir zoom" onClick={() => setZoom((value) => Math.max(.7, value - .1))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(1.6, value + .1))}><ZoomIn /></button></div><article className={styles.docxPage} style={{ zoom }} data-preview-loaded="true" dangerouslySetInnerHTML={{ __html: html }} /></>}
  </div>;
}

function ImagePreview({ url, name, onDownload }: { url: string; name: string; onDownload?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (state !== 'ready') return;
    const update = () => {
      const container = containerRef.current;
      if (!container) return;
      setViewport({ width: Math.max(1, container.clientWidth - 48), height: Math.max(1, container.clientHeight - 88) });
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (containerRef.current) observer?.observe(containerRef.current);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [state]);
  const fit = naturalSize.width && naturalSize.height ? Math.min(1, viewport.width / naturalSize.width, viewport.height / naturalSize.height) : 1;
  const renderedWidth = Math.max(1, naturalSize.width * fit * zoom);
  const renderedHeight = Math.max(1, naturalSize.height * fit * zoom);
  return <div ref={containerRef} className={styles.imagePreview}>
    {state === 'loading' && <p className={styles.previewLoading} role="status"><LoaderCircle aria-hidden="true" />Preparando imagen…</p>}
    {state === 'error' && <PreviewFallback onDownload={onDownload} />}
    {state === 'ready' && <div className={styles.zoomToolbar} aria-label="Controles de zoom"><button type="button" aria-label="Ajustar a página" onClick={() => setZoom(1)}><Maximize2 /></button><button type="button" aria-label="Reducir zoom" onClick={() => setZoom((value) => Math.max(.5, value - .15))}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(2.5, value + .15))}><ZoomIn /></button></div>}
    <div className={styles.imageStage} style={state === 'ready' ? { width: `${Math.max(viewport.width, renderedWidth)}px`, height: `${Math.max(viewport.height, renderedHeight)}px` } : undefined}>
      <img
        src={url}
        alt={`Vista previa de ${name}`}
        data-preview-loaded={state === 'ready' ? 'true' : 'false'}
        hidden={state === 'error'}
        style={state === 'ready' ? { width: `${renderedWidth}px`, height: `${renderedHeight}px` } : undefined}
        onLoad={(event) => { setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setState('ready'); }}
        onError={() => setState('error')}
      />
    </div>
  </div>;
}

export function DocumentViewer({ open, name, mimeType, url, loading, error, onClose, onDownload, onAsk }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[href],select,textarea,[tabindex]:not([tabindex="-1"])') || [])];
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables(); if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    requestAnimationFrame(() => focusables()[0]?.focus());
    return () => { window.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  const kind = previewKind(mimeType || '', name);
  return createPortal(<div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={styles.viewer} role="dialog" aria-modal="true" aria-labelledby="document-viewer-title">
      <header><div><span>Vista previa protegida</span><h2 id="document-viewer-title">{name}</h2></div><div>{onAsk && <button type="button" className={styles.askButton} onClick={onAsk}>Preguntar a IA</button>}{onDownload && <button type="button" onClick={onDownload} aria-label={`Descargar ${name}`}><Download /></button>}<button type="button" onClick={onClose} aria-label="Cerrar vista previa"><X /></button></div></header>
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
  </div>, document.body);
}
