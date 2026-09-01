import { Router } from 'express';
import { listTimingPolicies, publishTimingPolicy, readTimingSource } from '../controllers/timingPolicy.controller';
import { requirePermission } from '../middleware/auth.middleware';

export const timingPolicyConfigurationRoutes = Router();
timingPolicyConfigurationRoutes.get('/', requirePermission('configuracion.catalogos.read'), listTimingPolicies);
timingPolicyConfigurationRoutes.post('/', requirePermission('configuracion.actos_tiempos.manage'), publishTimingPolicy);

export const timingSourceRoutes = Router();
timingSourceRoutes.get('/:type/:sourceId', readTimingSource);
