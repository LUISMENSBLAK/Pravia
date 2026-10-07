import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../config/prisma';
import { AgendaController } from '../controllers/agenda.controller';
import { assistantConversationService } from './assistantConversation.service';
import { ProspectWorkflowService } from './prospectWorkflow.service';
import { CotizacionWorkflowService } from './cotizacionWorkflow.service';
import { ExpedienteActivityService } from './expedienteActivity.service';
import { ProspectWorkflowError } from '../domain/prospectWorkflow';
import { ProjectGenerationService } from './projectGeneration.service';
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
  beforeEach(() => {
    vi.spyOn(assistantConversationService, 'claimActionState').mockImplementation(async (_actor, conversationId, confirmationId) => {
      const state = await assistantConversationService.actionState(actor, conversationId);
      if (state?.confirmationId !== confirmationId) return { status: 'NOT_FOUND' as const, state };
      if (state.status === 'COMPLETED') return { status: 'COMPLETED' as const, state };
      if (state.status === 'EXECUTING') return { status: 'IN_PROGRESS' as const, state };
      if (state.status !== 'AWAITING_CONFIRMATION') return { status: 'NOT_FOUND' as const, state };
      return { status: 'CLAIMED' as const, state: { ...state, status: 'EXECUTING' as const, executingAt: new Date().toISOString() } };
    });
  });

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

  it('ejecuta una acción E de bajo riesgo sin confirmación redundante cuando el usuario la ordena de forma directa', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    const save = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const create = vi.spyOn(AgendaController, 'create').mockImplementation(async (_req: any, res: any) => res.status(201).json({ success: true, evento: { id: 'event-direct', titulo: 'Firma', fecha_inicio: '2026-09-30T10:00:00-06:00' } }));
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const result = await prepareOrExecuteAssistantAction({ ...base, origin: 'USER_COMMAND', actionKey: 'agenda.event.create', args: { titulo: 'Firma', fecha_inicio: '2026-09-30T10:00:00-06:00' } });
    expect(result).toMatchObject({ status: 'success', refresh: 'agenda' });
    expect(result.confirmation).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(actor, 'conversation-1', expect.objectContaining({ status: 'COMPLETED', actionKey: 'agenda.event.create' }));
  });

  it('normaliza un tipo de agenda expresado en forma humana al enum canónico antes de ejecutar', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const create = vi.spyOn(AgendaController, 'create').mockImplementation(async (req: any, res: any) => res.status(201).json({ success: true, evento: { id: 'event-1', titulo: req.body.titulo, fecha_inicio: req.body.fecha_inicio, tipo: req.body.tipo } }));
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);

    await prepareOrExecuteAssistantAction({ ...base, origin: 'USER_COMMAND', actionKey: 'agenda.event.create', args: { titulo: 'Cita de revisión', tipo: 'cita', fecha_inicio: '2026-09-30T10:00:00-06:00' } });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ tipo: 'CITA' }) }), expect.anything());
  });

  it('respeta la privacidad expresamente pedida por el usuario aunque el planificador proponga TODOS', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const create = vi.spyOn(AgendaController, 'create').mockImplementation(async (req: any, res: any) => res.status(201).json({ success: true, evento: { id: 'event-private', titulo: req.body.titulo, fecha_inicio: req.body.fecha_inicio } }));
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);

    await prepareOrExecuteAssistantAction({ ...base, origin: 'USER_COMMAND', actionKey: 'agenda.event.create',
      context: { requestMessage: 'Agenda una cita solo para mí mañana.' },
      args: { titulo: 'Cita privada', fecha_inicio: '2026-09-30T10:00:00-06:00', visibilidad: 'ORGANIZATION' } });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ visibilidad: 'PRIVATE' }) }), expect.anything());
  });

  it('normaliza etiquetas humanas de tipo de persona y solicita un catálogo válido si el planificador envía un placeholder', async () => {
    let stored: any;
    const partyActor = { ...actor, permissions: [...actor.permissions, 'comparecientes.write'] } as any;
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });

    const human = await prepareOrExecuteAssistantAction({
      ...base, actor: partyActor, actionKey: 'party.create', args: { tipo_persona: 'Persona física' },
    });
    expect(human.collection?.fields).toEqual([expect.objectContaining({ name: 'nombre' })]);
    expect(stored.args).toMatchObject({ tipo_persona: 'FISICA' });

    stored = undefined;
    const placeholder = await prepareOrExecuteAssistantAction({
      ...base, actor: partyActor, messageId: 'message-placeholder', actionKey: 'party.create', args: { tipo_persona: 'NO_ESPECIFICADO' },
    });
    expect(placeholder.collection?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tipo_persona', type: 'select' }),
      expect.objectContaining({ name: 'nombre' }),
    ]));
    expect(stored.args).not.toHaveProperty('tipo_persona');
  });

  it('nunca convierte placeholders del planificador en datos maestros', async () => {
    let stored: any;
    const propertyActor = { ...actor, permissions: [...actor.permissions, 'predios.write'] } as any;
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });

    const prepared = await prepareOrExecuteAssistantAction({
      ...base, actor: propertyActor, actionKey: 'property.create', args: { ubicacion_texto: 'pendiente' },
    });

    expect(prepared.confirmation).toBeUndefined();
    expect(prepared.collection?.fields).toEqual([expect.objectContaining({ name: 'ubicacion_texto', required: true })]);
    expect(stored.args).not.toHaveProperty('ubicacion_texto');
  });

  it('exige la fecha efectiva antes de preparar una conversión Cotización a Expediente', async () => {
    let stored: any;
    const quoteActor = { ...actor, permissions: [...actor.permissions, 'cotizaciones.write', 'expedientes.write'] } as any;
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });

    const prepared = await prepareOrExecuteAssistantAction({
      ...base, actor: quoteActor, actionKey: 'quote.convert_to_case', args: { quote_id: 'quote-1' },
    });

    expect(prepared.confirmation).toBeUndefined();
    expect(prepared.collection?.fields).toEqual([expect.objectContaining({ name: 'effectiveAt', label: 'Fecha y hora efectiva', required: true })]);
    expect(stored).toMatchObject({ status: 'COLLECTING', missing: ['effectiveAt'] });
  });

  it('usa CITA como tipo canónico cuando el usuario no especifica uno', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const create = vi.spyOn(AgendaController, 'create').mockImplementation(async (req: any, res: any) => res.status(201).json({ success: true, evento: { id: 'event-default', titulo: req.body.titulo, fecha_inicio: req.body.fecha_inicio, tipo: req.body.tipo } }));
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);

    await prepareOrExecuteAssistantAction({ ...base, origin: 'USER_COMMAND', actionKey: 'agenda.event.create', args: { titulo: 'Cita de revisión', fecha_inicio: '2026-09-30T10:00:00-06:00' } });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ tipo: 'CITA' }) }), expect.anything());
  });

  it('mantiene confirmación para la misma acción E si la iniciativa es proactiva', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const create = vi.spyOn(AgendaController, 'create');
    const result = await prepareOrExecuteAssistantAction({ ...base, origin: 'PROACTIVE', actionKey: 'agenda.event.create', args: { titulo: 'Firma', fecha_inicio: '2026-09-30T10:00:00-06:00' } });
    expect(result.confirmation).toMatchObject({ level: 'STANDARD' });
    expect(create).not.toHaveBeenCalled();
  });

  it('pregunta únicamente la hora/fecha faltante y conserva estado estructurado', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    const save = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    const result = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'agenda.event.create', args: { titulo: 'Cita con María' } });
    expect(result.message).toBe('¿En qué fecha y hora lo registro?');
    expect(result.collection).toMatchObject({
      actionKey: 'agenda.event.create',
      fields: [{ name: 'fecha_inicio', label: 'Fecha y hora', type: 'text', required: true }],
    });
    expect(save).toHaveBeenCalledWith(actor, 'conversation-1', expect.objectContaining({ status: 'COLLECTING', actionKey: 'agenda.event.create', missing: ['fecha_inicio'] }));
  });

  it('deriva adjuntos y destino del contexto pero exige confirmación antes de incorporarlos', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    vi.spyOn((prisma as any).expediente, 'findFirst').mockResolvedValue({ numero_pravia: 'EXP-0001-2026' });
    const promote = vi.spyOn(assistantConversationService, 'promoteAttachment').mockResolvedValue({ documentId: 'document-1', attachmentId: 'attachment-1', duplicate: false });
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const prepared = await prepareOrExecuteAssistantAction({
      ...base,
      actionKey: 'document.attach_uploaded',
      args: { tipo_documento: 'IDENTIFICACION', attachment_ids: [], target_id: 'current', target_type: 'EXPEDIENTE' },
      context: { entityType: 'expediente', entityId: 'case-1', attachmentIds: ['attachment-1'] },
    });
    expect(prepared.confirmation).toBeDefined();
    expect(stored.args).toMatchObject({ attachment_ids: ['attachment-1'], target_type: 'EXPEDIENTE', target_id: 'case-1', tipo_documento: 'IDENTIFICACION' });
    expect(promote).not.toHaveBeenCalled();
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(prisma as any));
    await confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'correlation-1' });
    expect(promote).toHaveBeenCalledWith(actor, 'conversation-1', 'attachment-1', { targetType: 'EXPEDIENTE', targetId: 'case-1', documentType: 'IDENTIFICACION' }, prisma);
  });

  it('incorpora todos los adjuntos dentro de una sola transacción canónica', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    vi.spyOn((prisma as any).expediente, 'findFirst').mockResolvedValue({ numero_pravia: 'EXP-0001-2026' });
    const tx = { marker: 'single-transaction' } as any;
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));
    const promote = vi.spyOn(assistantConversationService, 'promoteAttachment')
      .mockResolvedValueOnce({ documentId: 'document-1', attachmentId: 'attachment-1', duplicate: false })
      .mockResolvedValueOnce({ documentId: 'document-2', attachmentId: 'attachment-2', duplicate: false });
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);

    const prepared = await prepareOrExecuteAssistantAction({
      ...base, actionKey: 'document.attach_uploaded',
      args: { tipo_documento: 'OTROS', attachment_ids: ['attachment-1', 'attachment-2'], target_type: 'EXPEDIENTE', target_id: 'case-1' },
    });
    await confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'correlation-1' });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(promote).toHaveBeenCalledTimes(2);
    expect(promote.mock.calls.every((call) => call[4] === tx)).toBe(true);
  });

  it('propone datos extraídos sólo después de una orden explícita y los deja sujetos a confirmación', async () => {
    let stored: any;
    const partyActor = { ...actor, permissions: [...actor.permissions, 'comparecientes.write'] } as any;
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    const prepared = await prepareOrExecuteAssistantAction({
      ...base,
      actor: partyActor,
      actionKey: 'party.create',
      args: {},
      context: { attachmentFacts: [
        { field: 'tipo_persona', value: 'Persona física', attachmentId: 'attachment-1' },
        { field: 'nombre', value: 'María', attachmentId: 'attachment-1' },
        { field: 'apellido_paterno', value: 'López', attachmentId: 'attachment-1' },
        { field: 'rfc', value: 'LOPM900101AA1', attachmentId: 'attachment-1' },
      ] },
    });
    expect(prepared.confirmation).toBeDefined();
    expect(stored.args).toMatchObject({ tipo_persona: 'FISICA', nombre: 'María', apellido_paterno: 'López', rfc: 'LOPM900101AA1' });
  });

  it('completa el dato faltante en el turno siguiente sin cambiar la invocación', async () => {
    let stored: any = { status: 'COLLECTING', actionKey: 'agenda.event.create', args: { titulo: 'Cita con María' }, invocationId: 'stable-follow-up', missing: ['fecha_inicio'] };
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    const create = vi.spyOn(AgendaController, 'create').mockImplementation(async (_req: any, res: any) => res.status(201).json({ success: true, evento: { id: 'event-1', titulo: 'Cita con María', fecha_inicio: '2026-09-30T10:00:00-06:00' } }));
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const prepared = await prepareOrExecuteAssistantAction({ ...base, messageId: 'message-2', actionKey: 'agenda.event.create', args: { fecha_inicio: '2026-09-30T10:00:00-06:00' } });
    expect(prepared.confirmation).toBeDefined();
    expect(create).not.toHaveBeenCalled();
    const result = await confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'correlation-1' });
    expect(result.refresh).toBe('agenda');
    expect((create.mock.calls[0][0] as any).body).toMatchObject({ titulo: 'Cita con María', idempotency_key: 'stable-follow-up' });
  });

  it('reutiliza el expediente de la página y exige confirmación antes de una escritura segura', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    const addNote = vi.spyOn(ExpedienteActivityService.prototype, 'addNote').mockResolvedValue({ item: { id: 'activity-1' }, idempotent: false } as any);
    const audit = vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const prepared = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'case.add_note', args: { note: 'Solicitar antecedente' }, context: { entityType: 'expediente', entityId: 'case-1' } });
    expect(prepared.confirmation).toBeDefined();
    expect(addNote).not.toHaveBeenCalled();
    const result = await confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'correlation-1' });
    expect(result).toMatchObject({ refresh: 'actividad' });
    expect(addNote).toHaveBeenCalledWith(actor, 'case-1', expect.objectContaining({ note: 'Solicitar antecedente', idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor.organizationId, user_id: actor.id, detalles: expect.objectContaining({ origin: 'PRAVIA_IA', action_key: 'case.add_note' }) }) }));
  });

  it('resuelve referencias humanas al objeto visible sin enviar identificadores inválidos a Prisma', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });

    await prepareOrExecuteAssistantAction({
      ...base,
      actionKey: 'case.add_note',
      args: { expediente_id: 'EXPEDIENTE_VISIBLE_ACTUAL', note: 'Solicitar antecedente' },
      context: { entityType: 'expediente', entityId: '22222222-2222-4222-8222-222222222222' },
    });

    expect(stored.args.expediente_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('combina de forma explícita las indicaciones visibles de Proyecto con las de PRAVIA IA', async () => {
    let stored: any;
    const projectActor = { ...actor, permissions: [...actor.permissions, 'expedientes.project.read', 'ia.execute'] } as any;
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    vi.spyOn((prisma as any).expediente, 'findFirst').mockResolvedValue({ id: 'case-1', numero_pravia: 'EXP-0001-2026', updated_at: new Date('2026-09-23T10:00:00.000Z') });
    vi.spyOn(ProjectGenerationService.prototype, 'workspace').mockResolvedValue({
      expediente: { id: 'case-1', folio: 'EXP-0001-2026', acts: [{ id: 'act-1', name: 'Compraventa' }] },
      templates: [{ id: 'artifact-1', name: 'Machote QA', default: true, versions: [{ id: 'template-v1', version: 1, name: 'Machote QA' }] }],
      suggested_template: { artifact_id: 'artifact-1', name: 'Machote QA', version_id: 'template-v1', version: 1 },
      pending_detectable_count: 2,
      sources: { documents: [{ selected_by_default: true, documento: { id: 'source-1' } }] },
    } as any);

    const prepared = await prepareOrExecuteAssistantAction({
      ...base,
      actor: projectActor,
      actionKey: 'project.generate',
      args: { instructions: 'Revisa especialmente el antecedente.' },
      context: {
        entityType: 'proyecto',
        entityId: 'case-1',
        projectDraft: { instructions: 'Conservar literalmente la cláusula tercera.', templateVersionId: 'template-v1', sourceDocumentIds: ['source-1'] },
      },
    });

    expect(prepared.confirmation).toMatchObject({ confirmLabel: 'Generar proyecto' });
    expect(stored.args).toMatchObject({
      expediente_id: 'case-1',
      template_version_id: 'template-v1',
      source_document_ids: ['source-1'],
      instructions: 'Indicaciones existentes:\nConservar literalmente la cláusula tercera.\n\nIndicaciones de esta solicitud:\nRevisa especialmente el antecedente.',
    });
  });

  it('extrae determinísticamente la indicación del mensaje si el proveedor omite ese argumento', async () => {
    let stored: any;
    const projectActor = { ...actor, permissions: [...actor.permissions, 'expedientes.project.read', 'ia.execute'] } as any;
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    vi.spyOn((prisma as any).expediente, 'findFirst').mockResolvedValue({ id: 'case-1', numero_pravia: 'EXP-0001-2026', updated_at: new Date('2026-09-23T10:00:00.000Z') });
    vi.spyOn(ProjectGenerationService.prototype, 'workspace').mockResolvedValue({
      expediente: { id: 'case-1', folio: 'EXP-0001-2026', acts: [{ id: 'act-1', name: 'Compraventa' }] },
      templates: [{ id: 'artifact-1', name: 'Machote QA', default: true, versions: [{ id: 'template-v1', version: 1, name: 'Machote_QA.docx' }] }],
      pending_detectable_count: 0,
      sources: { documents: [] },
    } as any);

    await prepareOrExecuteAssistantAction({
      ...base,
      actor: projectActor,
      actionKey: 'project.generate',
      args: {},
      context: {
        entityType: 'proyecto',
        entityId: 'case-1',
        requestMessage: 'Proyéctalo y revisa especialmente el antecedente.',
        projectDraft: { instructions: 'Conservar literalmente la cláusula tercera.', templateVersionId: 'template-v1' },
      },
    });

    expect(stored.args.instructions).toBe('Indicaciones existentes:\nConservar literalmente la cláusula tercera.\n\nIndicaciones de esta solicitud:\nRevisa especialmente el antecedente.');
  });

  it('deniega project.generate a un usuario sin permisos aunque lo solicite mediante PRAVIA IA', async () => {
    const restricted = { ...actor, permissions: ['ai.use', 'ai.actions.prepare', 'expedientes.project.read'] } as any;
    await expect(prepareOrExecuteAssistantAction({ ...base, actor: restricted, actionKey: 'project.generate', args: { expediente_id: 'case-1' } }))
      .rejects.toMatchObject<Partial<AssistantActionError>>({ code: 'AI_ACTION_DENIED', status: 403 });
  });

  it('devuelve el recibo durable y no repite una escritura segura al reintentar el mismo mensaje', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    const create = vi.spyOn(ProspectWorkflowService.prototype, 'create').mockResolvedValue({ prospecto: { id: 'prospect-1', nombre: 'Roberto' }, idempotent: false } as any);
    vi.spyOn((prisma as any).auditLog, 'create').mockResolvedValue({} as any);
    const prepared = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'prospect.create', args: { nombre: 'Roberto' } });
    const first = await confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'correlation-1' });
    const retry = await confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'retry-correlation' });
    expect(retry).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][2]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('no expone el flujo legacy de solicitud a una notaría externa', () => {
    expect(assistantActionCatalog(actor).map((item) => item.key)).not.toContain('prospect.notary_request.prepare');
  });

  it('solicita en el chat un responsable autorizado antes de confirmar listo para cotizar', async () => {
    let pending: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => pending);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { pending = state; return undefined as any; });
    vi.spyOn(ProspectWorkflowService.prototype, 'read').mockResolvedValue({
      folio: 'PRO-0001-2026', stage: 'EN_INTEGRACION', stageLabel: 'En integración', version: 3,
      actions: [{ code: 'MARCAR_LISTO_PARA_COTIZAR', label: 'Marcar listo para cotizar' }],
      quoteAssignee: null,
      quoteAssignees: [{ id: actor.id, nombre: 'Ana', apellido: 'Prueba' }],
    } as any);
    const act = vi.spyOn(ProspectWorkflowService.prototype, 'act');

    const first = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'prospect.transition',
      args: { prospect_id: 'prospect-1', action: 'MARCAR_LISTO_PARA_COTIZAR' } });
    expect(first.confirmation).toBeUndefined();
    expect(first.collection?.fields).toContainEqual(expect.objectContaining({
      name: 'quoteAssigneeId', type: 'select', options: [{ value: actor.id, label: 'Ana Prueba' }],
    }));
    expect(act).not.toHaveBeenCalled();

    await expect(prepareOrExecuteAssistantAction({ ...base, messageId: 'form-foreign', actionKey: 'prospect.transition',
      args: { quoteAssigneeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }))
      .rejects.toMatchObject({ code: 'AI_PROSPECT_QUOTE_ASSIGNEE_INVALID', status: 409 });
    expect(act).not.toHaveBeenCalled();

    const selected = await prepareOrExecuteAssistantAction({ ...base, messageId: 'form-valid', actionKey: 'prospect.transition',
      args: { quoteAssigneeId: actor.id } });
    expect(selected.confirmation).toBeDefined();
    expect(selected.collection).toBeUndefined();
    expect(pending).toMatchObject({ status: 'AWAITING_CONFIRMATION', args: { quoteAssigneeId: actor.id } });
    expect(act).not.toHaveBeenCalled();
  });

  it('prepara una transición sensible y no la ejecuta antes de confirmar', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue(undefined);
    const save = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    vi.spyOn(CotizacionWorkflowService.prototype, 'read').mockResolvedValue({ numero_cotizacion: 'COT-0001-2026', estado: 'BORRADOR', version: 3 } as any);
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

  it('traduce un rechazo contractual de Prospectos a un error operativo controlado', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({
      status: 'AWAITING_CONFIRMATION', actionKey: 'prospect.transition',
      args: { prospect_id: 'prospect-1', action: 'MARCAR_LISTO_PARA_COTIZAR' },
      invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      preview: { guard: { kind: 'PROSPECT_VERSION', id: 'prospect-1', version: 4 } },
    });
    vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    vi.spyOn(ProspectWorkflowService.prototype, 'read').mockResolvedValue({ version: 4 } as any);
    vi.spyOn(ProspectWorkflowService.prototype, 'act').mockRejectedValue(new ProspectWorkflowError(409, 'PRO001_ACT_REQUIRED', 'Selecciona al menos un acto preliminar.'));

    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: 'confirm-1', correlationId: 'correlation-1' }))
      .rejects.toMatchObject<Partial<AssistantActionError>>({ code: 'PRO001_ACT_REQUIRED', status: 409, message: 'Selecciona al menos un acto preliminar.' });
  });

  it('devuelve el recibo persistido al repetir el callback de confirmación', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'COMPLETED', actionKey: 'quote.transition', args: {}, invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), result: { status: 'success', message: 'La transición quedó registrada.', refresh: 'cotizaciones' } });
    const act = vi.spyOn(CotizacionWorkflowService.prototype, 'act');
    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: 'confirm-1', correlationId: 'retry-correlation' }))
      .resolves.toEqual({ status: 'success', message: 'La transición quedó registrada.', refresh: 'cotizaciones' });
    expect(act).not.toHaveBeenCalled();
  });

  it('rechaza una segunda confirmación mientras la primera sigue ejecutándose', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'EXECUTING', actionKey: 'quote.transition', args: {}, invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), executingAt: new Date().toISOString() });
    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: 'confirm-1', correlationId: 'retry-correlation' }))
      .rejects.toMatchObject({ code: 'AI_ACTION_IN_PROGRESS', status: 409 });
  });

  it('propaga el conflicto canónico si el objeto cambia entre plan y ejecución', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({
      status: 'AWAITING_CONFIRMATION', actionKey: 'quote.transition',
      args: { quote_id: 'quote-1', action: 'SUSPENDER', reason: 'Solicitud del cliente' },
      invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const save = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    vi.spyOn(CotizacionWorkflowService.prototype, 'read').mockResolvedValue({ version: 8 } as any);
    vi.spyOn(CotizacionWorkflowService.prototype, 'act').mockRejectedValue(Object.assign(new Error('La cotización cambió.'), { code: 'QUOTE_VERSION_CONFLICT', status: 409 }));
    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: 'confirm-1', correlationId: 'correlation-1' }))
      .rejects.toMatchObject({ code: 'QUOTE_VERSION_CONFLICT', status: 409 });
    expect(save).not.toHaveBeenCalledWith(actor, 'conversation-1', expect.objectContaining({ status: 'COMPLETED' }));
  });

  it('la cancelación elimina el estado pendiente sin ejecutar la acción', async () => {
    vi.spyOn(assistantConversationService, 'actionState').mockResolvedValue({ status: 'AWAITING_CONFIRMATION', actionKey: 'quote.transition', args: {}, invocationId: 'stable-key', confirmationId: 'confirm-1', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const clear = vi.spyOn(assistantConversationService, 'setActionState').mockResolvedValue(undefined as any);
    await cancelAssistantConfirmation(actor, 'conversation-1', 'confirm-1');
    expect(clear).toHaveBeenCalledWith(actor, 'conversation-1', undefined);
  });

  it('no produce éxito falso cuando la autoridad canónica rechaza el objeto', async () => {
    let stored: any;
    vi.spyOn(assistantConversationService, 'actionState').mockImplementation(async () => stored);
    vi.spyOn(assistantConversationService, 'setActionState').mockImplementation(async (_actor, _conversationId, state) => { stored = state; });
    vi.spyOn(ExpedienteActivityService.prototype, 'addNote').mockRejectedValue(new Error('denied by canonical service'));
    const prepared = await prepareOrExecuteAssistantAction({ ...base, actionKey: 'case.add_note', args: { expediente_id: 'foreign-case', note: 'No autorizada' } });
    await expect(confirmAssistantAction({ actor, conversationId: 'conversation-1', confirmationId: prepared.confirmation!.id, correlationId: 'correlation-1' })).rejects.toThrow('denied by canonical service');
  });
});
