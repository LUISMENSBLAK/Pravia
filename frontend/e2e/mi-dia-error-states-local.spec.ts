import { expect, request as requestFactory, test } from '@playwright/test';

test('Mi Día: error parcial y error general no reutilizan importes o listas antiguas', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_ERROR_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json() as { access_token: string }).access_token}` };
  expect((await api.delete('/api/mi-dia/layout', { headers })).status()).toBe(200);
  try {
    await page.goto('/login');
    const email = page.getByRole('textbox', { name: 'Correo electrónico' });
    const secret = page.getByRole('textbox', { name: 'Contraseña' });
    const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await email.fill('adrian.hernandez@pravia.test');
      await secret.fill(password);
      if (await submit.isEnabled()) break;
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    const cases = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Expedientes recientes', exact: true }) }).first();
    const receivable = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Por cobrar', exact: true }) }).first();
    await expect(cases.locator('li').first()).toBeVisible();
    await expect(receivable).toContainText('$');

    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    const addSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('region', { name: 'Personalizar Mi Día' })
      .getByRole('button', { name: /^Ingreso cobrado Finanzas ·/ }).click();
    expect((await addSave).status()).toBe(200);
    const collected = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ingreso cobrado', exact: true }) }).first();
    await expect(collected).toBeVisible();
    await page.route('**/api/mi-dia', async (route) => {
      const response = await route.fetch();
      const json = await response.json() as { operacion: { finanzas_cards: Record<string, unknown> }; errors: Record<string, string> };
      json.operacion.finanzas_cards.INCOME_COLLECTED = null;
      json.errors.INCOME_COLLECTED = 'Fallo QA aislado de fuente financiera';
      await route.fulfill({ response, json });
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pravia:data-changed')));
    await expect(collected).toContainText('Fallo QA aislado de fuente financiera');
    await expect(cases.locator('li').first()).toBeVisible();
    await expect(receivable).toContainText('$');
    await page.unroute('**/api/mi-dia');

    await page.route('**/api/mi-dia', (route) => route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'QA_SOURCE_DOWN', error: 'Fuente QA indisponible' }) }));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pravia:data-changed')));
    await expect(cases.getByText(/No pudimos cargar|No fue posible/)).toBeVisible();
    await expect(cases.locator('li')).toHaveCount(0);
    await expect(receivable).toContainText('No pudimos cargar el saldo.');
    await expect(receivable).not.toContainText('$');
    await page.unroute('**/api/mi-dia');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pravia:data-changed')));
    await expect(cases.locator('li').first()).toBeVisible();
    await expect(receivable).toContainText('$');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    expect((await api.delete('/api/mi-dia/layout', { headers })).status()).toBe(200);
    await api.dispose();
  }
});

test('Mi Día: cero real de expedientes propios se distingue de error y de Sin información', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_MARIA_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_ZERO_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email: 'maria.careaga@pravia.test', password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json() as { access_token: string }).access_token}` };
  const dashboardResponse = await api.get('/api/mi-dia', { headers });
  expect(dashboardResponse.status()).toBe(200);
  const dashboard = await dashboardResponse.json() as { operacion: { recientes: Array<unknown> }; errors: Record<string, string> };
  expect(dashboard.operacion.recientes).toEqual([]);
  expect(dashboard.errors.recentFiles).toBeUndefined();
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const secret = page.getByRole('textbox', { name: 'Contraseña' });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await email.fill('maria.careaga@pravia.test');
    await secret.fill(password);
    if (await submit.isEnabled()) break;
  }
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cases = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Expedientes recientes', exact: true }) }).first();
  await expect(cases).toContainText('No hay expedientes recientes.');
  await expect(cases).not.toContainText('No pudimos');
  await page.reload();
  await expect(cases).toContainText('No hay expedientes recientes.');
  await api.dispose();
});
