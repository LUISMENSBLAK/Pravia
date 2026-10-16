import { expect, test } from '@playwright/test';

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

test('Dirección configura sólo tarjetas conectadas y Mi Día no desborda en móvil', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || !['5175', '5176'].includes(base.port) || !password) throw new Error('MI_DIA_LOCAL_E2E_SAFETY_GATE_FAILED');

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  await email.fill('adrian.hernandez@pravia.test');
  await passwordInput.fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(passwordInput).toHaveValue(password);
  const sessionResponse = page.waitForResponse((response) => response.url().endsWith('/auth/me') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const session = await (await sessionResponse).json() as { data?: { user?: { id?: string }; id?: string }; user?: { id?: string } };
  const responsibleId = session.data?.user?.id ?? session.user?.id ?? session.data?.id;
  expect(responsibleId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByRole('button', { name: /Menú de usuario de Adrián Hernández/ })).toBeVisible();

  await page.goto('/mi-dia');
  await page.getByRole('button', { name: 'Configurar notaría' }).click();
  const panel = page.getByRole('region', { name: 'Tablero predeterminado de la notaría' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'Asistente PRAVIA: habilitada' })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'Recordatorios de seguimiento: habilitada' })).toBeChecked();
  await expect(panel.getByText('REP_PENDING', { exact: true })).toHaveCount(0);
  for (const card of ['Citas próximas', 'Firmas de hoy']) {
    const enabled = panel.getByRole('checkbox', { name: `${card}: habilitada` });
    await expect(enabled).toBeVisible();
    if (!(await enabled.isChecked())) await enabled.check();
  }
  await panel.getByRole('button', { name: 'Guardar configuración' }).click();

  for (const width of [1920, 1440, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(panel.getByRole('button', { name: 'Guardar configuración' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Cerrar configuración' }).click();
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  await expect(page.getByRole('region', { name: 'Personalizar Mi Día' })).toBeVisible();
  for (const card of ['Citas próximas', 'Firmas de hoy']) {
    const available = page.getByRole('region', { name: 'Personalizar Mi Día' })
      .getByRole('button', { name: new RegExp(`^${card} Agenda`) });
    if (await available.count()) await available.click();
    await expect(page.getByRole('heading', { name: card, exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const casesCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Expedientes recientes' }) }).first();
  await expect.poll(async () => casesCard.locator('li').count()).toBeGreaterThan(0);
  const initialCount = await casesCard.locator('li').count();
  const limitSelect = page.getByRole('combobox', { name: 'Cantidad de Expedientes' });
  const initialLimit = await limitSelect.inputValue();
  if (initialLimit === '5') {
    const alternateSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await limitSelect.selectOption('10');
    expect((await alternateSave).status()).toBe(200);
  }
  const limitSave = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
  await limitSelect.selectOption('5');
  expect((await limitSave).status()).toBe(200);
  await expect(casesCard.locator('li')).toHaveCount(Math.min(initialCount, 5));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Citas próximas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Firmas de hoy', exact: true })).toBeVisible();
  await expect(casesCard.locator('li')).toHaveCount(Math.min(initialCount, 5));
  await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
  await expect(limitSelect).toHaveValue('5');
  if (initialLimit !== '5') {
    const restoreLimit = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
    await limitSelect.selectOption(initialLimit);
    expect((await restoreLimit).status()).toBe(200);
  }
  await expect(casesCard.locator('li')).toHaveCount(initialCount);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/finanzas?view=cartera&responsable_id=${encodeURIComponent(responsibleId!)}`);
  await expect(page.getByText('Cartera filtrada por responsable')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ver toda la organización' }).click();
  await expect(page).not.toHaveURL(/responsable_id=/);
  await expect(page.getByText('Cartera filtrada por responsable')).toHaveCount(0);
});

test('Una cita y una firma reales aparecen en Mi Día, abren su fuente y desaparecen al cancelarlas', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || !['5175', '5176'].includes(base.port) || !password) throw new Error('MI_DIA_LOCAL_E2E_SAFETY_GATE_FAILED');

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  await passwordInput.fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  if (await passwordInput.inputValue() !== password) await passwordInput.fill(password);
  await expect(email).toHaveValue('adrian.hernandez@pravia.test');
  await expect(passwordInput).toHaveValue(password);
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const loginResult = await loginResponse;
  expect(loginResult.status()).toBe(200);
  await expect(page).toHaveURL(/\/mi-dia$/);
  const accessToken = (await loginResult.json() as { access_token?: string }).access_token;
  expect(accessToken).toBeTruthy();
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const openMyDay = async (reload = false) => {
    const request = page.waitForRequest((candidate) => candidate.url().endsWith('/api/mi-dia') && candidate.method() === 'GET');
    if (reload) await page.reload();
    else await page.goto('/mi-dia');
    const nextBearer = (await request).headers().authorization;
    expect(nextBearer).toMatch(/^Bearer /);
    authorization.Authorization = nextBearer!;
  };

  const dashboard = async () => {
    const response = await page.request.get('/api/mi-dia', { headers: authorization });
    expect(response.status()).toBe(200);
    return await response.json() as {
      metricas: { citas_proximas: number };
      eventos: { citas_proximas: Array<{ id: string; titulo: string }> };
      operacion: { recientes: Array<{ id: string }> };
    };
  };
  for (const stale of (await dashboard()).eventos.citas_proximas.filter((event) => event.titulo.startsWith('QA MI DIA CITA '))) {
    const cleanup = await page.request.post(`/api/agenda/${stale.id}/cancelar`, { headers: authorization, data: {
      motivo_cancelacion: 'Limpieza de prueba local anterior',
    } });
    expect(cleanup.status()).toBe(200);
  }
  const initial = await dashboard();
  const title = `QA MI DIA CITA ${Date.now()}`;
  const start = new Date(Date.now() + 2 * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  let createdId: string | undefined;
  let signingId: string | undefined;
  try {
    const created = await page.request.post('/api/agenda', { headers: authorization, data: {
      titulo: title, tipo: 'CITA', fecha_inicio: start.toISOString(), fecha_fin: end.toISOString(),
      visibilidad: 'PRIVATE', idempotency_key: `mi-dia-qa-${Date.now()}`,
    } });
    expect(created.status()).toBe(201);
    createdId = (await created.json() as { evento: { id: string } }).evento.id;
    const afterCreate = await dashboard();
    expect(afterCreate.metricas.citas_proximas).toBe(initial.metricas.citas_proximas + 1);
    expect(afterCreate.eventos.citas_proximas.map((event) => event.id)).toContain(createdId);

    await openMyDay();
    const appointments = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Citas próximas', exact: true }) }).first();
    await expect(appointments.getByRole('link', { name: title })).toBeVisible();
    await openMyDay(true);
    await expect(appointments.getByRole('link', { name: title })).toBeVisible();
    await appointments.getByRole('link', { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`/agenda#evento=${createdId}$`));
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();

    const cancelled = await page.request.post(`/api/agenda/${createdId}/cancelar`, { headers: authorization, data: {
      motivo_cancelacion: 'Fin de prueba local de Mi Día',
    } });
    expect(cancelled.status()).toBe(200);
    const afterCancel = await dashboard();
    expect(afterCancel.metricas.citas_proximas).toBe(initial.metricas.citas_proximas);
    expect(afterCancel.eventos.citas_proximas.map((event) => event.id)).not.toContain(createdId);
    await openMyDay();
    await expect(appointments.getByRole('link', { name: title })).toHaveCount(0);

    const sourceCaseId = initial.operacion.recientes[0]?.id;
    expect(sourceCaseId).toMatch(/^[0-9a-f-]{36}$/i);
    const signingTitle = `QA MI DIA FIRMA ${Date.now()}`;
    const signingStart = new Date(Date.now() + 2 * 60_000);
    const signingEnd = new Date(signingStart.getTime() + 30 * 60_000);
    const signingInitial = await dashboard();
    const initialSigningCount = (signingInitial as typeof signingInitial & { metricas: { firmas_hoy_agenda: number } }).metricas.firmas_hoy_agenda;
    const createdSigning = await page.request.post('/api/agenda', { headers: authorization, data: {
      titulo: signingTitle, tipo: 'FIRMA', fecha_inicio: signingStart.toISOString(), fecha_fin: signingEnd.toISOString(),
      visibilidad: 'PRIVATE', expediente_id: sourceCaseId, idempotency_key: `mi-dia-signing-qa-${Date.now()}`,
    } });
    expect(createdSigning.status()).toBe(201);
    signingId = (await createdSigning.json() as { evento: { id: string } }).evento.id;
    const afterSigning = await dashboard() as typeof signingInitial & {
      metricas: { firmas_hoy_agenda: number };
      eventos: { firmas_hoy: Array<{ id: string; titulo: string }> };
    };
    expect(afterSigning.metricas.firmas_hoy_agenda).toBe(initialSigningCount + 1);
    expect(afterSigning.eventos.firmas_hoy.map((event) => event.id)).toContain(signingId);

    await openMyDay();
    const signings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Firmas de hoy', exact: true }) }).first();
    await expect(signings.getByRole('link', { name: signingTitle })).toBeVisible();
    await openMyDay(true);
    await expect(signings.getByRole('link', { name: signingTitle })).toBeVisible();
    await signings.getByRole('link', { name: signingTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/agenda#evento=${signingId}$`));
    await expect(page.getByRole('dialog', { name: signingTitle })).toBeVisible();

    const cancelledSigning = await page.request.post(`/api/agenda/${signingId}/cancelar`, { headers: authorization, data: {
      motivo_cancelacion: 'Fin de prueba local de firma en Mi Día',
    } });
    expect(cancelledSigning.status()).toBe(200);
    const afterSigningCancel = await dashboard() as typeof afterSigning;
    expect(afterSigningCancel.metricas.firmas_hoy_agenda).toBe(initialSigningCount);
    expect(afterSigningCancel.eventos.firmas_hoy.map((event) => event.id)).not.toContain(signingId);
    await openMyDay();
    await expect(signings.getByRole('link', { name: signingTitle })).toHaveCount(0);
  } finally {
    const cancelFixture = async (id: string) => {
      const request = () => page.request.post(`/api/agenda/${id}/cancelar`, { headers: authorization, data: {
        motivo_cancelacion: 'Limpieza de prueba local de Mi Día',
      } });
      let response = await request();
      if (response.status() === 401) {
        const refreshed = await page.request.post('/api/auth/refresh');
        if (refreshed.status() === 200) {
          const nextToken = (await refreshed.json() as { access_token?: string }).access_token;
          if (nextToken) authorization.Authorization = `Bearer ${nextToken}`;
          response = await request();
        }
      }
      expect(response.status()).toBe(200);
    };
    if (createdId) await cancelFixture(createdId);
    if (signingId) await cancelFixture(signingId);
  }
});

test('Agenda personal conserva una tarea sólo para su propietario y niega acceso directo al colega', async ({ browser }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const directorPassword = process.env.PRAVIA_E2E_PASSWORD || '';
  const colleaguePassword = process.env.PRAVIA_E2E_MARIA_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !directorPassword || !colleaguePassword) {
    throw new Error('MI_DIA_NOTEBOOK_LOCAL_ONLY');
  }
  const ownerContext = await browser.newContext({ baseURL: base.toString() });
  const colleagueContext = await browser.newContext({ baseURL: base.toString() });
  try {
    const owner = await ownerContext.newPage();
    await owner.goto('/login');
    await owner.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
    await owner.getByRole('textbox', { name: 'Contraseña' }).fill(directorPassword);
    const ownerLogin = owner.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    expect((await ownerLogin).status()).toBe(200);
    await expect(owner).toHaveURL(/\/mi-dia$/);
    const notebook = owner.locator('section').filter({ has: owner.getByRole('heading', { name: 'Agenda personal', exact: true }) }).first();
    await expect(notebook.getByLabel('Fecha de la libreta')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
    const date = await notebook.getByLabel('Fecha de la libreta').inputValue();
    const title = `QA LIBRETA PRIVADA ${Date.now()}`;
    await notebook.getByRole('textbox', { name: 'Nueva tarea personal' }).fill(title);
    const createdResponse = owner.waitForResponse((response) => response.url().endsWith('/api/mi-dia/notebook')
      && response.request().method() === 'POST');
    await notebook.getByRole('button', { name: 'Agregar' }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(200);
    const taskId = (await created.json() as { data: { id: string } }).data.id;
    await expect(notebook.getByText(title)).toBeVisible();
    await owner.reload();
    await expect(notebook.getByText(title)).toBeVisible();

    const colleague = await colleagueContext.newPage();
    await colleague.goto('/login');
    await colleague.getByRole('textbox', { name: 'Correo electrónico' }).fill('maria.careaga@pravia.test');
    await colleague.getByRole('textbox', { name: 'Contraseña' }).fill(colleaguePassword);
    const colleagueLogin = colleague.waitForResponse((response) => response.url().endsWith('/api/auth/login')
      && response.request().method() === 'POST');
    await colleague.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    const login = await colleagueLogin;
    expect(login.status()).toBe(200);
    const token = (await login.json() as { access_token: string }).access_token;
    await expect(colleague).toHaveURL(/\/mi-dia$/);
    await expect(colleague.getByText(title)).toHaveCount(0);
    const ownList = await colleague.request.get(`/api/mi-dia/notebook?view=DAY&date=${date}`,
      { headers: { Authorization: `Bearer ${token}` } });
    expect(ownList.status()).toBe(200);
    expect((await ownList.json() as { data: { tasks: Array<{ id: string }> } }).data.tasks.map((task) => task.id)).not.toContain(taskId);
    const forbidden = await colleague.request.patch(`/api/mi-dia/notebook/${taskId}`,
      { headers: { Authorization: `Bearer ${token}` }, data: { completed: true } });
    expect(forbidden.status()).toBe(404);

    await notebook.getByRole('checkbox', { name: title }).click();
    await expect(notebook.getByText(title)).toHaveCount(0);
    await notebook.getByRole('button', { name: 'Historial' }).click();
    await expect(notebook.getByText(title)).toBeVisible();
  } finally {
    await Promise.all([ownerContext.close(), colleagueContext.close()]);
  }
});
