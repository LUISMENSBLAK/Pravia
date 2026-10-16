import { expect, request as requestFactory, test, type Page } from '@playwright/test';

test.beforeEach(async ({ request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) {
    throw new Error('MI_DIA_LAYOUT_RESET_LOCAL_ONLY');
  }
  const login = await request.post('/api/auth/login', {
    data: { email: 'adrian.hernandez@pravia.test', password },
  });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { access_token: string }).access_token;
  const reset = await request.delete('/api/mi-dia/layout', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(reset.status()).toBe(200);
});

async function ensureLocalLoginReady(page: Page, password: string) {
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const secret = page.getByRole('textbox', { name: 'Contraseña' });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await email.fill('adrian.hernandez@pravia.test');
    await secret.fill(password);
    await page.waitForTimeout(100);
    if (await email.inputValue() === 'adrian.hernandez@pravia.test'
      && await secret.inputValue() === password && await submit.isEnabled()) break;
  }
  await expect(email).toHaveValue('adrian.hernandez@pravia.test');
  await expect(secret).toHaveValue(password);
  await expect(submit).toBeEnabled();
}

test('Agenda personal guarda tarea futura, la excluye de Hoy y conserva finalización tras reload', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_NOTEBOOK_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Agenda personal', exact: true }) }).first();
  await expect(card).toBeVisible();
  const dateInput = card.getByRole('textbox', { name: 'Fecha de la libreta' });
  await expect(dateInput).not.toHaveValue('');
  const today = await dateInput.inputValue();
  await card.getByRole('button', { name: 'Día siguiente' }).click();
  const tomorrow = await dateInput.inputValue();
  expect(tomorrow).not.toBe(today);
  const title = `QA libreta futura ${Date.now()}`;
  await card.getByRole('textbox', { name: 'Nueva tarea personal' }).fill(title);
  await card.getByRole('button', { name: 'Agregar' }).click();
  await expect(card.getByText(title)).toBeVisible();
  await card.getByRole('button', { name: 'Hoy' }).click();
  await expect(card.getByText(title)).toHaveCount(0);
  await card.getByRole('button', { name: 'Próximas' }).click();
  await expect(card.getByText(title)).toBeVisible();
  await page.reload();
  await expect(card.getByText(title)).toHaveCount(0);
  await card.getByRole('button', { name: 'Próximas' }).click();
  await expect(card.getByText(title)).toBeVisible();
  await card.getByRole('button', { name: 'Día' }).click();
  await dateInput.fill(tomorrow);
  await expect(card.getByText(title)).toBeVisible();
  await card.getByRole('checkbox', { name: title }).click();
  await expect(card.getByRole('checkbox', { name: title })).toBeChecked();
  await card.getByRole('button', { name: 'Próximas' }).click();
  await expect(card.getByText(title)).toHaveCount(0);
  await card.getByRole('button', { name: 'Historial' }).click();
  await expect(card.getByText(title)).toBeVisible();
  await expect(card.getByRole('listitem').filter({ hasText: title }).getByText(/Realizada:/)).toBeVisible();
  await page.reload();
  await card.getByRole('button', { name: 'Historial' }).click();
  await expect(card.getByText(title)).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Agenda personal enlaza tarea SYSTEM de solo lectura al expediente fuente', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_SYSTEM_LOCAL_ONLY');
  const email = 'adrian.hernandez@pravia.test';
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const tenantPanel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const urgentEnabled = tenantPanel.getByRole('checkbox', { name: 'Tareas urgentes: habilitada', exact: true });
  await expect(urgentEnabled).toBeVisible();
  if (!(await urgentEnabled.isChecked())) await urgentEnabled.check();
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await tenantPanel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  const urgentHeading = page.getByRole('heading', { name: 'Tareas urgentes', exact: true });
  const addUrgent = editor.getByRole('button', { name: /^Tareas urgentes Operación · Tareas/ });
  await expect.poll(async () => (await urgentHeading.count()) + (await addUrgent.count()), { timeout: 30_000 }).toBeGreaterThan(0);
  if (await addUrgent.count()) {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT');
    await addUrgent.click();
    expect((await layoutSave).status()).toBe(200);
  }
  await expect(urgentHeading).toBeVisible();
  await page.getByRole('button', { name: 'Terminar' }).click();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Agenda personal', exact: true }) }).first();
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const apiLogin = await api.post('/api/auth/login', { data: { email, password } });
  expect(apiLogin.status()).toBe(200);
  const session = await apiLogin.json() as { access_token: string };
  expect(session.access_token).toBeTruthy();
  const caseId = '0cb8d3f7-e8bf-4d3d-b91e-10e6f5331026';
  const title = `QA sistema libreta ${Date.now()}`;
  const authorization = { Authorization: `Bearer ${session.access_token}` };
  const beforeResponse = await api.get('/api/mi-dia', { headers: authorization });
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json() as { metricas: { tareas_hoy: number }; tareas: { hoy: Array<{ id: string }> } };
  const created = await api.post('/api/agenda/tareas', { headers: authorization, data: {
    titulo: title, expediente_id: caseId, fecha_limite: new Date(Date.now() + 2 * 60_000).toISOString(), prioridad: 'MEDIA',
  } });
  expect(created.status()).toBe(201);
  const task = (await created.json() as { tarea: { id: string } }).tarea;
  try {
    const afterResponse = await api.get('/api/mi-dia', { headers: authorization });
    expect(afterResponse.status()).toBe(200);
    const after = await afterResponse.json() as typeof before;
    expect(after.metricas.tareas_hoy).toBe(before.metricas.tareas_hoy + 1);
    expect(after.tareas.hoy.map((item) => item.id)).toContain(task.id);
    await page.reload();
    const link = card.getByRole('link', { name: title });
    await expect(link).toBeVisible();
    const urgentCard = page.locator('section').filter({ has: urgentHeading }).first();
    const urgentLink = urgentCard.getByRole('link', { name: title });
    await expect(urgentLink).toBeVisible();
    await expect(urgentLink).toHaveAttribute('href', `/expedientes/${caseId}`);
    expect(await link.getAttribute('href')).toBe(`/expedientes/${caseId}#seguimiento`);
    await expect(card.getByRole('checkbox', { name: title })).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/expedientes/${caseId}#seguimiento$`));
  } finally {
    const canceled = await api.patch(`/api/agenda/tareas/${task.id}`, { headers: authorization,
      data: { estatus: 'CANCELADA' } });
    expect(canceled.status()).toBe(200);
    await api.dispose();
  }
  await page.goto('/mi-dia');
  await expect(card.getByRole('link', { name: title })).toHaveCount(0);
  const urgentCard = page.locator('section').filter({ has: urgentHeading }).first();
  await expect(urgentCard.getByRole('link', { name: title })).toHaveCount(0);
});

test('Agenda del día concilia conteo no truncado con evento real y enlace exacto', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_AGENDA_LOCAL_ONLY');
  const email = 'adrian.hernandez@pravia.test';
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email, password } });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const beforeResponse = await api.get('/api/mi-dia', { headers });
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json() as { metricas: { citas_hoy: number } };
  const title = `QA Agenda hoy ${Date.now()}`;
  const created = await api.post('/api/agenda', { headers, data: {
    titulo: title, tipo: 'CITA', fecha_inicio: new Date(Date.now() + 2 * 60_000).toISOString(), visibilidad: 'PRIVATE',
  } });
  expect(created.status()).toBe(201);
  const event = (await created.json() as { evento: { id: string } }).evento;
  try {
    const afterResponse = await api.get('/api/mi-dia', { headers });
    expect(afterResponse.status()).toBe(200);
    const after = await afterResponse.json() as { metricas: { citas_hoy: number }; eventos: { hoy: Array<{ id: string }> } };
    expect(after.metricas.citas_hoy).toBe(before.metricas.citas_hoy + 1);
    expect(after.eventos.hoy.some((item) => item.id === event.id)).toBe(true);
    await page.reload();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Agenda del día', exact: true }) }).first();
    await expect(card.getByText(String(after.metricas.citas_hoy), { exact: true })).toBeVisible();
    const link = card.getByRole('link', { name: title });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe(`/agenda#evento=${event.id}`);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally {
    const canceled = await api.post(`/api/agenda/${event.id}/cancelar`, { headers,
      data: { motivo_cancelacion: 'Limpieza de prueba local QA' } });
    expect(canceled.status()).toBe(200);
    await api.dispose();
  }
  await page.reload();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Agenda del día', exact: true }) }).first();
  await expect(card.getByRole('link', { name: title })).toHaveCount(0);
});

