import { Router } from 'express';
import { LocalStorageController } from '../controllers/localStorage.controller';

const router = Router();
router.get('/local', LocalStorageController.serve);
export default router;
