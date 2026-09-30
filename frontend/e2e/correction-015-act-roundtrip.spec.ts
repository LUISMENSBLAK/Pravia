import { expect, test, type Page } from '@playwright/test';

const credentials = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function prospectAction(page: Page, label: RegExp) {
  await page.getByRole('button', { name: label }).click();
  const dialog = page.getByRole('group', { name: 'Confirmar acción' });
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && /\/prospectos\/[^/]+\/transiciones$/.test(new URL(item.url()).pathname));
  await dialog.getByRole('button', { name: 'Confirmar', exact: true }).dispatchEvent('click');
  expect((await response).ok()).toBe(true);
}

test('015-12 · crea variante en CFG-001 desde Cotización y regresa vinculada', async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString().slice(-8);
  const client = `CLIENTE ROUNDTRIP ${suffix}`;
  const variant = `COMPRAVENTA VARIANTE QA ${suffix}`;
  await login(page);

  await page.goto('/prospectos', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Nuevo prospecto', exact: true }).click();
  const newProspect = page.getByRole('dialog', { name: 'Nuevo prospecto' });
  await newProspect.getByLabel('Nombre o razón social').fill(client);
  await newProspect.getByRole('button', { name: 'Crear prospecto', exact: true }).click();
  await page.waitForURL(/\/prospectos\/[0-9a-f-]+$/);

  const matter = page.getByRole('heading', { name: 'Datos del asunto', exact: true }).locator('xpath=ancestor::section[1]');
  await matter.getByRole('button', { name: 'Editar bloque', exact: true }).click();
  await matter.getByRole('checkbox', { name: 'Compraventa', exact: true }).check();
  await matter.getByLabel('Descripción breve').fill('Caso local para validar alta contextual de variante.');
  const saved = page.waitForResponse((item) => item.request().method() === 'PUT' && /\/api\/prospectos\/[0-9a-f-]+$/.test(new URL(item.url()).pathname));
  await matter.getByRole('button', { name: 'Guardar', exact: true }).dispatchEvent('click');
  expect((await saved).ok()).toBe(true);
  await expect(matter.getByText('CASO LOCAL PARA VALIDAR ALTA CONTEXTUAL DE VARIANTE.', { exact: true })).toBeVisible();
  await prospectAction(page, /Comenzar integración/i);
  await prospectAction(page, /Marcar listo para cotizar/i);
  await prospectAction(page, /Solicitar cotización/i);
  await page.waitForURL(/\/cotizaciones\/[0-9a-f-]+$/);
  const quoteUrl = page.url();

  const actsCard = page.getByRole('heading', { name: 'Actos de la cotización', exact: true }).locator('xpath=ancestor::section[1]');
  await actsCard.getByRole('link', { name: '+ Crear nuevo acto en Actos y tiempos', exact: true }).click();
  await page.waitForURL(/\/configuracion\/actos-tiempos/);
  const dialog = page.getByRole('dialog', { name: 'Nuevo acto' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tipo de definición').selectOption('VARIANTE');
  await dialog.getByRole('combobox', { name: 'Acto base', exact: true }).selectOption({ label: 'Compraventa' });
  await dialog.getByLabel('Nombre de la variante').fill(variant);
  await dialog.getByLabel('Descripción').fill('Variante tenant que hereda del acto base canónico.');

  const created = page.waitForResponse((item) => item.request().method() === 'POST' && new URL(item.url()).pathname.endsWith('/settings/catalogs/acts'));
  const attached = page.waitForResponse((item) => item.request().method() === 'POST' && /\/cotizaciones\/[^/]+\/actos$/.test(new URL(item.url()).pathname));
  await dialog.getByRole('button', { name: 'Crear acto', exact: true }).click();
  expect((await created).status()).toBe(201);
  expect([200, 201]).toContain((await attached).status());
  await expect(page).toHaveURL(quoteUrl);
  await expect(actsCard.getByText(variant, { exact: true })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Actos de la cotización', exact: true }).locator('xpath=ancestor::section[1]').getByText(variant, { exact: true })).toBeVisible();
});
