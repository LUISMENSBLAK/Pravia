import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { signInLocalControlPlane } from './helpers/controlPlaneLogin';

test('tenant admin uploads, maps and approves a streamed migration in Chrome', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const database = new URL(process.env.DATABASE_URL || 'http://invalid.invalid');
  if (base.hostname !== '127.0.0.1' || base.port !== '4176'
    || database.hostname !== '127.0.0.1' || process.env.STORAGE_MODE !== 'local'
    || process.env.PRAVIA_PLATFORM_WORKER_ENABLE !== '1'
    || !process.env.PRAVIA_E2E_PASSWORD) {
    throw new Error('CONTROL_PLANE_BROWSER_QA_LOCAL_ONLY');
  }

  await signInLocalControlPlane(page, process.env.PRAVIA_E2E_PASSWORD);

  await page.goto('/configuracion/plan-consumo');
  const migrations = page.getByRole('region', { name: 'Migraciones de la organización' });
  await expect(migrations).toBeVisible();
  const source = `Chrome QA ${Date.now()}`;
  await migrations.getByLabel('Sistema de origen').fill(source);
  await migrations.getByLabel('Archivo fuente').setInputFiles({
    name: 'comparecientes-qa.csv', mimeType: 'text/csv',
    buffer: Buffer.from('nombre,email\nPersona QA,persona.qa@example.test\n', 'utf8'),
  });
  const creation = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/api/platform/migrations'));
  await migrations.getByRole('button', { name: 'Cargar y analizar' }).click();
  const jobId = String((await (await creation).json()).id);
  expect(jobId).toMatch(/^[0-9a-f-]{36}$/i);
  const row = migrations.locator('li').filter({ hasText: source }).first();
  await expect(row).toContainText(/Escaneando|Analizando|Requiere mapeo/);

  const backend = path.resolve(process.cwd(), '../backend');
  // The isolated QA database may retain older cleanup jobs. A single worker
  // batch need not contain this upload, so wait for its persisted state.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    execFileSync(path.join(backend, 'node_modules/.bin/ts-node'),
      ['--transpile-only', 'scripts/platform-worker.ts', '--once'],
      { cwd: backend, env: process.env, timeout: 120_000, stdio: 'pipe' });
    await page.reload();
    if ((await migrations.locator('li').filter({ hasText: source }).first().textContent())?.includes('Requiere mapeo')) break;
  }
  const refreshedMigrations = page.getByRole('region', { name: 'Migraciones de la organización' });
  const refreshedRow = refreshedMigrations.locator('li').filter({ hasText: source }).first();
  await expect(refreshedRow).toContainText('Requiere mapeo');
  await refreshedRow.getByRole('button', { name: 'Revisar' }).click();
  await expect(refreshedMigrations.getByText('Registros').first()).toBeVisible();
  await expect(refreshedMigrations.getByLabel('Destino para nombre')).toHaveValue('nombre');
  await expect(refreshedMigrations.getByLabel('Destino para email')).toHaveValue('email');
  await refreshedMigrations.getByRole('button', { name: 'Guardar mapeo' }).click();
  await expect(refreshedMigrations.getByText('Aprobación humana requerida')).toBeVisible();
  await refreshedMigrations.getByRole('button', { name: 'Aprobar migración' }).click();
  await expect(refreshedMigrations.getByText('Aprobación persistida')).toBeVisible();
  await expect(refreshedMigrations.getByRole('button', { name: 'Ejecutar migración' })).toBeDisabled();
  await expect(refreshedMigrations.getByText('No existe un backup local certificado para ejecutar de forma segura.')).toBeVisible();

  const backupOutput = execFileSync(path.join(backend, 'node_modules/.bin/ts-node'),
    ['--transpile-only', 'scripts/qa-backup-migration-source.ts', jobId],
    { cwd: backend, env: { ...process.env, NODE_ENV: 'test' }, timeout: 120_000, encoding: 'utf8', stdio: 'pipe' });
  const backup = JSON.parse(backupOutput.trim()) as { backupId: string; jobId: string; sourceSha256: string };
  expect(backup.jobId).toBe(jobId);
  expect(backup.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  await page.reload();
  const readyMigrations = page.getByRole('region', { name: 'Migraciones de la organización' });
  const readyRow = readyMigrations.locator('li').filter({ hasText: source }).first();
  await readyRow.getByRole('button', { name: 'Revisar' }).click();
  await expect(readyMigrations.getByRole('button', { name: 'Ejecutar migración' })).toBeEnabled();
  await readyMigrations.getByRole('button', { name: 'Ejecutar migración' }).click();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    execFileSync(path.join(backend, 'node_modules/.bin/ts-node'),
      ['--transpile-only', 'scripts/platform-worker.ts', '--once'],
      { cwd: backend, env: process.env, timeout: 120_000, stdio: 'pipe' });
    await page.reload();
    if ((await page.getByRole('region', { name: 'Migraciones de la organización' })
      .locator('li').filter({ hasText: source }).first().textContent())?.includes('Completada')) break;
  }
  const completedRow = page.getByRole('region', { name: 'Migraciones de la organización' })
    .locator('li').filter({ hasText: source }).first();
  await expect(completedRow).toContainText('Completada');
  await completedRow.getByRole('button', { name: 'Revisar' }).click();
  const completedReview = page.getByRole('region', { name: 'Migraciones de la organización' });
  await completedReview.getByText('Verificación técnica').click();
  const verification = JSON.parse(await completedReview.locator('pre').textContent() || '{}') as Record<string, unknown>;
  expect(verification).toMatchObject({ importedRecords: 1, provenanceRecords: 1, backupConfirmed: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Migraciones de la organización' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
