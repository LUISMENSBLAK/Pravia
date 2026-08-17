import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { getOpenAIEscalationModelName, getOpenAIModelName } from '../services/openaiDocument.service';
import { ASSISTANT_TOOL_REGISTRY, AssistantToolError, assistantToolCatalog, canUseAssistantTool, executeAssistantTool, type AssistantToolName } from '../services/assistantTools.service';
import { AssistantChatError, sendAssistantMessage } from '../services/assistantChat.service';
import { prepareAssistantAttachmentContext } from '../services/assistantAttachmentContext.service';
import { AssistantConversationError, assistantConversationService } from '../services/assistantConversation.service';
import { AssistantTranscriptionError, transcribeAssistantAudio } from '../services/assistantTranscription.service';
import { recordAIFailure, recordAIUsages } from '../services/aiUsage.service';
import { logAudit } from '../utils/auditLogger';

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
  static async message(req: Request, res: Response) {
    let conversationId = '';
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const message = String(req.body?.message || '').trim();
      if (message.length < 2 || message.length > 2_000) {
        return res.status(400).json({ success: false, code: 'AI_MESSAGE_INVALID', error: 'Escribe una consulta de entre 2 y 2,000 caracteres.' });
      }
      const conversation = await assistantConversationService.ensureActive(req.user, String(req.body?.conversationId || '').trim() || undefined, {
        message,
        context: req.body?.context,
      });
      conversationId = conversation.id;
      const userMessage = await assistantConversationService.addUserMessage(req.user, conversation.id, {
        content: message,
        clientMessageId: req.body?.clientMessageId,
        context: req.body?.context,
      });
      if (userMessage.duplicate) {
        const existingReply = await prisma.assistantMessage.findFirst({
          where: { conversation_id: conversation.id, role: 'ASSISTANT', status: 'COMPLETE', in_reply_to_message_id: userMessage.message.id },
        });
        if (existingReply) return res.json({
          status: 'success', message: existingReply.content, sources: existingReply.sources || undefined,
          conversationId: conversation.id, messageId: existingReply.id, duplicate: true,
        });
      }
      if (!userMessage.duplicate) {
        await assistantConversationService.linkAttachmentsToMessage(req.user, conversation.id, userMessage.message.id, req.body?.attachmentIds);
      }
      const [history, attachmentData] = await Promise.all([
        assistantConversationService.history(req.user, conversation.id, userMessage.message.id),
        prepareAssistantAttachmentContext(req.user, conversation.id, req.body?.attachmentIds),
      ]);
      const preferenceReader = (prisma as any).userPreference?.findUnique;
      const preference = typeof preferenceReader === 'function'
        ? await preferenceReader.call((prisma as any).userPreference, { where: { user_id: req.user.id }, select: { timezone: true } })
        : null;
      const reply = await sendAssistantMessage(
        {
          message: req.body?.message,
          context: req.body?.context,
          suggestionId: req.body?.suggestionId,
          history: history.messages,
          historySummary: history.summary,
          attachmentContext: attachmentData.context,
          timezone: preference?.timezone,
        },
        req.user,
        req.correlationId || crypto.randomUUID(),
      );
      const providerOperationId = `assistant-chat:${userMessage.message.id}:${req.correlationId || crypto.randomUUID()}`;
      const assistantMessage = await assistantConversationService.addAssistantMessage(req.user, conversation.id, {
        content: reply.message,
        sources: reply.sources,
        providerResponseId: reply.providerResponseId,
        model: reply.model,
        promptVersion: reply.promptVersion,
        inReplyToMessageId: userMessage.message.id,
      });
      await Promise.all([
        recordAIUsages([...(attachmentData.usages || []), ...(reply.usage || [])], {
          operacion: 'ASSISTANT_CHAT', usuarioId: req.user.id, assistantConversationId: conversation.id,
          organizationId: req.user.organizationId, operationId: providerOperationId,
          expedienteId: req.body?.context?.entityType === 'expediente' ? req.body?.context?.entityId : undefined,
          metadata: { module: req.body?.context?.module || null, attachment_count: Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds.length : 0 },
        }).catch(() => undefined),
        assistantConversationService.refreshExtractiveSummary(req.user, conversation.id),
        logAudit(req.user.id, 'AI_CONVERSATION_MESSAGE', 'AssistantConversation', conversation.id, {
          message_id: assistantMessage.id,
          attachment_count: Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds.length : 0,
          correlation_id: req.correlationId,
        }),
      ]);
      const { usage: _usage, providerResponseId: _providerResponseId, model: _model, promptVersion: _promptVersion, ...publicReply } = reply;
      return res.json({ ...publicReply, conversationId: conversation.id, messageId: assistantMessage.id });
    } catch (error: any) {
      const known = error instanceof AssistantChatError || error instanceof AssistantConversationError;
      const status = known ? error.status : 500;
      if (req.user && conversationId) await recordAIFailure({
        operacion: 'ASSISTANT_CHAT', usuarioId: req.user.id, assistantConversationId: conversationId,
        organizationId: req.user.organizationId, operationId: `assistant-chat-failure:${req.correlationId || conversationId}`,
        modelo: process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_DOCUMENT_MODEL || 'not-configured',
        errorCode: error?.code || 'AI_ASSISTANT_FAILED',
        metadata: { correlation_id: req.correlationId },
      }).catch(() => undefined);
      return res.status(status).json({
        success: false,
        code: known ? error.code : 'AI_ASSISTANT_FAILED',
        error: status >= 500 ? 'PRAVIA IA no pudo completar la consulta. Intenta de nuevo.' : error.message,
        ...(conversationId ? { conversationId } : {}),
      });
    }
  }

  static async createConversation(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const record = await assistantConversationService.create(req.user, { title: req.body?.title, context: req.body?.context });
      await logAudit(req.user.id, 'AI_CONVERSATION_CREATED', 'AssistantConversation', record.id, { correlation_id: req.correlationId });
      return res.status(201).json({ success: true, data: record });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async listConversations(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      return res.json({ success: true, data: await assistantConversationService.list(req.user, req.query.status) });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async getConversation(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      return res.json({ success: true, data: await assistantConversationService.get(req.user, req.params.conversationId) });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async renameConversation(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const record = await assistantConversationService.rename(req.user, req.params.conversationId, req.body?.title);
      await logAudit(req.user.id, 'AI_CONVERSATION_RENAMED', 'AssistantConversation', record.id, { correlation_id: req.correlationId });
      return res.json({ success: true, data: record });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async archiveConversation(req: Request, res: Response) { return AIController.transitionConversation(req, res, 'archive'); }
  static async trashConversation(req: Request, res: Response) { return AIController.transitionConversation(req, res, 'trash'); }
  static async restoreConversation(req: Request, res: Response) { return AIController.transitionConversation(req, res, 'restore'); }

  private static async transitionConversation(req: Request, res: Response, action: 'archive' | 'trash' | 'restore') {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const record = await assistantConversationService.transition(req.user, req.params.conversationId, action);
      await logAudit(req.user.id, `AI_CONVERSATION_${action.toUpperCase()}`, 'AssistantConversation', record.id, { correlation_id: req.correlationId });
      return res.json({ success: true, data: record });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async uploadConversationAttachment(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      if (!req.file) return res.status(400).json({ success: false, code: 'ASSISTANT_ATTACHMENT_REQUIRED', error: 'Selecciona un archivo.' });
      const record = await assistantConversationService.uploadAttachment(req.user, req.params.conversationId, req.file);
      await logAudit(req.user.id, 'AI_ATTACHMENT_UPLOADED', 'AssistantConversation', req.params.conversationId, {
        attachment_id: record.id, mime_type: record.mime_type, size_bytes: record.size_bytes, duplicate: record.duplicate,
      });
      return res.status(record.duplicate ? 200 : 201).json({ success: true, data: record });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async linkConversationDocument(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const record = await assistantConversationService.linkOfficialDocument(req.user, req.params.conversationId, String(req.body?.documentoId || ''));
      await logAudit(req.user.id, 'AI_DOCUMENT_LINKED', 'AssistantConversation', req.params.conversationId, { attachment_id: record.id, documento_id: record.documento_id });
      return res.status(201).json({ success: true, data: record });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async conversationAttachmentUrl(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      return res.json({ success: true, data: await assistantConversationService.attachmentUrl(req.user, req.params.conversationId, req.params.attachmentId) });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async archiveConversationAttachment(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const record = await assistantConversationService.archiveAttachment(req.user, req.params.conversationId, req.params.attachmentId);
      await logAudit(req.user.id, 'AI_ATTACHMENT_ARCHIVED', 'AssistantConversation', req.params.conversationId, { attachment_id: record.id });
      return res.json({ success: true, data: record });
    } catch (error: any) { return AIController.conversationError(res, error); }
  }

  static async transcribeConversationAudio(req: Request, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión para continuar.' });
      const { attachment, buffer } = await assistantConversationService.attachmentBuffer(req.user, req.params.conversationId, req.params.attachmentId);
      if (!attachment.mime_type.startsWith('audio/')) return res.status(415).json({ success: false, code: 'ASSISTANT_AUDIO_REQUIRED', error: 'El adjunto seleccionado no es audio.' });
      const result = await transcribeAssistantAudio({ buffer, mimeType: attachment.mime_type, filename: attachment.original_name });
      await prisma.assistantAttachment.update({ where: { id: attachment.id }, data: {
        transcription: result.text, transcription_model: result.model, transcribed_at: new Date(),
      } });
      await Promise.all([
        recordAIUsages([result.usage], { operacion: 'ASSISTANT_TRANSCRIPTION', usuarioId: req.user.id, assistantConversationId: req.params.conversationId,
          organizationId: req.user.organizationId, operationId: `assistant-transcription:${attachment.id}:${result.model}:${req.correlationId || crypto.randomUUID()}` }),
        logAudit(req.user.id, 'AI_AUDIO_TRANSCRIBED', 'AssistantConversation', req.params.conversationId, { attachment_id: attachment.id, model: result.model }),
      ]);
      return res.json({ success: true, data: { attachmentId: attachment.id, transcript: result.text } });
    } catch (error: any) {
      if (req.user && error instanceof AssistantTranscriptionError) await recordAIFailure({
        operacion: 'ASSISTANT_TRANSCRIPTION', usuarioId: req.user.id, assistantConversationId: req.params.conversationId,
        organizationId: req.user.organizationId, operationId: `assistant-transcription-failure:${req.params.attachmentId}:${req.correlationId || 'request'}`,
        modelo: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe', errorCode: error?.code || 'AI_TRANSCRIPTION_FAILED',
        metadata: { correlation_id: req.correlationId },
      }).catch(() => undefined);
      if (error instanceof AssistantTranscriptionError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
      return AIController.conversationError(res, error);
    }
  }

  private static conversationError(res: Response, error: any) {
    const status = error instanceof AssistantConversationError ? error.status : 500;
    return res.status(status).json({
      success: false,
      code: error instanceof AssistantConversationError ? error.code : 'ASSISTANT_CONVERSATION_FAILED',
      error: status >= 500 ? 'No fue posible completar la operación de la conversación.' : error.message,
    });
  }

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
