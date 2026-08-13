import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { AuthProvider } from '../features/auth/AuthProvider';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { ModulePlaceholder } from '../pages/ModulePlaceholder';
import { MyDayPage } from '../features/my-day/MyDayPage';
import { AssistantProvider } from '../features/assistant/AssistantProvider';
import { ProspectsPage } from '../features/prospects/ProspectsPage';
import { ProspectDetailPage } from '../features/prospects/ProspectDetailPage';
import { QuotesPage } from '../features/quotes/QuotesPage';
import { QuoteDetailPage } from '../features/quotes/QuoteDetailPage';
import { ExpedientesPage } from '../features/cases/ExpedientesPage';
import { ExpedienteWorkspace } from '../features/cases/ExpedienteWorkspace';
import { ComparecientesPage } from '../features/comparecientes/ComparecientesPage';
import { ComparecienteWorkspace } from '../features/comparecientes/ComparecienteWorkspace';
import { NotariasPage } from '../features/notarias/NotariasPage';
import { NotariaWorkspace } from '../features/notarias/NotariaWorkspace';
import { AgendaPage } from '../features/agenda/AgendaPage';
import { FinancePage } from '../features/finance/FinancePage';

const modulePaths = ['reportes', 'riesgos', 'configuracion'];

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
            {modulePaths.map((path) => <Route key={path} path={`/${path}`} element={<ModulePlaceholder />} />)}
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
