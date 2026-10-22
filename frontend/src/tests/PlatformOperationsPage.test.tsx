import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformOperationsPage } from '../features/settings/PlatformOperationsPage';
import { settingsService } from '../features/settings/settings.service';

vi.mock('../features/settings/settings.service', () => ({
  settingsService: { platformDashboard: vi.fn(), platformTenants: vi.fn() },
}));

const dashboard = {
  generatedAt: '2026-10-18T12:00:00.000Z', staleThresholdMinutes: 30,
  organizations: [{ status: 'ACTIVE', _count: 2 }],
  jobs: [{ status: 'RUNNING', _count: 1 }],
  migrations: [{ status: 'ANALYZING', _count: 1 }],
  exports: [],
  storage: { _sum: { production_bytes: '2048', temporary_bytes: '1024', reserved_bytes: '0' } },
  operations: {
    failedJobs: [{ id: 'job-1', organization_id: 'org-1', status: 'FAILED', job_type: 'EXPORT', attempts: 3, max_attempts: 3, created_at: '2026-10-18T10:00:00.000Z' }],
    stuckJobs: [], migrationIssues: [], exportIssues: [],
    temporaryStorage: [{ organization_id: 'org-1', temporary_bytes: '1024', updated_at: '2026-10-18T11:00:00.000Z' }],
    aiSpendAnomalies: [], backupIssues: [], billingWebhookIssues: [],
  },
};

describe('PlatformOperationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.platformDashboard).mockResolvedValue(dashboard);
    vi.mocked(settingsService.platformTenants).mockResolvedValue([{
      id: 'org-1', name: 'Notaría QA', status: 'ACTIVE', created_at: '2026-10-01T00:00:00.000Z',
      storage: null, aiWallet: null,
    }]);
  });

  it('presenta las ocho vistas operativas con metadatos de tenant y sin contenido documental', async () => {
    render(<PlatformOperationsPage />);
    expect(await screen.findByRole('heading', { name: 'Operación de plataforma' })).toBeInTheDocument();
    expect(screen.getAllByText('Notaría QA')).toHaveLength(2);
    expect(screen.getByText('Jobs fallidos')).toBeInTheDocument();
    expect(screen.getByText('Migraciones con atención')).toBeInTheDocument();
    expect(screen.getByText('Leases vencidos')).toBeInTheDocument();
    expect(screen.getByText('Almacenamiento temporal')).toBeInTheDocument();
    expect(screen.getByText('Exportaciones con atención')).toBeInTheDocument();
    expect(screen.getByText('Anomalías de costo IA')).toBeInTheDocument();
    expect(screen.getByText('Backups con atención')).toBeInTheDocument();
    expect(screen.getByText('Webhooks de facturación')).toBeInTheDocument();
    expect(screen.queryByText(/contenido de documento/i)).not.toBeInTheDocument();
  });

  it('vuelve a consultar ambos read models desde el control de actualización', async () => {
    const user = userEvent.setup();
    render(<PlatformOperationsPage />);
    expect(await screen.findAllByText('Notaría QA')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(settingsService.platformDashboard).toHaveBeenCalledTimes(2);
    expect(settingsService.platformTenants).toHaveBeenCalledTimes(2);
  });
});
