import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Bot, Boxes, DatabaseBackup, Download, HardDrive,
  RefreshCw, ServerCog, Webhook,
} from 'lucide-react';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { settingsService } from './settings.service';
import styles from './PlatformOperationsPage.module.css';

type CountGroup = { status: string; _count: number | { _all?: number } };
type OperationalRow = {
  id?: string; organization_id?: string | null; status?: string; job_type?: string;
  source_system?: string; provider?: string; provider_code?: string; event_type?: string;
  progress?: number; attempts?: number; max_attempts?: number; temporary_bytes?: string;
  created_at?: string; updated_at?: string; started_at?: string; lease_expires_at?: string;
  period?: string; ai_cost?: string; ai_sales?: string; gross_margin_estimate?: string; currency?: string;
};
type Dashboard = {
  generatedAt: string; staleThresholdMinutes: number;
  organizations: CountGroup[]; jobs: CountGroup[]; migrations: CountGroup[]; exports: CountGroup[];
  storage: { _sum: { production_bytes?: string | null; temporary_bytes?: string | null; reserved_bytes?: string | null } };
  operations: {
    failedJobs: OperationalRow[]; stuckJobs: OperationalRow[]; migrationIssues: OperationalRow[];
    exportIssues: OperationalRow[]; temporaryStorage: OperationalRow[]; aiSpendAnomalies: OperationalRow[];
    backupIssues: OperationalRow[]; billingWebhookIssues: OperationalRow[];
  };
};
type Tenant = Awaited<ReturnType<typeof settingsService.platformTenants>>[number];

const bytes = (raw: string | null | undefined) => {
  const amount = Number(BigInt(raw || '0'));
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(amount / 1024 ** index)} ${units[index]}`;
};
const dateTime = (value?: string) => value
  ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Sin fecha';
const count = (groups: CountGroup[], statuses?: string[]) => groups
  .filter((entry) => !statuses || statuses.includes(entry.status))
  .reduce((total, entry) => total + (typeof entry._count === 'number' ? entry._count : entry._count._all || 0), 0);
const human = (value?: string) => (value || 'SIN_ESTADO').toLocaleLowerCase('es-MX').replaceAll('_', ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('es-MX'));

const sections: Array<{
  key: keyof Dashboard['operations']; title: string; description: string;
  icon: typeof ServerCog;
}> = [
  { key: 'migrationIssues', title: 'Migraciones con atención', description: 'Fallidas o sin avance dentro del umbral operativo.', icon: DatabaseBackup },
  { key: 'failedJobs', title: 'Jobs fallidos', description: 'Trabajos que agotaron sus intentos.', icon: ServerCog },
  { key: 'stuckJobs', title: 'Leases vencidos', description: 'Workers recuperables por expiración de lease.', icon: AlertCircle },
  { key: 'temporaryStorage', title: 'Almacenamiento temporal', description: 'Bytes temporales todavía atribuidos por tenant.', icon: HardDrive },
  { key: 'exportIssues', title: 'Exportaciones con atención', description: 'Paquetes fallidos o sin completar.', icon: Download },
  { key: 'aiSpendAnomalies', title: 'Anomalías de costo IA', description: 'Periodos con margen negativo o costo IA superior a venta IA.', icon: Bot },
  { key: 'backupIssues', title: 'Backups con atención', description: 'Respaldos fallidos o que excedieron el umbral.', icon: DatabaseBackup },
  { key: 'billingWebhookIssues', title: 'Webhooks de facturación', description: 'Eventos fallidos, rechazados o con error.', icon: Webhook },
];

export function PlatformOperationsPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [nextDashboard, nextTenants] = await Promise.all([
        settingsService.platformDashboard() as Promise<Dashboard>, settingsService.platformTenants(),
      ]);
      setDashboard(nextDashboard); setTenants(nextTenants);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible cargar la operación de plataforma.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const tenantNames = useMemo(() => new Map(tenants.map((tenant) => [tenant.id, tenant.name])), [tenants]);

  if (loading) return <PageContainer title="Operación de plataforma" subtitle="Control operativo global sin acceso automático al contenido documental."><div className={styles.state} role="status"><span />Cargando métricas operativas…</div></PageContainer>;
  if (error || !dashboard) return <PageContainer title="Operación de plataforma" subtitle="Control operativo global sin acceso automático al contenido documental."><div className={styles.state} role="alert"><AlertCircle /><strong>Acceso no disponible</strong><p>{error || 'La respuesta no contiene métricas.'}</p><Button variant="secondary" onClick={() => void load()}><RefreshCw size={16} />Reintentar</Button></div></PageContainer>;

  return <PageContainer title="Operación de plataforma" subtitle="Salud multi-tenant, jobs y proveedores; sólo metadatos operativos."
    action={<Button variant="secondary" onClick={() => void load()}><RefreshCw size={16} />Actualizar</Button>}>
    <div className={styles.stack}>
      <section className={styles.summary} aria-label="Resumen global">
        <article><Boxes /><span><small>ORGANIZACIONES</small><strong>{count(dashboard.organizations)}</strong></span></article>
        <article><ServerCog /><span><small>JOBS ACTIVOS</small><strong>{count(dashboard.jobs, ['PENDING', 'RETRY', 'RUNNING'])}</strong></span></article>
        <article><DatabaseBackup /><span><small>MIGRACIONES ACTIVAS</small><strong>{count(dashboard.migrations, ['UPLOADING', 'ANALYZING', 'READY_FOR_MAPPING', 'APPROVED', 'MIGRATING', 'VERIFYING'])}</strong></span></article>
        <article><HardDrive /><span><small>TEMPORAL GLOBAL</small><strong>{bytes(dashboard.storage._sum.temporary_bytes)}</strong></span></article>
      </section>

      <p className={styles.timestamp}>Actualizado {dateTime(dashboard.generatedAt)} · alerta de inactividad: {dashboard.staleThresholdMinutes} min</p>

      <div className={styles.grid}>
        {sections.map(({ key, title, description, icon: Icon }) => {
          const rows = dashboard.operations[key];
          return <section className={styles.card} key={key} aria-labelledby={`platform-${key}`}>
            <header><Icon /><span><h2 id={`platform-${key}`}>{title}</h2><p>{description}</p></span><b data-has-issues={rows.length > 0}>{rows.length}</b></header>
            {rows.length ? <ul>{rows.map((row, index) => {
              const organization = row.organization_id ? tenantNames.get(row.organization_id) || row.organization_id : 'Plataforma';
              const when = row.updated_at || row.lease_expires_at || row.started_at || row.created_at || row.period;
              return <li key={row.id || `${row.organization_id}-${when}-${index}`}>
                <span><strong>{organization}</strong><small>{human(row.job_type || row.source_system || row.event_type || row.provider || row.provider_code || row.status)}</small></span>
                <span className={styles.meta}><em>{row.temporary_bytes ? bytes(row.temporary_bytes) : row.progress !== undefined ? `${row.progress}%` : human(row.status)}</em><small>{dateTime(when)}</small></span>
              </li>;
            })}</ul> : <div className={styles.empty}>Sin incidencias detectadas.</div>}
          </section>;
        })}
      </div>
    </div>
  </PageContainer>;
}
