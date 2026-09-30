import { createHash, randomBytes, randomUUID } from 'crypto';
import path from 'path';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { canAccessDocumento, canAttachDocumento } from './objectAccess.service';
import { deleteFile, downloadFile, getSignedUrl, uploadFile } from './supabase.service';
import { canonicalUploadedDocumentMime } from './documentUploadValidation';

type AuthUser = NonNullable<Request['user']>;

export type AssistantConversationContext = {
  route?: string;
  module?: string;
  label?: string;
  entityType?: string;
  entityId?: string;
  subview?: string;
  expedienteId?: string;
  expedienteActoId?: string;
  procesoId?: string;
  actividadId?: string;
  comparecienteId?: string;
  predioId?: string;
  documentoId?: string;
  cotizacionId?: string;
  presupuestoId?: string;
  isrCalculationId?: string;
  complianceReviewId?: string;
  selectedDate?: string;
  selectedFrom?: string;
  selectedTo?: string;
  activeDocumentId?: string;
};

export type AssistantActionState = {
  status: 'COLLECTING' | 'AWAITING_CONFIRMATION' | 'EXECUTING' | 'COMPLETED';
  actionKey: string;
  args: Record<string, unknown>;
  invocationId: string;
  missing?: string[];
  collection?: AssistantCollection;
  confirmationId?: string;
  expiresAt?: string;
  executingAt?: string;
  confirmation?: { id: string; title: string; summary?: string; level?: 'STANDARD' | 'REINFORCED'; details: Array<{ label: string; value: string }>; confirmLabel?: string };
  preview?: {
    object?: { type: string; id?: string; label?: string };
    before?: unknown;
    after?: unknown;
    impact?: string;
    guard?: { kind: string; id: string; version: string | number };
  };
  result?: { status: 'success'; message: string; refresh?: string };
};

export type AssistantCollection = {
  actionKey: string;
  title: string;
  description: string;
  fields: Array<{
    name: string;
    label: string;
    type: 'text' | 'number' | 'checkbox' | 'select' | 'multiline';
    required: boolean;
    value?: string | number | boolean;
    options?: Array<{ value: string; label: string }>;
  }>;
};

export class AssistantConversationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = 'AssistantConversationError';
  }
}

const conversationSelect = {
  id: true,
  title: true,
  status: true,
  context: true,
  summary: true,
  last_message_at: true,
  message_count: true,
  archived_at: true,
  trashed_at: true,
  restored_at: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.AssistantConversationSelect;

const attachmentSelect = {
  id: true,
  message_id: true,
  source: true,
  documento_id: true,
  original_name: true,
  mime_type: true,
  size_bytes: true,
  status: true,
  transcription: true,
  transcription_model: true,
  transcribed_at: true,
  expires_at: true,
  promoted_at: true,
  created_at: true,
} satisfies Prisma.AssistantAttachmentSelect;

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : value as Prisma.InputJsonValue;
}

function sanitizeContext(input: AssistantConversationContext | undefined) {
  if (!input) return undefined;
  const id = (value: unknown) => String(value || '').slice(0, 80) || undefined;
  const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : undefined;
  return {
    route: String(input.route || '').slice(0, 180) || undefined,
    module: String(input.module || '').slice(0, 60) || undefined,
    label: String(input.label || '').slice(0, 100) || undefined,
    entityType: String(input.entityType || '').slice(0, 60) || undefined,
    entityId: String(input.entityId || '').slice(0, 80) || undefined,
    subview: String(input.subview || '').slice(0, 80) || undefined,
    expedienteId: id(input.expedienteId),
    expedienteActoId: id(input.expedienteActoId),
    procesoId: id(input.procesoId),
    actividadId: id(input.actividadId),
    comparecienteId: id(input.comparecienteId),
    predioId: id(input.predioId),
    documentoId: id(input.documentoId),
    cotizacionId: id(input.cotizacionId),
    presupuestoId: id(input.presupuestoId),
    isrCalculationId: id(input.isrCalculationId),
    complianceReviewId: id(input.complianceReviewId),
    selectedDate: date(input.selectedDate),
    selectedFrom: date(input.selectedFrom),
    selectedTo: date(input.selectedTo),
    activeDocumentId: id(input.activeDocumentId),
  };
}

