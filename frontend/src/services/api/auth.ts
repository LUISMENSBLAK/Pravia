import type { LoginCredentials, SessionUser } from '../../features/auth/auth.types';
import { normalizeUser } from '../../features/auth/auth.types';
import { apiConfig } from './config';
import { apiRequest, extractToken, tokenStore } from './client';

type AuthPayload = Record<string, unknown>;

const requireUser = (payload: unknown): SessionUser => {
  const user = normalizeUser(payload);
  if (!user) throw new Error('La respuesta de sesión no contiene un usuario válido.');
  return user;
};

export const authService = {
  async login(credentials: LoginCredentials): Promise<SessionUser> {
    const payload = await apiRequest<AuthPayload>(apiConfig.loginPath, {
      method: 'POST',
      body: JSON.stringify({ email: credentials.email, password: credentials.password, remember: credentials.remember }),
      retryOnUnauthorized: false,
    });

    const token = extractToken(payload);
    if (token) tokenStore.set(token, credentials.remember);
    const user = normalizeUser(payload);
    return user ?? authService.currentUser();
  },

  async currentUser(): Promise<SessionUser> {
    const payload = await apiRequest<AuthPayload>(apiConfig.mePath);
    return requireUser(payload);
  },

  async logout(): Promise<void> {
    try {
      await apiRequest(apiConfig.logoutPath, { method: 'POST', retryOnUnauthorized: false });
    } finally {
      tokenStore.clear();
    }
  },
};
