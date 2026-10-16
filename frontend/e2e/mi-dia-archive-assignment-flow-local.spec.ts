import { expect, request as requestFactory, test } from '@playwright/test';

test('X16 · asignación real en Archivo actualiza Mi Día y persiste tras recarga', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) {
    throw new Error('MI_DIA_ARCHIVE_ASSIGNMENT_LOCAL_ONLY');
  }
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: {
    email: 'adrian.hernandez@pravia.test', password,
  } });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const getConfig = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: any }).data;
  };
  const original = await getConfig();
  const tenant = original.tenantAdministration;
  expect(tenant).toBeTruthy();
  const keys = ['NEXT_DEED', 'NEXT_FOLIO', 'DEEDS_TODAY'];
  try {
    const tenantUpdate = await api.put('/api/mi-dia/tenant-config', { headers, data: {
      version: tenant.version,
      enabled_cards: [...new Set([...tenant.enabledCards, ...keys])],
      default_layout: tenant.defaultLayout,
      fixed_cards: tenant.defaultLayout.filter((item: any) => item.fixed).map((item: any) => item.key),
      recommended_cards: tenant.recommendedCards,
    } });
    expect(tenantUpdate.status()).toBe(200);
    const configured = await getConfig();
    const additions = keys.filter((key) => !configured.layout.some((item: any) => item.key === key))
      .map((key) => ({ key, size: configured.catalog.find((item: any) => item.key === key).defaultSize,
        scope: 'ORGANIZATION', parameters: {} }));
    const layoutUpdate = await api.put('/api/mi-dia/layout', { headers, data: {
      version: configured.layoutVersion, layout: [...configured.layout, ...additions],
    } });
    expect(layoutUpdate.status()).toBe(200);

    const beforeArchiveResponse = await api.get('/api/archivo', { headers });
    expect(beforeArchiveResponse.status()).toBe(200);
    const beforeArchive = await beforeArchiveResponse.json() as {
      next_numero_escritura: string | null; next_folio: string | null;
    };
    expect(beforeArchive.next_numero_escritura).toMatch(/^\d+$/);
    expect(beforeArchive.next_folio).toMatch(/^\d+$/);
    const candidates = ['7fdf9137-2a49-4cbf-990a-4bf203e4f28f',
      '8647a5bc-2c99-47b9-9292-2d7d12c793ff',
      '506e92b0-e41d-447d-a1bd-f520ec633211',
      'ad282db4-1611-405e-9917-30b39087dd3a',
      '5f2e05fc-8d5f-421b-aea9-8456c290bbfd'];
    let expedienteId: string | null = null;
    for (const id of candidates) {
      const response = await api.get(`/api/expedientes/${id}/archivo`, { headers });
      if (response.status() !== 200) continue;
      const value = await response.json() as { record: unknown };
      if (!value.record) { expedienteId = id; break; }
    }
    expect(expedienteId, 'A synthetic local case without an Archivo assignment is required').toBeTruthy();

    await page.goto('/login');
    const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
    const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
    const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await emailInput.fill('adrian.hernandez@pravia.test');
      await passwordInput.fill(password);
      await page.waitForTimeout(100);
      if (await emailInput.inputValue() === 'adrian.hernandez@pravia.test'
        && await passwordInput.inputValue() === password && await submit.isEnabled()) break;
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    await page.goto(`/expedientes/${expedienteId}#archivo`);
    const form = page.getByRole('region', { name: 'Datos del instrumento' });
    await expect(form.getByRole('button', { name: 'Asignar escritura y folios' })).toBeVisible();
    await form.getByLabel('Número de escritura').fill(beforeArchive.next_numero_escritura!);
    await form.getByLabel('Folio inicial').fill(beforeArchive.next_folio!);
    await form.getByLabel('Folio final').fill(beforeArchive.next_folio!);
    const todayMexico = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    await form.getByLabel('Fecha de firma / instrumento').fill(todayMexico);
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/expedientes/${expedienteId}/archivo`)
      && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Asignar escritura y folios' }).click();
    expect((await saved).status()).toBe(201);
    await page.reload();
    await expect(page.getByRole('heading', { name: `Escritura ${beforeArchive.next_numero_escritura}` })).toBeVisible();

    const afterArchiveResponse = await api.get('/api/archivo', { headers });
    expect(afterArchiveResponse.status()).toBe(200);
    const afterArchive = await afterArchiveResponse.json() as typeof beforeArchive;
    expect(afterArchive.next_numero_escritura).toBe(String(BigInt(beforeArchive.next_numero_escritura!) + 1n));
    expect(afterArchive.next_folio).toBe(String(BigInt(beforeArchive.next_folio!) + 1n));
    const dashboardResponse = await api.get('/api/mi-dia', { headers });
    expect(dashboardResponse.status()).toBe(200);
    const dashboard = await dashboardResponse.json() as { operacion: { archivo_cards: Record<string, {
      value: string | null; items?: Array<{ href: string }>;
    }> } };
    expect(dashboard.operacion.archivo_cards.NEXT_DEED.value).toBe(afterArchive.next_numero_escritura);
    expect(dashboard.operacion.archivo_cards.NEXT_FOLIO.value).toBe(afterArchive.next_folio);
    expect(dashboard.operacion.archivo_cards.DEEDS_TODAY.items?.map((item) => item.href))
      .toContain(`/expedientes/${expedienteId}#archivo`);
    await page.goto('/mi-dia');
    const card = (name: string) => page.locator('section').filter({
      has: page.getByRole('heading', { name, exact: true }),
    }).first();
    await expect(card('Escritura siguiente').getByText(afterArchive.next_numero_escritura!, { exact: true })).toBeVisible();
    await expect(card('Folio siguiente').getByText(afterArchive.next_folio!, { exact: true })).toBeVisible();
    await expect(card('Escrituras asignadas hoy').getByRole('link', {
      name: new RegExp(`Escritura ${beforeArchive.next_numero_escritura}`),
    })).toHaveAttribute('href', `/expedientes/${expedienteId}#archivo`);
    await page.reload();
    await expect(card('Escritura siguiente').getByText(afterArchive.next_numero_escritura!, { exact: true })).toBeVisible();
  } finally {
    const current = await getConfig();
    const restoreLayout = original.personalized ? api.put('/api/mi-dia/layout', { headers,
      data: { version: current.layoutVersion, layout: original.layout } })
      : api.delete('/api/mi-dia/layout', { headers });
    expect((await restoreLayout).status()).toBe(200);
    const afterLayout = await getConfig();
    const restoreTenant = await api.put('/api/mi-dia/tenant-config', { headers, data: {
      version: afterLayout.tenantAdministration.version,
      enabled_cards: tenant.enabledCards,
      default_layout: tenant.defaultLayout,
      fixed_cards: tenant.defaultLayout.filter((item: any) => item.fixed).map((item: any) => item.key),
      recommended_cards: tenant.recommendedCards,
    } });
    expect(restoreTenant.status()).toBe(200);
    await api.dispose();
  }
});
