import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AssistantProvider, useAssistant } from '../features/assistant/AssistantProvider';
import type { AssistantService } from '../features/assistant/assistant.service';
import type { AssistantReply, AssistantSuggestion } from '../features/assistant/assistant.types';
import { AssistantLayer } from '../features/assistant/components/AssistantLayer';

const suggestion: AssistantSuggestion = {
  id: 'suggestion-1', type: 'missing-requirements', title: 'Requisitos pendientes',
  message: 'Encontré requisitos pendientes antes de la firma.', reason: 'La firma está próxima.', priority: 'high',
  entity: { type: 'expediente', id: 'file-1', label: 'Expediente' },
  cta: { label: 'Revisar', prompt: 'Revisar requisitos pendientes.' }, timestamp: '2026-08-12T10:00:00Z',
};

const makeService = (overrides: Partial<AssistantService> = {}): AssistantService => ({
  getSuggestions: vi.fn(async () => []),
  sendMessage: vi.fn(async (): Promise<AssistantReply> => ({ status: 'idle', message: 'Respuesta disponible.' })),
  confirmAction: vi.fn(async (): Promise<AssistantReply> => ({ status: 'success', message: 'Acción completada correctamente.' })),
  dismissSuggestion: vi.fn(async () => undefined),
  snoozeSuggestion: vi.fn(async () => undefined),
  ...overrides,
});

function ContextProbe() {
  const { context } = useAssistant();
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="context">{context.module}:{context.entityId ?? 'none'}:{location.pathname}</output><button onClick={() => navigate('/expedientes/abc-123')}>Cambiar contexto</button></>;
}

const renderAssistant = (service = makeService(), extra?: React.ReactNode) => render(
  <MemoryRouter initialEntries={['/mi-dia']}>
    <AssistantProvider service={service}>{extra}<AssistantLayer /></AssistantProvider>
  </MemoryRouter>,
);

