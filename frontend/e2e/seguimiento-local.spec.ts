import { expect, test } from '@playwright/test';

const expedienteId = '955b61c5-bbeb-4783-bd67-c3b84d07cc28';

test('Seguimiento local: proceso realizado persiste en UI y API', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_SEGUIMIENTO_QA_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local' });

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await email.fill('adrian.hernandez@pravia.test');
  const login = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const token = String((await (await login).json()).access_token || '');
  expect(token).toBeTruthy();
  await page.waitForURL('**/mi-dia');
  const headers = { Authorization: `Bearer ${token}` };
  const initial = await request.get(`/api/expedientes/${expedienteId}/seguimiento`, { headers });
  expect(initial.status()).toBe(200);
  const initialData = await initial.json() as { procesos: Array<{ expediente_acto_id: string; estado_operativo: string }> };
  if (!initialData.procesos.some((item) => item.estado_operativo !== 'COMPLETADO' && item.estado_operativo !== 'NO_APLICA')) {
    const actId = initialData.procesos[0]?.expediente_acto_id;
    expect(actId).toBeTruthy();
    const created = await request.post(`/api/expedientes/${expedienteId}/seguimiento/actividades-extraordinarias`, {
      headers,
      data: { expediente_acto_id: actId, nombre: `Proceso QA ${Date.now()}`, duracion_estimada: 0, margen_seguridad: 0 },
    });
    expect(created.status(), await created.text()).toBe(201);
  }
  await page.goto(`/expedientes/${expedienteId}#seguimiento`);
  await expect(page.getByRole('heading', { name: 'Seguimiento operativo' })).toBeVisible();

  const table = page.getByRole('table', { name: 'Procesos del expediente' });
  const row = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'Realizar' }) }).first();
  await expect(row).toBeVisible();
  const name = (await row.getByRole('cell').first().locator('strong').textContent())?.trim();
  expect(name).toBeTruthy();
  const updated = page.waitForResponse((response) => response.url().includes('/seguimiento/actividades/') && response.request().method() === 'PATCH');
  await row.getByRole('button', { name: 'Realizar' }).click();
  expect((await updated).status()).toBe(200);
  const completed = table.getByRole('row').filter({ hasText: name! });
  await expect(completed).toContainText('Realizado');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Procesos del expediente' }).getByRole('row').filter({ hasText: name! })).toContainText('Realizado');

  // Reload rotates the short-lived access token; read the API with the active browser session.
  const refreshed = await page.request.post('/api/auth/refresh');
  expect(refreshed.status()).toBe(200);
  const currentToken = String((await refreshed.json()).access_token || '');
  expect(currentToken).toBeTruthy();
  const read = await page.request.get(`/api/expedientes/${expedienteId}/seguimiento`, {
    headers: { Authorization: `Bearer ${currentToken}` },
  });
  expect(read.status()).toBe(200);
  const data = await read.json();
  expect(data.procesos.find((item: { actividad_nombre_snapshot: string }) => item.actividad_nombre_snapshot === name)?.estado_operativo).toBe('COMPLETADO');
});
