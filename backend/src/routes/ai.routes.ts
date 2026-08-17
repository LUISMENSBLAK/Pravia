import { Router } from 'express';
import multer from 'multer';
import { AIController } from '../controllers/ai.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
const assistantUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

router.get('/assistant/conversations', requirePermission('ai.use'), AIController.listConversations);
router.post('/assistant/conversations', requirePermission('ai.use'), AIController.createConversation);
router.get('/assistant/conversations/:conversationId', requirePermission('ai.use'), AIController.getConversation);
router.patch('/assistant/conversations/:conversationId', requirePermission('ai.use'), AIController.renameConversation);
router.post('/assistant/conversations/:conversationId/archive', requirePermission('ai.use'), AIController.archiveConversation);
router.post('/assistant/conversations/:conversationId/trash', requirePermission('ai.use'), AIController.trashConversation);
router.post('/assistant/conversations/:conversationId/restore', requirePermission('ai.use'), AIController.restoreConversation);
router.post('/assistant/conversations/:conversationId/attachments', requirePermission('ai.use'), assistantUpload.single('file'), AIController.uploadConversationAttachment);
router.post('/assistant/conversations/:conversationId/attachments/link-document', requirePermission('ai.documentos.read'), requirePermission('documentos.read'), AIController.linkConversationDocument);
router.get('/assistant/conversations/:conversationId/attachments/:attachmentId/url', requirePermission('ai.use'), AIController.conversationAttachmentUrl);
router.post('/assistant/conversations/:conversationId/attachments/:attachmentId/archive', requirePermission('ai.use'), AIController.archiveConversationAttachment);
router.post('/assistant/conversations/:conversationId/attachments/:attachmentId/transcribe', requirePermission('ai.use'), AIController.transcribeConversationAudio);
router.post('/assistant/messages', requirePermission('ai.use'), AIController.message);
router.get('/assistant/tools', requirePermission('ai.use'), AIController.tools);
router.post('/assistant/tools/:tool', requirePermission('ai.use'), AIController.executeTool);
router.post('/assistant/confirmations', requirePermission('ai.use'), AIController.confirmPreparedAction);
router.get('/dashboard', requirePermission('ai.admin.read'), AIController.dashboard);
export default router;
