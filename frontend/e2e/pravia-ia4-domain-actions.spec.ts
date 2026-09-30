import { expect, test, type Locator, type Page } from '@playwright/test';

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

async function openAssistant(page: Page) {
  await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'PRAVIA IA' });
  await expect(assistant).toBeVisible();
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();
  return assistant;
}

async function newConversation(assistant: Locator) {
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();
}

async function send(page: Page, assistant: Locator, message: string) {
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/messages'), { timeout: 300_000 });
  const composer = assistant.getByLabel('Pregúntame algo...');
  await composer.fill(message);
  await composer.press('Enter');
  const completed = await response;
  expect(completed.status(), await completed.text()).toBe(200);
}

async function confirm(page: Page, assistant: Locator) {
  const card = assistant.getByRole('region', { name: 'Confirmación requerida' });
  await expect(card).toBeVisible({ timeout: 180_000 });
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/confirmations'), { timeout: 300_000 });
  await card.getByRole('button', { name: /Confirmar|Convertir|Generar|Revisar/ }).click();
  const completed = await response;
  expect(completed.status(), await completed.text()).toBe(200);
  await expect(assistant.getByRole('status').filter({ hasText: 'Acción completada.' }).last()).toBeVisible({ timeout: 300_000 });
}

test.describe.serial('PRAVIA IA 4.0 · acciones de dominio completas', () => {
  test.setTimeout(1_200_000);

  test('crea un expediente desde una cotización aceptada y conserva idempotencia', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    await login(page);
    await page.goto('/cotizaciones/ba80e7cc-c7f1-4012-8cb0-943dbd927e48', { waitUntil: 'domcontentloaded' });
    const assistant = await openAssistant(page);
    await send(page, assistant, 'Convierte la cotización COT-0501-2026 en expediente usando el flujo canónico.');
    const form = assistant.getByRole('form', { name: 'Formulario operativo de PRAVIA IA' });
    await expect(form).toBeVisible({ timeout: 180_000 });
    await form.getByLabel('Fecha y hora efectiva *').fill('2026-09-29T13:15:00-06:00');
    const collected = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith('/assistant/actions/collect'), { timeout: 300_000 });
    await form.getByRole('button', { name: 'Continuar' }).click();
    const collectResponse = await collected;
    expect(collectResponse.status(), await collectResponse.text()).toBe(200);
    await confirm(page, assistant);
    await expect(assistant.getByRole('log')).toContainText(/convertida|expediente|ya estaba vinculada/i, { timeout: 300_000 });
    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const caseLink = page.getByRole('link', { name: 'Ir al expediente' });
    await expect(caseLink).toBeVisible({ timeout: 60_000 });
    await expect(caseLink).toHaveAttribute('href', /\/expedientes\/cfdd2591-11c0-4339-8cc1-1cf65096c7de/);
    expect(serverErrors).toEqual([]);
  });

  test('genera una cotización desde Prospecto mediante las transiciones contractuales', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    await login(page);
    await page.goto('/prospectos/7dc110e6-3deb-4afa-83e4-aa38a06544b3', { waitUntil: 'domcontentloaded' });
    const assistant = await openAssistant(page);

    await send(page, assistant, 'Comienza la integración del prospecto PRO-0506-2026.');
    await confirm(page, assistant);

    await newConversation(assistant);
    await send(page, assistant, 'Marca el prospecto PRO-0506-2026 listo para cotizar.');
    await confirm(page, assistant);

    await newConversation(assistant);
    await send(page, assistant, 'Convierte el prospecto PRO-0506-2026 en cotización mediante el flujo canónico.');
    await confirm(page, assistant);
    await expect(assistant.getByRole('log')).toContainText(/cotización|transición/i, { timeout: 300_000 });

    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Convertido en cotización/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: /Ir a cotización/i }).first()).toBeVisible({ timeout: 60_000 });
    expect(serverErrors).toEqual([]);
  });

  test('extrae propuestas de documentos vigentes sin modificar la ficha maestra', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    await login(page);
    await page.goto('/comparecientes/3a83988e-fafa-4de4-a5f9-235a41ff76a8', { waitUntil: 'domcontentloaded' });
    const assistant = await openAssistant(page);

    await send(page, assistant, 'Extrae información de los documentos vigentes de este compareciente sin modificar datos maestros.');
    const confirmation = assistant.getByRole('region', { name: 'Confirmación requerida' });
    await expect(confirmation).toContainText(/propuestas|revisión humana|no modificará/i, { timeout: 180_000 });
    await confirm(page, assistant);
    await expect(assistant.getByRole('log')).toContainText(/extracción terminó|no se modificaron datos maestros/i, { timeout: 300_000 });

    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('GONZALEZ MIRAMONTES', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    expect(serverErrors).toEqual([]);
  });

  test('genera y revisa el proyecto vigente desde el chat sin editar automáticamente el DOCX', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    await login(page);
    await page.goto('/expedientes/7a139000-0000-4000-8000-000000000001#proyecto', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Proyecto/i }).first()).toBeVisible({ timeout: 60_000 });
    const assistant = await openAssistant(page);

    await send(page, assistant, 'Proyecta la escritura con IA usando el machote vigente y las fuentes seleccionadas. Conserva la estructura del machote y no inventes datos faltantes.');
    await confirm(page, assistant);
    await expect(assistant.getByRole('log')).toContainText(/proyecto quedó generado|listo para revisión/i, { timeout: 300_000 });

    await newConversation(assistant);
    await send(page, assistant, 'Revisa con IA el proyecto vigente contra sus documentos fuente. Genera un reporte separado y no modifiques el Word.');
    const reviewConfirmation = assistant.getByRole('region', { name: 'Confirmación requerida' });
    await expect(reviewConfirmation).toContainText(/reporte separado|no editará|no aplicará/i, { timeout: 180_000 });
    await confirm(page, assistant);
    await expect(assistant.getByRole('log')).toContainText(/revisión terminó|proyecto no fue modificado/i, { timeout: 300_000 });

    await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Proyecto V\d+ · .*fuentes analizadas/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Origen PRAVIA_IA/i).first()).toBeVisible({ timeout: 60_000 });
    expect(serverErrors).toEqual([]);
  });
});
