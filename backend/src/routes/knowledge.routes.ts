import { Router } from 'express';
import { addKnowledgeVersion, createKnowledgeCriterion, detectKnowledgeVersion, importKnowledgeInventory, listKnowledgeCriteria, listKnowledgeSources, registerKnowledgeImpact, retrieveKnowledge, updateKnowledgeCriterion, verifyKnowledgeVersion } from '../controllers/knowledge.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/sources', requirePermission('configuracion.catalogos.read'), listKnowledgeSources);
router.get('/criteria', requirePermission('configuracion.catalogos.read'), listKnowledgeCriteria);
router.post('/retrieve', requirePermission('configuracion.catalogos.read'), retrieveKnowledge);
router.post('/inventory', requirePermission('configuracion.manage'), importKnowledgeInventory);
router.post('/criteria', requirePermission('configuracion.manage'), createKnowledgeCriterion);
router.patch('/criteria/:criterionId', requirePermission('configuracion.manage'), updateKnowledgeCriterion);
router.post('/sources/:sourceId/versions', requirePermission('configuracion.manage'), addKnowledgeVersion);
router.post('/sources/:sourceId/versions/:versionId/verify', requirePermission('configuracion.manage'), verifyKnowledgeVersion);
router.post('/sources/:sourceId/radar-detections', requirePermission('configuracion.manage'), detectKnowledgeVersion);
router.post('/radar-runs/:runId/impacts', requirePermission('configuracion.manage'), registerKnowledgeImpact);

export default router;
