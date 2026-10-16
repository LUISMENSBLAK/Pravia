import { execFileSync } from 'node:child_process';
import { expect, request as requestFactory, test } from '@playwright/test';

const userId = 'ad819fc5-169d-4ef0-8b2a-b5e4340ce197';
const organizationId = '30000000-0000-4000-8000-000000000001';

function localSql(sql: string) {
  return execFileSync('docker', ['exec', 'pravia-new-lot-qa-20260926', 'psql', '-U', 'pravia', '-d', 'pravia_qa', '-Atc', sql],
    { encoding: 'utf8' }).trim();
}

test('Mi Día: revocar tarjeta fija oculta datos al usuario y bloquea PUT directo sin filtración', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const directorPassword = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !directorPassword) {
    throw new Error('MI_DIA_REVOCATION_LOCAL_ONLY');
  }
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const health = await api.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const directorLogin = await api.post('/api/auth/login', { data: {
    email: 'adrian.hernandez@pravia.test', password: directorPassword,
  } });
  expect(directorLogin.status()).toBe(200);
  const directorHeaders = { Authorization: `Bearer ${(await directorLogin.json() as { access_token: string }).access_token}` };
  const subjectHeaders = directorHeaders;
  const originalGrant = localSql(`SELECT enabled::text || '|' || max_scope FROM pravia_os.mi_dia_card_permissions
    WHERE organization_id='${organizationId}' AND user_id='${userId}' AND card_key='CASES'`);
  const readDirector = async () => {
    const response = await api.get('/api/mi-dia/config', { headers: directorHeaders });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: { tenantAdministration: {
      version: number; enabledCards: string[]; recommendedCards: string[];
      defaultLayout: Array<{ key: string; size: string; scope: string; parameters: Record<string, string | number>; fixed: boolean }>;
    } } }).data.tenantAdministration;
  };
  const original = await readDirector();
  const updateTenant = async (version: number, defaults: typeof original.defaultLayout) => {
    const response = await api.put('/api/mi-dia/tenant-config', { headers: directorHeaders, data: {
      version, enabled_cards: original.enabledCards, default_layout: defaults,
      fixed_cards: defaults.filter((item) => item.fixed).map((item) => item.key),
      recommended_cards: original.recommendedCards,
    } });
    expect(response.status()).toBe(200);
  };
  try {
    expect(original.defaultLayout.some((item) => item.key === 'CASES')).toBe(true);
    await updateTenant(original.version, original.defaultLayout.map((item) => item.key === 'CASES' ? { ...item, fixed: true } : item));
    await page.goto('/login');
    const email = page.getByRole('textbox', { name: 'Correo electrónico' });
    const password = page.getByRole('textbox', { name: 'Contraseña' });
    const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await email.fill('adrian.hernandez@pravia.test');
      await password.fill(directorPassword);
      if (await submit.isEnabled()) break;
    }
    await expect(email).toHaveValue('adrian.hernandez@pravia.test');
    await expect(password).toHaveValue(directorPassword);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    await expect(page.getByRole('heading', { name: 'Expedientes recientes', exact: true })).toBeVisible();
    const before = await api.get('/api/mi-dia/config', { headers: subjectHeaders });
    expect(before.status()).toBe(200);
    const prior = (await before.json() as { data: { layout: Array<{ key: string; size: string; scope: string }>;
      layoutVersion: number } }).data;
    expect(prior.layout.find((item) => item.key === 'CASES')).toMatchObject({ key: 'CASES', fixed: true });
    const beforeDashboard = await api.get('/api/mi-dia', { headers: subjectHeaders });
    expect(beforeDashboard.status()).toBe(200);
    expect((await beforeDashboard.json() as { operacion: { recientes: Array<unknown> } }).operacion.recientes.length).toBeGreaterThan(0);

    const revoked = await api.put(`/api/mi-dia/users/${userId}/cards`, { headers: directorHeaders, data: {
      card_key: 'CASES', enabled: false, max_scope: 'OWN',
    } });
    expect(revoked.status()).toBe(200);
    const deniedConfig = await api.get('/api/mi-dia/config', { headers: subjectHeaders });
    expect(deniedConfig.status()).toBe(200);
    const effective = (await deniedConfig.json() as { data: { layout: Array<{ key: string }>;
      catalog: Array<{ key: string }> } }).data;
    expect(effective.layout.some((item) => item.key === 'CASES')).toBe(false);
    expect(effective.catalog.some((item) => item.key === 'CASES')).toBe(false);
    const deniedDashboard = await api.get('/api/mi-dia', { headers: subjectHeaders });
    expect(deniedDashboard.status()).toBe(200);
    const dashboard = await deniedDashboard.json() as { operacion: { recientes: Array<unknown> } };
    expect(dashboard.operacion.recientes).toEqual([]);
    const forged = await api.put('/api/mi-dia/layout', { headers: subjectHeaders, data: {
      version: prior.layoutVersion, layout: prior.layout,
    } });
    expect(forged.status()).toBe(403);
    expect((await forged.json() as { code: string }).code).toBe('MIDIA_CARD_DENIED');
    const refetch = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/config') && response.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await refetch).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Expedientes recientes', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Expedientes recientes', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    await expect(page.getByRole('button', { name: /Expedientes recientes Operación/ })).toHaveCount(0);
  } finally {
    const existing = await readDirector();
    await updateTenant(existing.version, original.defaultLayout);
    if (originalGrant) {
      const [enabled, maxScope] = originalGrant.split('|');
      const restored = await api.put(`/api/mi-dia/users/${userId}/cards`, { headers: directorHeaders, data: {
        card_key: 'CASES', enabled: enabled === 'true', max_scope: maxScope,
      } });
      expect(restored.status()).toBe(200);
    } else {
      localSql(`DELETE FROM pravia_os.mi_dia_card_permissions WHERE organization_id='${organizationId}'
        AND user_id='${userId}' AND card_key='CASES'`);
    }
    await api.dispose();
  }
});
