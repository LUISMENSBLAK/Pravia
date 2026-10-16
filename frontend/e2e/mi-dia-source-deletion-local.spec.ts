import { execFileSync } from 'node:child_process';
import { expect, request as requestFactory, test } from '@playwright/test';

test('Mi Día: un registro QA eliminado de la fuente no reaparece tras reconsulta ni reload', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_DELETION_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const health = await api.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const login = await api.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json() as { access_token: string }).access_token}` };
  const list = await api.get('/api/mi-dia/notebook?view=DAY', { headers });
  expect(list.status()).toBe(200);
  const today = (await list.json() as { data: { today: string } }).data.today;
  const title = `QA FUENTE ELIMINADA ${Date.now()}`;
  const created = await api.post('/api/mi-dia/notebook', { headers, data: { title, date: today } });
  expect(created.status()).toBe(200);
  const id = (await created.json() as { data: { id: string } }).data.id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  let deleted = false;
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
    const notebook = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Agenda personal', exact: true }) }).first();
    await expect(notebook.getByText(title)).toBeVisible();
    const removed = execFileSync('docker', ['exec', 'pravia-new-lot-qa-20260926', 'psql', '-U', 'pravia', '-d', 'pravia_qa', '-Atc',
      `DELETE FROM pravia_os.mi_dia_personal_tasks WHERE id='${id}' AND title='${title}' RETURNING id`], { encoding: 'utf8' }).trim();
    deleted = removed.includes(id);
    expect(deleted).toBe(true);
    const after = await api.get(`/api/mi-dia/notebook?view=DAY&date=${today}`, { headers });
    expect(after.status()).toBe(200);
    expect((await after.json() as { data: { tasks: Array<{ id: string }> } }).data.tasks.map((task) => task.id)).not.toContain(id);
    await page.reload();
    await expect(notebook.getByText(title)).toHaveCount(0);
  } finally {
    if (!deleted) {
      const canceled = await api.patch(`/api/mi-dia/notebook/${id}`, { headers, data: { canceled: true } });
      expect([200, 404]).toContain(canceled.status());
    }
    await api.dispose();
  }
});
