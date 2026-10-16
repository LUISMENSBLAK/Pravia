import { expect, request as requestFactory, test, type Page } from '@playwright/test';

test('Mi Día: tarjeta PRAVIA IA abre chat contextual y respeta permiso financiero', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const adminPassword = process.env.PRAVIA_E2E_PASSWORD || '';
  const lawyerPassword = process.env.PRAVIA_E2E_MARIA_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !adminPassword || !lawyerPassword) {
    throw new Error('MI_DIA_ASSISTANT_LOCAL_ONLY');
  }
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const accounts = [
    { email: 'adrian.hernandez@pravia.test', password: adminPassword, finance: true },
    { email: 'maria.careaga@pravia.test', password: lawyerPassword, finance: false },
  ];
  const tokens: string[] = [];
  const loginUi = async (tab: Page, emailAddress: string, secret: string) => {
    await tab.goto('/login');
    const email = tab.getByRole('textbox', { name: 'Correo electrónico' });
    const password = tab.getByRole('textbox', { name: 'Contraseña' });
    const submit = tab.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await email.fill(emailAddress);
      await password.fill(secret);
      if (await submit.isEnabled()) break;
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(tab).toHaveURL(/\/mi-dia$/);
  };
  for (const account of accounts) {
    const response = await api.post('/api/auth/login', { data: { email: account.email, password: account.password } });
    expect(response.status()).toBe(200);
    const token = (await response.json() as { access_token: string }).access_token;
    tokens.push(token);
    expect((await api.delete('/api/mi-dia/layout', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  }
  try {
    for (const [index, account] of accounts.entries()) {
      if (index > 0) {
        await page.getByRole('button', { name: /Menú de usuario de/ }).click();
        await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
        await expect(page).toHaveURL(/\/login$/);
      }
      await loginUi(page, account.email, account.password);
      await page.getByRole('button', { name: 'Personalizar Mi Día' }).click();
      const save = page.waitForResponse((response) => response.url().endsWith('/api/mi-dia/layout') && response.request().method() === 'PUT');
      await page.getByRole('region', { name: 'Personalizar Mi Día' })
        .getByRole('button', { name: /^Asistente PRAVIA IA ·/ }).click();
      expect((await save).status()).toBe(200);
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'PRAVIA IA', exact: true }) }).first();
      await expect(card.getByRole('button', { name: 'Buscar expediente' })).toBeVisible();
      const finance = card.getByRole('button', { name: 'Resumen financiero' });
      if (account.finance) await expect(finance).toBeEnabled();
      else await expect(finance).toBeDisabled();
      await card.getByRole('button', { name: 'Buscar expediente' }).click();
      const dialog = page.getByRole('dialog', { name: 'PRAVIA IA' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Pregúntame algo...' }))
        .toHaveValue('Ayúdame a buscar un expediente.');
      await dialog.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
      if (account.finance) {
        await finance.click();
        await expect(dialog.getByRole('textbox', { name: 'Pregúntame algo...' }))
          .toHaveValue('Muéstrame el resumen financiero disponible.');
        await dialog.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
      }
      await page.reload();
      await expect(page.getByRole('heading', { name: 'PRAVIA IA', exact: true })).toBeVisible();
    }
  } finally {
    for (const token of tokens) {
      expect((await api.delete('/api/mi-dia/layout', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
    }
    await api.dispose();
  }
});
