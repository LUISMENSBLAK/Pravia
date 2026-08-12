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

  const value = useMemo(() => ({ status, user, login, logout }), [login, logout, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  return context;
};
