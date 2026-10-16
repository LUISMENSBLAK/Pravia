import { expect, request as requestFactory, test } from '@playwright/test';

test('Mi Día: configuración de notaría persiste habilitación, tablero inicial, recomendación, tamaño, orden y tarjeta fija', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_CONTROLS_LOCAL_ONLY');
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const secret = page.getByRole('textbox', { name: 'Contraseña' });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await email.fill('adrian.hernandez@pravia.test');
    await secret.fill(password);
    if (await submit.isEnabled()) break;
  }
  await expect(email).toHaveValue('adrian.hernandez@pravia.test');
  await expect(secret).toHaveValue(password);
  await expect(submit).toBeEnabled();
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await submit.click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  let token = (await login.json() as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const readConfig = async () => {
    let response = await page.request.get('/api/mi-dia/config', { headers });
    if (response.status() === 401) {
      const fresh = await page.request.post('/api/auth/login', {
        data: { email: 'adrian.hernandez@pravia.test', password },
      });
      expect(fresh.status()).toBe(200);
      token = (await fresh.json() as { access_token: string }).access_token;
      headers.Authorization = `Bearer ${token}`;
      response = await page.request.get('/api/mi-dia/config', { headers });
    }
    expect(response.status()).toBe(200);
    return (await response.json() as { data: { tenantAdministration: {
      version: number; enabledCards: string[]; recommendedCards: string[];
      defaultLayout: Array<{ key: string; size: string; scope: string; parameters: Record<string, string | number>; fixed: boolean }>;
    }; layoutVersion: number; layout: Array<{ key: string; fixed: boolean }> } }).data;
  };
  const initial = await readConfig();
  const original = initial.tenantAdministration;
  const key = 'FOLLOWUP_REMINDERS';
  const name = 'Recordatorios de seguimiento';
  expect(original.enabledCards).toContain(key);
  expect(original.defaultLayout.some((item) => item.key === key)).toBe(false);
  try {
    await page.getByRole('button', { name: 'Configurar notaría' }).click();
    const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
    const enabled = panel.getByRole('checkbox', { name: `${name}: habilitada` });
    await enabled.uncheck();
    const disabledSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
      && response.request().method() === 'PUT');
    await panel.getByRole('button', { name: 'Guardar configuración' }).click();
    expect((await disabledSave).status()).toBe(200);
    expect((await readConfig()).tenantAdministration.enabledCards).not.toContain(key);
    await enabled.check();
    await panel.getByRole('checkbox', { name: `${name}: en tablero inicial` }).check();
    await panel.getByRole('checkbox', { name: `${name}: recomendada` }).check();
    await panel.getByRole('checkbox', { name: `${name}: fija` }).check();
    const size = panel.getByRole('combobox', { name: `${name}: tamaño` });
    const originalSize = await size.inputValue();
    const alternateSize = (await size.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)))
      .find((value) => value !== originalSize);
    expect(alternateSize).toBeTruthy();
    await size.selectOption(alternateSize!);
    await panel.getByRole('button', { name: `Subir ${name}` }).click();
    await panel.getByRole('button', { name: `Bajar ${name}` }).click();
    await panel.getByRole('button', { name: `Subir ${name}` }).click();
    const enabledSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
      && response.request().method() === 'PUT');
    await panel.getByRole('button', { name: 'Guardar configuración' }).click();
    expect((await enabledSave).status()).toBe(200);
    const configured = await readConfig();
    const admin = configured.tenantAdministration;
    const item = admin.defaultLayout.find((row) => row.key === key);
    expect(admin.enabledCards).toContain(key);
    expect(admin.recommendedCards).toContain(key);
    expect(item).toMatchObject({ size: alternateSize, fixed: true });
    expect(admin.defaultLayout.findIndex((row) => row.key === key)).toBe(original.defaultLayout.length - 1);
    await page.reload();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    await expect(page.getByRole('button', { name: `Quitar ${name}` })).toHaveCount(0);
    const current = await readConfig();
    const attempted = await page.request.put('/api/mi-dia/layout', { headers, data: {
      version: current.layoutVersion,
      layout: current.layout.filter((row) => row.key !== key),
    } });
    expect(attempted.status()).toBe(409);
    expect((await attempted.json() as { code: string }).code).toBe('MIDIA_FIXED_CARD_REQUIRED');
  } finally {
    const latest = (await readConfig()).tenantAdministration;
    const restored = await page.request.put('/api/mi-dia/tenant-config', { headers, data: {
      version: latest.version,
      enabled_cards: original.enabledCards,
      default_layout: original.defaultLayout,
      fixed_cards: original.defaultLayout.filter((row) => row.fixed).map((row) => row.key),
      recommended_cards: original.recommendedCards,
    } });
    expect(restored.status()).toBe(200);
    const reset = await page.request.delete('/api/mi-dia/layout', { headers });
    expect(reset.status()).toBe(200);
  }
});

