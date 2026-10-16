import { expect, request as requestFactory, test, type Page } from '@playwright/test';

type Layout = { key: string; size: string; scope: string; parameters: Record<string, string | number>; fixed: boolean };
type Tenant = { version: number; enabledCards: string[]; recommendedCards: string[]; defaultLayout: Layout[] };

test('Mi Día: dos pestañas y configuración concurrente rechazan versión obsoleta sin duplicar tarjetas', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_CONCURRENCY_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json() as { access_token: string }).access_token}` };
  const read = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: { layout: Layout[]; layoutVersion: number; tenantAdministration: Tenant } }).data;
  };
  const reset = await api.delete('/api/mi-dia/layout', { headers });
  expect(reset.status()).toBe(200);
  const originalTenant = (await read()).tenantAdministration;
  let other: Page | undefined;
  const loginUi = async (tab: Page) => {
    await tab.goto('/login');
    await tab.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
    await tab.getByRole('textbox', { name: 'Contraseña' }).fill(password);
    await tab.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(tab).toHaveURL(/\/mi-dia$/);
    await expect(tab.getByRole('heading', { name: 'Expedientes recientes', exact: true })).toBeVisible();
  };
  try {
    await loginUi(page);
    other = await page.context().newPage();
    await other.goto('/mi-dia');
    if (new URL(other.url()).pathname === '/login') await loginUi(other);
    await expect(other.getByRole('heading', { name: 'Expedientes recientes', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    await other.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('region', { name: 'Personalizar Mi Día' })
      .getByRole('button', { name: /^Recordatorios de seguimiento Agenda ·/ }).click();
    expect((await saved).status()).toBe(200);
    const rejected = other.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await other.getByRole('region', { name: 'Personalizar Mi Día' })
      .getByRole('button', { name: /^Prospectos activos Comercial ·/ }).click();
    const conflict = await rejected;
    expect(conflict.status()).toBe(409);
    expect((await conflict.json() as { code: string }).code).toBe('MIDIA_LAYOUT_CHANGED');
    await expect(other.getByText('No guardado', { exact: true })).toBeVisible();
    const afterConflict = await read();
    expect(afterConflict.layout.filter((item) => item.key === 'FOLLOWUP_REMINDERS')).toHaveLength(1);
    expect(afterConflict.layout.some((item) => item.key === 'PROSPECTS_ACTIVE')).toBe(false);
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Recordatorios de seguimiento', exact: true })).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Prospectos activos', exact: true })).toHaveCount(0);
    await other.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    const retry = other.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await other.getByRole('region', { name: 'Personalizar Mi Día' })
      .getByRole('button', { name: /^Prospectos activos Comercial ·/ }).click();
    expect((await retry).status()).toBe(200);
    const finalLayout = (await read()).layout;
    expect(finalLayout.filter((item) => item.key === 'FOLLOWUP_REMINDERS')).toHaveLength(1);
    expect(finalLayout.filter((item) => item.key === 'PROSPECTS_ACTIVE')).toHaveLength(1);

    const snapshot = await read();
    const duplicate = { version: snapshot.layoutVersion, layout: snapshot.layout };
    const [firstRetry, secondRetry] = await Promise.all([
      api.put('/api/mi-dia/layout', { headers, data: duplicate }),
      api.put('/api/mi-dia/layout', { headers, data: duplicate }),
    ]);
    expect([firstRetry.status(), secondRetry.status()].sort()).toEqual([200, 409]);
    const afterRetry = await read();
    expect(afterRetry.layoutVersion).toBe(snapshot.layoutVersion + 1);
    expect(afterRetry.layout.map((item) => item.key)).toEqual(finalLayout.map((item) => item.key));

    const current = (await read()).tenantAdministration;
    const payload = {
      version: current.version,
      enabled_cards: current.enabledCards,
      default_layout: current.defaultLayout,
      fixed_cards: current.defaultLayout.filter((item) => item.fixed).map((item) => item.key),
      recommended_cards: current.recommendedCards,
    };
    const [a, b] = await Promise.all([
      api.put('/api/mi-dia/tenant-config', { headers, data: payload }),
      api.put('/api/mi-dia/tenant-config', { headers, data: payload }),
    ]);
    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
    expect((await read()).tenantAdministration.version).toBe(current.version + 1);
  } finally {
    await other?.close();
    const current = (await read()).tenantAdministration;
    if (current.version !== originalTenant.version) {
      const restored = await api.put('/api/mi-dia/tenant-config', { headers, data: {
        version: current.version,
        enabled_cards: originalTenant.enabledCards,
        default_layout: originalTenant.defaultLayout,
        fixed_cards: originalTenant.defaultLayout.filter((item) => item.fixed).map((item) => item.key),
        recommended_cards: originalTenant.recommendedCards,
      } });
      expect(restored.status()).toBe(200);
    }
    expect((await api.delete('/api/mi-dia/layout', { headers })).status()).toBe(200);
    await api.dispose();
  }
});
