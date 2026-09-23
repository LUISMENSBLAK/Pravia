import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const expedienteId = '770a40da-3ba5-4d24-a293-75fa8d064c05';
const exclusiveTemplate = '/private/tmp/pravia-corr011-012-014-storage-qa/organizations/30000000-0000-4000-8000-000000000001/qa/correction-011/Machote_Proyecto_QA.docx';
const evidenceDir = resolve(process.cwd(), 'artifacts/qa-exp010-project-ux');

async function login(page: Page, email = 'qa.correcciones@pravia.test', password = 'Pravia!QA-Release-2026') {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function openProject(page: Page) {
  await page.goto(`/expedientes/${expedienteId}#proyecto`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Proyecto de escritura', exact: true })).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
}

test('EXP-010 · flujo fácil único, persistencia, preview y responsive', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });

  await login(page);
  consoleErrors.length = 0;
  await openProject(page);

  const primary = page.getByRole('button', { name: 'PROYECTAR ESCRITURA', exact: true });
  await expect(primary).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Generar proyecto|Generar desde machote/i })).toHaveCount(0);
  await expect(page.getByText('Machote sugerido', { exact: true })).toBeVisible();
  await expect(page.getByText(/Machote proyecto notarial QA · v1/).first()).toBeVisible();
  const advanced = page.getByText('Opciones avanzadas', { exact: true }).locator('..');
  await expect(advanced).not.toHaveAttribute('open');

  const instruction = 'QA_INSTRUCCION_PROYECCION_20260922 · Revisa especialmente el antecedente de subdivisión.';
  await page.getByLabel(/Indicaciones para la proyección/i).fill(instruction);
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`/expedientes/${expedienteId}/proyecto/generar`));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/expedientes/${expedienteId}/proyecto/generar`), { timeout: 180_000 });
  await primary.click();
  await expect(page.getByRole('status').filter({ hasText: /Integrando expediente/ })).toBeVisible();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBe(201);
  expect(request.postDataJSON()).toMatchObject({ instructions: instruction, origin: 'UI', template_version_id: '31100000-0000-4000-8000-000000000011' });
  const payload = await response.json();
  expect(payload).toMatchObject({ instructions_consumed: true, generation_origin: 'UI', docx_structural_fidelity: 'PASS', template: { exclusive: false } });
  expect(payload.instruction_focus).toContain('ANTECEDENTE');
  expect(payload.instruction_focus).toContain('SUBDIVISION');
  const version = payload.version.version_numero as number;
  await expect(page.getByRole('region', { name: 'Proyecto generado' })).toContainText(`Versión ${version}`);
  await page.getByRole('button', { name: 'Ver proyecto', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: new RegExp(`Proyecto_.*_V${version}\\.docx`) });
  await expect(viewer.locator('[data-preview-loaded="true"]')).toBeVisible({ timeout: 120_000 });
  await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(`Versión ${version}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Origen UI.*Machote proyecto notarial QA v1/).first()).toBeVisible();

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    await openProject(page);
    await expect(page.getByRole('button', { name: 'PROYECTAR ESCRITURA', exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: `${evidenceDir}/project-${viewport.width}.png`, fullPage: true });
  }

  expect(serverErrors).toEqual([]);
  expect(consoleErrors.filter((item) => !/favicon|ResizeObserver/i.test(item))).toEqual([]);
});

