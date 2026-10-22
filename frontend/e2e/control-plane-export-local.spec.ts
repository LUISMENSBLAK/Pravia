import { execFileSync } from 'node:child_process';
import path from 'node:path';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { signInLocalControlPlane } from './helpers/controlPlaneLogin';

test('tenant admin requests, resumes and downloads a verified local export in Chrome', async ({ page, request }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const database = new URL(process.env.DATABASE_URL || 'http://invalid.invalid');
  if (base.hostname !== '127.0.0.1' || base.port !== '4176'
    || database.hostname !== '127.0.0.1' || process.env.STORAGE_MODE !== 'local'
    || process.env.PRAVIA_PLATFORM_WORKER_ENABLE !== '1'
    || !process.env.PRAVIA_E2E_PASSWORD || !process.env.PRAVIA_E2E_DENIED_PASSWORD) {
    throw new Error('CONTROL_PLANE_BROWSER_QA_LOCAL_ONLY');
  }

  expect((await request.get('/api/platform/exports')).status()).toBe(401);
  const restrictedLogin = await request.post('/api/auth/login', { data: {
    email: 'qa.exportdenied@pravia.test', password: process.env.PRAVIA_E2E_DENIED_PASSWORD,
  } });
  expect(restrictedLogin.status()).toBe(200);
  const restrictedToken = (await restrictedLogin.json()).access_token as string;
  expect(restrictedToken).toBeTruthy();
  const restrictedHeaders = { Authorization: `Bearer ${restrictedToken}` };
  expect((await request.get('/api/platform/exports', { headers: restrictedHeaders })).status()).toBe(403);
  expect((await request.post('/api/platform/exports', { headers: restrictedHeaders, data: {} })).status()).toBe(403);
  await signInLocalControlPlane(page, process.env.PRAVIA_E2E_PASSWORD);

  await page.goto('/configuracion/plan-consumo');
  const exportsSection = page.getByRole('region', { name: 'Exportaciones de la organización' });
  await expect(exportsSection.getByRole('button', { name: 'Solicitar exportación' })).toBeVisible();
  await exportsSection.getByRole('button', { name: 'Solicitar exportación' }).click();
  const latestExport = exportsSection.locator('li').first();
  await expect(latestExport.getByText('Pendiente · 0%', { exact: false })).toBeVisible();

  const backend = path.resolve(process.cwd(), '../backend');
  // A reused isolated QA database can contain older cleanup jobs. Drain only
  // bounded local worker batches until this export is actually completed.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    execFileSync(path.join(backend, 'node_modules/.bin/ts-node'),
      ['--transpile-only', 'scripts/platform-worker.ts', '--once'],
      { cwd: backend, env: process.env, timeout: 120_000, stdio: 'pipe' });
    await page.reload();
    if (await latestExport.getByRole('button', { name: 'Preparar descarga' }).count()) break;
  }
  await expect(latestExport.getByRole('button', { name: 'Preparar descarga' })).toBeVisible();
  await latestExport.getByRole('button', { name: 'Preparar descarga' }).click();
  const href = await latestExport.getByRole('link', { name: 'Abrir descarga' }).getAttribute('href');
  expect(href).toContain('/api/storage/local?');
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  const archive = await JSZip.loadAsync(await response.body());
  const manifest = JSON.parse(await archive.file('manifest.json')!.async('text')) as {
    export_schema_version: number; organizationId: string; files: Array<{ path: string; sha256: string }>;
  };
  expect(manifest.export_schema_version).toBe(1);
  expect(manifest.organizationId).toBe('99999999-0000-4000-8000-000000000101');
  expect(manifest.files.length).toBeGreaterThan(10);
  expect(archive.file('data/usuarios.csv')).not.toBeNull();
});
