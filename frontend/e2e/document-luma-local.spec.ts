import { expect, test } from '@playwright/test';

const caseId = 'cfdd2591-11c0-4339-8cc1-1cf65096c7de';
const archivePath = process.env.PRAVIA_E2E_LUMA_RAR;
const qaPassword = process.env.PRAVIA_E2E_PASSWORD;

test('LUMA: RAR repetido desde Chrome conserva estructura y no duplica blobs', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  if (base.hostname !== '127.0.0.1' || !qaPassword || !archivePath?.endsWith('/PROTO LUMA OESTE.rar')) {
    throw new Error('LOCAL_LUMA_BROWSER_QA_SAFETY_GATE_FAILED');
  }
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(qaPassword);
  // Auth bootstrap can finish while the password is entered and reset the email field.
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${caseId}#documentos`);
  await expect(page.getByRole('heading', { name: 'Explorador documental' })).toBeVisible();
  await expect(page.getByText('18 documentos · Revisión')).toBeVisible();
  await page.locator('input[type=file][accept=".zip,.rar"]').setInputFiles(archivePath);
  await expect(page.getByRole('status').filter({ hasText: 'Validando archivos, estructura y versiones' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '0 documentos incorporados' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('status').filter({ hasText: '14 omitidos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PROTO LUMA OESTE' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('18 documentos · Revisión')).toBeVisible();
  await page.getByRole('button', { name: 'PROTO LUMA OESTE' }).first().click();
  await expect(page.getByRole('button', { name: '01 - ASAMBLEA' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '02 - LUMA OESTE' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '03 - DELEGADO ESPECIAL' }).first()).toBeVisible();
});
