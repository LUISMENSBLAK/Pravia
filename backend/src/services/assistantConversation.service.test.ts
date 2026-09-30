import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    assistantConversation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    assistantAttachment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    documento: { findUnique: vi.fn(), create: vi.fn() },
    expedienteDocumento: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  } as any,
  canAccessDocumento: vi.fn(),
  canAttachDocumento: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('../config/prisma', () => ({ default: mocks.db }));
vi.mock('./objectAccess.service', () => ({
  canAccessDocumento: mocks.canAccessDocumento,
  canAttachDocumento: mocks.canAttachDocumento,
}));
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
  });

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

  it('no expone argumentos ni claves internas del estado de acción al listar historial', async () => {
    mocks.db.assistantConversation.findMany.mockResolvedValue([{ ...conversation, context: {
      route: '/agenda', actionState: { status: 'AWAITING_CONFIRMATION', actionKey: 'agenda.event.cancel', args: { motivo_cancelacion: 'dato privado' }, invocationId: 'secret-invocation', confirmationId: 'confirmation-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), confirmation: { id: 'confirmation-1', title: 'Cancelar evento', details: [] } },
    } }]);
    const result = await assistantConversationService.list(user, 'ACTIVE');
    expect(result[0].context).toEqual({ route: '/agenda' });
    expect(result[0]).toMatchObject({ pending_confirmation: { id: 'confirmation-1', title: 'Cancelar evento' } });
    expect(JSON.stringify(result[0])).not.toContain('secret-invocation');
    expect(JSON.stringify(result[0])).not.toContain('dato privado');
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
      buffer: Buffer.from('%PDF-1.7\ncontenido idéntico'), mimetype: 'application/pdf', originalname: 'identificacion.pdf', size: 27,
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

  it('no presenta como éxito una segunda incorporación del mismo adjunto oficial', async () => {
    const writer = { ...user, permissions: [...user.permissions, 'documentos.write'] };
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.db.assistantAttachment.findFirst.mockResolvedValue({
      id: 'attachment-promoted', conversation_id: conversation.id, source: 'OFFICIAL_DOCUMENT',
      documento_id: 'documento-1', storage_key: 'organizations/org/documento.pdf', expires_at: null,
    });
    mocks.canAccessDocumento.mockResolvedValue(true);
    mocks.canAttachDocumento.mockResolvedValue(true);

    await expect(assistantConversationService.promoteAttachment(writer, conversation.id, 'attachment-promoted', {
      targetType: 'EXPEDIENTE', targetId: 'expediente-2', documentType: 'OTROS',
    })).rejects.toMatchObject({ code: 'ASSISTANT_ATTACHMENT_ALREADY_PROMOTED', status: 409 });
  });

  it('transfiere la propiedad del storage al documento oficial sin violar la invariancia de origen', async () => {
    const writer = { ...user, permissions: [...user.permissions, 'documentos.write'] };
    const temporary = {
      id: 'attachment-temporary', conversation_id: conversation.id, organization_id: user.organizationId,
      source: 'TEMPORARY_UPLOAD', documento_id: null, storage_key: 'organizations/org/assistant/file.pdf',
      original_name: 'file.pdf', mime_type: 'application/pdf', size_bytes: 128, sha256: 'abc123',
    };
    mocks.db.assistantConversation.findFirst.mockResolvedValue(conversation);
    mocks.db.assistantAttachment.findFirst.mockResolvedValue(temporary);
    mocks.canAttachDocumento.mockResolvedValue(true);
    mocks.db.documento.create.mockResolvedValue({ id: 'documento-promoted' });
    mocks.db.expedienteDocumento.create.mockResolvedValue({});
    mocks.db.assistantAttachment.update.mockResolvedValue({});
    mocks.db.auditLog.create.mockResolvedValue({});

    await expect(assistantConversationService.promoteAttachment(writer, conversation.id, temporary.id, {
      targetType: 'EXPEDIENTE', targetId: 'expediente-2', documentType: 'OTROS',
    })).resolves.toMatchObject({ documentId: 'documento-promoted', attachmentId: temporary.id });

    expect(mocks.db.documento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ storage_key: temporary.storage_key }),
    }));
    expect(mocks.db.assistantAttachment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: temporary.id },
      data: expect.objectContaining({ source: 'OFFICIAL_DOCUMENT', documento_id: 'documento-promoted', storage_key: null }),
    }));
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
