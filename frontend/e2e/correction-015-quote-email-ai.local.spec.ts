import { expect, test } from '@playwright/test';

const quoteId = process.env.PRAVIA_E2E_QUOTE_ID || '';
const runRealAI = process.env.PRAVIA_E2E_REAL_AI === '1' && Boolean(quoteId);

test('015-07 · Chrome real prepara correo con IA sin confirmar envío', async ({ page }) => {
  test.skip(!runRealAI, 'Requiere una cotización sintética local y proveedor IA de QA.');
  test.setTimeout(120_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill((process.env.PRAVIA_E2E_PASSWORD ?? ''));
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');

  await page.goto(`/cotizaciones/${quoteId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /^COT-/ })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar envío al cliente' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar envío manual a cliente' });
  await expect(dialog.getByRole('button', { name: 'Redactar correo con IA' })).toBeVisible();
  const aiResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/cotizaciones/${quoteId}/correo-ia`));
  await dialog.getByRole('button', { name: 'Redactar correo con IA' }).click();
  expect((await aiResponse).status()).toBe(200);
  await expect(dialog.getByText(/Borrador preparado con IA/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Para', exact: true })).not.toHaveValue('');
  expect((await dialog.getByRole('textbox', { name: 'Asunto', exact: true }).inputValue()).trim().length).toBeGreaterThan(5);
  expect((await dialog.getByRole('textbox', { name: 'Mensaje', exact: true }).inputValue()).trim().length).toBeGreaterThan(40);
  await expect(dialog.getByRole('button', { name: 'Confirmar envío manual' })).toBeVisible();
  await page.screenshot({ path: '/tmp/pravia-c015-email-ai-browser.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
});
