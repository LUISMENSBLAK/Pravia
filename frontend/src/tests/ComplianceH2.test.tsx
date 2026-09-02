import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComplianceTab } from '../features/cases/components/tabs/ComplianceTab';

const api = vi.hoisted(() => ({
  documentStructure: vi.fn(), uploadSignedEvidence: vi.fn(), validateDocumentEvidence: vi.fn(), exportDocumentPackage: vi.fn(),
}));

vi.mock('../features/compliance/compliance.service', () => ({ complianceService: api }));
vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { permissions: ['compliance.write', 'compliance.review', 'compliance.sensitive.read', 'documentos.read'] } }),
}));

const generated = {
  id: 'evidence-generated', source: 'FORMAT_GENERATED', document_state: 'GENERATED', validation_status: 'PENDING_HUMAN',
  document_version: 'generated-version-123456789', linked_at: '2026-09-01T12:00:00Z', validated_at: null,
  document: { id: 'document-generated', nombre_original: 'Formato generado.pdf', mime_type: 'application/pdf', size_bytes: 200 },
};
const personRequirement = {
  id: 'requirement-person', label: 'Identificación oficial vigente', status: 'PENDIENTE', category: 'IDENTIFICACION',
  expected_document_type: 'IDENTIFICACION_OFICIAL', target_compareciente_id: 'party-1', target_name: 'Persona sintética Uno',
  requires_signed_document: false, requires_human_validation: true, missing_action: 'GO_TO_COMPARECIENTE',
  missing_reason: 'Falta vincular la evidencia requerida.', evidence: [],
};
const signedRequirement = {
  id: 'requirement-signed', label: 'Formato de conocimiento firmado', status: 'EN_PROCESO', category: 'FORMATOS',
  expected_document_type: 'FORMATO_CONOCIMIENTO', target_compareciente_id: null, target_name: null,
  requires_signed_document: true, requires_human_validation: true, missing_action: 'UPLOAD_SIGNED',
  missing_reason: 'Falta cargar la versión firmada.', evidence: [generated],
};
const structure = {
  vulnerable: true, automatic_structure: true, state: { state: 'PENDIENTE', pending_count: 2 },
  groups: [
    { category: 'IDENTIFICACION', label: 'Identificación', requirements: [personRequirement] },
    { category: 'FORMATOS', label: 'Formatos', requirements: [signedRequirement] },
  ],
  requirements: [personRequirement, signedRequirement], missing: [personRequirement, signedRequirement],
};
const expediente = { id: 'expediente-h2', numero_pravia: 'EXP-0001-2026', complianceReviews: [] } as any;

describe('H2 CUM-DOC-001 presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.documentStructure.mockResolvedValue(structure);
    api.uploadSignedEvidence.mockResolvedValue({});
    api.validateDocumentEvidence.mockResolvedValue({});
  });

  it('renders the automatic requirement-first structure and exact person/requisite missing action', async () => {
    render(<MemoryRouter><ComplianceTab expediente={expediente} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Identificación oficial vigente' })).toBeInTheDocument();
    expect(screen.getByText('Persona sintética Uno')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Abrir Comparecientes/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Editar$/ })).not.toBeInTheDocument();
  });

  it('distinguishes generated from signed and requires the explicit signed upload action', async () => {
    render(<MemoryRouter><ComplianceTab expediente={expediente} /></MemoryRouter>);
    expect(await screen.findByText(/Generado · pendiente de firma/)).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de validación humana/)).toBeInTheDocument();
    const file = new File(['synthetic-pdf'], 'firmado-sintetico.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Cargar PDF firmado para Formato de conocimiento firmado'), file);
    await waitFor(() => expect(api.uploadSignedEvidence).toHaveBeenCalledWith('expediente-h2', 'requirement-signed', file));
  });

  it('shows the consolidated missing-items view with actionable requirements', async () => {
    render(<MemoryRouter><ComplianceTab expediente={expediente} /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Documental de cumplimiento' });
    await userEvent.click(screen.getByRole('button', { name: /Ver faltantes de Cumplimiento/ }));
    expect(screen.getByRole('heading', { name: 'Faltantes de Cumplimiento' })).toBeInTheDocument();
    expect(screen.getAllByText('Identificación oficial vigente').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Formato de conocimiento firmado').length).toBeGreaterThan(1);
  });
});
