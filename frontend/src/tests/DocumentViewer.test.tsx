import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    getPage: vi.fn().mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    }),
  }),
  destroy: vi.fn().mockResolvedValue(undefined),
});

describe('Shared DocumentViewer', () => {
  beforeEach(() => {
    getDocument.mockReset().mockImplementation(successfulPdf);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  it('renderiza una página PDF real en canvas y confirma contenido cargado', async () => {
    render(<DocumentViewer open name="documento-real.pdf" mimeType="application/pdf" url="blob:pdf-real" onClose={vi.fn()} onDownload={vi.fn()} />);
    const canvas = await screen.findByLabelText('Página 1 de documento-real.pdf');
    await waitFor(() => expect(canvas).toHaveAttribute('data-preview-loaded', 'true'));
    expect(canvas).not.toHaveAttribute('hidden');
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    expect(getDocument).toHaveBeenCalledWith({ url: 'blob:pdf-real' });
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
});
