import { Router } from 'express';
import { UsersController } from '../controllers/users.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/', requirePermission('usuarios.read'), UsersController.list);
router.post('/', requirePermission('usuarios.manage'), UsersController.create);
router.patch('/:id', requirePermission('usuarios.manage'), UsersController.update);
router.post('/:id/temporary-password', requirePermission('usuarios.manage'), UsersController.setTemporaryPassword);

export default router;
