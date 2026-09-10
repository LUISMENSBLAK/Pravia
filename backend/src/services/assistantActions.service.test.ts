import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '../config/prisma';
import { AgendaController } from '../controllers/agenda.controller';
import { assistantConversationService } from './assistantConversation.service';
import { ProspectWorkflowService } from './prospectWorkflow.service';
import { CotizacionWorkflowService } from './cotizacionWorkflow.service';
import { ExpedienteActivityService } from './expedienteActivity.service';
import {
  AssistantActionError,
  assistantActionCatalog,
  cancelAssistantConfirmation,
  confirmAssistantAction,
  prepareOrExecuteAssistantAction,
} from './assistantActions.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'ana@example.test', nombre: 'Ana', apellido: 'Prueba', rol: 'ABOGADO', sessionId: 'session-1', membershipId: 'membership-1',
  scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['ai.use', 'ai.actions.prepare', 'agenda.write', 'prospectos.write', 'cotizaciones.write', 'expedientes.write', 'documentos.write', 'comparecientes.read'],
} as any;

const base = { actor, conversationId: 'conversation-1', messageId: 'message-1', correlationId: 'correlation-1' };

describe('PRAVIA IA action layer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('expone solo las acciones respaldadas por permisos del rol', () => {
    expect(assistantActionCatalog(actor).map((item) => item.key)).toContain('agenda.event.create');
    expect(assistantActionCatalog({ ...actor, permissions: ['ai.use'] } as any)).toEqual([]);
  });

  it('rechaza nombres de acción arbitrarios antes de ejecutar', async () => {
    await expect(prepareOrExecuteAssistantAction({ ...base, actionKey: 'database.raw.write', args: {} }))
      .rejects.toMatchObject<Partial<AssistantActionError>>({ code: 'AI_ACTION_UNKNOWN', status: 404 });
  });

  it('mantiene la autorización backend aunque una acción no se anuncie al rol', async () => {
    const restricted = { ...actor, permissions: ['ai.use', 'agenda.write'] } as any;
    await expect(prepareOrExecuteAssistantAction({ ...base, actor: restricted, actionKey: 'agenda.event.create', args: { titulo: 'Cita', fecha_inicio: '2026-09-30T10:00:00-06:00' } }))
      .rejects.toMatchObject<Partial<AssistantActionError>>({ code: 'AI_ACTION_DENIED', status: 403 });
  });

  it('rechaza argumentos desconocidos, incluida organización propuesta por el modelo', async () => {
    await expect(prepareOrExecuteAssistantAction({ ...base, actionKey: 'prospect.create', args: { nombre: 'Roberto', organization_id: 'foreign' } }))
      .rejects.toMatchObject<Partial<AssistantActionError>>({ code: 'AI_ACTION_UNKNOWN_ARGUMENT' });
  });

  it('pregunta únicamente la hora/fecha faltante y conserva estado estructurado', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    const save = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const result = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'agenda.event.create', args: { titulo: 'Cita con María' } });
    expect(result.message).toBe('¿En qué fecha y hora lo registro?');
    expect(save).toHaveBeenCalledWith(actor, 'conversation-1', expect.objectContaining({ status: 'COLLECTING', actionKey: 'agenda.event.create', missing: ['fecha_inicio'] }));
  });

  it('completa el dato faltante en el turno siguiente sin cambiar la invocación', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'COLLECTING', actionKey: 'agenda.event.create', args: { titulo: 'Cita con María' }, invocationId: 'stable-follow-up', missing: ['fecha_inicio'] });
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const create = vi.spyOn(AgendaController, 'create').mockImplementation(async (_req: any, res: any) => res.status(201).json({ success: true, evento: { id: 'event-1', titulo: 'Cita con María', fecha_inicio: '2026-09-30T10:00:00-06:00' } }));
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const result = await prepareOrExecuteAssistantAction({ ...base, messageId: 'message-2', actionKey: 'agenda.event.create', args: { fecha_inicio: '2026-09-30T10:00:00-06:00' } });
    expect(result.refresh).toBe('agenda');
    expect((create.mock.calls[0][0] as any).body).toMatchObject({ titulo: 'Cita con María', idempotency_key: 'stable-follow-up' });
  });

  it('reutiliza el expediente de la página y ejecuta una escritura segura sin confirmación', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const addNote = vi.spyOn(ExpedienteActivityService.prototype, 'addNote').mockResolvedValue({ item: { id: 'activity-1' }, idempotent: false } as any);
    const audit = vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const result = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'case.add_note', args: { note: 'Solicitar antecedente' }, context: { entityType: 'expediente', entityId: 'case-1' } });
    expect(result).toMatchObject({ refresh: 'actividad' });
    expect(result.confirmation).toBeUndefined();
    expect(addNote).toHaveBeenCalledWith(actor, 'case-1', expect.objectContaining({ note: 'Solicitar antecedente', idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor.organizationId, user_id: actor.id, detalles: expect.objectContaining({ origin: 'PRAVIA_AI', action_key: 'case.add_note' }) }) }));
  });

  it('devuelve el recibo durable y no repite una escritura segura al reintentar el mismo mensaje', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    const create = vi.spyOn(ProspectWorkflowService.prototype, 'create').mockResolvedValue({ prospecto: { id: 'prospect-1', nombre: 'Roberto' }, idempotent: false } as any);
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const first = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'prospect.create', args: { nombre: 'Roberto' } });
    const retry = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'prospect.create', args: { nombre: 'Roberto' } });
    expect(retry).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][2]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prepara la solicitud notarial con PRO-001 sin registrar un envío', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    vi.spyOn(ProspectWorkflowService.prototype, 'read').mockResolvedValue({ version: 4 } as any);
    const prepare = vi.spyOn(ProspectWorkflowService.prototype, 'prepare').mockResolvedValue({ subject: 'Solicitud de cotización', content: 'Borrador canónico', preparedOnly: true } as any);
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const result = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'prospect.notary_request.prepare', args: { prospect_id: 'prospect-1' } });
    expect(result.message).toContain('no registré ningún envío');
    expect(result.message).toContain('Borrador canónico');
    expect(prepare).toHaveBeenCalledWith(actor, 'prospect-1', { expectedVersion: 4, attachmentIds: [] });
  });

  it('prepara una transición sensible y no la ejecuta antes de confirmar', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    const save = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const act = vi.spyOn(CotizacionWorkflowService.prototype, 'act');
    const result = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'quote.transition', args: { quote_id: 'quote-1', action: 'SUSPENDER', reason: 'Solicitud del cliente' } });
    expect(result.confirmation).toMatchObject({ title: expect.stringContaining('transición') });
    expect(act).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(actor, 'conversation-1', expect.objectContaining({ status: 'AWAITING_CONFIRMATION', confirmationId: expect.any(String) }));
  });

  it('ejecuta la autoridad canónica únicamente al confirmar y conserva al actor humano', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'AWAITING_CONFIRMATION', actionKey: 'quote.transition', args: { quote_id: 'quote-1', action: 'SUSPENDER', reason: 'Solicitud del cliente' }, invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    vi.spyOn(CotizacionWorkflowService.prototype, 'read').mockResolvedValue({ version: 7 } as any);
    const act = vi.spyOn(CotizacionWorkflowService.prototype, 'act').mockResolvedValue({ idempotent: false, eventId: 'event-1' });
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: 'confirm-1', correlationId: 'correlation-1' })).resolves.toMatchObject({ refresh: 'cotizaciones' });
    expect(act).toHaveBeenCalledWith(actor, 'quote-1', expect.objectContaining({ expectedVersion: 7, idempotencyKey: 'stable-key', confirm: true }));
  });

  it('devuelve el recibo persistido al repetir el callback de confirmación', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'COMPLETED', actionKey: 'quote.transition', args: {}, invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), result: { status: 'success', message: 'La transición quedó registrada.', refresh: 'cotizaciones' } });
    const act = vi.spyOn(CotizacionWorkflowService.prototype, 'act');
    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: 'confirm-1', correlationId: 'retry-correlation' }))
      .resolves.toEqual({ status: 'success', message: 'La transición quedó registrada.', refresh: 'cotizaciones' });
    expect(act).not.toHaveBeenCalled();
  });

  it('la cancelación elimina el estado pendiente sin ejecutar la acción', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'AWAITING_CONFIRMATION', actionKey: 'quote.transition', args: {}, invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const clear = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    await cancelAssistantConfirmation(actor, 'conversation-1', 'confirm-1');
    expect(clear).toHaveBeenCalledWith(actor, 'conversation-1', undefined);
  });

  it('no produce éxito falso cuando la autoridad canónica rechaza el objeto', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(ExpedienteActivityService.prototype, 'addNote').mockRejectedValue(new Error('denied by canonical service'));
    await expect(prepareOrExecuteAssistantAction({ ...base, actionKey: 'case.add_note', args: { expediente_id: 'foreign-case', note: 'No autorizada' } })).rejects.toThrow('denied by canonical service');
  });
});
