import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentViewer } from '../components/documents/DocumentViewer';

const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }));
const renderDocx = vi.fn(async (_data: ArrayBuffer, body: HTMLElement, styles: HTMLElement) => {
  styles.innerHTML = '<style>.pravia-docx { color: #111; }</style>';
  body.innerHTML = '<section class="pravia-docx"><h1>Contrato de prueba</h1><p>Contenido Word visible.</p></section><section class="pravia-docx"><p>Segunda página.</p></section>';
});
vi.mock('docx-preview', () => ({ renderAsync: (...args: unknown[]) => renderDocx(...args as [ArrayBuffer, HTMLElement, HTMLElement]) }));

const successfulPdf = () => ({
  promise: Promise.resolve({
    numPages: 2,
    getPage: vi.fn().mockImplementation(async (number: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: number === 2 ? 'Folio EXP-0002-2026' : 'Primera página' }] }),
    })),
  }),
  destroy: vi.fn().mockResolvedValue(undefined),
});

describe('Shared DocumentViewer', () => {
  beforeEach(() => {
    getDocument.mockReset().mockImplementation(successfulPdf);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renderiza una página PDF real en canvas y confirma contenido cargado', async () => {
    render(<DocumentViewer open name="documento-real.pdf" mimeType="application/pdf" url="blob:pdf-real" onClose={vi.fn()} onDownload={vi.fn()} />);
    const canvas = await screen.findByLabelText('Página 1 de documento-real.pdf');
    await waitFor(() => expect(canvas).toHaveAttribute('data-preview-loaded', 'true'));
    expect(canvas).not.toHaveAttribute('hidden');
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    expect(getDocument).toHaveBeenCalledWith({ url: 'blob:pdf-real' });
  });

  it('muestra las primeras páginas sin esperar a que termine un PDF grande', async () => {
    let releaseSecond!: (page: unknown) => void;
    const secondPage = new Promise((resolve) => { releaseSecond = resolve; });
    const page = (number: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      getTextContent: vi.fn().mockResolvedValue({ items: [{ str: `Página ${number}` }] }),
    });
    getDocument.mockReturnValueOnce({ promise: Promise.resolve({ numPages: 2, getPage: vi.fn((number: number) => number === 1 ? Promise.resolve(page(1)) : secondPage) }), destroy: vi.fn().mockResolvedValue(undefined) });
    render(<DocumentViewer open name="expediente-extenso.pdf" mimeType="application/pdf" url="blob:large" onClose={vi.fn()} />);
    expect(await screen.findByLabelText('Página 1 de expediente-extenso.pdf')).toBeInTheDocument();
    expect(screen.getByText('Cargando páginas 1 de 2…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Página 2 de expediente-extenso.pdf')).not.toBeInTheDocument();
    await act(async () => releaseSecond(page(2)));
    expect(await screen.findByLabelText('Página 2 de expediente-extenso.pdf')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Cargando páginas 1 de 2…')).not.toBeInTheDocument());
  });

  it('confirma que una imagen cargó y conserva su blob autenticado', async () => {
    render(<DocumentViewer open name="identificacion.png" mimeType="image/png" url="blob:image-real" onClose={vi.fn()} onDownload={vi.fn()} />);
    const image = screen.getByAltText('Vista previa de identificacion.png');
    expect(image).toHaveAttribute('src', 'blob:image-real');
    fireEvent.load(image);
    expect(image).toHaveAttribute('data-preview-loaded', 'true');
    expect(screen.queryByText('Preparando imagen…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    expect(screen.getByText('115%')).toBeInTheDocument();
    expect(image.style.transform).toBe('');
  });

  it('monta el diálogo en document.body para que ningún panel padre lo recorte', async () => {
    render(<form data-testid="parent-form"><DocumentViewer open name="identificacion.png" mimeType="image/png" url="blob:image" onClose={vi.fn()} /></form>);
    const dialog = screen.getByRole('dialog', { name: 'identificacion.png' });
    expect(dialog.closest('form')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('muestra un fallback humano cuando el render falla y mantiene descarga', async () => {
    getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('invalid pdf')), destroy: vi.fn().mockResolvedValue(undefined) });
    render(<DocumentViewer open name="ilegible.pdf" mimeType="application/pdf" url="blob:broken" onClose={vi.fn()} onDownload={vi.fn()} />);
    expect(await screen.findByText('No pudimos mostrar la vista previa de este documento.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Página 1 de ilegible.pdf')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Descargar/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/invalid pdf|blob:broken/i)).not.toBeInTheDocument();
  });

  it('informa cuando una página PDF falla al dibujarse sin dejar un rechazo sin manejar', async () => {
    getDocument.mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
          render: vi.fn(() => ({ promise: Promise.reject(new Error('canvas failure')), cancel: vi.fn() })),
        }),
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    render(<DocumentViewer open name="pagina.pdf" mimeType="application/pdf" url="blob:page-error" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert', { name: '' })).toHaveTextContent('No se pudo dibujar esta página.');
  });

  it('maqueta DOCX por páginas con cabeceras y saltos conservados', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75]), { status: 200 })));
    render(<DocumentViewer open name="contrato.docx" mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" url="blob:docx" onClose={vi.fn()} onDownload={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Contrato de prueba' })).toBeInTheDocument();
    expect(screen.getByText('Contenido Word visible.')).toBeInTheDocument();
    expect(screen.getByText('Vista maquetada · la paginación puede variar respecto a Word')).toBeInTheDocument();
    expect(renderDocx).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.any(HTMLElement), expect.any(HTMLElement), expect.objectContaining({
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderAltChunks: false,
    }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Descargar/ }).length).toBeGreaterThan(0);
  });

  it('descarta scripts y enlaces externos del Word antes de mostrarlo', async () => {
    renderDocx.mockImplementationOnce(async (_data, body) => {
      body.innerHTML = '<section class="pravia-docx"><script>alert(1)</script><a href="https://externo.test" onclick="alert(1)">Enlace</a></section>';
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75]), { status: 200 })));
    render(<DocumentViewer open name="externo.docx" url="blob:externo" onClose={vi.fn()} />);
    const link = await screen.findByText('Enlace');
    expect(link).not.toHaveAttribute('href');
    expect(link).not.toHaveAttribute('onclick');
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
  });

  it('detecta .DOC antiguo sin intentar una conversión silenciosa', () => {
    const download = vi.fn();
    render(<DocumentViewer open name="aviso-preventivo.doc" mimeType="application/msword" url="blob:legacy-doc" onClose={vi.fn()} onDownload={download} />);
    expect(screen.getByText('El archivo usa el formato antiguo .DOC')).toBeInTheDocument();
    expect(screen.getByText(/no puede extraerlo ni mostrarlo de forma fiable/i)).toBeInTheDocument();
    expect(screen.getByText(/revisión manual/i)).toBeInTheDocument();
    expect(screen.queryByText('Interpretando documento Word…')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Descargar/ }).at(-1)!);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('navega páginas y busca texto extraído sin salir del visor', async () => {
    render(<DocumentViewer open name="expediente.pdf" mimeType="application/pdf" url="blob:pdf-search" onClose={vi.fn()} />);
    await screen.findByLabelText('Página 1 de expediente.pdf');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Buscar en documento'), { target: { value: 'EXP-0002-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar en PDF' }));
    expect(await screen.findByText('Coincidencia en la página 2.')).toBeInTheDocument();
  });

  it('cierra con Escape y devuelve el foco al control de origen', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<><button type="button">Abrir visor</button><DocumentViewer open={false} name="archivo.png" onClose={onClose} /></>);
    const trigger = screen.getByRole('button', { name: 'Abrir visor' });
    trigger.focus();
    rerender(<><button type="button">Abrir visor</button><DocumentViewer open name="archivo.png" url="blob:image" onClose={onClose} /></>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar vista previa' })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<><button type="button">Abrir visor</button><DocumentViewer open={false} name="archivo.png" onClose={onClose} /></>);
    expect(screen.getByRole('button', { name: 'Abrir visor' })).toHaveFocus();
  });
});
