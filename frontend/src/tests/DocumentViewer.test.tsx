import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentViewer } from '../components/documents/DocumentViewer';

const getDocument = vi.fn();

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }));
vi.mock('mammoth', () => ({ convertToHtml: vi.fn().mockResolvedValue({ value: '<h1>Contrato de prueba</h1><p>Contenido Word visible.</p>' }) }));

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

  it('renderiza DOCX dentro de PRAVIA sin descargarlo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75]), { status: 200 })));
    render(<DocumentViewer open name="contrato.docx" mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" url="blob:docx" onClose={vi.fn()} onDownload={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Contrato de prueba' })).toBeInTheDocument();
    expect(screen.getByText('Contenido Word visible.')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Descargar/ }).length).toBeGreaterThan(0);
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
