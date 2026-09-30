import { expect, test, type Page } from '@playwright/test';

const credentials = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

test('015-22 · normaliza texto operativo y conserva el formato del correo tras recargar', async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString().slice(-7);
  const rawEmail = `Prueba.Operativa+${suffix}@Example.test`;
  await login(page);
  await page.goto('/prospectos', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Nuevo prospecto', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'Nuevo prospecto' });
  await createDialog.getByLabel('Nombre o razón social').fill(`cliente minúsculas ${suffix}`);
  await createDialog.getByRole('button', { name: 'Crear prospecto', exact: true }).click();
  await page.waitForURL(/\/prospectos\/[0-9a-f-]+$/);

  const client = page.getByRole('heading', { name: 'Cliente / solicitante', exact: true }).locator('xpath=ancestor::section[1]');
  await client.getByRole('button', { name: 'Editar bloque', exact: true }).click();
  await client.getByLabel('Correo').fill(rawEmail);
  let saved = page.waitForResponse((response) => response.request().method() === 'PUT' && /\/api\/prospectos\/[0-9a-f-]+$/.test(new URL(response.url()).pathname));
  await client.getByRole('button', { name: 'Guardar', exact: true }).click();
  expect((await saved).ok()).toBe(true);

  const matter = page.getByRole('heading', { name: 'Datos del asunto', exact: true }).locator('xpath=ancestor::section[1]');
  await matter.getByRole('button', { name: 'Editar bloque', exact: true }).click();
  await matter.getByLabel('Descripción breve').fill('compraventa de inmueble urbano');
  await matter.getByLabel('Contexto de la operación').fill('cliente solicita crédito bancario');
  saved = page.waitForResponse((response) => response.request().method() === 'PUT' && /\/api\/prospectos\/[0-9a-f-]+$/.test(new URL(response.url()).pathname));
  await matter.getByRole('button', { name: 'Guardar', exact: true }).click();
  expect((await saved).ok()).toBe(true);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText(`CLIENTE MINÚSCULAS ${suffix}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(rawEmail, { exact: true })).toBeVisible();
  await expect(page.getByText('COMPRAVENTA DE INMUEBLE URBANO', { exact: true })).toBeVisible();
  await expect(page.getByText('CLIENTE SOLICITA CRÉDITO BANCARIO', { exact: true })).toBeVisible();
});