describe('PRAVIA IA global', () => {
  it('abre y cierra el drawer global, incluyendo ESC', async () => {
    const user = userEvent.setup();
    renderAssistant();
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    expect(await screen.findByRole('dialog', { name: 'PRAVIA IA' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const launcher = screen.getByRole('button', { name: 'Abrir PRAVIA IA' });
    await waitFor(() => expect(launcher).toHaveFocus());
    await user.click(launcher);
    await screen.findByRole('dialog', { name: 'PRAVIA IA' });
    await user.click(screen.getByRole('button', { name: 'Cerrar PRAVIA IA' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resuelve cambios de ruta y entidad sin usarlos como autorización', async () => {
    const user = userEvent.setup();
    renderAssistant(makeService(), <ContextProbe />);
    expect(screen.getByTestId('context')).toHaveTextContent('mi-dia:none:/mi-dia');
    await user.click(screen.getByRole('button', { name: 'Cambiar contexto' }));
    expect(screen.getByTestId('context')).toHaveTextContent('expedientes:abc-123:/expedientes/abc-123');
  });

  it('precarga las quick actions según el contexto', async () => {
    const user = userEvent.setup();
    renderAssistant();
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.click(screen.getByRole('button', { name: '¿Qué urge hoy?' }));
    expect(screen.getByLabelText('Pregúntame algo...')).toHaveValue('¿Qué requiere mi atención hoy?');
  });

  it('hace crecer el composer y activa scroll interno después de varias líneas', async () => {
    const user = userEvent.setup();
    renderAssistant();
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    const composer = screen.getByLabelText('Pregúntame algo...');
    Object.defineProperty(composer, 'scrollHeight', { configurable: true, get: () => 148 });
    await user.type(composer, 'Primera línea{shift>}{enter}{/shift}Segunda línea{shift>}{enter}{/shift}Tercera línea');
    expect(composer).toHaveStyle({ height: '116px', overflowY: 'auto' });
  });

  it('descarta una sugerencia y comunica la decisión al adapter', async () => {
    const service = makeService({ getSuggestions: vi.fn(async () => [suggestion]) });
    const user = userEvent.setup();
    renderAssistant(service);
    expect(await screen.findByLabelText('Sugerencia contextual de PRAVIA IA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Descartar sugerencia' }));
    expect(screen.queryByLabelText('Sugerencia contextual de PRAVIA IA')).not.toBeInTheDocument();
    expect(service.dismissSuggestion).toHaveBeenCalledWith('suggestion-1', expect.objectContaining({ module: 'mi-dia' }));
  });

  it('muestra el estado thinking mientras espera una respuesta', async () => {
    const service = makeService({ sendMessage: vi.fn(() => new Promise<AssistantReply>(() => undefined)) });
    const user = userEvent.setup();
    renderAssistant(service);
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.type(screen.getByLabelText('Pregúntame algo...'), 'Revisa mi día');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(screen.getByRole('status')).toHaveTextContent('Revisando la información…');
  });

  it('representa processing, success y error con mensajes humanos', async () => {
    const user = userEvent.setup();
    const processing = makeService({ sendMessage: vi.fn(async (): Promise<AssistantReply> => ({ status: 'processing', processLabel: 'Consultando agenda…' })) });
    const first = renderAssistant(processing);
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.type(screen.getByLabelText('Pregúntame algo...'), 'Agenda');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText('Consultando agenda…')).toBeInTheDocument();
    first.unmount();

    const success = makeService({ sendMessage: vi.fn(async (): Promise<AssistantReply> => ({ status: 'success', message: 'Tarea creada correctamente.' })) });
    const second = renderAssistant(success);
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.type(screen.getByLabelText('Pregúntame algo...'), 'Crear tarea');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText('Tarea creada correctamente.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Acción completada.');
    second.unmount();

    const failure = makeService({ sendMessage: vi.fn(async () => { throw new Error('HTTP 500'); }) });
    renderAssistant(failure);
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.type(screen.getByLabelText('Pregúntame algo...'), 'Consulta');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pude completar esa consulta.');
    expect(screen.queryByText(/HTTP 500|endpoint|stack/i)).not.toBeInTheDocument();
  });

  it('Reintentar repite la consulta fallida y muestra la respuesta real', async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ status: 'success', message: 'Tienes dos pendientes reales.' });
    const service = makeService({ sendMessage });
    const user = userEvent.setup();
    renderAssistant(service);
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.type(screen.getByLabelText('Pregúntame algo...'), 'Muéstrame mis pendientes de hoy.');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Tienes dos pendientes reales.')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Muéstrame mis pendientes de hoy.' }), expect.any(AbortSignal));
  });

  it('envía historial acotado para un follow-up contextual', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ status: 'idle', message: 'EXP-1 y EXP-2 requieren atención.' })
      .mockResolvedValueOnce({ status: 'idle', message: 'EXP-1 es el urgente.' });
    const user = userEvent.setup();
    renderAssistant(makeService({ sendMessage }));
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    const composer = screen.getByLabelText('Pregúntame algo...');
    await user.type(composer, '¿Qué expedientes requieren atención?');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText('EXP-1 y EXP-2 requieren atención.')).toBeInTheDocument();
    await user.type(composer, 'Solo enséñame los urgentes.');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await screen.findByText('EXP-1 es el urgente.');
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Solo enséñame los urgentes.',
      history: [
        expect.objectContaining({ role: 'user', content: '¿Qué expedientes requieren atención?' }),
        expect.objectContaining({ role: 'assistant', content: 'EXP-1 y EXP-2 requieren atención.' }),
      ],
    }), expect.any(AbortSignal));
  });

  it('TEST 10 mantiene el input accesible y no corta una respuesta larga', async () => {
    const content = Array.from({ length: 35 }, (_value, index) => `## Bloque ${index + 1}\n\n- Resultado ${index + 1}`).join('\n\n');
    const user = userEvent.setup();
    renderAssistant(makeService({ sendMessage: vi.fn(async (): Promise<AssistantReply> => ({ status: 'idle', message: content })) }));
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    const composer = screen.getByLabelText('Pregúntame algo...');
    await user.type(composer, 'Dame un resumen completo.');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText('Resultado 35')).toBeInTheDocument();
    expect(composer).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeInTheDocument();
  });

  it('exige confirmación antes de llamar a una acción sensible', async () => {
    const confirmation = { id: 'confirm-1', title: 'Preparar una cita', summary: 'Revisa los datos antes de continuar.', details: [{ label: 'Expediente', value: 'Referencia del backend' }] };
    const service = makeService({ sendMessage: vi.fn(async (): Promise<AssistantReply> => ({ status: 'confirmation-required', message: 'Voy a preparar una cita con estos datos:', confirmation })) });
    const user = userEvent.setup();
    renderAssistant(service);
    await user.click(screen.getByRole('button', { name: 'Abrir PRAVIA IA' }));
    await user.type(screen.getByLabelText('Pregúntame algo...'), 'Preparar cita');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByLabelText('Confirmación requerida')).toBeInTheDocument();
    expect(service.confirmAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(service.confirmAction).toHaveBeenCalledWith('confirm-1', expect.objectContaining({ module: 'mi-dia' }), expect.any(AbortSignal)));
  });

  it('desactiva el movimiento del búho cuando el sistema lo solicita', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const { container } = renderAssistant();
    expect(container.querySelector('[data-motion="reduced"]')).toBeInTheDocument();
  });
});
