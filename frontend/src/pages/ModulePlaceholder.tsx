import { useLocation } from 'react-router-dom';
import { PageContainer } from '../components/layout/PageContainer';
import styles from './ModulePlaceholder.module.css';

const labels: Record<string, string> = {
  '/prospectos': 'Prospectos', '/cotizaciones': 'Cotizaciones', '/expedientes': 'Expedientes',
  '/notarias': 'Notarías', '/comparecientes': 'Comparecientes', '/finanzas': 'Finanzas',
  '/agenda': 'Agenda', '/reportes': 'Reportes', '/riesgos': 'Riesgos / UIF', '/configuracion': 'Configuración',
};

export function ModulePlaceholder() {
  const { pathname } = useLocation();
  return (
    <PageContainer title={labels[pathname] ?? 'PRAVIA OS'}>
      <section className={styles.placeholder}>
        <span aria-hidden="true" />
        <p>Módulo pendiente de construcción.</p>
      </section>
    </PageContainer>
  );
}
