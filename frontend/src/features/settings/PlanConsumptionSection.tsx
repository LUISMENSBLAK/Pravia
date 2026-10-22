import { useEffect, useState } from 'react';
import { AlertCircle, Bot, CheckCircle2, Cloud, CreditCard, Database, Download, FileArchive, HardDrive, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { settingsService } from './settings.service';
import { MigrationControlSection } from './MigrationControlSection';
import styles from './PlanConsumption.module.css';

type Consumption = {
  subscription: {
    subscription: null | { status: string; current_period_start?: string | null; current_period_end?: string | null };
    plan: null | { name: string; monthly_price_minor?: string | null; currency: string; included_storage_bytes: string };
  };
  storage: {
    includedBytes: string; addonBytes: string; capacityBytes: string; productionBytes: string;
    temporaryBytes: string; reservedBytes: string; availableBytes: string; utilizationBasisPoints: number;
    addons: Array<{ id: string; quantity: number; status: string; price_snapshot_minor?: string | null; currency: string }>;
    alerts: Array<{ id: string; threshold: number; crossed_at: string }>;
  };
  ai: {
    wallet: { currency: string; balance_minor: string; reserved_minor: string; available_minor: string; status: string };
    history: Array<{ id: string; type: string; amount_minor: string; created_at: string }>;
  };
  billing: { cycles: Array<{ id: string; period_start: string; period_end: string; status: string; subscription_amount: string; storage_addon_amount: string; currency: string }> };
  migrations: { jobs: Array<{ id: string; source_system: string; status: string; progress: number; created_at: string }> };
};

const bytes = (value: string) => {
  const amount = Number(BigInt(value));
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: index > 2 ? 2 : 1 }).format(amount / 1024 ** index)} ${units[index]}`;
};
const money = (minor: string | null | undefined, currency = 'MXN') => minor === null || minor === undefined
  ? 'Configuración comercial pendiente'
  : new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(BigInt(minor)) / 100);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin fecha programada';
const label = (value: string) => value.toLocaleLowerCase('es-MX').replaceAll('_', ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('es-MX'));
const exportStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente', RUNNING: 'En proceso', COMPLETED: 'Completada',
  FAILED: 'Fallida', EXPIRED: 'Expirada', REVOKED: 'Revocada',
};

type ExportJob = { id: string; status: string; progress: number; created_at: string; expires_at: string | null };

export function PlanConsumptionSection({ canReadExports = false, canManageExports = false, canReadMigrations = false, canManageMigrations = false }: {
  canReadExports?: boolean; canManageExports?: boolean; canReadMigrations?: boolean; canManageMigrations?: boolean;
}) {
  const [data, setData] = useState<Consumption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [download, setDownload] = useState<{ id: string; url: string } | null>(null);
  const load = async () => {
    setLoading(true); setError('');
    try { setData(await settingsService.planConsumption() as Consumption); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar Plan y consumo.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const refreshExports = async () => {
    if (!canReadExports) return;
    try { setExportJobs(await settingsService.tenantExports()); setExportError(''); }
    catch (reason) { setExportError(reason instanceof Error ? reason.message : 'No se pudo consultar el estado de las exportaciones.'); }
  };
  useEffect(() => { void refreshExports(); }, [canReadExports]);
  useEffect(() => {
    if (!canReadExports || !exportJobs.some((job) => ['PENDING', 'RUNNING'].includes(job.status))) return;
    const timer = window.setInterval(() => { void refreshExports(); }, 5000);
    return () => window.clearInterval(timer);
  }, [canReadExports, exportJobs]);
  const requestExport = async () => {
    setExportBusy(true); setExportError(''); setDownload(null);
    try { await settingsService.createTenantExport(); await refreshExports(); }
    catch (reason) { setExportError(reason instanceof Error ? reason.message : 'No se pudo iniciar la exportación.'); }
    finally { setExportBusy(false); }
  };
  const prepareDownload = async (id: string) => {
    setExportBusy(true); setExportError(''); setDownload(null);
    try { const result = await settingsService.tenantExportDownload(id); setDownload({ id, url: result.url }); }
    catch (reason) { setExportError(reason instanceof Error ? reason.message : 'La descarga ya no está disponible.'); }
    finally { setExportBusy(false); }
  };
  if (loading) return <div className={styles.state} role="status"><span />Cargando consumo real de la organización…</div>;
  if (error) return <div className={styles.state} role="alert"><AlertCircle /><strong>No pudimos cargar Plan y consumo</strong><p>{error}</p><Button variant="secondary" onClick={() => void load()}><RefreshCw size={16} />Reintentar</Button></div>;
  if (!data) return null;
  const storagePercent = Math.min(100, data.storage.utilizationBasisPoints / 100);
  const price = data.subscription.plan?.monthly_price_minor;
  return <div className={styles.stack}>
    <section className={styles.hero}>
      <div className={styles.heroIcon}><Cloud /></div>
      <div><span>PLAN ACTUAL</span><h2>{data.subscription.plan?.name || 'Sin plan asignado'}</h2><p>{data.subscription.subscription ? `${label(data.subscription.subscription.status)} · renovación ${date(data.subscription.subscription.current_period_end)}` : 'La suscripción todavía no está configurada.'}</p></div>
      <strong>{money(price, data.subscription.plan?.currency)}</strong>
    </section>

    <div className={styles.grid}>
      <section className={styles.card}>
        <header><span><HardDrive /><small>ALMACENAMIENTO</small></span><em>{storagePercent.toLocaleString('es-MX', { maximumFractionDigits: 2 })}%</em></header>
        <h3>{bytes(data.storage.productionBytes)} <small>utilizados</small></h3>
        <div className={styles.progress} role="progressbar" aria-label="Uso de almacenamiento" aria-valuemin={0} aria-valuemax={100} aria-valuenow={storagePercent}><i style={{ width: `${storagePercent}%` }} /></div>
        <dl><div><dt>Incluido</dt><dd>{bytes(data.storage.includedBytes)}</dd></div><div><dt>Add-ons</dt><dd>{bytes(data.storage.addonBytes)}</dd></div><div><dt>Disponible</dt><dd>{bytes(data.storage.availableBytes)}</dd></div><div><dt>Temporal</dt><dd>{bytes(data.storage.temporaryBytes)}</dd></div></dl>
        {data.storage.alerts.length > 0 && <p className={styles.notice}><AlertCircle size={16} />Alerta activa: uso igual o superior a {data.storage.alerts.at(-1)?.threshold}%.</p>}
      </section>

      <section className={styles.card}>
        <header><span><Bot /><small>INTELIGENCIA ARTIFICIAL</small></span><em data-ok={BigInt(data.ai.wallet.available_minor) > 0n}>{label(data.ai.wallet.status)}</em></header>
        <h3>{money(data.ai.wallet.balance_minor, data.ai.wallet.currency)} <small>saldo</small></h3>
        <dl><div><dt>Disponible</dt><dd>{money(data.ai.wallet.available_minor, data.ai.wallet.currency)}</dd></div><div><dt>Reservado</dt><dd>{money(data.ai.wallet.reserved_minor, data.ai.wallet.currency)}</dd></div><div><dt>Movimientos</dt><dd>{data.ai.history.length}</dd></div><div><dt>Último</dt><dd>{data.ai.history[0] ? date(data.ai.history[0].created_at) : 'Sin movimientos'}</dd></div></dl>
        <p className={styles.caption}>Los créditos promocionales se muestran como saldo; no se contabilizan como ingreso.</p>
      </section>
    </div>

    <div>
      <section className={styles.listCard}>
        <header><div><CreditCard /><span><h3>Facturación PRAVIA</h3><p>Separada de las finanzas notariales.</p></span></div></header>
        {data.billing.cycles.length ? <ul>{data.billing.cycles.map((cycle) => <li key={cycle.id}><span><strong>{date(cycle.period_start)} — {date(cycle.period_end)}</strong><small>{label(cycle.status)}</small></span><b>{money(String(BigInt(cycle.subscription_amount) + BigInt(cycle.storage_addon_amount)), cycle.currency)}</b></li>)}</ul> : <div className={styles.empty}><CheckCircle2 /><span><strong>Sin ciclos facturados</strong><small>No se simulan cargos cuando no existen.</small></span></div>}
      </section>
    </div>
    <MigrationControlSection canRead={canReadMigrations} canManage={canManageMigrations} />
    {canReadExports && <section className={styles.listCard} aria-labelledby="tenant-export-title">
      <header className={styles.exportHeader}><div><FileArchive /><span><h3 id="tenant-export-title">Exportaciones de la organización</h3><p>Paquetes privados con manifiesto, archivos y comprobación de integridad.</p></span></div>
        {canManageExports && <Button disabled={exportBusy} onClick={() => void requestExport()}>Solicitar exportación</Button>}
      </header>
      {exportError && <p className={styles.exportError} role="alert">{exportError} <button type="button" onClick={() => void refreshExports()}>Reintentar</button></p>}
      {exportJobs.length ? <ul aria-live="polite">{exportJobs.map((job) => <li key={job.id} className={styles.exportRow}>
        <span><strong>{date(job.created_at)}</strong><small>{exportStatusLabel[job.status] || label(job.status)} · {job.progress}%{job.expires_at ? ` · disponible hasta ${date(job.expires_at)}` : ''}</small></span>
        {job.status === 'COMPLETED' && (download?.id === job.id
          ? <a className={styles.downloadLink} href={download.url} target="_blank" rel="noopener noreferrer"><Download size={15} />Abrir descarga</a>
          : <Button variant="secondary" disabled={exportBusy} onClick={() => void prepareDownload(job.id)}>Preparar descarga</Button>)}
      </li>)}</ul> : <div className={styles.empty}><FileArchive /><span><strong>Sin exportaciones</strong><small>Las solicitudes aparecerán aquí y conservarán su estado al volver a entrar.</small></span></div>}
    </section>}
  </div>;
}
