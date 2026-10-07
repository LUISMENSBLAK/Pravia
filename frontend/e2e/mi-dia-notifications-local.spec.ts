import { expect, test } from '@playwright/test';

test('Mi Día, notificaciones y búho comparten estado real tras reload', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_MY_DAY_QA_SAFETY_GATE_FAILED');
  expect(await (await request.get('/api/health')).json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');

  const feed = page.waitForResponse((response) => response.url().includes('/api/settings/notifications') && response.request().method() === 'GET');
  const notificationButton = page.getByRole('button', { name: /\d+ notificaciones sin leer/ });
  await notificationButton.click();
  const payload = await (await feed).json();
  await expect(notificationButton).toHaveAttribute('aria-label', `${payload.unread} notificaciones sin leer`);
  await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Abrir PRAVIA IA para hacer una pregunta' }).click();
  await expect(page.getByRole('dialog', { name: 'PRAVIA IA' })).toBeVisible();
  await page.getByRole('dialog', { name: 'PRAVIA IA' }).getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Abrir PRAVIA IA para hacer una pregunta' })).toBeVisible();
  await notificationButton.click();
  await expect(page.getByRole('dialog', { name: 'Notificaciones' })).toBeVisible();
});
