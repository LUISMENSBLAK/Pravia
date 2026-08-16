import { describe, expect, it, vi } from 'vitest';
import { assistantToolCatalog, executeAssistantTool } from './assistantTools.service';

const user = (permissions: string[] = ['ai.use', 'ai.expedientes.read', 'expedientes.read']) => ({
  id: '11111111-1111-4111-8111-111111111111', email: 'user@example.test', nombre: 'Ana', apellido: 'Prueba',
  rol: 'ABOGADO', sessionId: 'session-1', permissions, requiresPasswordChange: false,
} as any);

const db = (expediente: any = null) => ({
  expediente: { findFirst: vi.fn().mockResolvedValue(expediente), findMany: vi.fn().mockResolvedValue([]) },
  compareciente: { findFirst: vi.fn(), findMany: vi.fn() },
  eventoAgenda: { findMany: vi.fn() }, tarea: { findMany: vi.fn() }, complianceReview: { findMany: vi.fn() },
  userPreference: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Mexico_City' }) },
  prospectoSeguimiento: { findMany: vi.fn().mockResolvedValue([]) },
  notaria: { findMany: vi.fn() }, user: { findFirst: vi.fn() }, auditLog: { create: vi.fn().mockResolvedValue({}) },
} as any);

describe('assistant backend tools', () => {
  it('deniega la tool antes de consultar datos si falta el permiso', async () => {
    const client = db();
    await expect(executeAssistantTool({ tool: 'getFinancialSummary', args: { expediente_id: 'exp-1' }, user: user(['ai.use', 'ai.finanzas.read', 'expedientes.read']), correlationId: 'corr-1' }, client))
      .rejects.toMatchObject({ code: 'AI_TOOL_PERMISSION_DENIED', status: 403 });
    expect(client.expediente.findMany).not.toHaveBeenCalled();
    expect(client.auditLog.create).toHaveBeenCalledTimes(2);
    expect(client.auditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'AI_TOOL_FAILED' }) }));
  });

  it('rechaza spoofing cuando argumento y contexto apuntan a objetos distintos', async () => {
    const client = db();
    await expect(executeAssistantTool({ tool: 'getExpedienteSummary', args: { expediente_id: 'exp-otro' }, context: { entity_type: 'expediente', entity_id: 'exp-contexto' }, user: user(), correlationId: 'corr-2' }, client))
      .rejects.toMatchObject({ code: 'AI_CONTEXT_OBJECT_MISMATCH', status: 409 });
    expect(client.expediente.findFirst).not.toHaveBeenCalled();
  });

  it('deniega un expediente fuera del scope del usuario', async () => {
    const client = db(null);
    await expect(executeAssistantTool({ tool: 'getExpedienteSummary', context: { entity_type: 'expediente', entity_id: 'exp-1' }, user: user(), correlationId: 'corr-3' }, client))
      .rejects.toMatchObject({ code: 'AI_EXPEDIENTE_SCOPE_DENIED', status: 403 });
    expect(client.expediente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'exp-1', archived_at: null }) }));
  });

  it('responde estructurado, con procedencia y audita una lectura permitida', async () => {
    const client = db({ id: 'exp-1', numero_pravia: 'EXP-2026-0001', cliente_alias: 'Cliente', estatus: 'EN_PROCESO', etapa_actual_nombre: 'Integración', tipo_acto: { nombre: 'Compraventa' }, abogado: { nombre: 'Ana', apellido: 'Prueba' }, gestor: null, notaria: null, fecha_apertura: new Date(), fecha_estimada_firma: null, fecha_real_firma: null, fecha_entrega_cliente: null, avance_general: 30, avance_documental: 40, avance_operativo: 20, avance_financiero: 30 });
    const result = await executeAssistantTool({ tool: 'getExpedienteSummary', context: { entity_type: 'expediente', entity_id: 'exp-1' }, user: user(), correlationId: 'corr-4' }, client);
    expect(result).toMatchObject({ success: true, tool: 'getExpedienteSummary', correlation_id: 'corr-4', data: { folio: 'EXP-2026-0001' }, provenance: [{ entity: 'Expediente', id: 'exp-1' }] });
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'AI_TOOL_COMPLETED', correlation_id: 'corr-4' }) }));
  });

  it('prepara una acción sin persistirla ni ejecutar la API normal', async () => {
    const client = db({ id: 'exp-1', numero_pravia: 'EXP-2026-0001' });
    client.user.findFirst.mockResolvedValue({ id: user().id, nombre: 'Ana', apellido: 'Prueba' });
    const result = await executeAssistantTool({ tool: 'prepareTask', args: { title: 'Revisar documentos', fecha_limite: '2026-08-14', expediente_id: 'exp-1' }, user: user(['ai.use', 'ai.actions.prepare', 'agenda.write', 'expedientes.read']), correlationId: 'corr-5' }, client);
    expect(result.data).toMatchObject({ kind: 'PREPARED_ACTION', status: 'AWAITING_CONFIRMATION', confirmation: { method: 'POST', endpoint: '/agenda/tareas', requires_explicit_confirmation: true }, controls: ['CONFIRMAR', 'EDITAR', 'CANCELAR'] });
    expect(client.tarea).toEqual(expect.objectContaining({ findMany: expect.any(Function) }));
    expect(client.auditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'AI_TOOL_PREPARED' }) }));
  });

  it('publica un catálogo sin nombres internos de permisos', () => {
    const catalog = assistantToolCatalog(user());
    expect(catalog.map((item) => item.name)).toContain('getExpedienteSummary');
    expect(catalog.map((item) => item.name)).not.toContain('getFinancialSummary');
    expect(catalog[0]).not.toHaveProperty('permission');
    expect(catalog[0]).toEqual(expect.objectContaining({ mode: expect.any(String), object_scope: expect.any(String), sensitivity: expect.any(String) }));
  });

  it('publica Reportes para IA solo con la doble autorización requerida', () => {
    const allowed = assistantToolCatalog(user(['ai.use', 'ai.reportes.read', 'reportes.read']));
    expect(allowed.map((item) => item.name)).toContain('getReportingSummary');
    const missingModulePermission = assistantToolCatalog(user(['ai.use', 'ai.reportes.read']));
    expect(missingModulePermission.map((item) => item.name)).not.toContain('getReportingSummary');
  });

  it('lee trabajo real exclusivamente del usuario autenticado', async () => {
    const client = db();
    client.tarea.findMany.mockResolvedValueOnce([{ id: 'task-1', titulo: 'Revisar escritura', prioridad: 'ALTA', estatus: 'PENDIENTE', fecha_limite: new Date(), fecha_completada: null, expediente: { id: 'exp-1', numero_pravia: 'EXP-2026-0042' } }]).mockResolvedValueOnce([]);
    client.eventoAgenda.findMany.mockResolvedValue([]);
    const currentUser = user(['ai.use', 'ai.work.read', 'mi_dia.read']);
    const result = await executeAssistantTool({ tool: 'getCurrentUserWork', args: { period: 'THIS_MONTH', limit: 10 }, user: currentUser, correlationId: 'corr-work' }, client);
    expect(client.tarea.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ asignado_a_id: currentUser.id }) }));
    expect(result.data.tareas_del_periodo[0]).toMatchObject({ titulo: 'Revisar escritura', expediente: { numero_pravia: 'EXP-2026-0042' } });
    expect(result.data.periodo.timezone).toBe('America/Mexico_City');
  });

  it('consulta agenda con el límite final exclusivo de la zona configurada', async () => {
    const client = db();
    client.eventoAgenda.findMany.mockResolvedValue([]);
    const currentUser = user(['ai.use', 'ai.agenda.read', 'agenda.read']);
    const result = await executeAssistantTool({ tool: 'getAgenda', args: { period: 'TODAY' }, user: currentUser, correlationId: 'corr-agenda' }, client);
    expect(client.eventoAgenda.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        user_id: currentUser.id,
        fecha_inicio: { gte: expect.any(Date), lt: expect.any(Date) },
      }),
    }));
    expect(result.data.periodo).toMatchObject({ key: 'TODAY', timezone: 'America/Mexico_City' });
  });

  it('mantiene seguimientos comerciales separados y dentro del scope autorizado', async () => {
    const client = db();
    client.prospectoSeguimiento.findMany.mockResolvedValue([{
      id: 'follow-1', tipo: 'LLAMADA', proxima_accion: 'Confirmar documentos',
      fecha_proximo_seguimiento: new Date(),
      prospecto: { id: 'prospect-1', nombre: 'Cliente potencial', estado: 'SEGUIMIENTO', prioridad: 'ALTA', tipo_acto: 'Compraventa' },
    }]);
    const prospectUser = user(['ai.use', 'ai.prospectos.read', 'prospectos.read']);
    const result = await executeAssistantTool({ tool: 'getProspectFollowUps', args: { period: 'THIS_MONTH' }, user: prospectUser, correlationId: 'corr-prospect' }, client);
    expect(client.prospectoSeguimiento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ prospecto: expect.objectContaining({ archived_at: null }) }),
    }));
    expect(result.data.seguimientos_del_periodo[0]).toMatchObject({ prospecto: { nombre: 'Cliente potencial' } });
    expect(result.provenance).toEqual([expect.objectContaining({ entity: 'Prospecto', id: 'prospect-1' })]);
  });

  it('resuelve un follow-up por folio visible sin relajar el scope del expediente', async () => {
    const client = db();
    client.expediente.findFirst
      .mockResolvedValueOnce({ id: 'exp-1' })
      .mockResolvedValueOnce({
        id: 'exp-1', numero_pravia: 'EXP-2026-0042',
        requisitos_docs: [{ id: 'req-1', nombre: 'Identificación', categoria: 'IDENTIDAD', estatus: 'PENDIENTE', fecha_vencimiento: null }],
        tareas: [], tareas_externas: [],
      });
    const result = await executeAssistantTool({ tool: 'getExpedientePendingItems', args: { folio: 'EXP-2026-0042' }, user: user(), correlationId: 'corr-follow-up' }, client);
    expect(client.expediente.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ numero_pravia: { equals: 'EXP-2026-0042', mode: 'insensitive' }, archived_at: null }),
    }));
    expect(result.data).toMatchObject({ folio: 'EXP-2026-0042', total_pendientes: 1 });
  });

  it('identifica expedientes que requieren atención con motivos reales y dentro del scope', async () => {
    const client = db();
    client.expediente.findMany.mockResolvedValue([{
      id: 'exp-attention', numero_pravia: 'EXP-2026-0099', cliente_alias: 'Cliente Atención',
      estatus: 'PENDIENTE_CLIENTE', etapa_actual_nombre: 'Integración', updated_at: new Date('2026-08-15T10:00:00Z'),
      fecha_estimada_firma: null, fecha_real_firma: null, requisitos_docs: [{ id: 'req-1', nombre: 'Identificación', estatus: 'VENCIDO', fecha_vencimiento: new Date('2026-08-14T10:00:00Z') }],
      tareas: [{ id: 'task-1', titulo: 'Revisar documentación', prioridad: 'ALTA', estatus: 'PENDIENTE', fecha_limite: new Date('2026-08-14T10:00:00Z') }],
      tareas_externas: [],
    }]);
    const result = await executeAssistantTool({ tool: 'getExpedientesRequiringAttention', args: { limit: 10 }, user: user(), correlationId: 'corr-attention' }, client);
    expect(client.expediente.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ archived_at: null }),
      take: 300,
    }));
    expect(result.data).toEqual([expect.objectContaining({
      folio: 'EXP-2026-0099',
      reasons: expect.arrayContaining([
        expect.objectContaining({ type: 'PENDIENTE_CLIENTE' }),
        expect.objectContaining({ type: 'TAREA_VENCIDA', detail: 'Revisar documentación' }),
        expect.objectContaining({ type: 'DOCUMENTO_PENDIENTE', detail: 'Identificación' }),
      ]),
    })]);
    expect(result.provenance).toEqual([expect.objectContaining({ entity: 'Expediente', id: 'exp-attention', label: 'EXP-2026-0099' })]);
  });
});
