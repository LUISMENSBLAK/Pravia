import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const expedienteId = '7a139000-0000-4000-8000-000000000001';

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const password = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  await email.fill('qa.correcciones@pravia.test');
  await password.fill((process.env.PRAVIA_E2E_PASSWORD ?? ''));
  await page.waitForTimeout(500);
  if (await email.inputValue() !== 'qa.correcciones@pravia.test') await email.fill('qa.correcciones@pravia.test');
  if (await password.inputValue() !== (process.env.PRAVIA_E2E_PASSWORD ?? '')) await password.fill((process.env.PRAVIA_E2E_PASSWORD ?? ''));
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await page.waitForURL('**/mi-dia');
}

test('PRAVIA IA 4.0 · carga universal, extracción y promoción oficial desde el chat', async ({ page }) => {
  test.setTimeout(600_000);
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];

  await login(page);
  // La pantalla de login consulta /auth/me antes de tener una sesión por diseño.
  // A partir de aquí toda la navegación autenticada sí debe quedar limpia.
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`/expedientes/${expedienteId}#documentos`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'PRAVIA IA' });
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();

  const fixtures = [
    '/tmp/pravia-ia-qa-fixture.pdf',
    resolve(process.cwd(), 'artifacts/qa-corrections-011-012-014/011-project-controlled-defects.docx'),
    resolve(process.cwd(), '../brand/pravia-ai/owl-success.png'),
    resolve(process.cwd(), '../brand/pravia-ai/owl-master-reference.jpg'),
    resolve(process.cwd(), 'node_modules/.pnpm/mammoth@1.12.3/node_modules/mammoth/test/test-data/simple/word/document.xml'),
    resolve(process.cwd(), 'node_modules/.pnpm/mammoth@1.12.3/node_modules/mammoth/test/test-data/hello.zip'),
  ];
  const expectedNames = fixtures.map((item) => item.split('/').at(-1)!);
  const uploads: Array<{ status: number; contentType: string }> = [];
  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && /\/assistant\/conversations\/[^/]+\/attachments$/.test(new URL(response.url()).pathname)) {
      uploads.push({ status: response.status(), contentType: String(response.headers()['content-type'] || '') });
    }
  });

  const input = assistant.locator('input[type="file"][multiple]');
  await expect(input).toHaveAttribute('accept', '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xml,.zip,.mp3,.m4a,.wav,.ogg,.webm');
  await input.setInputFiles(fixtures);
  const attachments = assistant.getByLabel('Adjuntos temporales');
  await expect(attachments).toBeVisible({ timeout: 180_000 });
  for (const name of expectedNames) await expect(attachments).toContainText(name, { timeout: 180_000 });
  expect(uploads).toHaveLength(6);
  expect(uploads.every((item) => item.status === 200 || item.status === 201)).toBe(true);

  const prompt = 'Incorpora estos seis archivos al expediente actual como tipo DOCUMENTO_QA_IA4. Conserva su trazabilidad y no dupliques blobs.';
  const composer = assistant.getByLabel('Pregúntame algo...');
  await composer.fill(prompt);
  const preparedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/messages'), { timeout: 300_000 });
  await composer.press('Enter');
  const prepared = await preparedResponse;
  expect(prepared.status(), await prepared.text()).toBe(200);

  const confirmation = assistant.getByRole('region', { name: 'Confirmación requerida' });
  await expect(confirmation).toBeVisible({ timeout: 180_000 });
  await expect(confirmation).toContainText('Incorporar los archivos adjuntos');
  await expect(confirmation).toContainText('EXPEDIENTE');
  const confirmationResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/confirmations'), { timeout: 300_000 });
  await confirmation.getByRole('button', { name: 'Confirmar cambio administrativo', exact: true }).click();
  const completed = await confirmationResponse;
  expect(completed.status(), await completed.text()).toBe(200);
  await expect(assistant.getByRole('status').filter({ hasText: 'Acción completada.' })).toBeVisible({ timeout: 180_000 });
  await expect(assistant.getByText('6 archivo(s) quedaron incorporados al registro', { exact: false })).toBeVisible();
  await expect(attachments).toHaveCount(0);

  await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (const name of expectedNames) await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  expect(serverErrors).toEqual([]);
  expect(consoleErrors.filter((item) => !/favicon|ResizeObserver/i.test(item))).toEqual([]);
});
