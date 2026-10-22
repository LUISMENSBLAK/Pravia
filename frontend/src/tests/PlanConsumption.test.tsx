import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ planConsumption: vi.fn(), tenantExports: vi.fn(),
  createTenantExport: vi.fn(), tenantExportDownload: vi.fn(), tenantMigrations: vi.fn(),
  certifiedMigrationBackups: vi.fn(), createTenantMigration: vi.fn(), createMigrationUpload: vi.fn(),
  uploadMigrationPart: vi.fn(), completeMigrationUpload: vi.fn(), migrationPreview: vi.fn(),
  submitMigrationMapping: vi.fn(), approveMigration: vi.fn(), executeMigration: vi.fn() }));
vi.mock('../features/settings/settings.service', () => ({ settingsService: api }));

import { PlanConsumptionSection } from '../features/settings/PlanConsumptionSection';

const fixture = () => ({
  subscription: {
    subscription: { status: 'ACTIVE', current_period_end: null },
    plan: { name: 'PRAVIA Base', monthly_price_minor: null, currency: 'MXN', included_storage_bytes: '53687091200' },
  },
  storage: {
    includedBytes: '53687091200', addonBytes: '0', capacityBytes: '53687091200',
    productionBytes: '1048576', temporaryBytes: '2048', reservedBytes: '0',
    availableBytes: '53686042624', utilizationBasisPoints: 0,
    addons: [], alerts: [],
  },
  ai: {
    wallet: { currency: 'MXN', balance_minor: '300000', reserved_minor: '0', available_minor: '300000', status: 'ACTIVE' },
    history: [{ id: 'promo', type: 'PROMO_CREDIT', amount_minor: '300000', created_at: '2026-10-16T00:00:00.000Z' }],
  },
  billing: { cycles: [] }, migrations: { jobs: [] },
});

