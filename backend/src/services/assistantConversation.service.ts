import { createHash, randomBytes, randomUUID } from 'crypto';
import path from 'path';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { canAccessDocumento } from './objectAccess.service';
import { deleteFile, downloadFile, getSignedUrl, uploadFile } from './supabase.service';

type AuthUser = NonNullable<Request['user']>;

export type AssistantConversationContext = {
  route?: string;
  module?: string;
  label?: string;
  entityType?: string;
  entityId?: string;
  subview?: string;
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
  return {
    route: String(input.route || '').slice(0, 180) || undefined,
    module: String(input.module || '').slice(0, 60) || undefined,
    label: String(input.label || '').slice(0, 100) || undefined,
    entityType: String(input.entityType || '').slice(0, 60) || undefined,
    entityId: String(input.entityId || '').slice(0, 80) || undefined,
    subview: String(input.subview || '').slice(0, 80) || undefined,
  };
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
    'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
    'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg',
  };
  return fallback[mimeType] || '.bin';
}

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
    return prisma.assistantConversation.findMany({
      where: { organization_id: user.organizationId, owner_user_id: user.id, status },
      select: conversationSelect,
      orderBy: [{ last_message_at: 'desc' }, { created_at: 'desc' }],
      take: 60,
    });
  },

  async get(user: AuthUser, id: string) {
    await ownedConversation(user, id);
    const now = new Date();
    return prisma.assistantConversation.findFirstOrThrow({
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
  },

  async rename(user: AuthUser, id: string, title: unknown) {
    await ownedConversation(user, id);
    const normalized = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!normalized) throw new AssistantConversationError('Escribe un nombre para la conversación.', 'ASSISTANT_TITLE_REQUIRED');
    return prisma.assistantConversation.update({ where: { id }, data: { title: normalized }, select: conversationSelect });
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
    return prisma.assistantConversation.update({ where: { id }, data, select: conversationSelect });
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
        const conversation = await tx.assistantConversation.findUniqueOrThrow({ where: { id: conversationId }, select: { message_count: true, title: true } });
        await tx.assistantConversation.update({ where: { id: conversationId }, data: {
          message_count: { increment: 1 }, last_message_at: created.created_at,
          ...(conversation.message_count === 0 && conversation.title === 'Nueva conversación' ? { title: titleFromMessage(input.content) } : {}),
          context: json(sanitizeContext(input.context)),
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
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new AssistantConversationError('Tipo de archivo no permitido. Usa PDF, imagen, DOC/DOCX o audio compatible.', 'ASSISTANT_ATTACHMENT_TYPE_UNSUPPORTED', 415);
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
