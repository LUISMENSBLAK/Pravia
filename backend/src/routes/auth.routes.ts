import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const limitLogin = (req: any, res: any, next: any) => {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const current = loginAttempts.get(key);
  const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
  state.count += 1;
  loginAttempts.set(key, state);
  if (loginAttempts.size > 5000) {
    for (const [entry, value] of loginAttempts) if (value.resetAt <= now) loginAttempts.delete(entry);
  }
  if (state.count > 20) return res.status(429).json({ code: 'AUTH_RATE_LIMITED', error: 'Demasiados intentos. Intenta más tarde.' });
  return next();
};

router.post('/login', limitLogin, AuthController.login);
router.post('/refresh', AuthController.refresh);
router.post('/logout', AuthController.logout);
router.get('/me', authenticate, AuthController.me);
router.post('/change-password', authenticate, AuthController.changePassword);
router.post('/request-recovery', AuthController.requestRecovery);
router.post('/reset-password', AuthController.resetPassword);

export default router;