test('Mi Día: personalización aplica vista previa, orden, tamaño, alcance, retiro y reset con autosave real', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_PERSONAL_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const apiLogin = await api.post('/api/auth/login', { data: {
    email: 'adrian.hernandez@pravia.test', password,
  } });
  expect(apiLogin.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await apiLogin.json() as { access_token: string }).access_token}` };
  const readConfig = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: {
      layout: Array<{ key: string; size: string; scope: string; fixed: boolean }>;
      personalized: boolean;
    } }).data;
  };
  const reset = await api.delete('/api/mi-dia/layout', { headers });
  expect(reset.status()).toBe(200);
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
    const initial = await readConfig();
    expect(initial.layout.some((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(false);
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
    const name = 'Recordatorios de seguimiento';
    const add = editor.getByRole('button', { name: /^Recordatorios de seguimiento Agenda ·/ });
    const addedSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await add.click();
    expect((await addedSave).status()).toBe(200);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect((await readConfig()).layout.some((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(true);
    const size = page.getByRole('combobox', { name: `Tamaño de ${name}` });
    const originalSize = await size.inputValue();
    const alternate = (await size.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)))
      .find((value) => value !== originalSize);
    expect(alternate).toBeTruthy();
    const sizeSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await size.selectOption(alternate!);
    expect((await sizeSave).status()).toBe(200);
    expect((await readConfig()).layout.find((item) => item.key === 'FOLLOWUP_REMINDERS')?.size).toBe(alternate);
    const beforeMove = (await readConfig()).layout.findIndex((item) => item.key === 'FOLLOWUP_REMINDERS');
    const upSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: `Mover ${name} arriba` }).click();
    expect((await upSave).status()).toBe(200);
    expect((await readConfig()).layout.findIndex((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(beforeMove - 1);
    const downSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: `Mover ${name} abajo` }).click();
    expect((await downSave).status()).toBe(200);
    expect((await readConfig()).layout.findIndex((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(beforeMove);
    const targetIndex = beforeMove - 1;
    expect(await page.getByRole('button', { name: `Arrastrar ${name}` }).evaluate((element) => (element as HTMLElement).draggable)).toBe(true);
    const dragSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: `Arrastrar ${name}` })
      .dragTo(page.locator('[class*="boardItem"]').nth(targetIndex), { steps: 20 });
    expect((await dragSave).status()).toBe(200);
    expect((await readConfig()).layout.findIndex((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(targetIndex);
    const casesScope = page.getByRole('combobox', { name: 'Alcance de Expedientes' });
    const ownSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await casesScope.selectOption('OWN');
    expect((await ownSave).status()).toBe(200);
    expect((await readConfig()).layout.find((item) => item.key === 'CASES')?.scope).toBe('OWN');
    await page.reload();
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    await expect(page.getByRole('combobox', { name: 'Alcance de Expedientes' })).toHaveValue('OWN');
    const orgSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('combobox', { name: 'Alcance de Expedientes' }).selectOption('ORGANIZATION');
    expect((await orgSave).status()).toBe(200);
    const removeSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: `Quitar ${name}` }).click();
    expect((await removeSave).status()).toBe(200);
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    expect((await readConfig()).layout.some((item) => item.key === 'FOLLOWUP_REMINDERS')).toBe(false);
    const restoreSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await editor.getByRole('button', { name: /^Recordatorios de seguimiento Agenda ·/ }).click();
    expect((await restoreSave).status()).toBe(200);
    const resetResponse = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'DELETE');
    await editor.getByRole('button', { name: 'Restablecer' }).click();
    expect((await resetResponse).status()).toBe(200);
    await page.reload();
    const afterReset = await readConfig();
    expect(afterReset.personalized).toBe(false);
    expect(afterReset.layout.map((item) => item.key)).toEqual(initial.layout.map((item) => item.key));
  } finally {
    const cleanup = await api.delete('/api/mi-dia/layout', { headers });
    expect(cleanup.status()).toBe(200);
    await api.dispose();
  }
});

test('Mi Día: libreta arrastra pendiente en día hábil sin perder fecha original y permite día anterior/siguiente', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_NOTEBOOK_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json() as { access_token: string }).access_token}` };
  const list = async (date?: string) => {
    const response = await api.get(`/api/mi-dia/notebook?view=DAY${date ? `&date=${date}` : ''}`, { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: { today: string; tasks: Array<{
      id: string; title: string; original_on: string; effective_on: string;
      carry_history: Array<{ from: string; to: string }>;
    }> } }).data;
  };
  const today = (await list()).today;
  const dayOfWeek = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  expect(dayOfWeek).not.toBe(0);
  expect(dayOfWeek).not.toBe(6);
  const original = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const title = `QA ARRASTRE MI DIA ${Date.now()}`;
  const created = await api.post('/api/mi-dia/notebook', { headers, data: { title, date: original } });
  expect(created.status()).toBe(200);
  const id = (await created.json() as { data: { id: string } }).data.id;
  try {
    const carried = (await list(today)).tasks.find((task) => task.id === id);
    expect(carried).toBeTruthy();
    expect(carried?.original_on.slice(0, 10)).toBe(original);
    expect(carried?.effective_on.slice(0, 10)).toBe(today);
    expect(carried?.carry_history).toEqual(expect.arrayContaining([expect.objectContaining({ from: original, to: today })]));
    const browserLogin = await page.goto('/login');
    expect(browserLogin?.status()).toBe(200);
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
    await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    const notebook = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Agenda personal', exact: true }) }).first();
    await expect(notebook.getByText(title)).toBeVisible();
    await expect(notebook.getByText(`Programada originalmente: ${original}`)).toBeVisible();
    await notebook.getByRole('button', { name: 'Día anterior' }).click();
    await expect(notebook.getByRole('textbox', { name: 'Fecha de la libreta' })).toHaveValue(original);
    await expect(notebook.getByText(title)).toBeVisible();
    await notebook.getByRole('button', { name: 'Día siguiente' }).click();
    await expect(notebook.getByRole('textbox', { name: 'Fecha de la libreta' })).toHaveValue(today);
    await expect(notebook.getByText(title)).toBeVisible();
    await page.reload();
    await expect(notebook.getByText(title)).toBeVisible();
    expect((await list(today)).tasks.find((task) => task.id === id)?.original_on.slice(0, 10)).toBe(original);
  } finally {
    const canceled = await api.patch(`/api/mi-dia/notebook/${id}`, { headers, data: { canceled: true } });
    expect(canceled.status()).toBe(200);
    await api.dispose();
  }
});
