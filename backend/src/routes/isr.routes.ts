import { Router } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/auth.middleware';
import { auditISRExport, calculateISRRecord, createISR, downloadISRDocument, extractISR, getISR, listISR, previewISRDocument, reviewISRProposal, unlinkISRDocument, updateISR, uploadISRDocument } from '../controllers/isr.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

router.get('/', requirePermission('isr.read'), listISR);
router.post('/', requirePermission('isr.write'), createISR);
router.get('/:id', requirePermission('isr.read'), getISR);
router.patch('/:id', requirePermission('isr.write'), updateISR);
router.post('/:id/calculate', requirePermission('isr.calculate'), calculateISRRecord);
router.post('/:id/export-audit', requirePermission('isr.read'), auditISRExport);
router.post('/:id/extract', requirePermission('isr.write'), extractISR);
router.patch('/:id/proposals/:proposalId', requirePermission('isr.write'), reviewISRProposal);
router.post('/:id/documents', requirePermission('isr.write'), upload.single('file'), uploadISRDocument);
router.get('/:id/documents/:documentId/preview', requirePermission('isr.read'), previewISRDocument);
router.get('/:id/documents/:documentId/download', requirePermission('isr.read'), downloadISRDocument);
router.delete('/:id/documents/:documentId', requirePermission('isr.write'), unlinkISRDocument);

export default router;