function publicConversation<T extends { context?: unknown }>(record: T) {
  const stored = record.context && typeof record.context === 'object' && !Array.isArray(record.context)
    ? record.context as Record<string, unknown>
    : {};
  const state = stored.actionState && typeof stored.actionState === 'object' && !Array.isArray(stored.actionState)
    ? stored.actionState as AssistantActionState
    : undefined;
  const { actionState: _privateActionState, ...context } = stored;
  const pending_confirmation = state?.status === 'AWAITING_CONFIRMATION' && state.confirmation
    && state.expiresAt && new Date(state.expiresAt) > new Date()
    ? state.confirmation
    : undefined;
  const pending_collection = state?.status === 'COLLECTING' ? state.collection : undefined;
  return { ...record, context, pending_confirmation, pending_collection };
}

function titleFromMessage(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 64 ? `${normalized.slice(0, 61).trimEnd()}…` : normalized || 'Nueva conversación';
}

function statusValue(value: unknown): 'ACTIVE' | 'ARCHIVED' | 'TRASHED' {
  const normalized = String(value || 'ACTIVE').toUpperCase();
  return normalized === 'ARCHIVED' || normalized === 'TRASHED' ? normalized : 'ACTIVE';
}

async function ownedConversation(user: AuthUser, id: string) {
  const record = await prisma.assistantConversation.findFirst({ where: { id, organization_id: user.organizationId, owner_user_id: user.id }, select: conversationSelect });
  if (!record) throw new AssistantConversationError('La conversación no existe o no está disponible.', 'ASSISTANT_CONVERSATION_NOT_FOUND', 404);
  return record;
}

async function writableConversation(user: AuthUser, id: string) {
  const record = await ownedConversation(user, id);
  if (record.status !== 'ACTIVE') throw new AssistantConversationError('Restaura la conversación antes de continuar escribiendo.', 'ASSISTANT_CONVERSATION_NOT_ACTIVE', 409);
  return record;
}

function extensionFor(name: string, mimeType: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
  if (ext && ext.length <= 8) return ext;
  const fallback: Record<string, string> = {
    'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/xml': '.xml', 'text/xml': '.xml', 'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
    'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg',
  };
  return fallback[mimeType] || '.bin';
}

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/xml', 'text/xml', 'application/zip', 'application/x-zip-compressed',
  'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg',
]);

