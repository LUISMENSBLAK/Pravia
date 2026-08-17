import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { authService } from '../../services/api/auth';
import type { LoginCredentials, SessionUser } from './auth.types';

type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;
    authService.currentUser()
      .then((sessionUser) => {
        if (!active) return;
        setUser(sessionUser);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus('anonymous');
      });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const sessionUser = await authService.login(credentials);
    setUser(sessionUser);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const switchOrganization = useCallback(async (organizationId: string) => {
    const sessionUser = await authService.switchOrganization(organizationId);
    sessionStorage.removeItem('pravia.assistant.suppressed-suggestions');
    setUser((current) => ({ ...sessionUser, organizations: current?.organizations || sessionUser.organizations }));
    window.dispatchEvent(new CustomEvent('pravia:organization-changed', { detail: { organizationId } }));
  }, []);

  const value = useMemo(() => ({ status, user, login, logout, switchOrganization }), [login, logout, status, switchOrganization, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  return context;
};
