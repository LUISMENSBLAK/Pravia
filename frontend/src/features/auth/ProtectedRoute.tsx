import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { AuthSplash } from './AuthSplash';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <AuthSplash />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}