export const assistantConversationService = {
  async create(user: AuthUser, input?: { title?: string; context?: AssistantConversationContext }) {
    const title = String(input?.title || '').trim().replace(/\s+/g, ' ').slice(0, 100) || 'Nueva conversación';
    const record = await prisma.assistantConversation.create({
      data: { organization_id: user.organizationId, owner_user_id: user.id, title, context: json(sanitizeContext(input?.context)) },
      select: conversationSelect,
    });
    return record;
  },

  async list(user: AuthUser, rawStatus?: unknown) {
    const status = statusValue(rawStatus);
    const records = await prisma.assistantConversation.findMany({
      where: { organization_id: user.organizationId, owner_user_id: user.id, status },
      select: conversationSelect,
      orderBy: [{ last_message_at: 'desc' }, { created_at: 'desc' }],
      take: 60,
    });
    return records.map((record) => publicConversation(record));
  },

  async get(user: AuthUser, id: string) {
    await ownedConversation(user, id);
    const now = new Date();
    const record = await prisma.assistantConversation.findFirstOrThrow({
      where: { id, organization_id: user.organizationId, owner_user_id: user.id },
      select: {
        ...conversationSelect,
        messages: {
          where: { status: 'COMPLETE' },
          orderBy: { created_at: 'asc' },
          take: 200,
          select: {
            id: true, role: true, content: true, sources: true, status: true, created_at: true,
            attachments: { where: { status: { not: 'ARCHIVED' }, OR: [{ source: 'OFFICIAL_DOCUMENT' }, { expires_at: null }, { expires_at: { gt: now } }] }, select: attachmentSelect },
          },
        },
        attachments: { where: { message_id: null, status: { not: 'ARCHIVED' }, OR: [{ source: 'OFFICIAL_DOCUMENT' }, { expires_at: null }, { expires_at: { gt: now } }] }, orderBy: { created_at: 'asc' }, select: attachmentSelect },
      },
    });
    return publicConversation(record);
  },

  async rename(user: AuthUser, id: string, title: unknown) {
    await ownedConversation(user, id);
    const normalized = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!normalized) throw new AssistantConversationError('Escribe un nombre para la conversación.', 'ASSISTANT_TITLE_REQUIRED');
    return publicConversation(await prisma.assistantConversation.update({ where: { id }, data: { title: normalized }, select: conversationSelect }));
  },

  async transition(user: AuthUser, id: string, action: 'archive' | 'trash' | 'restore') {
    const current = await ownedConversation(user, id);
    const now = new Date();
    const data = action === 'archive'
      ? { status: 'ARCHIVED', archived_at: now, trashed_at: null }
      : action === 'trash'
        ? { status: 'TRASHED', trashed_at: now }
        : { status: 'ACTIVE', archived_at: null, trashed_at: null, restored_at: now };
    if (action === 'archive' && current.status === 'TRASHED') throw new AssistantConversationError('Restaura la conversación antes de archivarla.', 'ASSISTANT_RESTORE_REQUIRED', 409);
    return publicConversation(await prisma.assistantConversation.update({ where: { id }, data, select: conversationSelect }));
  },

  async ensureActive(user: AuthUser, conversationId: string | undefined, input: { message: string; context?: AssistantConversationContext }) {
    if (conversationId) return writableConversation(user, conversationId);
    return this.create(user, { title: titleFromMessage(input.message), context: input.context });
  },

  async addUserMessage(user: AuthUser, conversationId: string, input: {
    content: string;
    clientMessageId?: string;
    context?: AssistantConversationContext;
  }) {
    await writableConversation(user, conversationId);
    const clientMessageId = String(input.clientMessageId || '').trim().slice(0, 120) || null;
    if (clientMessageId) {
      const existing = await prisma.assistantMessage.findFirst({ where: { conversation_id: conversationId, client_message_id: clientMessageId } });
      if (existing) return { message: existing, duplicate: true };
    }
    let message;
    try {
      message = await prisma.$transaction(async (tx) => {
        const created = await tx.assistantMessage.create({ data: {
          organization_id: user.organizationId, conversation_id: conversationId,
          role: 'USER',
          content: input.content,
          client_message_id: clientMessageId,
          context_snapshot: json(sanitizeContext(input.context)),
        } });
        const conversation = await tx.assistantConversation.findUniqueOrThrow({ where: { id: conversationId }, select: { message_count: true, title: true, context: true } });
        const currentContext = conversation.context && typeof conversation.context === 'object' && !Array.isArray(conversation.context)
          ? conversation.context as Record<string, unknown>
          : {};
        await tx.assistantConversation.update({ where: { id: conversationId }, data: {
          message_count: { increment: 1 }, last_message_at: created.created_at,
          ...(conversation.message_count === 0 && conversation.title === 'Nueva conversación' ? { title: titleFromMessage(input.content) } : {}),
          context: json({ ...currentContext, ...sanitizeContext(input.context) }),
        } });
        return created;
      });
    } catch (error) {
      if (clientMessageId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.assistantMessage.findFirst({ where: { conversation_id: conversationId, client_message_id: clientMessageId } });
        if (existing) return { message: existing, duplicate: true };
      }
      throw error;
    }
    return { message, duplicate: false };
  },

  async addAssistantMessage(user: AuthUser, conversationId: string, input: {
    content: string;
    sources?: unknown;
    status?: 'COMPLETE' | 'FAILED';
    providerResponseId?: string;
    model?: string;
    promptVersion?: string;
    inReplyToMessageId?: string;
  }) {
    await ownedConversation(user, conversationId);
    return prisma.$transaction(async (tx) => {
      const created = await tx.assistantMessage.create({ data: {
        organization_id: user.organizationId, conversation_id: conversationId,
        role: 'ASSISTANT',
        content: input.content,
        in_reply_to_message_id: input.inReplyToMessageId || null,
        sources: json(input.sources),
        status: input.status || 'COMPLETE',
        provider_response_id: String(input.providerResponseId || '').slice(0, 160) || null,
        model: String(input.model || '').slice(0, 100) || null,
        prompt_version: String(input.promptVersion || '').slice(0, 80) || null,
      } });
      await tx.assistantConversation.update({ where: { id: conversationId }, data: { message_count: { increment: 1 }, last_message_at: created.created_at } });
      return created;
    });
  },

  async history(user: AuthUser, conversationId: string, excludeMessageId?: string) {
    const conversation = await ownedConversation(user, conversationId);
    const records = await prisma.assistantMessage.findMany({
      where: { conversation_id: conversationId, status: 'COMPLETE', ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}) },
      select: { role: true, content: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 16,
    });
    return {
      summary: conversation.summary || undefined,
      messages: records.reverse().map((item) => ({ role: item.role === 'ASSISTANT' ? 'assistant' as const : 'user' as const, content: item.content })),
    };
  },

  async actionState(user: AuthUser, conversationId: string): Promise<AssistantActionState | undefined> {
    const conversation = await ownedConversation(user, conversationId);
    const context = conversation.context && typeof conversation.context === 'object' && !Array.isArray(conversation.context)
      ? conversation.context as Record<string, unknown>
      : {};
    const state = context.actionState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
    return state as AssistantActionState;
  },

  async setActionState(user: AuthUser, conversationId: string, state?: AssistantActionState) {
    const conversation = await writableConversation(user, conversationId);
    const context = conversation.context && typeof conversation.context === 'object' && !Array.isArray(conversation.context)
      ? conversation.context as Record<string, unknown>
      : {};
    const next = { ...context };
    if (state) next.actionState = state;
    else delete next.actionState;
    await prisma.assistantConversation.update({
      where: { id: conversationId },
      data: { context: json(next) },
    });
  },

  async claimActionState(user: AuthUser, conversationId: string, confirmationId: string) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM assistant_conversations
        WHERE id = ${conversationId}::uuid
          AND organization_id = ${user.organizationId}::uuid
          AND owner_user_id = ${user.id}::uuid
        FOR UPDATE
      `);
      if (!locked.length) throw new AssistantConversationError('La conversación no existe o no está disponible.', 'ASSISTANT_CONVERSATION_NOT_FOUND', 404);
      const conversation = await tx.assistantConversation.findFirstOrThrow({
        where: { id: conversationId, organization_id: user.organizationId, owner_user_id: user.id },
        select: { status: true, context: true },
      });
      if (conversation.status !== 'ACTIVE') throw new AssistantConversationError('Restaura la conversación antes de continuar escribiendo.', 'ASSISTANT_CONVERSATION_NOT_ACTIVE', 409);
      const context = conversation.context && typeof conversation.context === 'object' && !Array.isArray(conversation.context)
        ? conversation.context as Record<string, unknown>
        : {};
      const state = context.actionState && typeof context.actionState === 'object' && !Array.isArray(context.actionState)
        ? context.actionState as AssistantActionState
        : undefined;
      if (state?.confirmationId !== confirmationId) return { status: 'NOT_FOUND' as const, state };
      if (state.status === 'COMPLETED') return { status: 'COMPLETED' as const, state };
      if (state.status === 'EXECUTING') return { status: 'IN_PROGRESS' as const, state };
      if (state.status !== 'AWAITING_CONFIRMATION') return { status: 'NOT_FOUND' as const, state };
      const claimed: AssistantActionState = { ...state, status: 'EXECUTING', executingAt: new Date().toISOString() };
      await tx.assistantConversation.update({
        where: { id: conversationId },
        data: { context: json({ ...context, actionState: claimed }) },
      });
      return { status: 'CLAIMED' as const, state: claimed };
    });
  },

  async refreshExtractiveSummary(user: AuthUser, conversationId: string) {
    await ownedConversation(user, conversationId);
    const total = await prisma.assistantMessage.count({ where: { conversation_id: conversationId, status: 'COMPLETE' } });
    if (total <= 16) return;
    const older = await prisma.assistantMessage.findMany({
      where: { conversation_id: conversationId, status: 'COMPLETE' },
      select: { role: true, content: true }, orderBy: { created_at: 'asc' }, take: Math.max(0, total - 12),
    });
    const summary = older
      .map((item) => `${item.role === 'USER' ? 'Usuario' : 'PRAVIA IA'}: ${item.content.replace(/\s+/g, ' ').slice(0, 500)}`)
      .join('\n')
      .slice(-6_000);
    await prisma.assistantConversation.update({ where: { id: conversationId }, data: { summary, summary_updated_at: new Date() } });
  },

  async uploadAttachment(user: AuthUser, conversationId: string, file: Express.Multer.File) {
    await writableConversation(user, conversationId);
    if (!file.mimetype.startsWith('audio/')) {
      try {
        file.mimetype = canonicalUploadedDocumentMime(file);
      } catch (error: any) {
        throw new AssistantConversationError(error?.message || 'El archivo no es válido.', 'ASSISTANT_ATTACHMENT_CONTENT_INVALID', 415);
      }
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new AssistantConversationError('Tipo de archivo no permitido. Usa PDF, imagen, DOC/DOCX, XML, ZIP o audio compatible.', 'ASSISTANT_ATTACHMENT_TYPE_UNSUPPORTED', 415);
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await prisma.assistantAttachment.findFirst({
      where: { conversation_id: conversationId, sha256, source: 'TEMPORARY_UPLOAD', status: { not: 'ARCHIVED' }, expires_at: { gt: new Date() } },
      select: attachmentSelect,
    });
    if (duplicate) return { ...duplicate, duplicate: true };
    const key = `organizations/${user.organizationId}/temporales/assistant/${user.id}/${conversationId}/${Date.now()}_${randomBytes(4).toString('hex')}${extensionFor(file.originalname, file.mimetype)}`;
    await uploadFile(file.buffer, key, file.mimetype);
    try {
      const created = await prisma.assistantAttachment.create({ data: {
        organization_id: user.organizationId, conversation_id: conversationId,
        uploaded_by_id: user.id,
        source: 'TEMPORARY_UPLOAD',
        original_name: path.basename(file.originalname).slice(0, 180) || `adjunto-${randomUUID()}`,
        storage_key: key,
        mime_type: file.mimetype,
        size_bytes: file.size,
        sha256,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }, select: attachmentSelect });
      return { ...created, duplicate: false };
    } catch (error) {
      await deleteFile(key).catch(() => undefined);
      throw error;
    }
  },

  async linkOfficialDocument(user: AuthUser, conversationId: string, documentId: string) {
    await writableConversation(user, conversationId);
    if (!user.permissions.includes('documentos.read') || !(await canAccessDocumento(user, documentId))) {
      throw new AssistantConversationError('No tienes acceso a este documento.', 'ASSISTANT_DOCUMENT_ACCESS_DENIED', 403);
    }
    const document = await prisma.documento.findFirst({ where: { id: documentId, organization_id: user.organizationId }, select: {
      id: true, nombre_original: true, mime_type: true, size_bytes: true, storage_key: true,
    } });
    if (!document) throw new AssistantConversationError('Documento no encontrado.', 'ASSISTANT_DOCUMENT_NOT_FOUND', 404);
    const sha256 = createHash('sha256').update(`documento:${document.id}:${document.storage_key}`).digest('hex');
    const record = await prisma.assistantAttachment.upsert({
      where: { conversation_id_sha256_source: { conversation_id: conversationId, sha256, source: 'OFFICIAL_DOCUMENT' } },
      create: {
        organization_id: user.organizationId, conversation_id: conversationId, uploaded_by_id: user.id, source: 'OFFICIAL_DOCUMENT', documento_id: document.id,
        original_name: document.nombre_original, mime_type: document.mime_type, size_bytes: document.size_bytes, sha256,
      },
      update: { status: 'AVAILABLE', archived_at: null },
      select: attachmentSelect,
    });
    return record;
  },

  async attachmentForOwner(user: AuthUser, conversationId: string, attachmentId: string) {
    await ownedConversation(user, conversationId);
    const attachment = await prisma.assistantAttachment.findFirst({
      where: { id: attachmentId, conversation_id: conversationId, archived_at: null },
      include: { documento: { select: { storage_key: true } } },
    });
    if (!attachment) throw new AssistantConversationError('Adjunto no encontrado.', 'ASSISTANT_ATTACHMENT_NOT_FOUND', 404);
    if (attachment.source === 'TEMPORARY_UPLOAD' && attachment.expires_at && attachment.expires_at <= new Date()) {
      await prisma.assistantAttachment.update({ where: { id: attachment.id }, data: { status: 'ARCHIVED', archived_at: new Date() } });
      throw new AssistantConversationError('El adjunto temporal expiró y ya no está disponible.', 'ASSISTANT_ATTACHMENT_EXPIRED', 410);
    }
    if (attachment.source === 'OFFICIAL_DOCUMENT' && attachment.documento_id && !(await canAccessDocumento(user, attachment.documento_id))) {
      throw new AssistantConversationError('Ya no tienes acceso a este documento.', 'ASSISTANT_DOCUMENT_ACCESS_DENIED', 403);
    }
    return attachment;
  },

  async attachmentUrl(user: AuthUser, conversationId: string, attachmentId: string) {
    const attachment = await this.attachmentForOwner(user, conversationId, attachmentId);
    const key = attachment.source === 'OFFICIAL_DOCUMENT' ? attachment.documento?.storage_key : attachment.storage_key;
    if (!key) throw new AssistantConversationError('El archivo no está disponible.', 'ASSISTANT_ATTACHMENT_FILE_UNAVAILABLE', 410);
    return { url: await getSignedUrl(key, 600), expires_in: 600 };
  },

  async attachmentBuffer(user: AuthUser, conversationId: string, attachmentId: string) {
    const attachment = await this.attachmentForOwner(user, conversationId, attachmentId);
    const key = attachment.source === 'OFFICIAL_DOCUMENT' ? attachment.documento?.storage_key : attachment.storage_key;
    if (!key) throw new AssistantConversationError('El archivo no está disponible.', 'ASSISTANT_ATTACHMENT_FILE_UNAVAILABLE', 410);
    return { attachment, buffer: await downloadFile(key) };
  },

  async promoteAttachment(user: AuthUser, conversationId: string, attachmentId: string, input: {
    targetType: 'EXPEDIENTE' | 'COTIZACION' | 'PROSPECTO' | 'COMPARECIENTE' | 'PREDIO';
    targetId: string;
    documentType: string;
  }, transaction?: Prisma.TransactionClient) {
    if (!user.permissions.includes('documentos.write')) {
      throw new AssistantConversationError('No tienes permiso para incorporar documentos.', 'ASSISTANT_DOCUMENT_WRITE_DENIED', 403);
    }
    const attachment = await this.attachmentForOwner(user, conversationId, attachmentId);
    const targets = {
      expediente_id: input.targetType === 'EXPEDIENTE' ? input.targetId : null,
      cotizacion_id: input.targetType === 'COTIZACION' ? input.targetId : null,
      prospecto_id: input.targetType === 'PROSPECTO' ? input.targetId : null,
      compareciente_id: input.targetType === 'COMPARECIENTE' ? input.targetId : null,
      predio_id: input.targetType === 'PREDIO' ? input.targetId : null,
    };
    if (!(await canAttachDocumento(user, targets))) {
      throw new AssistantConversationError('No tienes acceso al registro de destino.', 'ASSISTANT_DOCUMENT_TARGET_DENIED', 403);
    }
    if (attachment.documento_id) {
      throw new AssistantConversationError(
        'Este adjunto ya fue incorporado como documento oficial. Usa ese documento existente o vuelve a adjuntar el archivo para otro registro.',
        'ASSISTANT_ATTACHMENT_ALREADY_PROMOTED',
        409,
      );
    }
    if (!attachment.storage_key) {
      throw new AssistantConversationError('El archivo temporal ya no está disponible.', 'ASSISTANT_ATTACHMENT_FILE_UNAVAILABLE', 410);
    }
    const documentType = String(input.documentType || 'OTROS').trim().slice(0, 120) || 'OTROS';
    const partyCategories = new Set(['IDENTIFICACION','CURP','RFC','COMPROBANTE_DOMICILIO','ACTA_NACIMIENTO','ACTA_MATRIMONIO','REGIMEN_MATRIMONIAL','DOCUMENTO_MIGRATORIO','ACTA_CONSTITUTIVA','REFORMAS','PODERES','INSCRIPCION_MERCANTIL','CONSTANCIA_FISCAL','ORGANIGRAMA','ASAMBLEAS','OTROS']);
    if (input.targetType === 'COMPARECIENTE' && !partyCategories.has(documentType)) {
      throw new AssistantConversationError('La categoría documental del compareciente no es válida.', 'ASSISTANT_DOCUMENT_CATEGORY_INVALID', 400);
    }
    const promote = async (tx: Prisma.TransactionClient) => {
      const locked = await tx.assistantAttachment.findFirst({
        where: { id: attachment.id, conversation_id: conversationId, organization_id: user.organizationId, documento_id: null },
      });
      if (!locked) {
        const current = await tx.assistantAttachment.findFirst({ where: { id: attachment.id, conversation_id: conversationId, organization_id: user.organizationId } });
        if (current?.documento_id) {
          throw new AssistantConversationError(
            'Este adjunto ya fue incorporado como documento oficial.',
            'ASSISTANT_ATTACHMENT_ALREADY_PROMOTED',
            409,
          );
        }
        throw new AssistantConversationError('El adjunto ya no está disponible.', 'ASSISTANT_ATTACHMENT_NOT_FOUND', 404);
      }
      const document = await tx.documento.create({ data: {
        organization_id: user.organizationId,
        nombre_original: locked.original_name,
        nombre_interno: locked.storage_key!,
        tipo: documentType,
        categoria: 'OTROS',
        storage_key: locked.storage_key!,
        mime_type: locked.mime_type,
        size_bytes: locked.size_bytes,
        checksum_sha256: locked.sha256,
        estatus: 'PENDIENTE',
        subido_por_id: user.id,
        expediente_id: targets.expediente_id,
        cotizacion_id: targets.cotizacion_id,
        prospecto_id: targets.prospecto_id,
        compareciente_id: targets.compareciente_id,
        datos_extraidos: json({ source: 'PRAVIA_IA', conversation_id: conversationId, attachment_id: locked.id, promoted_at: new Date().toISOString(), requested_by: user.id }),
      } });
      if (input.targetType === 'EXPEDIENTE') await tx.expedienteDocumento.create({ data: {
        organization_id: user.organizationId, expediente_id: input.targetId, documento_id: document.id, tipo_vinculo: documentType,
        creado_por_id: user.id, origen: 'EXPEDIENTE', source_entity_type: 'AssistantAttachment', source_entity_id: locked.id,
        source_context: 'PRAVIA_IA', source_key: `PRAVIA_IA:AssistantAttachment:${locked.id}`, document_version: locked.sha256,
        provenance: json({ source: 'PRAVIA_IA', conversation_id: conversationId, attachment_id: locked.id }),
      } });
      if (input.targetType === 'COTIZACION') await tx.cotizacionDocumento.create({ data: {
        organization_id: user.organizationId, cotizacion_id: input.targetId, documento_id: document.id, tipo_vinculo: documentType,
        creado_por_id: user.id, idempotency_key: `assistant:${locked.id}`,
      } });
      if (input.targetType === 'PROSPECTO') await tx.prospectoDocumento.create({ data: {
        organization_id: user.organizationId, prospecto_id: input.targetId, documento_id: document.id, tipo_vinculo: documentType, creado_por_id: user.id,
      } });
      if (input.targetType === 'COMPARECIENTE') await tx.comparecienteDocumento.create({ data: {
        organization_id: user.organizationId, compareciente_id: input.targetId, documento_id: document.id,
        categoria: documentType as any, creado_por_id: user.id, vigencia: 'VIGENTE',
      } });
      if (input.targetType === 'PREDIO') await tx.predioDocumento.create({ data: {
        organization_id: user.organizationId, predio_id: input.targetId, documento_id: document.id, tipo_vinculo: documentType,
        creado_por_id: user.id, vigencia: 'VIGENTE', origen: 'PRAVIA_IA',
      } });
      await tx.assistantAttachment.update({ where: { id: locked.id }, data: {
        source: 'OFFICIAL_DOCUMENT', documento_id: document.id, storage_key: null,
        promoted_at: new Date(), expires_at: null, status: 'LINKED',
      } });
      await tx.auditLog.create({ data: {
        organization_id: user.organizationId, user_id: user.id, accion: 'AI_ATTACHMENT_PROMOTED', entidad: 'Documento', entidad_id: document.id,
        correlation_id: randomUUID(), session_id: user.sessionId,
        valores_nuevos: json({ origin: 'PRAVIA_IA', conversation_id: conversationId, attachment_id: locked.id, target_type: input.targetType, target_id: input.targetId, document_type: documentType }),
      } });
      return { documentId: document.id, attachmentId: locked.id, duplicate: false };
    };
    return transaction ? promote(transaction) : prisma.$transaction(promote);
  },

  async linkAttachmentsToMessage(user: AuthUser, conversationId: string, messageId: string, rawIds: unknown) {
    const ids = [...new Set((Array.isArray(rawIds) ? rawIds : []).map((value) => String(value)).filter(Boolean))].slice(0, 6);
    if (!ids.length) return [];
    await ownedConversation(user, conversationId);
    const available = await prisma.assistantAttachment.findMany({
      where: { id: { in: ids }, conversation_id: conversationId, message_id: null, status: 'AVAILABLE', archived_at: null,
        OR: [{ source: 'OFFICIAL_DOCUMENT' }, { expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      select: attachmentSelect,
    });
    if (available.length !== ids.length) throw new AssistantConversationError('Uno o más adjuntos no están disponibles para esta conversación.', 'ASSISTANT_ATTACHMENT_INVALID', 409);
    await prisma.assistantAttachment.updateMany({ where: { id: { in: ids }, conversation_id: conversationId }, data: { message_id: messageId, status: 'LINKED' } });
    return available;
  },

  async archiveAttachment(user: AuthUser, conversationId: string, attachmentId: string) {
    await this.attachmentForOwner(user, conversationId, attachmentId);
    return prisma.assistantAttachment.update({ where: { id: attachmentId }, data: { status: 'ARCHIVED', archived_at: new Date() }, select: attachmentSelect });
  },
};
