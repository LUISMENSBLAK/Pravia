import { Router } from 'express';
import { UsersController } from '../controllers/users.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/', requirePermission('usuarios.read'), UsersController.list);
router.get('/invitations', requirePermission('usuarios.manage'), UsersController.invitations);
router.post('/invitations', requirePermission('usuarios.manage'), UsersController.invite);
router.delete('/invitations/:id', requirePermission('usuarios.manage'), UsersController.revokeInvitation);
router.get('/:id/impact', requirePermission('usuarios.manage'), UsersController.impact);
router.get('/:id', requirePermission('usuarios.manage'), UsersController.detail);
router.patch('/:id', requirePermission('usuarios.manage'), UsersController.update);

export default router;