test('EXP-010 · opciones avanzadas, machote exclusivo y flujo Review separado', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(evidenceDir, { recursive: true });
  await login(page);
  await openProject(page);
  await expect(page.getByText(/Machote proyecto notarial QA · v1/).first()).toBeVisible();

  const options = page.locator('details').filter({ hasText: 'Opciones avanzadas' }).first();
  await options.locator(':scope > summary').click();
  await expect(options).toHaveAttribute('open', '');
  await expect(options.getByLabel('Cambiar machote')).toHaveValue('31100000-0000-4000-8000-000000000011');
  await options.getByText(/Ver \/ ajustar fuentes/).click();
  const source = options.locator('label').filter({ hasText: 'Certificado_Literal_QA.docx' }).getByRole('checkbox');
  await expect(source).toBeChecked();
  await source.uncheck();
  await source.check();
  await options.locator('input[type="file"][accept=".docx"]').setInputFiles(exclusiveTemplate);
  await expect(options.getByText(/Machote_Proyecto_QA\.docx/).first()).toBeVisible();

  const generationResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/expedientes/${expedienteId}/proyecto/generar-desde-machote`), { timeout: 180_000 });
  await page.getByRole('button', { name: 'PROYECTAR ESCRITURA', exact: true }).click();
  const response = await generationResponse;
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload).toMatchObject({ generation_origin: 'UI', template: { exclusive: true, name: 'Machote_Proyecto_QA.docx' } });
  const version = payload.version.version_numero as number;
  await expect(page.getByRole('region', { name: 'Proyecto generado' })).toContainText(`Versión ${version}`);
  const reviewInputPath = `${evidenceDir}/exclusive-project-v${version}.docx`;
  const download = page.waitForEvent('download');
  await page.getByRole('region', { name: 'Proyecto generado' }).getByRole('button', { name: 'Descargar Word', exact: true }).click();
  await (await download).saveAs(reviewInputPath);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Origen UI.*Machote_Proyecto_QA\.docx v1/).first()).toBeVisible();

  const review = page.locator('section').filter({ has: page.getByRole('heading', { name: '¿Ya tienes un proyecto?', exact: true }) });
  await expect(review.getByRole('button', { name: 'REVISAR PROYECTO', exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'REVISAR PROYECTO', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Cargar nueva versión', exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Revisar versión vigente', exact: true })).toBeEnabled();
  const uploadResponse = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith(`/expedientes/${expedienteId}/proyecto/upload`));
  await review.locator('input[type="file"][accept=".docx"]').setInputFiles(reviewInputPath);
  expect((await uploadResponse).status()).toBe(201);
  await expect(page.getByRole('status').filter({ hasText: 'La versión quedó cargada' })).toBeVisible();
  const reviewResponse = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith(`/expedientes/${expedienteId}/proyecto/analizar-ia`), { timeout: 360_000 });
  await review.getByRole('button', { name: 'Revisar versión vigente', exact: true }).click();
  const reviewed = await reviewResponse;
  expect(reviewed.status()).toBe(201);
  await expect(page.getByRole('region', { name: 'Resultado de la revisión notarial' })).toBeVisible({ timeout: 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Resultado de la revisión notarial' })).toBeVisible();
  await expectNoOverflow(page);
});

test('PRAVIA IA usa el mismo EXP-010 y conserva las indicaciones de la pantalla', async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  await openProject(page);
  await expect(page.getByText(/Machote proyecto notarial QA · v1/).first()).toBeVisible();
  const fieldInstruction = 'Conservar literalmente la cláusula tercera.';
  await page.getByLabel(/Indicaciones para la proyección/i).fill(fieldInstruction);

  await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'PRAVIA IA' });
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();
  const messageInput = assistant.getByLabel('Pregúntame algo...');
  await expect(messageInput).toBeEnabled();
  await messageInput.fill('Proyéctalo.');
  const messageResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/messages'), { timeout: 180_000 });
  await messageInput.press('Enter');
  const preparedResponse = await messageResponse;
  expect(preparedResponse.status()).toBe(200);
  const preparedPayload = JSON.stringify(await preparedResponse.json());
  expect(preparedPayload).toContain('Machote proyecto notarial QA');
  expect(preparedPayload).toContain('Conservar literalmente la cláusula');

  const confirmation = assistant.getByRole('region', { name: 'Confirmación requerida' });
  await expect(confirmation).toBeVisible({ timeout: 180_000 });
  await expect(confirmation).toContainText('EXP-010');
  await expect(confirmation).toContainText('Machote proyecto notarial QA');
  await expect(confirmation.getByRole('button', { name: 'REVISAR FUENTES', exact: true })).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'CAMBIAR MACHOTE', exact: true })).toBeVisible();

  const confirmResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/confirmations'), { timeout: 180_000 });
  await confirmation.getByRole('button', { name: 'Generar proyecto', exact: true }).click();
  expect((await confirmResponse).status()).toBe(200);
  await expect(assistant.getByRole('status').filter({ hasText: 'Acción completada.' })).toBeVisible({ timeout: 180_000 });
  await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();
  await expect(page.getByText(/Origen PRAVIA_IA.*Machote proyecto notarial QA v1/).first()).toBeVisible();
  await expect(page.getByText(`Indicaciones: ${fieldInstruction}`, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Ver versión / }).first().click();
  const viewer = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Cerrar vista previa' }) });
  await expect(viewer.locator('[data-preview-loaded="true"]')).toBeVisible({ timeout: 120_000 });
  await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();

  await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();
  await messageInput.fill('Proyéctalo y revisa especialmente el antecedente.');
  const secondMessageResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/messages'), { timeout: 180_000 });
  await messageInput.press('Enter');
  const secondPrepared = await secondMessageResponse;
  expect(secondPrepared.status()).toBe(200);
  expect(JSON.stringify(await secondPrepared.json())).toContain('Revisa especialmente el antecedente.');
  await expect(confirmation).toBeVisible({ timeout: 180_000 });
  const secondConfirmResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/confirmations'), { timeout: 180_000 });
  await confirmation.getByRole('button', { name: 'Generar proyecto', exact: true }).click();
  expect((await secondConfirmResponse).status()).toBe(200);
  await expect(assistant.getByRole('status').filter({ hasText: 'Acción completada.' })).toBeVisible({ timeout: 180_000 });
  await assistant.getByRole('button', { name: 'Cerrar PRAVIA IA' }).click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Origen PRAVIA_IA.*Machote proyecto notarial QA v1/).first()).toBeVisible();
  await expect(page.getByText(`Indicaciones: ${fieldInstruction}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Indicaciones: Revisa especialmente el antecedente.', { exact: true }).first()).toBeVisible();
});

test('usuario de consulta puede leer Proyecto pero no generar por UI ni PRAVIA IA', async ({ page }) => {
  test.setTimeout(300_000);
  const generationRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/proyecto\/generar(?:-desde-machote)?$/.test(new URL(request.url()).pathname)) generationRequests.push(request.url());
  });
  await login(page, 'consulta.proyecto.qa@pravia.test', 'Synthetic-ReadOnly-2026!');
  await openProject(page);
  await expect(page.getByRole('button', { name: 'PROYECTAR ESCRITURA', exact: true })).toBeDisabled();
  await expect(page.getByText('Tu función actual no permite generar proyectos.')).toBeVisible();

  await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: 'PRAVIA IA' });
  await assistant.getByRole('button', { name: 'Nueva conversación' }).click();
  const input = assistant.getByLabel('Pregúntame algo...');
  await input.fill('Proyéctalo.');
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/assistant/messages'), { timeout: 180_000 });
  await input.press('Enter');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.confirmation).toBeUndefined();
  await expect(assistant.getByRole('region', { name: 'Confirmación requerida' })).toHaveCount(0);
  expect(generationRequests).toEqual([]);
});
