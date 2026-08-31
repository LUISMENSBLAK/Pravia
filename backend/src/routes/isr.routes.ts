import { Router } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/auth.middleware';
import { auditISRExport, calculateISRRecord, createISR, downloadISRDocument, extractISR, generateISRPDF, getISR, listISR, openISRForExpediente, previewISRDocument, reviewISRProposal, unlinkISRDocument, unlinkISRFromExpediente, updateISR, uploadISRDocument } from '../controllers/isr.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

router.get('/', requirePermission('isr.read'), listISR);
router.post('/', requirePermission('isr.write'), createISR);
router.post('/expedientes/:expedienteId/open', requirePermission('isr.write'), openISRForExpediente);
router.get('/:id', requirePermission('isr.read'), getISR);
router.patch('/:id', requirePermission('isr.write'), updateISR);
router.delete('/:id/expediente-link', requirePermission('isr.write'), unlinkISRFromExpediente);
router.post('/:id/calculate', requirePermission('isr.calculate'), calculateISRRecord);
router.post('/:id/pdf', requirePermission('isr.calculate'), requirePermission('documentos.write'), generateISRPDF);
router.post('/:id/export-audit', requirePermission('isr.read'), auditISRExport);
router.post('/:id/extract', requirePermission('isr.write'), extractISR);
router.patch('/:id/proposals/:proposalId', requirePermission('isr.write'), reviewISRProposal);
router.post('/:id/documents', requirePermission('isr.write'), requirePermission('documentos.write'), upload.single('file'), uploadISRDocument);
router.get('/:id/documents/:documentId/preview', requirePermission('isr.read'), requirePermission('documentos.read'), previewISRDocument);
router.get('/:id/documents/:documentId/download', requirePermission('isr.read'), requirePermission('documentos.read'), downloadISRDocument);
router.delete('/:id/documents/:documentId', requirePermission('isr.write'), requirePermission('documentos.unlink'), unlinkISRDocument);

export default router;
