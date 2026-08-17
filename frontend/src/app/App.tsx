import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { AuthProvider } from '../features/auth/AuthProvider';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AssistantProvider } from '../features/assistant/AssistantProvider';
import { UpdatePrompt } from '../components/system/UpdatePrompt';

const MyDayPage = lazy(() => import('../features/my-day/MyDayPage').then((module) => ({ default: module.MyDayPage })));
const ProspectsPage = lazy(() => import('../features/prospects/ProspectsPage').then((module) => ({ default: module.ProspectsPage })));
const ProspectDetailPage = lazy(() => import('../features/prospects/ProspectDetailPage').then((module) => ({ default: module.ProspectDetailPage })));
const QuotesPage = lazy(() => import('../features/quotes/QuotesPage').then((module) => ({ default: module.QuotesPage })));
const QuoteDetailPage = lazy(() => import('../features/quotes/QuoteDetailPage').then((module) => ({ default: module.QuoteDetailPage })));
const ExpedientesPage = lazy(() => import('../features/cases/ExpedientesPage').then((module) => ({ default: module.ExpedientesPage })));
const ExpedienteWorkspace = lazy(() => import('../features/cases/ExpedienteWorkspace').then((module) => ({ default: module.ExpedienteWorkspace })));
const ComparecientesPage = lazy(() => import('../features/comparecientes/ComparecientesPage').then((module) => ({ default: module.ComparecientesPage })));
const ComparecienteWorkspace = lazy(() => import('../features/comparecientes/ComparecienteWorkspace').then((module) => ({ default: module.ComparecienteWorkspace })));
const NotariasPage = lazy(() => import('../features/notarias/NotariasPage').then((module) => ({ default: module.NotariasPage })));
const NotariaWorkspace = lazy(() => import('../features/notarias/NotariaWorkspace').then((module) => ({ default: module.NotariaWorkspace })));
const AgendaPage = lazy(() => import('../features/agenda/AgendaPage').then((module) => ({ default: module.AgendaPage })));
const FinancePage = lazy(() => import('../features/finance/FinancePage').then((module) => ({ default: module.FinancePage })));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const CompliancePage = lazy(() => import('../features/compliance/CompliancePage').then((module) => ({ default: module.CompliancePage })));
const ComplianceReviewPage = lazy(() => import('../features/compliance/ComplianceReviewPage').then((module) => ({ default: module.ComplianceReviewPage })));
const ISRDirectoryPage = lazy(() => import('../features/isr/ISRDirectoryPage').then((module) => ({ default: module.ISRDirectoryPage })));
const ISRWorkspacePage = lazy(() => import('../features/isr/ISRWorkspacePage').then((module) => ({ default: module.ISRWorkspacePage })));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const UserDetailPage = lazy(() => import('../features/settings/UserDetailPage').then((module) => ({ default: module.UserDetailPage })));
const ActivationPage = lazy(() => import('../features/settings/ActivationPage').then((module) => ({ default: module.ActivationPage })));

export function App() {
  return (
    <AuthProvider>
      <UpdatePrompt />
      <Suspense fallback={<div role="status" aria-live="polite">Cargando módulo…</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/activar" element={<ActivationPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AssistantProvider><AppShell /></AssistantProvider>}>
              <Route index element={<Navigate to="/mi-dia" replace />} />
              <Route path="/mi-dia" element={<MyDayPage />} />
              <Route path="/prospectos" element={<ProspectsPage />} />
              <Route path="/prospectos/:id" element={<ProspectDetailPage />} />
              <Route path="/cotizaciones" element={<QuotesPage />} />
              <Route path="/cotizaciones/:id" element={<QuoteDetailPage />} />
              <Route path="/expedientes" element={<ExpedientesPage />} />
              <Route path="/expedientes/:id" element={<ExpedienteWorkspace />} />
              <Route path="/comparecientes" element={<ComparecientesPage />} />
              <Route path="/comparecientes/:id" element={<ComparecienteWorkspace />} />
              <Route path="/notarias" element={<NotariasPage />} />
              <Route path="/notarias/:id" element={<NotariaWorkspace />} />
              <Route path="/agenda" element={<AgendaPage />} />
              <Route path="/finanzas" element={<FinancePage />} />
              <Route path="/reportes" element={<ReportsPage />} />
              <Route path="/riesgos" element={<CompliancePage />} />
              <Route path="/riesgos/revisiones/:id" element={<ComplianceReviewPage />} />
              <Route path="/calculo-isr" element={<ISRDirectoryPage />} />
              <Route path="/calculo-isr/:id" element={<ISRWorkspacePage />} />
              <Route path="/configuracion" element={<SettingsPage />} />
              <Route path="/configuracion/:section" element={<SettingsPage />} />
              <Route path="/configuracion/usuarios/:id" element={<UserDetailPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
