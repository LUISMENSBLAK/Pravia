import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { catalogError, configurationCatalogController } from '../controllers/configurationCatalog.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 100, fields: 8 } });
const read = requirePermission('configuracion.catalogos.read');
const manageActs = requirePermission('configuracion.actos_tiempos.manage');
const manageArtifacts = requirePermission('configuracion.plantillas_formatos.manage');
const endpoint = (handler: (req: Request) => Promise<unknown>, success = 200) => async (req: Request, res: Response) => {
  try { return res.status(success).json({ success: true, data: await handler(req) }); }
  catch (error) { const result = catalogError(error); if (result.status >= 500) console.error('Configuration catalog error', error); return res.status(result.status).json(result.body); }
};

router.get('/acts', read, endpoint(configurationCatalogController.listActs));
router.post('/acts', manageActs, endpoint(configurationCatalogController.createAct, 201));
router.post('/v2/bootstrap', manageActs, endpoint(configurationCatalogController.bootstrapV2));
router.get('/v2/concepts', read, endpoint(configurationCatalogController.listConcepts));
router.post('/v2/concepts', manageActs, endpoint(configurationCatalogController.createConcept, 201));
router.patch('/v2/concepts/:conceptId', manageActs, endpoint(configurationCatalogController.updateConcept));
router.post('/v2/institutions', manageActs, endpoint(configurationCatalogController.createInstitution, 201));
router.get('/acts/:id', read, endpoint(configurationCatalogController.getAct));
router.post('/acts/:id/duplicate', manageActs, endpoint(configurationCatalogController.duplicateAct, 201));
router.post('/acts/:id/activities/:activityId/override', manageActs, endpoint(configurationCatalogController.overrideInheritedApplication, 201));
router.delete('/acts/:id/activities/:activityId', manageActs, endpoint(configurationCatalogController.removeConceptFromAct));
router.post('/acts/:id/configuration', manageActs, endpoint(configurationCatalogController.ensureActConfiguration, 201));
router.patch('/acts/:id', manageActs, endpoint(configurationCatalogController.updateAct));
router.post('/acts/:actId/stages', manageActs, endpoint(configurationCatalogController.createStage, 201));
router.patch('/stages/:stageId', manageActs, endpoint(configurationCatalogController.updateStage));
router.delete('/stages/:stageId', manageActs, endpoint(configurationCatalogController.deleteStage));
router.post('/stages/:stageId/activities', manageActs, endpoint(configurationCatalogController.createActivity, 201));
router.post('/stages/:stageId/activity-applications', manageActs, endpoint(configurationCatalogController.createApplication, 201));
router.patch('/activities/:activityId', manageActs, endpoint(configurationCatalogController.updateActivity));
router.post('/activities/:activityId/inherit/:attribute', manageActs, endpoint(configurationCatalogController.revertActivityAttribute));
router.put('/activities/:activityId/dependencies', manageActs, endpoint(configurationCatalogController.setDependencies));
router.post('/activities/:activityId/exceptions', manageActs, endpoint(configurationCatalogController.createException, 201));
router.patch('/exceptions/:exceptionId', manageActs, endpoint(configurationCatalogController.updateException));
router.get('/activities/:activityId/resolve', read, endpoint(configurationCatalogController.resolveTiming));

router.get('/artifacts/root', read, endpoint(configurationCatalogController.artifactsRoot));
router.post('/artifacts/library/bootstrap', manageArtifacts, endpoint(configurationCatalogController.bootstrapLibraryV4, 201));
router.post('/artifacts/import/preview', manageArtifacts, importUpload.array('files', 100), endpoint(configurationCatalogController.previewArtifactImport));
router.post('/artifacts/import/confirm', manageArtifacts, importUpload.array('files', 100), endpoint(configurationCatalogController.confirmArtifactImport, 201));
router.get('/supporting', read, endpoint(configurationCatalogController.supportingCatalogs));
router.post('/institutions', manageArtifacts, endpoint(configurationCatalogController.createInstitution, 201));
router.put('/institutions/:institutionId/response-times', manageActs, endpoint(configurationCatalogController.upsertInstitutionResponse));
router.get('/explorer', read, endpoint(configurationCatalogController.explorer));
router.post('/folders', manageArtifacts, endpoint(configurationCatalogController.createFolder, 201));
router.post('/artifacts', manageArtifacts, upload.single('file'), endpoint(configurationCatalogController.createArtifact, 201));
router.patch('/artifacts/:artifactId', manageArtifacts, endpoint(configurationCatalogController.updateArtifact));
router.post('/artifacts/:artifactId/versions', manageArtifacts, upload.single('file'), endpoint(configurationCatalogController.addArtifactVersion, 201));
router.get('/artifact-versions/:versionId/url', read, endpoint(configurationCatalogController.artifactVersionUrl));

export default router;
