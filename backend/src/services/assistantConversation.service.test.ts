import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    assistantConversation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    assistantAttachment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    documento: { findUnique: vi.fn() },
  } as any,
  canAccessDocumento: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('../config/prisma', () => ({ default: mocks.db }));
vi.mock('./objectAccess.service', () => ({ canAccessDocumento: mocks.canAccessDocumento }));
vi.mock('./supabase.service', () => ({
  uploadFile: mocks.uploadFile,
  deleteFile: mocks.deleteFile,
  downloadFile: mocks.downloadFile,
  getSignedUrl: mocks.getSignedUrl,
}));

import { assistantConversationService } from './assistantConversation.service';

const user = {
  id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.test', nombre: 'Ana', apellido: 'Prueba',
  rol: 'ABOGADO', sessionId: 'session-1', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'membership-a', scope: 'ASSIGNED_OBJECTS', permissions: ['ai.use', 'documentos.read'], requiresPasswordChange: false,
} as any;
const conversation = {
  id: 'conversation-1', owner_user_id: user.id, title: 'Consulta privada', status: 'ACTIVE', context: null, summary: null,
  last_message_at: new Date(), message_count: 1, archived_at: null, trashed_at: null, restored_at: null,
  created_at: new Date(), updated_at: new Date(),
};

describe('conversaciones persistentes de PRAVIA IA', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('aplica ownership estricto y no permite IDOR ni siquiera a otro usuario autenticado', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(null);
    await expect(assistantConversationService.get(user, 'conversation-foreign'))
      .rejects.toMatchObject({ code: 'ASSISTANT_CONVERSATION_NOT_FOUND', status: 404 });
    expect(mocks.db.assistantConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conversation-foreign', organization_id: user.organizationId, owner_user_id: user.id },
    }));
  });

  it('lista únicamente el historial privado del propietario y el estado solicitado', async () => {
    mocks.db.assistantConversation.findMany.mockResolvedValue([]);
    await assistantConversationService.list(user, 'TRASHED');
    expect(mocks.db.assistantConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organization_id: user.organizationId, owner_user_id: user.id, status: 'TRASHED' }, take: 60,
    }));
  });

  it('envía a papelera de forma lógica y conserva el registro para restauración', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.db.assistantConversation.update.mockResolvedValue({ ...conversation, status: 'TRASHED' });
    await assistantConversationService.transition(user, conversation.id, 'trash');
    expect(mocks.db.assistantConversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: conversation.id }, data: expect.objectContaining({ status: 'TRASHED', trashed_at: expect.any(Date) }),
    }));
    expect(mocks.db.assistantConversation.delete).toBeUndefined();
  });

  it('deduplica un adjunto temporal por hash antes de escribir nuevamente en Storage', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.db.assistantAttachment.findFirst.mockResolvedValue({
      id: 'attachment-existing', original_name: 'identificacion.pdf', source: 'TEMPORARY_UPLOAD', status: 'AVAILABLE',
    });
    const result = await assistantConversationService.uploadAttachment(user, conversation.id, {
      buffer: Buffer.from('contenido idéntico'), mimetype: 'application/pdf', originalname: 'identificacion.pdf', size: 18,
    } as Express.Multer.File);
    expect(result).toMatchObject({ id: 'attachment-existing', duplicate: true });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it('reutiliza el control documental existente antes de enlazar un documento oficial', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.canAccessDocumento.mockResolvedValue(false);
    await expect(assistantConversationService.linkOfficialDocument(user, conversation.id, 'documento-ajeno'))
      .rejects.toMatchObject({ code: 'ASSISTANT_DOCUMENT_ACCESS_DENIED', status: 403 });
    expect(mocks.db.documento.findUnique).not.toHaveBeenCalled();
  });

  it('rechaza adjuntos que pertenecen a otra conversación', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.db.assistantAttachment.findMany.mockResolvedValue([]);
    await expect(assistantConversationService.linkAttachmentsToMessage(user, conversation.id, 'message-1', ['foreign-attachment']))
      .rejects.toMatchObject({ code: 'ASSISTANT_ATTACHMENT_INVALID', status: 409 });
    expect(mocks.db.assistantAttachment.updateMany).not.toHaveBeenCalled();
  });

  it('no emite URL firmada cuando la conversación no pertenece al tenant y propietario activos', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(null);
    await expect(assistantConversationService.attachmentUrl(user, 'conversation-org-b', 'attachment-org-b'))
      .rejects.toMatchObject({ code: 'ASSISTANT_CONVERSATION_NOT_FOUND', status: 404 });
    expect(mocks.db.assistantAttachment.findFirst).not.toHaveBeenCalled();
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('hace cumplir la expiración temporal mediante retiro lógico, sin borrar el archivo físico', async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.db.assistantAttachment.findFirst.mockResolvedValue({
      id: 'attachment-expired', conversation_id: conversation.id, source: 'TEMPORARY_UPLOAD', expires_at: new Date('2026-01-01'),
    });
    mocks.db.assistantAttachment.update.mockResolvedValue({});
    await expect(assistantConversationService.attachmentForOwner(user, conversation.id, 'attachment-expired'))
      .rejects.toMatchObject({ code: 'ASSISTANT_ATTACHMENT_EXPIRED', status: 410 });
    expect(mocks.db.assistantAttachment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attachment-expired' }, data: expect.objectContaining({ status: 'ARCHIVED', archived_at: expect.any(Date) }),
    }));
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
