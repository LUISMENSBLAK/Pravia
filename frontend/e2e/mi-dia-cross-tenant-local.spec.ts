import { execFileSync } from 'node:child_process';
import { expect, request as requestFactory, test } from '@playwright/test';

function localSql(sql: string) {
  return execFileSync('docker', ['exec', 'pravia-new-lot-qa-20260926', 'psql', '-U', 'pravia', '-d', 'pravia_qa', '-Atc', sql],
    { encoding: 'utf8' }).trim();
}

test('Mi Día: dos notarías QA aíslan layout, tarjetas, expediente y permisos de usuario', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_TENANT_LOCAL_ONLY');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const foreignEmail = localSql("SELECT email FROM pravia_os.users WHERE email LIKE 'archive-tenant-b-%@pravia.test' ORDER BY created_at DESC LIMIT 1");
  expect(foreignEmail).toMatch(/^archive-tenant-b-\d+@pravia\.test$/);
  const foreignSuffix = foreignEmail.slice('archive-tenant-b-'.length, -'@pravia.test'.length);
  const foreignPassword = `Synthetic-Archive-B-${foreignSuffix}!`;
  const foreignUserId = localSql(`SELECT id FROM pravia_os.users WHERE email='${foreignEmail}'`);
  expect(foreignUserId).toMatch(/^[0-9a-f-]{36}$/);
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = async (email: string, secret: string) => {
    const response = await api.post('/api/auth/login', { data: { email, password: secret } });
    expect(response.status()).toBe(200);
    return { Authorization: `Bearer ${(await response.json() as { access_token: string }).access_token}` };
  };
  const a = await login('adrian.hernandez@pravia.test', password);
  const b = await login(foreignEmail, foreignPassword);
  const readConfig = async (headers: typeof a) => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: { layout: Array<{ key: string; size: string; scope: string; parameters: Record<string, string | number> }>;
      layoutVersion: number; tenantVersion: number } }).data;
  };
  const readDashboard = async (headers: typeof a) => {
    const response = await api.get('/api/mi-dia', { headers });
    expect(response.status()).toBe(200);
    return await response.json() as { operacion: { recientes: Array<{ id: string }> } };
  };
  expect((await api.delete('/api/mi-dia/layout', { headers: a })).status()).toBe(200);
  try {
    const beforeB = await readConfig(b);
    const dashboardA = await readDashboard(a);
    const dashboardB = await readDashboard(b);
    const aCase = dashboardA.operacion.recientes[0]?.id;
    const bCase = dashboardB.operacion.recientes[0]?.id;
    expect(aCase).toMatch(/^[0-9a-f-]{36}$/);
    expect(bCase).toMatch(/^[0-9a-f-]{36}$/);
    expect(dashboardA.operacion.recientes.map((item) => item.id)).not.toContain(bCase);
    expect(dashboardB.operacion.recientes.map((item) => item.id)).not.toContain(aCase);
    expect([403, 404]).toContain((await api.get(`/api/expedientes/${bCase}`, { headers: a })).status());
    expect([403, 404]).toContain((await api.get(`/api/expedientes/${aCase}`, { headers: b })).status());

    const beforeA = await readConfig(a);
    expect(beforeA.layout.some((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(false);
    const savedA = await api.put('/api/mi-dia/layout', { headers: a, data: {
      version: beforeA.layoutVersion,
      layout: [...beforeA.layout, { key: 'FOLLOWUP_REMINDERS', size: 'M', scope: 'ORGANIZATION', parameters: {} }],
    } });
    expect(savedA.status()).toBe(200);
    expect((await readConfig(a)).layout.some((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(true);
    const afterB = await readConfig(b);
    expect(afterB.layout).toEqual(beforeB.layout);
    expect(afterB.layoutVersion).toBe(beforeB.layoutVersion);
    expect(afterB.tenantVersion).toBe(beforeB.tenantVersion);
    const forgedGrant = await api.put(`/api/mi-dia/users/${foreignUserId}/cards`, { headers: a,
      data: { card_key: 'CASES', enabled: false, max_scope: 'OWN' } });
    expect(forgedGrant.status()).toBe(404);
    expect((await readDashboard(b)).operacion.recientes.map((item) => item.id)).toContain(bCase);
  } finally {
    expect((await api.delete('/api/mi-dia/layout', { headers: a })).status()).toBe(200);
    await api.dispose();
  }
});
