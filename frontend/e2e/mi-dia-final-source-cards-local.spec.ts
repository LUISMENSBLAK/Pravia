import { expect, request as requestFactory, test } from '@playwright/test';

test('cinco tarjetas finales: fuente real, ausencia honesta, reload y móvil', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) {
    throw new Error('MI_DIA_FINAL_CARDS_LOCAL_ONLY');
  }
  const email = 'adrian.hernandez@pravia.test';
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email, password } });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const getConfig = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: any }).data;
  };
  const original = await getConfig();
  const keys = ['ADVANCES_PENDING', 'PRODUCTION_VALUE', 'CURRENT_BOOK', 'FOLIOS_LEFT', 'APPENDIX_PENDING'];
  const tenant = original.tenantAdministration;
  if (!tenant) throw new Error('MI_DIA_FINAL_CARDS_NEEDS_LOCAL_TENANT_ADMIN');
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
      .map((key) => {
        const card = configured.catalog.find((item: any) => item.key === key);
        if (!card) throw new Error(`MI_DIA_CARD_NOT_AVAILABLE_${key}`);
        return { key, size: card.defaultSize,
          scope: card.allowedScopes.includes('ORGANIZATION') && key !== 'PRODUCTION_VALUE'
            && key !== 'ADVANCES_PENDING' ? 'ORGANIZATION' : 'OWN', parameters: {} };
      });
    const layoutUpdate = await api.put('/api/mi-dia/layout', { headers, data: {
      version: configured.layoutVersion, layout: [...configured.layout, ...additions],
    } });
    expect(layoutUpdate.status()).toBe(200);

    await page.goto('/login');
    const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
    const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
    const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await page.waitForTimeout(100);
      if (await emailInput.inputValue() === email && await passwordInput.inputValue() === password) break;
    }
    await expect(emailInput).toHaveValue(email);
    await expect(passwordInput).toHaveValue(password);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    for (const name of ['Anticipos pendientes', 'Valor de producción', 'Libro/Tomo actual',
      'Folios restantes', 'Apéndices pendientes']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    const card = (name: string) => page.locator('section').filter({
      has: page.getByRole('heading', { name, exact: true }),
    }).first();
    await expect(card('Anticipos pendientes').getByText(/Sin información: falta el anticipo requerido/)).toBeVisible();
    await expect(card('Libro/Tomo actual').getByText(/Sin información: Archivo no tiene configurado/)).toBeVisible();
    await expect(card('Folios restantes').getByText(/Sin información: Archivo no tiene un rango/)).toBeVisible();
    await expect(card('Apéndices pendientes').getByText(/Sin información: Archivo no determina/)).toBeVisible();
    const dashboardResponse = await api.get('/api/mi-dia', { headers });
    expect(dashboardResponse.status()).toBe(200);
    const dashboard = await dashboardResponse.json() as { operacion: {
      finanzas_cards: Record<string, { count: number; amount: string; available?: boolean;
        items: Array<{ amount: string; href: string }> }>;
      archivo_cards: Record<string, { available: boolean; value: string | null }>;
    } };
    expect(dashboard.operacion.finanzas_cards.ADVANCES_PENDING.available).toBe(false);
    expect(dashboard.operacion.archivo_cards.FOLIOS_LEFT.value).toBeNull();
    const production = dashboard.operacion.finanzas_cards.PRODUCTION_VALUE;
    if (production.available !== false) {
      expect(production.items).toHaveLength(production.count);
      const itemCents = production.items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
      expect(itemCents).toBe(Math.round(Number(production.amount) * 100));
      expect(production.items.every((item) => /^\/expedientes\/[0-9a-f-]+#finanzas$/i.test(item.href))).toBe(true);
    }
    if (production.available === false) await expect(card('Valor de producción').getByText(/Sin información/)).toBeVisible();
    else if (production.count === 0) await expect(card('Valor de producción').getByText(/No hay expedientes firmados/)).toBeVisible();
    else await expect(card('Valor de producción').getByText(new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Number(production.amount)), { exact: false })).toBeVisible();

    await page.reload();
    await expect(card('Anticipos pendientes').getByText(/Sin información/)).toBeVisible();
    await expect(card('Apéndices pendientes').getByText(/Sin información/)).toBeVisible();
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    const period = page.getByRole('combobox', { name: 'Periodo de Valor de producción' });
    await expect(period.locator('option')).toHaveCount(3);
    await period.selectOption('YEAR');
    await expect(period).toHaveValue('YEAR');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ['Anticipos pendientes', 'Valor de producción', 'Libro/Tomo actual',
        'Folios restantes', 'Apéndices pendientes']) {
        await expect(card(name)).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally {
    // Restore the synthetic QA tenant and personal layout, preserving the prior local review state.
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
