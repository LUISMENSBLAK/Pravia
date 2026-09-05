import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { H9AssistedReviewWorkspace } from '../features/cases/components/tabs/H9AssistedReviewWorkspace';
import { complianceService } from '../features/compliance/compliance.service';

vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: ['compliance.read', 'compliance.review', 'ia.execute'] } }) }));
vi.mock('../features/compliance/compliance.service', () => ({ complianceService: { h9Workspace: vi.fn(), h9Run: vi.fn() } }));

const clean = {
  id: 'review-h9-1', created_at: '2026-09-05T18:00:00.000Z', executed_by: { id: 'user-1', name: 'Andrea Ruiz' }, freshness: 'ACTUAL' as const, changes: [],
  correct_count: 2, observation_count: 0, critical_count: 0, provider: 'OPENAI', model: 'gpt-5.4-mini', prompt_version: 'v1', output_schema_version: 'v1', canonical_document: null,
  result: { verification_checks: [], correct_count: 2, observations: [], critical_inconsistencies: [] },
};
const ready = { readiness: { status: 'READY' as const, causes: [] }, latest: clean, history: [clean] };

describe('H9 Revisar Cumplimiento UI', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(complianceService.h9Workspace).mockResolvedValue(ready); vi.mocked(complianceService.h9Run).mockResolvedValue({}); });
  it('uses the approved human-facing action name and never runs on page load', async () => {
    render(<H9AssistedReviewWorkspace expedienteId="case-1" />);
    expect(await screen.findByRole('button', { name: 'Revisar Cumplimiento' })).toBeInTheDocument();
    expect(complianceService.h9Run).not.toHaveBeenCalled(); expect(document.body.textContent).not.toMatch(/Auditoría|Audit/);
  });
  it('runs only after an explicit click and prevents duplicate submission while running', async () => {
    let release!: () => void; vi.mocked(complianceService.h9Run).mockReturnValue(new Promise((resolve) => { release = () => resolve({}); }));
    render(<H9AssistedReviewWorkspace expedienteId="case-1" />); const button = await screen.findByRole('button', { name: 'Revisar Cumplimiento' }); fireEvent.click(button);
    expect(await screen.findByRole('button', { name: 'Revisando…' })).toBeDisabled(); expect(complianceService.h9Run).toHaveBeenCalledTimes(1); release();
  });
  it('shows exact counts and the approved no-inconsistencies message without a score', async () => {
    render(<H9AssistedReviewWorkspace expedienteId="case-1" />); expect(await screen.findByText('No se detectaron inconsistencias en las verificaciones realizadas')).toBeInTheDocument();
    expect(screen.getByText('Verificaciones correctas').previousElementSibling).toHaveTextContent('2'); expect(document.body.textContent).not.toMatch(/score|porcentaje|aprobado/i);
  });
  it('explains staleness, offers Revisar nuevamente and preserves compact history', async () => {
    const old = { ...clean, id: 'old', created_at: '2026-09-04T18:00:00.000Z' };
    vi.mocked(complianceService.h9Workspace).mockResolvedValue({ readiness: ready.readiness, latest: { ...clean, freshness: 'DESACTUALIZADA', changes: [{ source_ref: 'DOC:d:path', change: 'CHANGED', detail: 'Documento cambió de versión o contenido normalizado.' }] }, history: [{ ...clean, freshness: 'DESACTUALIZADA', changes: [{ source_ref: 'DOC:d:path', change: 'CHANGED', detail: 'Documento cambió de versión o contenido normalizado.' }] }, old] });
    render(<H9AssistedReviewWorkspace expedienteId="case-1" />); expect(await screen.findByRole('button', { name: 'Revisar nuevamente' })).toBeInTheDocument(); expect(screen.getByText('Documento cambió de versión o contenido normalizado.')).toBeInTheDocument(); expect(screen.getByText(/Historial de revisiones \(2\)/)).toBeInTheDocument();
  });
  it('shows actionable readiness causes and never creates an empty review', async () => {
    vi.mocked(complianceService.h9Workspace).mockResolvedValue({ readiness: { status: 'NOT_READY', causes: ['Ejecuta primero la evaluación canónica de Cumplimiento.'] }, latest: null, history: [] });
    render(<H9AssistedReviewWorkspace expedienteId="case-1" />); expect(await screen.findByText('Información insuficiente para una revisión útil')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Revisar Cumplimiento' })).toBeDisabled();
  });
  it.each([320, 390, 768, 1440])('keeps the card action reachable at %d px without a table', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.dispatchEvent(new Event('resize'));
    const { container } = render(<H9AssistedReviewWorkspace expedienteId="case-1" />); expect(await screen.findByRole('button', { name: 'Revisar Cumplimiento' })).toBeVisible(); expect(container.querySelector('table')).toBeNull();
  });
});
