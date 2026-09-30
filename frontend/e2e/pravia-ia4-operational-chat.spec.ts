import { expect, test, type Locator, type Page } from '@playwright/test';

async function login(page: Page, email = 'qa.correcciones@pravia.test', password = (process.env.PRAVIA_E2E_PASSWORD ?? '')) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.waitForTimeout(500);
  if (await emailInput.inputValue() !== email) await emailInput.fill(email);
  if (await passwordInput.inputValue() !== password) await passwordInput.fill(password);
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await page.waitForURL('**/mi-dia');
}

async function newConversation(assistant: Locator) {
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();
}

async function send(page: Page, assistant: Locator, prompt: string) {
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/messages'), { timeout: 300_000 });
  const composer = assistant.getByLabel('Pregúntame algo...');
  await composer.fill(prompt);
  await composer.press('Enter');
  const completed = await response;
  expect(completed.status(), await completed.text()).toBe(200);
}

async function confirm(page: Page, assistant: Locator) {
  const card = assistant.getByRole('region', { name: 'Confirmación requerida' });
  await expect(card).toBeVisible({ timeout: 180_000 });
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/confirmations'), { timeout: 300_000 });
  await card.getByRole('button', { name: /Confirmar/ }).click();
  const completed = await response;
  expect(completed.status(), await completed.text()).toBe(200);
  await expect(assistant.getByRole('status').filter({ hasText: 'Acción completada.' })).toBeVisible({ timeout: 180_000 });
}

test.describe.serial('PRAVIA IA 4.0 · orquestación operativa desde el chat', () => {
  test.setTimeout(900_000);

  test('crea cita real, consulta finanzas y detecta pendientes con datos autorizados', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    await login(page);
    await page.goto('/agenda', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
    const assistant = page.getByRole('dialog', { name: 'PRAVIA IA' });

    const suffix = Date.now().toString().slice(-7);
    const title = `Cita IA4 Chrome ${suffix}`;
    await newConversation(assistant);
    await send(page, assistant, `Crea una cita titulada "${title}" el 30 de septiembre de 2026 a las 10:30, hora de Bahía de Banderas.`);
    await expect(assistant.getByText('Listo, el evento quedó creado en Agenda.', { exact: false })).toBeVisible({ timeout: 180_000 });

    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
    await newConversation(assistant);
    await send(page, assistant, 'Consulta el resumen financiero real de esta organización durante este mes. No hagas ningún cambio.');
    await expect(assistant.getByRole('log')).toContainText(/finanz|honorarios|movimientos|datos/i, { timeout: 180_000 });
    await expect(assistant.getByRole('region', { name: 'Confirmación requerida' })).toHaveCount(0);

    await newConversation(assistant);
    await send(page, assistant, '¿Qué expedientes requieren atención y qué pendientes objetivos existen? No inventes información.');
    await expect(assistant.getByRole('log')).toContainText(/pendiente|atención|expediente/i, { timeout: 180_000 });
    expect(serverErrors).toEqual([]);
  });

  test('usa formularios reales para crear compareciente e inmueble y persiste ambos', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    await login(page);
    await page.goto('/comparecientes', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
    const assistant = page.getByRole('dialog', { name: 'PRAVIA IA' });
    const suffix = Date.now().toString().slice(-7);
    const party = `Persona IA Cuatro ${suffix}`;

    await newConversation(assistant);
    await send(page, assistant, 'Registrar nuevo compareciente.');
    const form = assistant.getByRole('form', { name: 'Formulario operativo de PRAVIA IA' });
    await expect(form).toBeVisible({ timeout: 180_000 });
    await form.getByLabel('Tipo de persona *').selectOption('FISICA');
    await form.getByLabel('Nombre o razón social *').fill(party);
    const collected = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/actions/collect'), { timeout: 300_000 });
    await form.getByRole('button', { name: 'Continuar' }).click();
    const collectResponse = await collected;
    expect(collectResponse.status(), await collectResponse.text()).toBe(200);
    await confirm(page, assistant);

    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(party.toLocaleUpperCase('es-MX'), { exact: false }).first()).toBeVisible({ timeout: 60_000 });

    await page.goto('/predios', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
    const property = `Inmueble IA4 ${suffix}`;
    await newConversation(assistant);
    await send(page, assistant, 'Crear un nuevo predio o inmueble.');
    const propertyForm = assistant.getByRole('form', { name: 'Formulario operativo de PRAVIA IA' });
    await expect(propertyForm).toBeVisible({ timeout: 180_000 });
    await propertyForm.getByLabel('Ubicación del inmueble *', { exact: true }).fill(`Calle QA ${suffix}, Bahía de Banderas, Nayarit`);
    const propertyCollected = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/actions/collect'), { timeout: 300_000 });
    await propertyForm.getByRole('button', { name: 'Continuar' }).click();
    const propertyCollectResponse = await propertyCollected;
    expect(propertyCollectResponse.status(), await propertyCollectResponse.text()).toBe(200);
    await confirm(page, assistant);

    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Calle QA ${suffix}`, { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    expect(serverErrors).toEqual([]);
  });
});