test('Recordatorios comerciales conserva conteo, límite visible y ruta exacta', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_FOLLOWUP_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toHaveValue(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const checkbox = panel.getByRole('checkbox', { name: 'Recordatorios de seguimiento: habilitada' });
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  const reminderHeading = page.getByRole('heading', { name: 'Recordatorios de seguimiento', exact: true });
  const addReminder = editor.getByRole('button', { name: /^Recordatorios de seguimiento Agenda · Prospectos\/Cotizaciones/ });
  await expect.poll(async () => (await reminderHeading.count()) + (await addReminder.count()), { timeout: 30_000 }).toBeGreaterThan(0);
  if (await addReminder.count()) {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT', { timeout: 30_000 });
    await addReminder.click();
    expect((await layoutSave).status()).toBe(200);
  }
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200, { timeout: 30_000 });
  await page.reload();
  const dashboard = await (await dashboardRequest).json() as { operacion: {
    cotizaciones_seguimiento_count: number;
    cotizaciones_seguimiento: Array<{ id: string; tipo: 'PROSPECTO' | 'COTIZACION' }>;
  } };
  const card = page.locator('section').filter({ has: page.getByRole('heading', {
    name: 'Recordatorios de seguimiento', exact: true,
  }) }).first();
  const items = dashboard.operacion.cotizaciones_seguimiento;
  expect(dashboard.operacion.cotizaciones_seguimiento_count).toBeGreaterThanOrEqual(items.length);
  if (process.env.PRAVIA_E2E_REQUIRE_BOTH_FOLLOWUP_TYPES === '1') {
    expect(new Set(items.map((item) => item.tipo))).toEqual(new Set(['PROSPECTO', 'COTIZACION']));
  }
  await expect(card.getByRole('link')).toHaveCount(items.length);
  if (dashboard.operacion.cotizaciones_seguimiento_count) {
    await expect(card.getByText(String(dashboard.operacion.cotizaciones_seguimiento_count), { exact: true })).toBeVisible();
  }
  for (const item of items) {
    const href = item.tipo === 'PROSPECTO' ? `/prospectos/${item.id}` : `/cotizaciones/${item.id}`;
    await expect(card.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
  const originalCount = dashboard.operacion.cotizaciones_seguimiento_count;
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const reminderLimit = page.getByRole('combobox', { name: 'Cantidad de Recordatorios de seguimiento' });
  const originalLimit = await reminderLimit.inputValue();
  if (originalLimit !== '5') {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT');
    await reminderLimit.selectOption('5');
    expect((await layoutSave).status()).toBe(200);
  }
  const limitedRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200, { timeout: 30_000 });
  await page.reload();
  const limited = await (await limitedRequest).json() as typeof dashboard;
  expect(limited.operacion.cotizaciones_seguimiento_count).toBe(originalCount);
  expect(limited.operacion.cotizaciones_seguimiento.length).toBeLessThanOrEqual(5);
  await expect(card.getByRole('link')).toHaveCount(limited.operacion.cotizaciones_seguimiento.length);
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  await expect(page.getByRole('combobox', { name: 'Cantidad de Recordatorios de seguimiento' })).toHaveValue('5');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (originalLimit !== '5') {
    const restore = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT');
    await reminderLimit.selectOption(originalLimit);
    expect((await restore).status()).toBe(200);
  }
});

