import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsTab } from '../features/cases/components/tabs/DocumentsTab';
import { WorkflowTab } from '../features/cases/components/tabs/WorkflowTab';

const api = vi.hoisted(() => ({
  documentAppendix: vi.fn(),
  syncDocumentAppendix: vi.fn(),
  importDocumentSource: vi.fn(),
  createDocumentFolder: vi.fn(),
  renameDocumentFolder: vi.fn(),
  deleteDocumentFolder: vi.fn(),
  moveDocumentItems: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  downloadAppendixFile: vi.fn(),
  downloadAppendixZip: vi.fn(),
  appendixSignedUrl: vi.fn(),
  uploadDocument: vi.fn(),
  transition: vi.fn(),
  signaturePreflight: vi.fn(),
}));

vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: api }));

const expediente = {
  id: 'exp-1',
  version: 4,
  estatus: 'FIRMA_PROGRAMADA',
  macrofase: 'FIRMA',
  flujoVersion: { version: 2 },
  etapas: [],
  workflow: {
    stages: [],
    current_status_label: 'Firma programada',
    transitions: [
      { status: 'EN_PROCESO', label: 'En proceso', requires_signature_data: false, requires_effective_date: false, requires_notes: false },
      { status: 'FIRMADO', label: 'Registrar firma', requires_signature_data: false, requires_effective_date: true, requires_notes: false },
    ],
  },
  capabilities: { canWrite: true, canUploadDocuments: true },
} as any;

const live = {
  state: 'SINCRONIZADO_PREFIRMA',
  frozen_at: null,
  revision: 'rev-live-123456789',
  folders: [],
  groups: [
    { origin: 'COMPARECIENTE', label: 'Comparecientes', items: [{ id: 'item-1', documento_id: 'doc-1', origin: 'COMPARECIENTE', source_name: 'Persona vinculada', source_entity_type: 'COMPARECIENTE', source_entity_id: 'party-1', source_context: 'IDENTIFICACION', document_version: 'version-1', name: 'Identificación vigente.pdf', type: 'IDENTIFICACION', status: 'VIGENTE', incorporated_at: '2026-08-28T10:00:00Z', file_available: true, snapshot: false }] },
    { origin: 'COTIZACION_NOTARIA', label: 'Cotización de Notaría', items: [{ id: 'item-2', documento_id: 'doc-2', origin: 'COTIZACION_NOTARIA', source_name: 'Cotización de Notaría', source_entity_type: 'COTIZACION', source_entity_id: 'quote-1', source_context: 'PRESUPUESTO_NOTARIA', document_version: 'version-2', name: 'Presupuesto notaría.pdf', type: 'PRESUPUESTO_NOTARIA', status: 'VIGENTE', incorporated_at: '2026-08-28T10:00:00Z', file_available: true, snapshot: false }] },
  ],
} as any;

const frozen = {
  state: 'CONGELADO_AL_FIRMAR',
  frozen_at: '2026-08-28T12:00:00Z',
  revision: 'rev-frozen-123456',
  folders: [],
  groups: [{ origin: 'FINANZAS', label: 'Finanzas', items: [{ id: 'snapshot-1', documento_id: null, origin: 'FINANZAS', source_name: 'MOV-0001', source_entity_type: 'MOVIMIENTO_FINANCIERO', source_entity_id: 'movement-1', source_context: 'COMPROBANTE', document_version: 'legacy-version', name: 'Comprobante registrado', type: 'COMPROBANTE', status: 'REGISTRO_EXISTENTE', incorporated_at: '2026-08-28T10:00:00Z', file_available: false, snapshot: true }] }],
} as any;

describe('EXP-004 apéndice documental', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.documentAppendix.mockResolvedValue(live);
    api.syncDocumentAppendix.mockResolvedValue(live);
    api.importDocumentSource.mockResolvedValue({ ...live, import: { origin: 'COMPARECIENTE', new: 1, updated: 0, unchanged: 0, duplicates_created: 0, historical_imported: 0, blob_copies: 0 } });
    api.downloadAppendixFile.mockResolvedValue(undefined);
    api.downloadAppendixZip.mockResolvedValue(undefined);
    api.appendixSignedUrl.mockResolvedValue({ url: 'https://signed.example.test/file', expires_in: 600, file_name: 'Identificación vigente.pdf', mime_type: 'application/pdf' });
    api.uploadDocument.mockResolvedValue({});
    api.transition.mockResolvedValue({});
    api.signaturePreflight.mockResolvedValue({ preflight: { ready: true, ready_label: 'Listo para firma', count: 0, hash: 'preflight-hash', missing: [] } });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('muestra únicamente documentos ya incorporados y mantiene su procedencia', async () => {
    render(<DocumentsTab expediente={expediente} onChanged={vi.fn()} />);
    expect(await screen.findByText('Pre-firma · Organización editable')).toBeInTheDocument();
    expect(screen.getByText('Identificación vigente.pdf')).toBeInTheDocument();
    expect(screen.getByText(/IDENTIFICACION · Compareciente/)).toBeInTheDocument();
  });

  it('importa fuentes vigentes sólo desde la acción explícita y muestra resumen', async () => {
    const changed = vi.fn();
    render(<DocumentsTab expediente={expediente} onChanged={changed} />);
    await screen.findByText('Pre-firma · Organización editable');
    await userEvent.click(screen.getByRole('button', { name: 'Importar documentos vigentes de comparecientes' }));
    await waitFor(() => expect(api.importDocumentSource).toHaveBeenCalledWith('exp-1', 'compareciente'));
    expect(changed).toHaveBeenCalled();
  });

  it('muestra missing-file humano y no ofrece descarga en snapshot', async () => {
    api.documentAppendix.mockResolvedValue(frozen);
    render(<DocumentsTab expediente={expediente} onChanged={vi.fn()} />);
    expect(await screen.findByText('Apéndice congelado al firmar')).toBeInTheDocument();
    expect(screen.getByTitle('Archivo no disponible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar Comprobante/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importar documentos vigentes de comparecientes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir' })).not.toBeInTheDocument();
  });

  it('abre una vista previa PDF real mediante URL privada temporal', async () => {
    render(<DocumentsTab expediente={expediente} onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByText('Identificación vigente.pdf'));
    expect(await screen.findByTitle('Vista previa de Identificación vigente.pdf')).toHaveAttribute('src', 'https://signed.example.test/file');
    expect(api.appendixSignedUrl).toHaveBeenCalledWith('exp-1', 'item-1');
  });

  it('incluye carpetas seleccionadas en el ZIP de selección', async () => {
    api.documentAppendix.mockResolvedValue({ ...live, folders: [{ id: 'folder-1', parent_id: null, nombre: 'Antecedentes', orden: 0 }] });
    render(<DocumentsTab expediente={expediente} onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar carpeta Antecedentes' }));
    await userEvent.click(screen.getByRole('button', { name: 'ZIP selección' }));
    await waitFor(() => expect(api.downloadAppendixZip).toHaveBeenCalledWith('exp-1', { item_ids: [], folder_ids: ['folder-1'] }, 'seleccion-documental.zip'));
  });

  it('protege la firma con la revisión documental previamente consultada', async () => {
    render(<WorkflowTab expediente={expediente} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar firma' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar firma efectiva' });
    expect(within(dialog).getByText(/apéndice documental revisado quedará congelado/i)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Fecha y hora efectiva'), { target: { value: '2026-08-28T12:30' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar firma y congelar apéndice' }));
    await waitFor(() => expect(api.transition).toHaveBeenCalledWith('exp-1', expect.objectContaining({ document_revision: 'rev-live-123456789' })));
  });
});
