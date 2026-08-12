import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { AuthProvider } from '../features/auth/AuthProvider';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { DayPage } from '../pages/DayPage';
import { ModulePlaceholder } from '../pages/ModulePlaceholder';

const modulePaths = ['prospectos', 'cotizaciones', 'expedientes', 'notarias', 'comparecientes', 'finanzas', 'agenda', 'reportes', 'riesgos', 'configuracion'];

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/mi-dia" replace />} />
            <Route path="/mi-dia" element={<DayPage />} />
            {modulePaths.map((path) => <Route key={path} path={`/${path}`} element={<ModulePlaceholder />} />)}
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
