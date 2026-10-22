import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { settingsService } from './settings.service';
import styles from './PlanConsumption.module.css';

type MigrationJob = {
  id: string; source_system: string; status: string; progress: number; declared_bytes: string;
  temporary_bytes: string; estimated_production_bytes: string; detected_files: number;
  detected_records: number; duplicate_files: number; corrupt_files: number; dangerous_files: number;
  created_at: string; updated_at: string; completed_at?: string | null;
};
type Mapping = { id: string; source_field: string; target_field: string | null; entity_type: string; status: string };
type Preview = {
  job: MigrationJob & { approved_at?: string | null; verification_json?: Record<string, unknown> };
  assets: Array<{ id: string; source_path: string; size_bytes: string; scan_status: string; status: string; error_code?: string | null }>;
  mappings: Mapping[]; conflicts: unknown[];
  capacity: null | { requiredBytes: string; availableBytes: string; sufficient: boolean };
  pricing: { configured: boolean };
  approvalAllowed: boolean;
};
type CertifiedBackup = {
  id: string; scope: string; provider: string; completed_at: string; bytes: string;
  latestRestoreDrill: { tested_at: string; result: 'PASS'; sample_count: number };
};

const statusLabels: Record<string, string> = {
  UPLOADING: 'Cargando', SCANNING: 'Escaneando', ANALYZING: 'Analizando',
  MAPPING_REQUIRED: 'Requiere mapeo', PREVIEW_READY: 'Vista previa lista',
  AWAITING_APPROVAL: 'Pendiente de aprobación', MIGRATING: 'Migrando', VERIFYING: 'Verificando',
  COMPLETED: 'Completada', FAILED: 'Fallida', CANCELLED: 'Cancelada',
};
const formatBytes = (value: string) => {
  const amount = Number(BigInt(value || '0'));
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(amount / 1024 ** index)} ${units[index]}`;
};
const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const sha256 = async (part: Blob) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await part.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const errorMessage = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

export function MigrationControlSection({ canRead, canManage }: { canRead: boolean; canManage: boolean }) {
  const [jobs, setJobs] = useState<MigrationJob[]>([]);
  const [backups, setBackups] = useState<CertifiedBackup[]>([]);
  const [selected, setSelected] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [sourceSystem, setSourceSystem] = useState('Sistema anterior');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    if (!canRead) return;
    try {
      const [migrationResult, backupResult] = await Promise.all([
        settingsService.tenantMigrations(), settingsService.certifiedMigrationBackups(),
      ]);
      setJobs(migrationResult.jobs); setBackups(backupResult); setError('');
    } catch (reason) { setError(errorMessage(reason, 'No se pudo actualizar el estado de las migraciones.')); }
  };
  useEffect(() => { void refresh(); }, [canRead]);
  useEffect(() => {
    if (!jobs.some((job) => ['SCANNING', 'ANALYZING', 'MIGRATING', 'VERIFYING'].includes(job.status))) return;
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const upload = async () => {
    if (!file || !sourceSystem.trim()) return;
    setBusy(true); setError(''); setUploadProgress(0); setSelected(null);
    try {
      const job = await settingsService.createTenantMigration({
        source_system: sourceSystem.trim(), declared_bytes: String(file.size), idempotency_key: globalThis.crypto.randomUUID(),
      });
      const partSize = 4 * 1024 * 1024;
      const session = await settingsService.createMigrationUpload(job.id, {
        filename: file.name, declared_bytes: String(file.size), part_size_bytes: partSize,
        idempotency_key: globalThis.crypto.randomUUID(),
      });
      const partCount = Math.ceil(file.size / partSize);
      for (let index = 0; index < partCount; index += 1) {
        const part = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
        await settingsService.uploadMigrationPart(job.id, session.id, index + 1, part, await sha256(part));
        setUploadProgress(Math.round(((index + 1) / partCount) * 95));
      }
      await settingsService.completeMigrationUpload(job.id, session.id);
      setUploadProgress(100); setFile(null); if (fileInput.current) fileInput.current.value = '';
      await refresh();
    } catch (reason) { setError(errorMessage(reason, 'No se pudo completar la carga reanudable.')); }
    finally { setBusy(false); window.setTimeout(() => setUploadProgress(null), 1200); }
  };

  const openPreview = async (jobId: string) => {
    setBusy(true); setError('');
    try {
      const next = await settingsService.migrationPreview(jobId) as Preview;
      setSelected(next);
      setMapping(Object.fromEntries(next.mappings.map((item) => [item.source_field, item.target_field || ''])));
    } catch (reason) { setError(errorMessage(reason, 'No se pudo cargar la vista previa.')); }
    finally { setBusy(false); }
  };
  const saveMapping = async () => {
    if (!selected) return;
    const packageMapping = selected.mappings.length === 1 && selected.mappings[0].source_field === 'pravia-migration.json';
    setBusy(true); setError('');
    try {
      const next = await settingsService.submitMigrationMapping(selected.job.id, {
        entity_type: packageMapping ? 'PRAVIA_PACKAGE_V1' : 'COMPARECIENTE',
        fields: selected.mappings.map((item) => ({ source_field: item.source_field, target_field: packageMapping ? 'PRAVIA_PACKAGE_V1' : (mapping[item.source_field] || null) })),
      }) as Preview;
      setSelected(next); await refresh();
    } catch (reason) { setError(errorMessage(reason, 'El mapeo no cumple las invariantes de migración.')); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try { await settingsService.approveMigration(selected.job.id); await openPreview(selected.job.id); await refresh(); }
    catch (reason) { setError(errorMessage(reason, 'No se pudo persistir la aprobación humana.')); setBusy(false); }
  };
  const execute = async () => {
    const selectedBackup = selected && backups.find((backup) => backup.scope === `MIGRATION_SOURCE:${selected.job.id}`);
    if (!selected || !selectedBackup) return;
    setBusy(true); setError('');
    try { await settingsService.executeMigration(selected.job.id, selectedBackup.id); setSelected(null); await refresh(); }
    catch (reason) { setError(errorMessage(reason, 'No se pudo encolar la migración.')); }
    finally { setBusy(false); }
  };

  if (!canRead) return null;
  const packageMapping = selected?.mappings.length === 1 && selected.mappings[0].source_field === 'pravia-migration.json';
  const selectedBackup = selected && backups.find((backup) => backup.scope === `MIGRATION_SOURCE:${selected.job.id}`);
  return <section className={styles.listCard} aria-labelledby="tenant-migrations-title">
    <header className={styles.exportHeader}><div><Database /><span><h3 id="tenant-migrations-title">Migraciones de la organización</h3><p>Carga reanudable, revisión humana, backup certificado y trazabilidad por tenant.</p></span></div>
      <Button variant="secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Actualizar</Button>
    </header>
    {canManage && <div className={styles.migrationComposer}>
      <label><span>Sistema de origen</span><input value={sourceSystem} maxLength={180} onChange={(event) => setSourceSystem(event.target.value)} /></label>
      <label><span>Archivo fuente</span><input ref={fileInput} type="file" accept=".csv,.xlsx,.zip,.rar" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <p>CSV de comparecientes y paquetes ZIP PRAVIA v1: importación con mapeo y aprobación. XLSX, RAR y otros ZIP: análisis e inventario para revisión; no se importan automáticamente.</p>
      <Button disabled={busy || !file || !sourceSystem.trim()} onClick={() => void upload()}><FileUp size={16} />Cargar y analizar</Button>
      {uploadProgress !== null && <div className={styles.migrationProgress} role="progressbar" aria-label="Progreso de carga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}><i style={{ width: `${uploadProgress}%` }} /><span>{uploadProgress}%</span></div>}
    </div>}
    {error && <p className={styles.exportError} role="alert"><AlertCircle size={15} />{error}</p>}
    {jobs.length ? <ul aria-live="polite">{jobs.map((job) => <li key={job.id} className={styles.exportRow}>
      <span><strong>{job.source_system}</strong><small>{statusLabels[job.status] || job.status} · {job.progress}% · {formatDate(job.created_at)}{job.detected_files ? ` · ${job.detected_files} archivos / ${job.detected_records} registros` : ''}</small></span>
      <Button variant="secondary" disabled={busy || ['UPLOADING', 'SCANNING', 'ANALYZING'].includes(job.status)} onClick={() => void openPreview(job.id)}>Revisar</Button>
    </li>)}</ul> : <div className={styles.empty}><Database /><span><strong>Sin migraciones</strong><small>No hay trabajos activos para esta organización.</small></span></div>}
    {selected && <div className={styles.migrationReview}>
      <div className={styles.reviewTitle}><span><strong>Vista previa · {selected.job.source_system}</strong><small>{statusLabels[selected.job.status] || selected.job.status}</small></span><button type="button" onClick={() => setSelected(null)} aria-label="Cerrar vista previa">×</button></div>
      <dl><div><dt>Archivos</dt><dd>{selected.assets.length}</dd></div><div><dt>Registros</dt><dd>{selected.job.detected_records}</dd></div><div><dt>Producción estimada</dt><dd>{formatBytes(selected.job.estimated_production_bytes)}</dd></div><div><dt>Capacidad</dt><dd>{selected.capacity?.sufficient ? 'Suficiente' : 'Insuficiente o no configurada'}</dd></div></dl>
      {selected.assets.length > 0 && <div className={styles.assetList}>{selected.assets.map((asset) => <span key={asset.id}><strong>{asset.source_path}</strong><small>{formatBytes(asset.size_bytes)} · {asset.scan_status} · {asset.status}{asset.error_code ? ` · ${asset.error_code}` : ''}</small></span>)}</div>}
      {selected.job.status === 'MAPPING_REQUIRED' && <div className={styles.mappingGrid}>
        {selected.mappings.map((item) => <label key={item.id}><span>{item.source_field}</span>{packageMapping
          ? <input value="Paquete PRAVIA v1" readOnly />
          : <select aria-label={`Destino para ${item.source_field}`} value={mapping[item.source_field] || ''} onChange={(event) => setMapping((current) => ({ ...current, [item.source_field]: event.target.value }))}><option value="">No importar</option><option value="source_id">ID de origen</option><option value="nombre">Nombre</option><option value="apellido">Apellido</option><option value="email">Correo</option><option value="telefono">Teléfono</option></select>}</label>)}
        <Button disabled={busy} onClick={() => void saveMapping()}>{packageMapping ? 'Validar paquete' : 'Guardar mapeo'}</Button>
      </div>}
      {selected.job.status === 'PREVIEW_READY' && !selected.job.approved_at && <div className={styles.migrationGate}><ShieldCheck /><span><strong>Aprobación humana requerida</strong><small>La ejecución sólo se habilita cuando el mapeo, capacidad y conflictos permiten aprobar.</small></span><Button disabled={busy || !selected.approvalAllowed} onClick={() => void approve()}>Aprobar migración</Button></div>}
      {selected.job.status === 'PREVIEW_READY' && selected.job.verification_json?.executionAvailable === false && <p role="status">Este formato quedó inventariado, pero requiere revisión del origen antes de importarse. No se ejecutará ni marcará como migrado.</p>}
      {selected.job.approved_at && <div className={styles.migrationGate}><CheckCircle2 /><span><strong>Aprobación persistida</strong><small>{selectedBackup ? `Backup y restore drill certificados para esta migración el ${formatDate(selectedBackup.latestRestoreDrill.tested_at)}.` : 'No existe un backup local certificado para ejecutar de forma segura.'}</small></span><Button disabled={busy || !selectedBackup} onClick={() => void execute()}>Ejecutar migración</Button></div>}
      {selected.job.verification_json && <details className={styles.verification}><summary>Verificación técnica</summary><pre>{JSON.stringify(selected.job.verification_json, null, 2)}</pre></details>}
    </div>}
  </section>;
}
