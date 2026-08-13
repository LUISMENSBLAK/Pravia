import { Router } from 'express';
import { SettingsController } from '../controllers/settings.controller';
import { requirePermission } from '../middleware/auth.middleware';

const router = Router();
router.get('/overview', SettingsController.overview);
router.get('/profile', SettingsController.profile);
router.patch('/profile', SettingsController.updateProfile);
router.get('/preferences', SettingsController.preferences);
router.patch('/preferences', SettingsController.updatePreferences);
router.get('/sessions', SettingsController.sessions);
router.delete('/sessions/:id', SettingsController.revokeSession);
router.post('/sessions/revoke-others', SettingsController.revokeOtherSessions);
router.get('/roles', requirePermission('usuarios.read'), SettingsController.roles);
router.get('/audit', requirePermission('configuracion.manage'), SettingsController.audit);
router.get('/notifications', SettingsController.notifications);
router.post('/notifications/read-all', SettingsController.readAllNotifications);
router.post('/notifications/:id/read', SettingsController.readNotification);
router.get('/search', requirePermission('ai.search'), SettingsController.search);

export default router;