test('Formatos pendientes de firma refleja requisitos vigentes y persiste en móvil', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_FORMATS_TO_SIGN_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toHaveValue(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const checkbox = panel.getByRole('checkbox', { name: 'Formatos pendientes de firma: habilitada' });
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  if (!(await page.getByRole('heading', { name: 'Formatos pendientes de firma', exact: true }).count())) {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT');
    await editor.getByRole('button', { name: /^Formatos pendientes de firma Documentos · CFG-002/ }).click();
    expect((await layoutSave).status()).toBe(200);
  }
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200, { timeout: 45_000 });
  await page.reload();
  const dashboard = await (await dashboardRequest).json() as { operacion: { documento_cards: Record<string, {
    count: number; items: Array<{ id: string; folio: string; href: string }>
  }> } };
  const data = dashboard.operacion.documento_cards.FORMATS_TO_SIGN;
  expect(data).toBeTruthy();
  const card = page.locator('section').filter({ has: page.getByRole('heading', {
    name: 'Formatos pendientes de firma', exact: true,
  }) }).first();
  if (!data.count) {
    await expect(card.getByText('No hay formatos generados que requieran una versión firmada pendiente dentro de tu alcance.')).toBeVisible();
  } else {
    await expect(card.getByText(`${data.count} formatos en total`)).toBeVisible();
    await expect(card.getByRole('link')).toHaveCount(data.items.length);
    for (const item of data.items) {
      const link = card.getByRole('link', { name: `Abrir Cumplimiento de ${item.folio}` });
      expect(await link.getAttribute('href')).toBe(item.href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Carga por usuario usa sólo expedientes y procesos reales de la notaría', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_USER_LOAD_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const checkbox = panel.getByRole('checkbox', { name: 'Carga por usuario: habilitada' });
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  if (!(await page.getByRole('heading', { name: 'Carga por usuario', exact: true }).count())) {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT');
    await editor.getByRole('button', { name: /^Carga por usuario Producción · Expedientes/ }).click();
    expect((await layoutSave).status()).toBe(200);
  }
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const dashboard = await (await dashboardRequest).json() as { operacion: { user_load: {
    count: number; items: Array<{ id: string; nombre: string; expedientes: number; procesos: number; href: string }>
  } } };
  const data = dashboard.operacion.user_load;
  expect(data.count).toBeGreaterThan(0);
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Carga por usuario', exact: true }) }).first();
  await expect(card.getByText(`${data.count} usuarios activos; expedientes y procesos se muestran por separado.`)).toBeVisible();
  await expect(card.getByRole('link')).toHaveCount(data.items.length);
  for (const item of data.items) {
    const link = card.getByRole('link', { name: `Abrir reporte de ${item.nombre}` });
    await expect(link).toContainText(`${item.expedientes} expedientes activos · ${item.procesos} procesos en alcance`);
    expect(await link.getAttribute('href')).toBe(item.href);
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Tiempo promedio por proceso respeta hechos completados, periodo y unidad visible', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_PROCESS_AVERAGE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const checkbox = panel.getByRole('checkbox', { name: 'Tiempo promedio por proceso: habilitada' });
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  const processAverageHeading = page.getByRole('heading', { name: 'Tiempo promedio por proceso', exact: true });
  const addProcessAverage = editor.getByRole('button', { name: /^Tiempo promedio por proceso Producción · Seguimiento/ });
  await expect.poll(async () => (await processAverageHeading.count()) + (await addProcessAverage.count())).toBeGreaterThan(0);
  if (!(await processAverageHeading.count())) {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT', { timeout: 45_000 });
    await addProcessAverage.click();
    expect((await layoutSave).status()).toBe(200);
  }
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200, { timeout: 45_000 });
  await page.reload();
  const dashboard = await (await dashboardRequest).json() as { operacion: { process_average: {
    count: number; items: Array<{ key: string; nombre: string; unidad: string; promedio_dias: number;
      procesos: number; href: string }>
  } } };
  const data = dashboard.operacion.process_average;
  expect(data).toBeTruthy();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tiempo promedio por proceso', exact: true }) }).first();
  if (!data.count) await expect(card.getByText('No hay procesos completados con inicio y fin verificables en este periodo.')).toBeVisible();
  else {
    await expect(card.getByText(`${data.count} procesos completados con duración verificable.`)).toBeVisible();
    await expect(card.getByRole('link')).toHaveCount(data.items.length);
    for (const item of data.items) {
      const link = card.getByRole('link', { name: `Abrir proceso ${item.nombre}` });
      await expect(link).toContainText(`${item.procesos} ${item.procesos === 1 ? 'proceso' : 'procesos'} · ${item.promedio_dias} días ${item.unidad === 'HABILES' ? 'hábiles' : 'naturales'} en promedio`);
      expect(await link.getAttribute('href')).toBe(item.href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Tiempo promedio a firma usa aperturas y firmas reales sin simular datos', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_SIGNING_AVERAGE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const checkbox = panel.getByRole('checkbox', { name: 'Tiempo promedio a firma: habilitada' });
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  if (!(await page.getByRole('heading', { name: 'Tiempo promedio a firma', exact: true }).count())) {
    const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
      && response.request().method() === 'PUT');
    await editor.getByRole('button', { name: /^Tiempo promedio a firma Producción · Expedientes/ }).click();
    expect((await layoutSave).status()).toBe(200);
  }
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const dashboard = await (await dashboardRequest).json() as { operacion: { signing_average: {
    count: number; promedio_dias_naturales: number | null;
    items: Array<{ id: string; folio: string; dias_naturales: number; href: string }>
  } } };
  const data = dashboard.operacion.signing_average;
  expect(data).toBeTruthy();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tiempo promedio a firma', exact: true }) }).first();
  if (!data.count) await expect(card.getByText('No hay expedientes firmados con fechas de apertura y firma válidas en este periodo.')).toBeVisible();
  else {
    await expect(card.getByText(`${data.promedio_dias_naturales} días naturales desde apertura hasta firma real.`)).toBeVisible();
    await expect(card.getByRole('link')).toHaveCount(data.items.length);
    for (const item of data.items) {
      const link = card.getByRole('link', { name: `Abrir ${item.folio}` });
      await expect(link).toContainText(`${item.dias_naturales} días naturales hasta la firma`);
      expect(await link.getAttribute('href')).toBe(item.href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Seguimiento alimenta las tarjetas reales de Mi Día y enlaza el proceso exacto', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_PROCESS_LOCAL_ONLY');

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toHaveValue(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);

  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const names = ['Mis pendientes', 'Procesos vencidos', 'Vencen hoy', 'Próximos vencimientos', 'Qué puedo avanzar hoy'];
  for (const name of names) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada` });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await expect(panel.getByRole('checkbox', { name: 'Mis pendientes: habilitada' })).toBeChecked();
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const name of names) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(name === 'Qué puedo avanzar hoy'
        ? `^${name} IA · Seguimiento` : `^${name} Operación · Seguimiento`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(editor.getByText('Cambios guardados')).toBeVisible();

  type ProcessDashboard = { operacion: { procesos: Record<string, { count: number; items: Array<{ id: string; href: string; estado: string }> }> } };
  let dashboard: ProcessDashboard | undefined;
  const dashboardResponse = page.waitForResponse(async (response) => {
    if (!response.url().endsWith('/api/mi-dia') || response.request().method() !== 'GET' || response.status() !== 200) return false;
    dashboard = await response.json() as ProcessDashboard;
    return true;
  });
  await page.reload();
  await dashboardResponse;
  expect(dashboard).toBeTruthy();
  for (const [key, name] of [
    ['MY_PENDING', names[0]], ['OVERDUE_PROCESSES', names[1]], ['DUE_TODAY', names[2]], ['UPCOMING_DUE', names[3]],
    ['CAN_ADVANCE_TODAY', names[4]],
  ]) {
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    const data = dashboard!.operacion.procesos[key];
    expect(data).toBeTruthy();
    if (data.count === 0) await expect(card.getByText('No hay procesos en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'proceso' : 'procesos'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }

  const first = dashboard!.operacion.procesos.MY_PENDING.items[0];
  expect(first).toBeTruthy();
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Mis pendientes', exact: true }) })
    .first().getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`process_id=${first.id}#seguimiento$`));
  await expect(page.locator(`#seguimiento-actividad-${first.id}`)).toBeVisible();
  await expect(page.locator(`#seguimiento-actividad-${first.id}`)).toBeFocused();

  const actionable = dashboard!.operacion.procesos.MY_PENDING.items.find((item) => item.estado !== 'BLOQUEADO');
  expect(actionable, 'El fixture local necesita un proceso realizable para validar el cambio persistido').toBeTruthy();
  await page.goto('/mi-dia');
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Mis pendientes', exact: true }) })
    .first().locator(`a[href="${actionable!.href}"]`).click();
  await expect(page).toHaveURL(new RegExp(`process_id=${actionable!.id}#seguimiento$`));
  const processRow = page.locator(`#seguimiento-actividad-${actionable!.id}`);
  await expect(processRow.getByRole('button', { name: 'Realizar' })).toBeVisible();
  const completion = page.waitForResponse((response) => response.url().includes(`/seguimiento/actividades/${actionable!.id}`)
    && response.request().method() === 'PATCH');
  await processRow.getByRole('button', { name: 'Realizar' }).click();
  expect((await completion).status()).toBe(200);
  await expect(processRow.getByText('Realizado')).toBeVisible();
  await page.reload();
  await expect(page.locator(`#seguimiento-actividad-${actionable!.id}`).getByText('Realizado')).toBeVisible();

  let updatedDashboard: ProcessDashboard | undefined;
  const updatedDashboardResponse = page.waitForResponse(async (response) => {
    if (!response.url().endsWith('/api/mi-dia') || response.request().method() !== 'GET' || response.status() !== 200) return false;
    updatedDashboard = await response.json() as ProcessDashboard;
    return true;
  });
  await page.goto('/mi-dia');
  await updatedDashboardResponse;
  expect(updatedDashboard).toBeTruthy();
  expect(updatedDashboard!.operacion.procesos.MY_PENDING.count).toBe(dashboard!.operacion.procesos.MY_PENDING.count - 1);
  expect(updatedDashboard!.operacion.procesos.MY_PENDING.items.some((item) => item.id === actionable!.id)).toBe(false);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: 'Mis pendientes', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Qué puedo avanzar hoy', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Actividad, Seguimiento y bloqueo canónico alimentan las tarjetas de expedientes', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_CASE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const names = ['Expedientes sin movimiento', 'Expedientes con retraso', 'Expedientes bloqueados',
    'Postfirma pendiente', 'Entregas pendientes'];
  for (const name of names) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada` });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const name of names) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} Operación ·`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(editor.getByText('Cambios guardados')).toBeVisible();
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const dashboard = await (await dashboardRequest).json() as { operacion: { expediente_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of [
    ['CASES_INACTIVE', names[0]], ['CASES_DELAYED', names[1]], ['CASES_BLOCKED', names[2]],
    ['POSTSIGN_PENDING', names[3]], ['DELIVERIES_PENDING', names[4]],
  ]) {
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    const data = dashboard.operacion.expediente_cards[key];
    expect(data).toBeTruthy();
    if (data.count === 0) await expect(card.getByText('No hay expedientes en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'expediente' : 'expedientes'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  const first = dashboard.operacion.expediente_cards.CASES_INACTIVE.items[0];
  if (first) {
    await page.locator('section').filter({ has: page.getByRole('heading', { name: names[0], exact: true }) })
      .first().getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/expedientes/${first.id}#actividad$`));
    await expect(page.getByRole('tabpanel', { name: 'Actividad' })).toBeVisible();
  }
  await page.goto('/mi-dia');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('El preflight H6 alimenta Listos y No listos para firma sin simular estados', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_SIGNATURE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const names = ['Listos para firma', 'No listos para firma'];
  for (const name of names) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const name of names) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} Operación · Firma`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const authorization = (await dashboardRequest).request().headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const dashboardApi = await page.request.get('/api/mi-dia', { headers: { Authorization: authorization! } });
  expect(dashboardApi.status()).toBe(200);
  const dashboard = await dashboardApi.json() as { operacion: { firma_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of [['READY_TO_SIGN', names[0]], ['NOT_READY_TO_SIGN', names[1]]]) {
    const data = dashboard.operacion.firma_cards[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (data.count === 0) await expect(card.getByText('No hay expedientes en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'expediente' : 'expedientes'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Firmados hoy y en el periodo leen la fecha real de firma', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_SIGNED_LOCAL_ONLY');
  await page.goto('/login');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
    await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
    if (await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).isEnabled()) break;
  }
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  const names = ['Firmados hoy', 'Firmados en el periodo'];
  for (const name of names) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const name of names) {
    const addCard = editor.getByRole('button', { name: new RegExp(`^${name} `) });
    await expect.poll(async () => (await page.getByRole('heading', { name, exact: true }).count()) + (await addCard.count())).toBeGreaterThan(0);
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await addCard.click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const dashboardResponse = page.waitForResponse((item) => item.url().endsWith('/api/mi-dia') && item.request().method() === 'GET' && item.status() === 200, { timeout: 45_000 });
  await page.reload();
  const dashboard = await (await dashboardResponse).json() as { operacion: { firma_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of [['SIGNED_TODAY', names[0]], ['SIGNED_PERIOD', names[1]]]) {
    const data = dashboard.operacion.firma_cards[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (data.count === 0) await expect(card.getByText('No hay expedientes en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'expediente' : 'expedientes'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  const periodSelect = page.getByRole('combobox', { name: 'Periodo de Firmados en el periodo' });
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const originalPeriod = await periodSelect.inputValue();
  await page.getByRole('button', { name: 'Terminar' }).click();
  for (const period of ['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']) {
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    if (await periodSelect.inputValue() !== period) {
      const layoutSave = page.waitForResponse((item) => item.url().endsWith('/api/mi-dia/layout') && item.request().method() === 'PUT', { timeout: 45_000 });
      await periodSelect.selectOption(period);
      expect((await layoutSave).status()).toBe(200);
    }
    const dashboardResponse = page.waitForResponse((item) => item.url().endsWith('/api/mi-dia') && item.request().method() === 'GET' && item.status() === 200, { timeout: 45_000 });
    await page.reload();
    const periodData = (await (await dashboardResponse).json() as { operacion: { firma_cards: Record<string, { count: number; items: Array<{ href: string }> }> } })
      .operacion.firma_cards.SIGNED_PERIOD;
    const signedCard = page.locator('section').filter({ has: page.getByRole('heading', { name: names[1], exact: true }) }).first();
    if (periodData.count) {
      await expect(signedCard.getByText(`${periodData.count} ${periodData.count === 1 ? 'expediente' : 'expedientes'} en total`)).toBeVisible();
      await expect(signedCard.getByRole('link')).toHaveCount(periodData.items.length);
    } else await expect(signedCard.getByText('No hay expedientes en esta condición dentro de tu alcance.')).toBeVisible();
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    await expect(periodSelect).toHaveValue(period);
    await page.getByRole('button', { name: 'Terminar' }).click();
  }
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  if (await periodSelect.inputValue() !== originalPeriod) {
    const restore = page.waitForResponse((item) => item.url().endsWith('/api/mi-dia/layout') && item.request().method() === 'PUT');
    await periodSelect.selectOption(originalPeriod);
    expect((await restore).status()).toBe(200);
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Firmas próximas usa el total completo, la ventana local y abre el expediente exacto', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_UPCOMING_SIGNATURE_LOCAL_ONLY');
  await page.goto('/login');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
    await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
    if (await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).isEnabled()) break;
  }
  const loginResponse = page.waitForResponse((item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST');
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  let token = (await (await loginResponse).json() as { access_token?: string }).access_token;
  expect(token).toBeTruthy();
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const renewApiSession = async () => {
    const response = await page.request.post('/api/auth/login', { data: {
      email: 'adrian.hernandez@pravia.test', password,
    } });
    expect(response.status()).toBe(200);
    token = (await response.json() as { access_token?: string }).access_token;
    expect(token).toBeTruthy();
  };
  const readDashboard = async () => {
    const response = await page.request.get('/api/mi-dia', { headers: headers(), timeout: 45_000 });
    expect(response.status()).toBe(200);
    return await response.json() as { metricas: { firmas_proximas: number }; operacion: {
      recientes: Array<{ id: string }>; firmas_proximas: Array<{ id: string; numero_pravia: string }>;
    } };
  };
  let source: { id: string; numero_pravia: string; version: number; fecha_estimada_firma: string | null } | undefined;
  for (let listPage = 1; listPage <= 5 && !source; listPage += 1) {
    const candidatesResponse = await page.request.get(`/api/expedientes?page=${listPage}&pageSize=100&sort=updated_at%3Adesc`, { headers: headers() });
    expect(candidatesResponse.status()).toBe(200);
    const candidates = await candidatesResponse.json() as { data: Array<{ id: string }>; meta: { hasNextPage: boolean } };
    for (const candidate of candidates.data) {
      const detail = await page.request.get(`/api/expedientes/${candidate.id}`, { headers: headers() });
      if (detail.status() !== 200) continue;
      const value = await detail.json() as { id: string; numero_pravia: string; version: number; fecha_estimada_firma: string | null; fecha_real_firma: string | null };
      if (!value.fecha_real_firma) { source = value; break; }
    }
    if (!candidates.meta.hasNextPage) break;
  }
  expect(source?.id).toBeTruthy();
  const originalDate = source!.fecha_estimada_firma;
  let currentVersion = source!.version;
  const patchDate = async (value: string | null) => {
    let response = await page.request.patch(`/api/expedientes/${source!.id}`, { headers: headers(), data: {
      fecha_estimada_firma: value, version: currentVersion,
    } });
    if (response.status() === 401) {
      await renewApiSession();
      response = await page.request.patch(`/api/expedientes/${source!.id}`, { headers: headers(), data: {
        fecha_estimada_firma: value, version: currentVersion,
      } });
    }
    expect(response.status()).toBe(200);
    const updated = await response.json() as { version: number };
    currentVersion = updated.version;
  };
  try {
    if (originalDate) await patchDate(null);
    const baseline = await readDashboard();
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    await patchDate(future);
    const after = await readDashboard();
    expect(after.metricas.firmas_proximas).toBe(baseline.metricas.firmas_proximas + 1);
    expect(after.operacion.firmas_proximas.map((item) => item.id)).toContain(source!.id);

    await page.goto('/mi-dia');
    await page.getByRole('button', { name: 'Configurar notaría' }).click();
    const tenant = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
    const enabled = tenant.getByRole('checkbox', { name: 'Firmas próximas: habilitada', exact: true });
    if (!(await enabled.isChecked())) await enabled.check();
    const tenantSave = page.waitForResponse((item) => item.url().endsWith('/api/mi-dia/tenant-config') && item.request().method() === 'PUT');
    await tenant.getByRole('button', { name: 'Guardar configuración' }).click();
    expect((await tenantSave).status()).toBe(200);
    await page.getByRole('button', { name: 'Cerrar configuración' }).click();
    await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
    const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
    const addCard = editor.getByRole('button', { name: /^Firmas próximas / });
    await expect.poll(async () => (await page.getByRole('heading', { name: 'Firmas próximas', exact: true }).count()) + (await addCard.count())).toBeGreaterThan(0);
    if (!(await page.getByRole('heading', { name: 'Firmas próximas', exact: true }).count())) {
      const layoutSave = page.waitForResponse((item) => item.url().endsWith('/api/mi-dia/layout') && item.request().method() === 'PUT');
      await addCard.click();
      expect((await layoutSave).status()).toBe(200);
    }
    await page.getByRole('button', { name: 'Terminar' }).click();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Firmas próximas', exact: true }) }).first();
    await expect(card.getByText(String(after.metricas.firmas_proximas), { exact: true })).toBeVisible();
    const link = card.getByRole('link', { name: source!.numero_pravia, exact: true });
    await expect(link).toHaveAttribute('href', `/expedientes/${source!.id}`);
    await page.reload();
    await expect(card.getByRole('link', { name: source!.numero_pravia, exact: true })).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally {
    await patchDate(originalDate);
    const restored = await page.request.get(`/api/expedientes/${source!.id}`, { headers: headers() });
    expect(restored.status()).toBe(200);
    const restoredDate = (await restored.json() as { fecha_estimada_firma: string | null }).fecha_estimada_firma;
    expect(restoredDate ? new Date(restoredDate).toISOString() : null)
      .toBe(originalDate ? new Date(originalDate).toISOString() : null);
  }
});

test('Prospectos y cotizaciones muestran trece condiciones e importes reales y navegan al objeto exacto', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_COMMERCIAL_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toHaveValue(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [
    ['PROSPECTS_ACTIVE', 'Prospectos activos'], ['PROSPECTS_NEW', 'Prospectos nuevos'],
    ['PROSPECTS_STALE', 'Prospectos sin seguimiento'], ['PROSPECTS_READY', 'Listos para cotizar'],
    ['QUOTES_ACTIVE', 'Cotizaciones activas'], ['QUOTES_TO_SEND', 'Cotizaciones por enviar'],
    ['QUOTES_NO_RESPONSE', 'Cotizaciones sin respuesta'], ['QUOTES_FOLLOWUP', 'Cotizaciones en seguimiento'],
    ['QUOTES_ACCEPTED', 'Cotizaciones aceptadas'],
    ['QUOTES_CONVERSION', 'Conversión de cotizaciones'], ['CASES_CONVERSION', 'Conversión a expediente'],
    ['QUOTES_ACTIVE_VALUE', 'Cotizaciones en curso $'], ['QUOTES_ACCEPTED_VALUE', 'Cotizaciones aceptadas $'],
  ] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [key, name] of cards) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name.replaceAll('$', '\\$')} ${key.startsWith('QUOTES_') && key.endsWith('_VALUE') ? 'Finanzas' : 'Comercial'} ·`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const acceptedPeriod = page.getByLabel('Periodo de Cotizaciones aceptadas', { exact: true });
  if (await acceptedPeriod.inputValue() !== 'YEAR') {
    const periodSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT', { timeout: 45_000 });
    await acceptedPeriod.selectOption('YEAR');
    expect((await periodSave).status()).toBe(200);
  }
  await expect(acceptedPeriod).toHaveValue('YEAR');
  const dashboardRequest = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200, { timeout: 45_000 });
  await page.reload();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  await expect(page.getByLabel('Periodo de Cotizaciones aceptadas', { exact: true })).toHaveValue('YEAR');
  const dashboard = await (await dashboardRequest).json() as { operacion: { comercial_cards: Record<string, {
    count: number; denominator?: number; rate?: number | null; amount?: string | null;
    items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of cards) {
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    const data = dashboard.operacion.comercial_cards[key];
    expect(data).toBeTruthy();
    if (data.amount !== undefined) {
      if (data.count === 0) await expect(card.getByText('No hay cotizaciones en esta condición dentro de tu alcance.')).toBeVisible();
      else {
        const money = data.amount === null ? 'Sin importe vigente'
          : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(data.amount));
        await expect(card.getByText(money)).toBeVisible();
        await expect(card.getByText(`${data.count} ${data.count === 1 ? 'cotización' : 'cotizaciones'} en total`)).toBeVisible();
        await expect(card.getByRole('link')).toHaveCount(data.items.length);
        expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
      }
    } else if (data.denominator !== undefined) {
      if (data.denominator === 0) await expect(card.getByText('No hay registros en la cohorte de este periodo.')).toBeVisible();
      else await expect(card.getByText(`${data.rate}% · ${data.count} de ${data.denominator} conversiones`)).toBeVisible();
      if (data.count > 0) {
        await expect(card.getByRole('link')).toHaveCount(data.items.length);
        expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
      }
    } else if (data.count === 0) await expect(card.getByText('No hay registros en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'registro' : 'registros'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  const first = dashboard.operacion.comercial_cards.PROSPECTS_ACTIVE.items[0];
  expect(first).toBeTruthy();
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Prospectos activos', exact: true }) })
    .first().getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/prospectos/${first.id}$`));
  await page.goto('/mi-dia');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: 'Prospectos activos', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // X02/X03: a real source mutation must change both the API and the visible card.
  // Merely rendering a pre-existing item does not certify the integrated flow.
  const commercialSnapshot = async () => {
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
      && response.request().method() === 'GET' && response.status() === 200, { timeout: 45_000 });
    if (new URL(page.url()).pathname === '/mi-dia') await page.reload();
    else await page.goto('/mi-dia');
    const response = await responsePromise;
    return (await response.json() as { operacion: { comercial_cards: Record<string, {
      count: number; denominator?: number; items: Array<{ id: string; href: string }>;
    }> } }).operacion.comercial_cards;
  };
  const beforeMutation = await commercialSnapshot();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/prospectos');
  await page.getByRole('button', { name: 'Nuevo prospecto' }).click();
  const prospectName = `QA MI DIA COMERCIAL ${Date.now()}`;
  await page.getByLabel('Nombre o razón social').fill(prospectName);
  await page.getByRole('button', { name: 'Crear prospecto' }).click();
  await page.waitForURL(/\/prospectos\/[0-9a-f-]+$/);
  const prospectPath = new URL(page.url()).pathname;
  const prospectId = prospectPath.split('/').at(-1)!;
  const afterCreate = await commercialSnapshot();
  expect(afterCreate.PROSPECTS_ACTIVE.count).toBe(beforeMutation.PROSPECTS_ACTIVE.count + 1);
  expect(afterCreate.PROSPECTS_ACTIVE.items).toContainEqual(expect.objectContaining({ id: prospectId, href: prospectPath }));
  expect(afterCreate.PROSPECTS_NEW.count).toBe(beforeMutation.PROSPECTS_NEW.count + 1);
  expect(afterCreate.PROSPECTS_NEW.items).toContainEqual(expect.objectContaining({ id: prospectId, href: prospectPath }));
  const activeCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Prospectos activos', exact: true }) }).first();
  await expect(activeCard.getByRole('link', { name: /Abrir PRO-/ }).first()).toHaveAttribute('href', prospectPath);
  const newCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Prospectos nuevos', exact: true }) }).first();
  await expect(newCard.getByRole('link', { name: /Abrir PRO-/ }).first()).toHaveAttribute('href', prospectPath);

  await page.goto(prospectPath);
  const prospectSummary = page.getByRole('heading', { name: 'Resumen' }).locator('xpath=ancestor::section[1]');
  await prospectSummary.getByRole('button', { name: 'Editar datos' }).click();
  await prospectSummary.getByRole('checkbox').first().check();
  await prospectSummary.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Comenzar integración' }).click();
  await page.getByRole('group', { name: 'Confirmar acción' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Marcar listo para cotizar' })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar listo para cotizar' }).click();
  const readiness = page.getByRole('group', { name: 'Confirmar acción' });
  const assignee = readiness.getByRole('combobox', { name: /Quién continuará con la cotización/i });
  const assigneeLabel = (await assignee.locator('option').allTextContents()).find((label) => label.includes('Hernández'));
  expect(assigneeLabel).toBeTruthy();
  await assignee.selectOption({ label: assigneeLabel });
  await readiness.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Convertir en cotización' })).toBeVisible();
  const afterReady = await commercialSnapshot();
  expect(afterReady.PROSPECTS_READY.count).toBe(beforeMutation.PROSPECTS_READY.count + 1);
  expect(afterReady.PROSPECTS_READY.items).toContainEqual(expect.objectContaining({ id: prospectId, href: prospectPath }));
  const readyCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Listos para cotizar', exact: true }) }).first();
  await expect(readyCard.getByRole('link', { name: /Abrir PRO-/ }).first()).toHaveAttribute('href', prospectPath);
  await readyCard.getByRole('link', { name: /Abrir PRO-/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`${prospectPath}$`));

  await page.getByRole('button', { name: 'Convertir en cotización' }).click();
  await page.getByRole('group', { name: 'Confirmar acción' }).getByRole('button', { name: 'Confirmar' }).click();
  await page.waitForURL(/\/cotizaciones\/[0-9a-f-]+$/);
  const quotePath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Comenzar elaboración' }).first().click();
  await page.getByRole('dialog', { name: 'Comenzar elaboración' }).getByRole('button', { name: 'Comenzar elaboración' }).click();
  await expect(page.getByRole('button', { name: 'Registrar envío al cliente' })).toBeVisible();
  await page.getByLabel('Concepto 1', { exact: true }).fill('Honorarios de prueba local');
  await page.getByLabel('Importe concepto 1', { exact: true }).fill('1234.56');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Presupuesto guardado.')).toBeVisible();
  const readyToSend = await commercialSnapshot();
  expect(readyToSend.QUOTES_TO_SEND.count).toBe(beforeMutation.QUOTES_TO_SEND.count + 1);
  expect(readyToSend.QUOTES_TO_SEND.items).toContainEqual(expect.objectContaining({ href: quotePath }));
  const toSendCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Cotizaciones por enviar', exact: true }) }).first();
  await expect(toSendCard.getByRole('link').first()).toHaveAttribute('href', quotePath);

  await page.goto(quotePath);
  await page.getByRole('button', { name: 'Registrar envío al cliente' }).click();
  const delivery = page.getByRole('dialog', { name: 'Confirmar envío manual a cliente' });
  await delivery.getByLabel('Canal externo').selectOption('presencial');
  await delivery.getByLabel('Para', { exact: true }).fill('Destinatario sintético QA');
  await delivery.getByLabel('Evidencia / nota del envío realizado').fill('Entrega presencial simulada en QA local aislada; no se contactó a un cliente real.');
  await delivery.getByRole('button', { name: 'Confirmar envío manual' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar seguimiento' }).first()).toBeVisible();
  const afterSend = await commercialSnapshot();
  expect(afterSend.QUOTES_TO_SEND.count).toBe(beforeMutation.QUOTES_TO_SEND.count);
  expect(afterSend.QUOTES_TO_SEND.items).not.toContainEqual(expect.objectContaining({ href: quotePath }));

  await page.goto(quotePath);
  await page.getByRole('button', { name: 'Iniciar seguimiento' }).first().click();
  await page.getByRole('dialog', { name: 'Iniciar seguimiento' }).getByRole('button', { name: 'Iniciar seguimiento' }).click();
  await expect(page.getByRole('button', { name: 'Marcar como aceptada' })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como aceptada' }).click();
  const acceptance = page.getByRole('dialog', { name: 'Registrar aceptación' });
  const formalApplicant = acceptance.getByLabel('Solicitante formal');
  await expect.poll(() => formalApplicant.locator('option').count()).toBeGreaterThan(1);
  await formalApplicant.selectOption({ index: 1 });
  await acceptance.getByRole('button', { name: 'Confirmar aceptación' }).click();
  await expect(page.getByRole('button', { name: 'Convertir en expediente', exact: true })).toBeVisible();
  const afterAcceptance = await commercialSnapshot();
  expect(afterAcceptance.QUOTES_ACCEPTED.count).toBe(beforeMutation.QUOTES_ACCEPTED.count + 1);
  expect(afterAcceptance.QUOTES_ACCEPTED.items).toContainEqual(expect.objectContaining({ href: quotePath }));
  expect(afterAcceptance.QUOTES_CONVERSION.count).toBe(beforeMutation.QUOTES_CONVERSION.count + 1);
  expect(afterAcceptance.QUOTES_CONVERSION.denominator).toBe((beforeMutation.QUOTES_CONVERSION.denominator ?? 0) + 1);
  expect(afterAcceptance.QUOTES_CONVERSION.items).toContainEqual(expect.objectContaining({ href: quotePath }));
  const acceptedCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Cotizaciones aceptadas', exact: true }) }).first();
  await expect(acceptedCard.getByRole('link').first()).toHaveAttribute('href', quotePath);

  await page.goto(quotePath);
  await page.getByRole('button', { name: 'Convertir en expediente', exact: true }).click();
  const conversion = page.getByRole('dialog', { name: 'Convertir a expediente' });
  const applicantRole = conversion.getByRole('combobox', { name: /Carácter del solicitante en/i });
  await expect.poll(() => applicantRole.locator('option').count()).toBeGreaterThan(2);
  await applicantRole.selectOption({ index: 2 });
  await expect(conversion.getByRole('button', { name: 'Convertir en expediente' })).toBeEnabled();
  await conversion.getByRole('button', { name: 'Convertir en expediente' }).click();
  await page.waitForURL(/\/expedientes\/[0-9a-f-]+(?:#.*)?$/);
  const casePath = new URL(page.url()).pathname;
  const afterConversion = await commercialSnapshot();
  expect(afterConversion.CASES_CONVERSION.count).toBe(beforeMutation.CASES_CONVERSION.count + 1);
  expect(afterConversion.CASES_CONVERSION.denominator).toBe((beforeMutation.CASES_CONVERSION.denominator ?? 0) + 1);
  expect(afterConversion.CASES_CONVERSION.items).toContainEqual(expect.objectContaining({ href: casePath }));
  const caseCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Conversión a expediente', exact: true }) }).first();
  await expect(caseCard.getByRole('link').first()).toHaveAttribute('href', casePath);
  await page.goto(quotePath);
  await expect(page.getByRole('link', { name: 'Ir al expediente' })).toHaveAttribute('href', casePath);
});

test('Documentos faltantes, por revisar y vencidos muestran datos persistidos sin cruzar expedientes', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_DOCUMENT_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [
    ['MISSING_DOCUMENTS', 'Documentos faltantes'], ['DOCUMENTS_TO_REVIEW', 'Documentos por revisar'],
    ['EXPIRED_DOCUMENTS', 'Documentos vencidos'], ['FORMATS_TO_GENERATE', 'Formatos por generar'],
    ['DOCUMENT_INCONSISTENCIES', 'Inconsistencias detectadas'],
  ] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [, name] of cards) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} Documentos ·`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const dashboardRequest = page.waitForRequest((request) => request.url().endsWith('/api/mi-dia') && request.method() === 'GET');
  await page.reload();
  const authorization = (await dashboardRequest).headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const response = await page.request.get('/api/mi-dia', { headers: { Authorization: authorization! } });
  expect(response.status()).toBe(200);
  const dashboard = await response.json() as { operacion: { documento_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of cards) {
    const data = dashboard.operacion.documento_cards[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (data.count === 0) await expect(card.getByText(key === 'FORMATS_TO_GENERATE'
      ? 'No hay formatos pendientes de generación dentro de tu alcance.'
      : key === 'DOCUMENT_INCONSISTENCIES'
        ? 'No hay hallazgos persistidos en la revisión del proyecto vigente dentro de tu alcance.'
        : 'No hay documentos en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${key === 'FORMATS_TO_GENERATE'
        ? data.count === 1 ? 'formato' : 'formatos'
        : key === 'DOCUMENT_INCONSISTENCIES' ? data.count === 1 ? 'hallazgo' : 'hallazgos'
        : data.count === 1 ? 'documento' : 'documentos'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: cards[0][1], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Catastro, RPP y Testimonios usan procesos canónicos en el tablero local', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_CANONICAL_PROCESS_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [
    ['CATASTRO_PENDING', 'Catastro pendiente'], ['RPP_PENDING', 'RPP pendiente'],
    ['TESTIMONIES_PENDING', 'Testimonios pendientes'],
  ] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [, name] of cards) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} Operación · Seguimiento`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const dashboardRequest = page.waitForRequest((request) => request.url().endsWith('/api/mi-dia') && request.method() === 'GET');
  await page.reload();
  const authorization = (await dashboardRequest).headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const response = await page.request.get('/api/mi-dia', { headers: { Authorization: authorization! } });
  expect(response.status()).toBe(200);
  const dashboard = await response.json() as { operacion: { procesos: Record<string, {
    count: number; items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of cards) {
    const data = dashboard.operacion.procesos[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (data.count === 0) await expect(card.getByText('No hay procesos en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'proceso' : 'procesos'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: cards[0][1], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('PLD y avisos consumen el estado persistido de Cumplimiento y conservan el expediente exacto', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_COMPLIANCE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [
    ['PLD_INCOMPLETE', 'Expedientes PLD incompletos'],
    ['NOTICES_PENDING', 'Avisos pendientes'],
    ['NOTICES_UPCOMING', 'Avisos por vencer'],
    ['NOTICES_OVERDUE', 'Avisos vencidos'],
    ['CRITICAL_ALERTS', 'Alertas críticas'],
  ] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [key, name] of cards) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(key === 'CRITICAL_ALERTS'
        ? `^${name} IA · Notificaciones` : `^${name} Cumplimiento · Cumplimiento`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
  }
  const dashboardResponse = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const authorization = (await dashboardResponse).request().headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const response = await page.request.get('/api/mi-dia', { headers: { Authorization: authorization! } });
  expect(response.status()).toBe(200);
  const dashboard = await response.json() as { operacion: { cumplimiento_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }>
  }> } };
  for (const [key, name] of cards) {
    const data = dashboard.operacion.cumplimiento_cards[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (data.count === 0) await expect(card.getByText(key === 'PLD_INCOMPLETE'
      ? 'No hay expedientes PLD incompletos dentro de tu alcance.'
      : key === 'CRITICAL_ALERTS' ? 'No hay alertas jurídicas críticas abiertas de revisiones vigentes dentro de tu alcance.'
        : 'No hay avisos en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      const noun = key === 'PLD_INCOMPLETE' ? 'expediente' : key === 'CRITICAL_ALERTS' ? 'alerta' : 'aviso';
      await expect(card.getByText(`${data.count} ${noun}${data.count === 1 ? '' : 's'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      expect(await card.getByRole('link').first().getAttribute('href')).toBe(data.items[0].href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [, name] of cards) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Resumen y atención de Mi Día sólo muestran las tarjetas propias visibles', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_SUMMARY_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const name of ['Resumen de mi día', 'Requieren mi atención']) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config')
    && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  for (const [name, source] of [['Resumen de mi día', 'Mi Día'], ['Requieren mi atención', 'MID-BASE']]) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
      const save = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout')
        && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} IA · ${source}`) }).click();
      expect((await save).status()).toBe(200);
    }
  }
  await page.reload();
  const summary = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Resumen de mi día', exact: true }) }).first();
  const attention = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Requieren mi atención', exact: true }) }).first();
  await expect(summary).toBeVisible();
  await expect(summary.getByText(/Agrega tarjetas de alcance propio|No hay elementos pendientes|en tu alcance|resumen es parcial/).first()).toBeVisible();
  await expect(attention).toBeVisible();
  await expect(attention.getByText(/Agrega tarjetas de alertas|No hay señales pendientes|en tu alcance|resumen es parcial/).first()).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(summary).toBeVisible();
    await expect(attention).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Archivo comparte los números siguientes canónicos con Mi Día sin crear una secuencia paralela', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_ARCHIVO_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toHaveValue(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [['NEXT_DEED', 'Escritura siguiente'], ['NEXT_FOLIO', 'Folio siguiente'],
    ['DEEDS_TODAY', 'Escrituras asignadas hoy']] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [, name] of cards) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} Archivo · Archivo`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
  }
  const dashboardResponse = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const authorization = (await dashboardResponse).request().headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const headers = { Authorization: authorization! };
  const [dashboardResponseApi, archiveResponseApi] = await Promise.all([
    page.request.get('/api/mi-dia', { headers }), page.request.get('/api/archivo', { headers }),
  ]);
  expect(dashboardResponseApi.status()).toBe(200);
  expect(archiveResponseApi.status()).toBe(200);
  const dashboard = await dashboardResponseApi.json() as { operacion: { archivo_cards: Record<string, {
    value: string | null; available: boolean; items?: Array<{ href: string; numero_escritura: string; folio: string }>
  }> } };
  const archive = await archiveResponseApi.json() as { next_numero_escritura: string | null; next_folio: string | null };
  expect(dashboard.operacion.archivo_cards.NEXT_DEED.value).toBe(archive.next_numero_escritura);
  expect(dashboard.operacion.archivo_cards.NEXT_FOLIO.value).toBe(archive.next_folio);
  for (const [key, name] of cards) {
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    const data = dashboard.operacion.archivo_cards[key];
    if (key === 'DEEDS_TODAY') {
      expect(data.available).toBe(true);
      if (data.value === '0') await expect(card.getByText('No se asignaron escrituras hoy.')).toBeVisible();
      else {
        await expect(card.getByText(`${data.value} escritura(s)`)).toBeVisible();
        const rowLinks = card.getByRole('listitem').getByRole('link');
        await expect(rowLinks).toHaveCount(data.items?.length ?? 0);
        if (data.items?.length) await expect(rowLinks.first()).toHaveAttribute('href', data.items[0].href);
      }
      continue;
    }
    if (data.available) {
      await expect(card.getByText(data.value!)).toBeVisible();
      await expect(card.getByRole('link', { name: 'Abrir Archivo' })).toHaveAttribute('href', '/archivo');
    } else await expect(card.getByText('Archivo aún no tiene una asignación desde la cual calcular el siguiente número.')).toBeVisible();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [, name] of cards) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Desempeño muestra sólo expedientes del responsable efectivo y firmas reales del periodo', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_PERFORMANCE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [['MY_ACTIVE_CASES', 'Mis expedientes activos'], ['SIGNED_CASES', 'Expedientes firmados']] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [, name] of cards) {
    const heading = page.getByRole('heading', { name, exact: true });
    const addCard = editor.getByRole('button', { name: new RegExp(`^${name} Producción · Expedientes`) });
    await expect.poll(async () => (await heading.count()) + (await addCard.count()), { timeout: 30_000 }).toBeGreaterThan(0);
    if (await addCard.count()) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await addCard.click();
      expect((await layoutSave).status()).toBe(200);
    }
    await expect(heading).toBeVisible();
  }
  const dashboardResponse = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const authorization = (await dashboardResponse).request().headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const response = await page.request.get('/api/mi-dia', { headers: { Authorization: authorization! } });
  expect(response.status()).toBe(200);
  const dashboard = await response.json() as { operacion: { expediente_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }> }>; firma_cards: Record<string, {
    count: number; items: Array<{ id: string; href: string }> }> } };
  for (const [key, name] of cards) {
    const data = key === 'SIGNED_CASES' ? dashboard.operacion.firma_cards[key] : dashboard.operacion.expediente_cards[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (data.count === 0) await expect(card.getByText('No hay expedientes en esta condición dentro de tu alcance.')).toBeVisible();
    else {
      await expect(card.getByText(`${data.count} ${data.count === 1 ? 'expediente' : 'expedientes'} en total`)).toBeVisible();
      await expect(card.getByRole('link')).toHaveCount(data.items.length);
      await expect(card.getByRole('link').first()).toHaveAttribute('href', data.items[0].href);
    }
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [, name] of cards) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('Mi Día concilia cobros, honorarios y solicitudes EXP-008 con las fuentes reales', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_FINANCE_LOCAL_ONLY');
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toHaveValue('adrian.hernandez@pravia.test');
  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toHaveValue(password);
  await ensureLocalLoginReady(page, password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
  const cards = [['INCOME_COLLECTED', 'Ingreso cobrado'], ['COLLECTED_TODAY', 'Cobrado hoy'],
    ['COLLECTION_SCHEDULED', 'Cobro programado'],
    ['FEES_SCHEDULED_SIGN', 'Honorarios programados a firma'], ['FEES_SIGNED', 'Honorarios firmados'],
    ['PAYMENTS_DUE', 'Pagos por realizar'], ['PAYMENTS_UNPROVEN', 'Pagos por comprobar'],
    ['CLIENT_RESOURCES', 'Recursos no propios disponibles'], ['REP_PENDING', 'REP pendientes'],
    ['INVOICES_PENDING', 'Facturas pendientes'], ['CFDI_TO_STAMP', 'CFDI por timbrar']] as const;
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  for (const [, name] of cards) {
    const checkbox = panel.getByRole('checkbox', { name: `${name}: habilitada`, exact: true });
    await expect(checkbox).toBeVisible();
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  const tenantSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/tenant-config') && response.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();
  expect((await tenantSave).status()).toBe(200);
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  const editor = page.getByRole('region', { name: 'Personalizar Mi Día' });
  for (const [key, name] of cards) {
    if (!(await page.getByRole('heading', { name, exact: true }).count())) {
      const layoutSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await editor.getByRole('button', { name: new RegExp(`^${name} Finanzas · ${key === 'REP_PENDING' || key === 'INVOICES_PENDING' || key === 'CFDI_TO_STAMP' ? 'CFDI' : key.startsWith('FEES_') ? 'Presupuesto/Firma' : key.startsWith('PAYMENTS_') || key === 'CLIENT_RESOURCES' ? 'EXP-008' : 'Finanzas'}`) }).click();
      expect((await layoutSave).status()).toBe(200);
    }
  }
  const dashboardResponse = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia')
    && response.request().method() === 'GET' && response.status() === 200);
  await page.reload();
  const authorization = (await dashboardResponse).request().headers().authorization;
  expect(authorization).toMatch(/^Bearer /);
  const headers = { Authorization: authorization! };
  const dashboardApi = await page.request.get('/api/mi-dia', { headers });
  expect(dashboardApi.status()).toBe(200);
  const dashboard = await dashboardApi.json() as { operacion: { finanzas_cards: Record<string, {
    count: number; amount: string; items: Array<{ id: string; href: string; concepto: string }>
  }> } };
  const money = (value: string) => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value));
  for (const [key, name] of cards) {
    const data = dashboard.operacion.finanzas_cards[key];
    expect(data).toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
    if (key === 'CFDI_TO_STAMP' && data.count > 0) await expect(card.getByText('La revisión de datos no autoriza el timbrado: el proveedor fiscal no está certificado.')).toBeVisible();
    if (data.count === 0) {
      await expect(card.getByText(key === 'FEES_SCHEDULED_SIGN'
        ? 'No hay firmas programadas en este periodo dentro de tu alcance.'
        : key === 'FEES_SIGNED' ? 'No hay expedientes firmados en este periodo dentro de tu alcance.'
          : key === 'PAYMENTS_DUE' ? 'No hay solicitudes de pago pendientes dentro de tu alcance.'
            : key === 'PAYMENTS_UNPROVEN' ? 'No hay pagos sin comprobante activo dentro de tu alcance.'
              : key === 'CLIENT_RESOURCES' ? 'No hay recursos de terceros disponibles en expedientes dentro de tu alcance.'
                : key === 'REP_PENDING' ? 'No hay pagos PPD de CFDI emitidos pendientes de complemento dentro de tu alcance.'
                  : key === 'INVOICES_PENDING' ? 'No hay saldo facturable pendiente dentro de tu alcance.'
                    : key === 'CFDI_TO_STAMP' ? 'No hay prefacturas con datos mínimos completos; el PAC no está certificado.'
              : key === 'COLLECTION_SCHEDULED' ? 'No hay cobros pendientes con vencimiento contractual en este periodo.'
          : 'No hay ingresos recibidos en este periodo dentro de tu alcance.')).toBeVisible();
      expect(data.amount).toBe('0.00');
    } else {
      const noun = key === 'CFDI_TO_STAMP' ? 'prefactura' : key === 'REP_PENDING' ? 'pago' : key === 'INVOICES_PENDING' ? 'ingreso' : key === 'COLLECTION_SCHEDULED' ? 'cobro' : key === 'CLIENT_RESOURCES' || key.startsWith('FEES_')
        ? 'expediente' : key.startsWith('PAYMENTS_') ? 'solicitud' : 'movimiento';
      await expect(card.getByText(`${money(data.amount)} · ${data.count} ${data.count === 1 ? noun : noun === 'solicitud' ? 'solicitudes' : `${noun}s`}`)).toBeVisible();
      const links = card.getByRole('listitem').getByRole('link');
      await expect(links).toHaveCount(data.items.length);
      await expect(links.first()).toHaveAttribute('href', data.items[0].href);
    }
  }
  const collected = dashboard.operacion.finanzas_cards.INCOME_COLLECTED;
  expect(collected.count).toBeGreaterThan(0);
  const summaryResponse = await page.request.get('/api/finanzas/resumen?periodo=ESTE_MES', { headers });
  expect(summaryResponse.status()).toBe(200);
  const summary = await summaryResponse.json() as { data: { kpis: { ingresos_recibidos: number } } };
  expect(Number(collected.amount)).toBe(summary.data.kpis.ingresos_recibidos);
  const first = collected.items[0];
  await page.locator('section').filter({ has: page.getByRole('heading', { name: cards[0][1], exact: true }) })
    .first().getByRole('listitem').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`movimiento_id=${first.id}`));
  await expect(page.getByText('Movimiento específico')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Movimientos financieros' }).getByText('1 movimientos encontrados')).toBeVisible();
  const exactResponse = await page.request.get(`/api/finanzas/movimientos?movimiento_id=${first.id}`, { headers });
  expect(exactResponse.status()).toBe(200);
  const exact = await exactResponse.json() as { data: { items: Array<{ id: string; concepto: string }> } };
  expect(exact.data.items.map((item) => item.id)).toEqual([first.id]);
  expect(exact.data.items[0].concepto).toBe(first.concepto);
  await page.goto('/mi-dia');
  const due = dashboard.operacion.finanzas_cards.PAYMENTS_DUE;
  expect(due.count).toBeGreaterThan(0);
  const request = due.items[0];
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Pagos por realizar', exact: true }) })
    .first().getByRole('listitem').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`payment_request_id=${request.id}#finanzas$`));
  await expect(page.locator(`#finance-request-${request.id}`)).toBeVisible();
  await expect(page.locator(`#finance-request-${request.id}`)).toBeFocused();
  await page.goto('/mi-dia');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [, name] of cards) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
