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
});