describe('Plan y consumo · datos reales del read model', () => {
  beforeEach(() => { vi.clearAllMocks(); api.tenantMigrations.mockResolvedValue({ jobs: [] }); api.certifiedMigrationBackups.mockResolvedValue([]); });

  it('muestra capacidad, saldo y precio pendiente sin inventar cobros', async () => {
    api.planConsumption.mockResolvedValue(fixture());
    render(<PlanConsumptionSection />);
    expect(await screen.findByRole('heading', { name: 'PRAVIA Base' })).toBeInTheDocument();
    expect(screen.getByText('Configuración comercial pendiente')).toBeInTheDocument();
    expect(screen.getByText('1 MB')).toBeInTheDocument();
    expect(screen.getAllByText('50 GB')).toHaveLength(2);
    expect(screen.getByText('Sin ciclos facturados')).toBeInTheDocument();
    expect(screen.queryByText('Sin migraciones')).not.toBeInTheDocument();
    expect(api.planConsumption).toHaveBeenCalledTimes(1);
  });

  it('distingue un error real de un estado vacío y permite reintentar', async () => {
    api.planConsumption.mockRejectedValueOnce(new Error('Servicio temporalmente no disponible')).mockResolvedValueOnce(fixture());
    render(<PlanConsumptionSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio temporalmente no disponible');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'PRAVIA Base' })).toBeInTheDocument();
    expect(api.planConsumption).toHaveBeenCalledTimes(2);
  });

  it('solicita una exportación autorizada y prepara la descarga de un artefacto completado', async () => {
    api.planConsumption.mockResolvedValue(fixture());
    api.tenantExports.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 'export-qa', status: 'COMPLETED', progress: 100,
      created_at: '2026-10-18T00:00:00.000Z', expires_at: '2026-10-25T00:00:00.000Z',
    }]);
    api.createTenantExport.mockResolvedValue({ id: 'export-qa' });
    api.tenantExportDownload.mockResolvedValue({ url: 'https://storage.example.test/signed-export',
      expiresAt: '2026-10-25T00:00:00.000Z', sizeBytes: '512' });
    render(<PlanConsumptionSection canReadExports canManageExports />);
    await userEvent.click(await screen.findByRole('button', { name: 'Solicitar exportación' }));
    expect(api.createTenantExport).toHaveBeenCalledTimes(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Preparar descarga' }));
    expect(api.tenantExportDownload).toHaveBeenCalledWith('export-qa');
    expect(screen.getByRole('link', { name: 'Abrir descarga' })).toHaveAttribute('href', 'https://storage.example.test/signed-export');
  });

  it('muestra el control de migración sólo con permiso y no habilita ejecución sin backup certificado', async () => {
    api.planConsumption.mockResolvedValue(fixture());
    api.certifiedMigrationBackups.mockResolvedValue([{
      id: 'backup-other-job', scope: 'MIGRATION_SOURCE:other-job', provider: 'QA_LOCAL',
      completed_at: '2026-10-18T00:00:00.000Z', bytes: '128',
      latestRestoreDrill: { tested_at: '2026-10-18T00:01:00.000Z', result: 'PASS', sample_count: 1 },
    }]);
    api.tenantMigrations.mockResolvedValue({ jobs: [{
      id: 'migration-qa', source_system: 'Sistema legado', status: 'PREVIEW_READY', progress: 80,
      declared_bytes: '128', temporary_bytes: '128', estimated_production_bytes: '64',
      detected_files: 1, detected_records: 2, duplicate_files: 0, corrupt_files: 0, dangerous_files: 0,
      created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z',
    }] });
    api.migrationPreview.mockResolvedValue({
      job: { id: 'migration-qa', source_system: 'Sistema legado', status: 'PREVIEW_READY', progress: 80,
        estimated_production_bytes: '64', detected_records: 2, approved_at: '2026-10-18T00:10:00.000Z', verification_json: {} },
      assets: [], mappings: [{ id: 'map-1', source_field: 'nombre', target_field: 'nombre', entity_type: 'COMPARECIENTE', status: 'APPROVED' }],
      conflicts: [], capacity: { requiredBytes: '64', availableBytes: '1024', sufficient: true },
      pricing: { configured: false }, approvalAllowed: true,
    });
    render(<PlanConsumptionSection canReadMigrations canManageMigrations />);
    expect(await screen.findByRole('heading', { name: 'Migraciones de la organización' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    expect(await screen.findByText('No existe un backup local certificado para ejecutar de forma segura.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ejecutar migración' })).toBeDisabled();
  });

  it('sólo ofrece el backup certificado del job exacto para ejecutar', async () => {
    api.planConsumption.mockResolvedValue(fixture());
    api.tenantMigrations.mockResolvedValue({ jobs: [{
      id: 'migration-qa', source_system: 'Sistema legado', status: 'PREVIEW_READY', progress: 80,
      declared_bytes: '128', temporary_bytes: '128', estimated_production_bytes: '64',
      detected_files: 1, detected_records: 2, duplicate_files: 0, corrupt_files: 0, dangerous_files: 0,
      created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z',
    }] });
    api.certifiedMigrationBackups.mockResolvedValue([
      { id: 'unrelated', scope: 'MIGRATION_SOURCE:other-job', provider: 'QA_LOCAL',
        completed_at: '2026-10-18T00:00:00.000Z', bytes: '128',
        latestRestoreDrill: { tested_at: '2026-10-18T00:01:00.000Z', result: 'PASS', sample_count: 1 } },
      { id: 'exact', scope: 'MIGRATION_SOURCE:migration-qa', provider: 'QA_LOCAL',
        completed_at: '2026-10-18T00:02:00.000Z', bytes: '128',
        latestRestoreDrill: { tested_at: '2026-10-18T00:03:00.000Z', result: 'PASS', sample_count: 1 } },
    ]);
    api.migrationPreview.mockResolvedValue({
      job: { id: 'migration-qa', source_system: 'Sistema legado', status: 'PREVIEW_READY', progress: 80,
        estimated_production_bytes: '64', detected_records: 2, approved_at: '2026-10-18T00:10:00.000Z', verification_json: {} },
      assets: [], mappings: [], conflicts: [],
      capacity: { requiredBytes: '64', availableBytes: '1024', sufficient: true },
      pricing: { configured: false }, approvalAllowed: true,
    });
    api.executeMigration.mockResolvedValue({ id: 'queued' });
    render(<PlanConsumptionSection canReadMigrations canManageMigrations />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ejecutar migración' }));
    expect(api.executeMigration).toHaveBeenCalledWith('migration-qa', 'exact');
  });
});
