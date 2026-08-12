import prisma from '../config/prisma';
import { Prisma } from '@prisma/client';
import { AIUsageMetrics } from './openaiDocument.service';

export interface AIUsageContext {
  operacion: string;
  usuarioId?: string | null;
  expedienteId?: string | null;
  altaSessionId?: string | null;
  escalamientoMotivo?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAIUsage(metrics: AIUsageMetrics, context: AIUsageContext) {
  return prisma.aIUsageLog.create({
    data: {
      provider: 'OPENAI',
      modelo: metrics.modelo,
      operacion: context.operacion,
      estatus: 'COMPLETADO',
      usuario_id: context.usuarioId || null,
      expediente_id: context.expedienteId || null,
      compareciente_alta_session_id: context.altaSessionId || null,
      input_tokens: metrics.input_tokens,
      cached_input_tokens: metrics.cached_input_tokens,
      output_tokens: metrics.output_tokens,
      reasoning_tokens: metrics.reasoning_tokens,
      total_tokens: metrics.total_tokens,
      duracion_ms: metrics.duracion_ms,
      costo_estimado_usd: metrics.costo_estimado_usd,
      documentos_enviados: metrics.documentos_enviados,
      escalamiento_utilizado: metrics.escalamiento_utilizado,
      escalamiento_motivo: metrics.escalamiento_utilizado ? context.escalamientoMotivo || 'Complejidad o baja confianza documental' : null,
      metadata: context.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function recordAIUsages(metrics: AIUsageMetrics[] | undefined, context: AIUsageContext) {
  for (const item of metrics || []) await recordAIUsage(item, context);
}

export async function recordAIFailure(context: AIUsageContext & { modelo: string; errorCode?: string; durationMs?: number }) {
  return prisma.aIUsageLog.create({
    data: {
      provider: 'OPENAI',
      modelo: context.modelo,
      operacion: context.operacion,
      estatus: 'FALLIDO',
      usuario_id: context.usuarioId || null,
      expediente_id: context.expedienteId || null,
      compareciente_alta_session_id: context.altaSessionId || null,
      duracion_ms: context.durationMs || 0,
      error_codigo: context.errorCode || 'AI_REQUEST_FAILED',
      metadata: context.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
