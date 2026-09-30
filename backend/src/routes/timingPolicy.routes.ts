import { Router } from 'express';
import { readTimingSource } from '../controllers/timingPolicy.controller';

export const timingSourceRoutes = Router();
timingSourceRoutes.get('/:type/:sourceId', readTimingSource);
