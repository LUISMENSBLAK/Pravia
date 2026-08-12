import { PageContainer } from '../components/layout/PageContainer';
import styles from './DayPage.module.css';

export function DayPage() {
  return (
    <PageContainer title="Mi Día" subtitle="Tu espacio de trabajo está listo para la siguiente fase.">
      <section className={styles.canvas} aria-label="Área de Mi Día">
        <div className={styles.line} />
        <p>El contenido operativo de Mi Día se construirá después de aprobar este shell.</p>
      </section>
    </PageContainer>
  );
}
