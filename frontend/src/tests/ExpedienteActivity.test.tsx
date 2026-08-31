import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityTab } from '../features/cases/components/tabs/ActivityTab';
import { expedientesService } from '../features/cases/expedientes.service';

const activity = { id: 'event-1', type: 'SEGUIMIENTO', category: 'OPERACION', title: 'Firma registrada', description: 'La firma del instrumento quedó confirmada.', occurred_at: '2026-08-29T18:00:00.000Z', actor: { id: 'user-1', nombre: 'Andrea', apellido: 'Ruiz' }, manual_note: false, previous_values: { estado: 'EN_PROCESO' }, new_values: { estado: 'FIRMADO' }, related_section: 'seguimiento', related_entity: null, related_entity_id: null } as const;
const expediente = { id: 'exp-1', capabilities: { canWrite: true } } as any;
const response = { data: [activity], next_cursor: null, filters: { category: 'TODO', search: null, from: null, to: null }, canonical_source: 'ExpedienteActividad', technical_audit_source: false } as const;

describe('EXP-009 ActivityTab', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders what, when and who without exposing technical audit', async () => {
    vi.spyOn(expedientesService, 'activity').mockResolvedValue(response as any);
    render(<MemoryRouter><ActivityTab expediente={expediente} /></MemoryRouter>);
    expect((await screen.findAllByText('Firma registrada')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Andrea Ruiz').length).toBeGreaterThan(0);
    expect(screen.getByText('Cuándo')).toBeInTheDocument(); expect(screen.getByText('Quién')).toBeInTheDocument();
    expect(screen.queryByText(/AuditLog|UUID|correlation/i)).not.toBeInTheDocument();
  });

  it('uses canonical human labels for previous and new enum values', async () => {
    vi.spyOn(expedientesService, 'activity').mockResolvedValue({
      ...response,
      data: [{
        ...activity,
        previous_values: { estado: 'EN_PROCESO', validacion: 'PENDIENTE_REVISION' },
        new_values: { estado: 'FIRMADO', validacion: 'VALIDADO' },
      }],
    } as any);
    render(<MemoryRouter><ActivityTab expediente={expediente} /></MemoryRouter>);
    expect(await screen.findByText('En proceso')).toBeInTheDocument();
    expect(screen.getByText('Firmado')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de revisión')).toBeInTheDocument();
    expect(screen.getByText('Validado')).toBeInTheDocument();
    expect(screen.queryByText('EN_PROCESO')).not.toBeInTheDocument();
    expect(screen.queryByText('FIRMADO')).not.toBeInTheDocument();
    expect(screen.queryByText('PENDIENTE_REVISION')).not.toBeInTheDocument();
  });

  it('applies category and search filters through the canonical endpoint', async () => {
    const spy = vi.spyOn(expedientesService, 'activity').mockResolvedValue(response as any);
    render(<MemoryRouter><ActivityTab expediente={expediente} /></MemoryRouter>); await screen.findAllByText('Firma registrada');
    fireEvent.click(screen.getByRole('button', { name: 'Documentos' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith('exp-1', expect.objectContaining({ category: 'DOCUMENTOS' }), expect.any(AbortSignal)));
    fireEvent.change(screen.getByPlaceholderText('Buscar en actividad'), { target: { value: 'presupuesto' } }); fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith('exp-1', expect.objectContaining({ search: 'presupuesto' }), expect.any(AbortSignal)));
  });

  it('adds a manual note without presenting it as a task', async () => {
    vi.spyOn(expedientesService, 'activity').mockResolvedValue(response as any);
    const add = vi.spyOn(expedientesService, 'addActivityNote').mockResolvedValue({ item: { ...activity, id: 'note-1', type: 'NOTA', title: 'Nota operativa', description: 'Cliente confirmó horario.', manual_note: true, related_section: 'actividad' }, idempotent: false } as any);
    render(<MemoryRouter><ActivityTab expediente={expediente} /></MemoryRouter>); await screen.findAllByText('Firma registrada');
    expect(screen.getByText(/No crea tareas ni modifica Seguimiento/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nota para la actividad'), { target: { value: 'Cliente confirmó horario.' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('exp-1', 'Cliente confirmó horario.', expect.any(String)));
    expect(await screen.findAllByText('Nota operativa')).not.toHaveLength(0);
  });

  it('hides the note composer when RBAC denies expediente writes', async () => {
    vi.spyOn(expedientesService, 'activity').mockResolvedValue(response as any);
    render(<MemoryRouter><ActivityTab expediente={{ ...expediente, capabilities: { canWrite: false } } as any} /></MemoryRouter>); await screen.findAllByText('Firma registrada');
    expect(screen.queryByLabelText('Nota para la actividad')).not.toBeInTheDocument();
  });

  it('supports Tab, Space, Enter and Escape with visible native controls', async () => {
    const user = userEvent.setup();
    const second = { ...activity, id: 'event-2', category: 'FINANZAS', title: 'Ingreso aplicado', description: 'Anticipo validado.', previous_values: null, new_values: null, related_section: 'finanzas' } as const;
    const spy = vi.spyOn(expedientesService, 'activity').mockResolvedValue({ ...response, data: [activity, second] } as any);
    render(<MemoryRouter><ActivityTab expediente={expediente} /></MemoryRouter>);
    await screen.findAllByText('Firma registrada');
    const todo = screen.getByRole('button', { name: 'Todo' });
    todo.focus();
    await user.tab();
    const operation = screen.getByRole('button', { name: 'Operación' });
    expect(operation).toHaveFocus();
    await user.keyboard('[Space]');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith('exp-1', expect.objectContaining({ category: 'OPERACION' }), expect.any(AbortSignal)));
    const secondButton = screen.getByRole('button', { name: /Ingreso aplicado/ });
    secondButton.focus();
    await user.keyboard('[Enter]');
    expect(screen.getByRole('heading', { name: 'Ingreso aplicado' })).toBeInTheDocument();
    await user.keyboard('[Escape]');
    expect(screen.getByRole('heading', { name: 'Ingreso aplicado' })).toBeInTheDocument();
  });
});
