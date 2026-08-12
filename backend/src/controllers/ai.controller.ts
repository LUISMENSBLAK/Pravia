import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { getOpenAIEscalationModelName, getOpenAIModelName } from '../services/openaiDocument.service';
import { ASSISTANT_TOOL_REGISTRY, AssistantToolError, assistantToolCatalog, canUseAssistantTool, executeAssistantTool, type AssistantToolName } from '../services/assistantTools.service';

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function periodStart(value: unknown) {
  const now = new Date();
  const period = String(value || '30_DIAS').toUpperCase();
  if (period === 'HOY') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'ESTE_MES') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'TODO') return new Date('2000-01-01T00:00:00');
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
}

export class AIController {
  static async tools(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
    return res.json({ success: true, tools: assistantToolCatalog(req.user) });
  }

  static async confirmPreparedAction(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const tool = String(req.body?.tool || '') as AssistantToolName;
      const definition = ASSISTANT_TOOL_REGISTRY[tool];
      if (!definition || definition.mode !== 'PREPARE_ONLY' || !canUseAssistantTool(req.user, tool)) {
        return res.status(403).json({ success: false, code: 'AI_CONFIRMATION_DENIED', error: 'Esta confirmación no corresponde a una acción preparada disponible para tu función.' });
      }
      const preparedCorrelationId = String(req.body?.prepared_correlation_id || '').trim().slice(0, 120);
      if (!preparedCorrelationId) return res.status(400).json({ success: false, code: 'AI_CONFIRMATION_REFERENCE_REQUIRED', error: 'No se encontró la referencia de la acción preparada.' });
      await prisma.auditLog.create({ data: {
        user_id: req.user.id,
        accion: 'AI_TOOL_CONFIRMED',
        entidad: 'User',
        entidad_id: req.user.id,
        correlation_id: req.correlationId,
        session_id: req.user.sessionId,
        detalles: {
          tool,
          prepared_correlation_id: preparedCorrelationId,
          target_endpoint: String(req.body?.target_endpoint || '').slice(0, 160),
          result_entity_type: String(req.body?.result_entity_type || '').slice(0, 60) || null,
          result_entity_id: String(req.body?.result_entity_id || '').slice(0, 80) || null,
        },
      } });
      return res.status(201).json({ success: true, correlation_id: req.correlationId });
    } catch {
      return res.status(500).json({ success: false, code: 'AI_CONFIRMATION_AUDIT_FAILED', error: 'La acción se registró, pero no fue posible completar su constancia de confirmación.' });
    }
  }

  static async executeTool(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const result = await executeAssistantTool({ tool: req.params.tool as AssistantToolName, args: req.body?.args, context: req.body?.context, user: req.user, correlationId: req.correlationId || crypto.randomUUID() });
      return res.json(result);
    } catch (error: any) {
      const status = error instanceof AssistantToolError ? error.status : 500;
      return res.status(status).json({ success: false, code: error.code || 'AI_TOOL_FAILED', error: status === 500 ? 'No fue posible ejecutar la herramienta solicitada.' : error.message, correlation_id: req.correlationId });
    }
  }

  static async dashboard(req: Request, res: Response) {
    try {
      if (!req.user || !['DIRECCION', 'ADMINISTRACION'].includes(req.user.rol)) {
        return res.status(403).json({ success: false, code: 'AI_CONFIGURATION_ACCESS_DENIED', error: 'La configuración técnica de IA es exclusiva de roles administrativos.' });
      }
      const from = periodStart(req.query.periodo);
      const where = {
        created_at: { gte: from },
        ...(req.query.usuario_id && req.query.usuario_id !== 'TODOS' ? { usuario_id: String(req.query.usuario_id) } : {}),
        ...(req.query.operacion && req.query.operacion !== 'TODAS' ? { operacion: String(req.query.operacion) } : {}),
      };
      const [logs, users] = await Promise.all([
        prisma.aIUsageLog.findMany({
          where,
          include: {
            usuario: { select: { id: true, nombre: true, apellido: true } },
            expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } },
          },
          orderBy: { created_at: 'desc' },
          take: 500,
        }),
        prisma.user.findMany({ where: { activo: true }, select: { id: true, nombre: true, apellido: true }, orderBy: { nombre: 'asc' } }),
      ]);

      const completed = logs.filter((item) => item.estatus === 'COMPLETADO');
      const totals = completed.reduce((acc, item) => {
        acc.requests += 1;
        acc.input += item.input_tokens;
        acc.output += item.output_tokens;
        acc.reasoning += item.reasoning_tokens;
        acc.tokens += item.total_tokens;
        acc.cost += asNumber(item.costo_estimado_usd);
        acc.documents += item.documentos_enviados;
        if (item.escalamiento_utilizado) acc.escalations += 1;
        return acc;
      }, { requests: 0, input: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, documents: 0, escalations: 0 });

      const grouped = new Map<string, { modelo: string; solicitudes: number; tokens: number; costo_usd: number }>();
      for (const item of completed) {
        const current = grouped.get(item.modelo) || { modelo: item.modelo, solicitudes: 0, tokens: 0, costo_usd: 0 };
        current.solicitudes += 1;
        current.tokens += item.total_tokens;
        current.costo_usd += asNumber(item.costo_estimado_usd);
        grouped.set(item.modelo, current);
      }

      return res.json({
        success: true,
        configuracion: {
          provider: 'OPENAI',
          modelo_principal: getOpenAIModelName(),
          modelo_escalamiento: getOpenAIEscalationModelName(),
          api_key_configurada: Boolean((process.env.OPENAI_API_KEY || '').trim()),
          razonamiento: process.env.OPENAI_REASONING_EFFORT || 'high',
          escalamiento_habilitado: String(process.env.AI_ESCALATION_ENABLED || 'true').toLowerCase() !== 'false',
        },
        periodo: { desde: from },
        metricas: {
          solicitudes: totals.requests,
          fallidas: logs.length - completed.length,
          documentos: totals.documents,
          input_tokens: totals.input,
          output_tokens: totals.output,
          reasoning_tokens: totals.reasoning,
          total_tokens: totals.tokens,
          costo_estimado_usd: Number(totals.cost.toFixed(6)),
          escalaciones: totals.escalations,
        },
        por_modelo: [...grouped.values()].map((item) => ({ ...item, costo_usd: Number(item.costo_usd.toFixed(6)) })),
        operaciones: [...new Set(logs.map((item) => item.operacion))].sort(),
        usuarios: users,
        solicitudes_recientes: logs.slice(0, 100),
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'No fue posible consultar el consumo de IA.', detail: error.message });
    }
  }
}
