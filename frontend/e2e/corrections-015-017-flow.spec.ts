import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.PRAVIA_E2E_API_URL || 'http://127.0.0.1:3001';
const credentials = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  expect((await responsePromise).ok()).toBe(true);
  await page.waitForURL('**/mi-dia');
}

async function accessToken(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/api/auth/login`, { data: credentials });
  expect(response.ok()).toBe(true);
  return String((await response.json()).access_token);
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth, `overflow horizontal ${dimensions.scrollWidth}px > ${dimensions.clientWidth}px`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function confirmProspectAction(page: Page, label: RegExp) {
  await page.getByRole('button', { name: label }).click();
  const confirmation = page.getByRole('group', { name: 'Confirmar acción' });
  await expect(confirmation).toBeVisible();
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && /\/prospectos\/[^/]+\/transiciones$/.test(new URL(response.url()).pathname));
  await confirmation.getByRole('button', { name: 'Confirmar', exact: true }).dispatchEvent('click');
  expect((await responsePromise).ok()).toBe(true);
}

test('correcciones 015–017 · flujo multiacto completo y persistente en Chrome real', async ({ page, request }) => {
  test.setTimeout(420_000);
  const suffix = Date.now().toString().slice(-8);
  const prospectName = `CLIENTE MULTIACTO QA ${suffix}`;
  const serverErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await login(page);
  serverErrors.length = 0;
  consoleErrors.length = 0;

  await test.step('Prospecto mínimo abre ficha con folio canónico', async () => {
    await page.goto('/prospectos', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Nuevo prospecto', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: 'Nuevo prospecto' });
    await createDialog.getByLabel('Nombre o razón social').fill(prospectName);
    await createDialog.getByRole('button', { name: 'Crear prospecto', exact: true }).click();
    await page.waitForURL(/\/prospectos\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: prospectName, exact: true })).toBeVisible();
    await expect(page.getByText(/^PRO-\d{4}-\d{4}$/).first()).toBeVisible();
    await expect(page.getByText('Nuevo', { exact: true }).first()).toBeVisible();
  });

  const prospectId = page.url().split('/').pop()!;
  await test.step('Ficha captura dos actos, contexto y preparación económica sin wizard', async () => {
    const matter = page.getByRole('heading', { name: 'Datos del asunto', exact: true }).locator('xpath=ancestor::section[1]');
    await matter.getByRole('button', { name: 'Editar bloque', exact: true }).click();
    const acts = matter.getByRole('group', { name: 'Actos preliminares' }).getByRole('checkbox');
    expect(await acts.count()).toBeGreaterThan(1);
    await matter.getByRole('checkbox', { name: 'Compraventa', exact: true }).check();
    await matter.getByRole('checkbox', { name: 'Cancelación de hipoteca', exact: true }).check();
    await matter.getByLabel('Descripción breve').fill('Operación local de QA con dos actos relacionados.');
    await matter.getByLabel('Contexto de la operación').fill('Validación integral 015 con trazabilidad multiacto y sin recaptura.');
    let saveResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/api/prospectos/${prospectId}`));
    await matter.getByRole('button', { name: 'Guardar', exact: true }).dispatchEvent('click');
    expect((await saveResponse).ok()).toBe(true);
    await expect(matter.getByText('Validación integral 015 con trazabilidad multiacto y sin recaptura.')).toBeVisible();

    const client = page.getByRole('heading', { name: 'Cliente / solicitante', exact: true }).locator('xpath=ancestor::section[1]');
    await client.getByRole('button', { name: 'Editar bloque', exact: true }).click();
    await page.getByLabel('Correo', { exact: true }).fill(`qa.${suffix}@example.test`);
    await page.getByLabel('Teléfono', { exact: true }).fill('3111234567');
    saveResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/api/prospectos/${prospectId}`));
    await page.getByRole('button', { name: 'Guardar', exact: true }).dispatchEvent('click');
    expect((await saveResponse).ok()).toBe(true);

    const economic = page.getByRole('heading', { name: 'Cotización / preparación económica', exact: true }).locator('xpath=ancestor::section[1]');
    await economic.getByRole('button', { name: 'Editar bloque', exact: true }).click();
    await page.getByLabel('Honorarios', { exact: true }).fill('12000');
    await page.getByLabel('Impuestos y derechos', { exact: true }).fill('3000');
    await page.getByLabel('Total', { exact: true }).fill('15000');
    saveResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/api/prospectos/${prospectId}`));
    await page.getByRole('button', { name: 'Guardar', exact: true }).dispatchEvent('click');
    expect((await saveResponse).ok()).toBe(true);
    await expect(economic).toContainText('$15,000.00');
  });

  await test.step('Documento real se persiste y puede verse tras reload', async () => {
    await page.locator('#initial-document').setInputFiles('artifacts/qa-corrections-011-012-014/011-project-for-manual-review.docx');
    const uploadResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/documentos'));
    await page.getByRole('button', { name: 'Subir seleccionados', exact: true }).click();
    expect((await uploadResponse).ok()).toBe(true);
    await expect(page.getByText('011-project-for-manual-review.docx', { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('011-project-for-manual-review.docx', { exact: true })).toBeVisible();
  });

  await test.step('Workflow Prospecto → Cotización usa acciones contextuales', async () => {
    await confirmProspectAction(page, /Comenzar integración/i);
    await expect(page.getByText('En integración', { exact: true }).first()).toBeVisible();
    await confirmProspectAction(page, /Marcar listo para cotizar/i);
    await expect(page.getByText('Listo para cotizar', { exact: true }).first()).toBeVisible();
    await confirmProspectAction(page, /Solicitar cotización/i);
    await page.waitForURL(/\/cotizaciones\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: /^COT-\d{4}-\d{4}$/ })).toBeVisible();
  });

  const quoteId = page.url().split('/').pop()!;
  await test.step('Cotización hereda dos actos, contexto y presupuesto', async () => {
    await expect(page.getByRole('textbox', { name: /Contexto de la operación/ })).toHaveValue('VALIDACIÓN INTEGRAL 015 CON TRAZABILIDAD MULTIACTO Y SIN RECAPTURA.');
    await expect(page.getByRole('textbox', { name: 'Concepto 1', exact: true })).toHaveValue('Honorarios');
    await expect(page.getByRole('spinbutton', { name: 'Importe concepto 1', exact: true })).toHaveValue('12000');
    await expect(page.getByRole('textbox', { name: 'Concepto 2', exact: true })).toHaveValue('Impuestos y derechos');
    await expect(page.getByRole('spinbutton', { name: 'Importe concepto 2', exact: true })).toHaveValue('3000');
    const subtitle = page.locator('header').filter({ has: page.getByRole('heading', { name: /^COT-/ }) }).first();
    await expect(subtitle.locator('p')).toContainText(',');
  });

  await test.step('Elaboración, envío manual, seguimiento y aceptación formal', async () => {
    await page.getByRole('button', { name: 'Comenzar elaboración', exact: true }).click();
    await page.getByRole('dialog', { name: 'Comenzar elaboración' }).getByRole('button', { name: 'Comenzar elaboración', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrar envío al cliente', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Registrar envío al cliente', exact: true }).click();
    const delivery = page.getByRole('dialog', { name: /Confirmar envío manual a cliente/ });
    await delivery.getByRole('textbox', { name: 'Para', exact: true }).fill(`qa.${suffix}@example.test`);
    await delivery.getByLabel('CC (opcional)').fill('control.qa@example.test');
    await delivery.getByLabel('Asunto').fill(`Cotización multiacto QA ${suffix}`);
    await delivery.getByLabel('Mensaje').fill('Mensaje QA enviado manualmente desde el canal externo controlado.');
    await delivery.getByLabel('Evidencia / nota del envío realizado').fill('Evidencia sintética local: envío confirmado por QA.');
    await delivery.getByRole('button', { name: 'Confirmar envío manual', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Iniciar seguimiento', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Iniciar seguimiento', exact: true }).click();
    await page.getByRole('dialog', { name: 'Iniciar seguimiento' }).getByRole('button', { name: 'Iniciar seguimiento', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrar aceptación', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Registrar aceptación', exact: true }).click();
    const acceptance = page.getByRole('dialog', { name: 'Registrar aceptación' });
    const acceptanceActs = acceptance.getByRole('group', { name: 'Confirma los actos aceptados' }).getByRole('checkbox');
    expect(await acceptanceActs.count()).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < await acceptanceActs.count(); index += 1) await expect(acceptanceActs.nth(index)).toBeChecked();
    await acceptance.getByLabel('Solicitante formal').selectOption({ index: 1 });
    await acceptance.getByRole('button', { name: 'Confirmar aceptación', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Convertir en expediente', exact: true })).toBeVisible();
  });

  await test.step('Conversión crea un expediente exacto con todos los actos', async () => {
    await page.getByRole('button', { name: 'Convertir en expediente', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Convertir a expediente' });
    await expect(dialog).toContainText('Los demás actos aceptados también se incorporarán');
    await dialog.getByRole('button', { name: 'Convertir en expediente', exact: true }).click();
    await page.waitForURL(/\/expedientes\/[0-9a-f-]+/);
    await expect(page.getByRole('textbox', { name: 'Número de expediente', exact: true })).toHaveValue(/^EXP-\d{4}-\d{4}$/);
    await expect(page.getByRole('tabpanel', { name: 'Actos' }).locator('article')).toHaveCount(2);
  });

  const expedienteId = page.url().match(/\/expedientes\/([^#?]+)/)?.[1];
  expect(expedienteId).toBeTruthy();

  await test.step('Porcentaje objeto, comparecientes, documentos y seguimiento están operativos', async () => {
    const actsPanel = page.getByRole('tabpanel', { name: 'Actos' });
    const percentage = actsPanel.getByLabel('Porcentaje objeto').first();
    await percentage.fill('50');
    await actsPanel.getByRole('button', { name: 'Guardar', exact: true }).first().click();
    await expect(percentage).toHaveValue('50');

    await page.getByRole('tab', { name: 'Comparecientes', exact: true }).click();
    const partiesPanel = page.getByRole('tabpanel', { name: 'Comparecientes' });
    await expect(partiesPanel.getByText('Validación de participaciones por acto')).toHaveCount(0);
    await expect(partiesPanel).toContainText('Carlos Adquirente QA');

    await page.getByRole('tab', { name: 'Documentos', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Documentos' })).toContainText('011-project-for-manual-review.docx');

    await page.getByRole('tab', { name: 'Seguimiento', exact: true }).click();
    const tracking = page.getByRole('tabpanel', { name: 'Seguimiento' });
    await expect(tracking.getByRole('heading', { name: 'Seguimiento operativo' })).toBeVisible();
    if (await tracking.getByRole('button', { name: /Preparar (procesos|seguimiento)/ }).count()) {
      await tracking.getByRole('button', { name: /Preparar (procesos|seguimiento)/ }).click();
    }
    const processTable = tracking.getByRole('table', { name: 'Procesos del expediente' });
    await expect(processTable).toBeVisible();
    await expect(processTable.getByRole('columnheader')).toHaveText([
      'Proceso', 'Días restantes', 'Fecha de cumplimiento', 'Responsable', 'Estatus',
    ]);
    await expect(tracking.getByText(/Fecha estimada|Desfase|Notas|Historial/i)).toHaveCount(0);

    const realizeButton = processTable.getByRole('button', { name: 'Realizar', exact: true }).first();
    await expect(realizeButton).toBeVisible();
    const initialRow = realizeButton.locator('xpath=ancestor::*[@role="row"][1]');
    const processName = (await initialRow.getByRole('cell').first().innerText()).trim();
    const responsible = initialRow.getByRole('combobox');
    if (!(await responsible.inputValue())) {
      const assignmentResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/seguimiento\/actividades\//.test(response.url()));
      await responsible.selectOption({ index: 1 });
      expect((await assignmentResponse).ok()).toBe(true);
    }

    const refreshedRow = processTable.getByRole('row').filter({ hasText: processName }).first();
    const selectedResponsible = await refreshedRow.getByRole('combobox').inputValue();
    expect(selectedResponsible).not.toBe('');
    const completionResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/seguimiento\/actividades\//.test(response.url()));
    await refreshedRow.getByRole('button', { name: 'Realizar', exact: true }).click();
    expect((await completionResponse).ok()).toBe(true);
    await expect(refreshedRow).toContainText('Realizado');
    await expect(refreshedRow.locator('[data-label="Días restantes"]')).toHaveText('—');
    await expect(refreshedRow.locator('[data-label="Fecha de cumplimiento"]')).not.toHaveText('—');
    await expect(refreshedRow.getByRole('combobox')).toHaveValue(selectedResponsible);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Seguimiento', exact: true }).click();
    const persistedTracking = page.getByRole('tabpanel', { name: 'Seguimiento' });
    const persistedRow = persistedTracking.getByRole('table', { name: 'Procesos del expediente' }).getByRole('row').filter({ hasText: processName }).first();
    await expect(persistedRow).toContainText('Realizado');
    await expect(persistedRow.locator('[data-label="Fecha de cumplimiento"]')).not.toHaveText('—');
    await expect(persistedRow.getByRole('combobox')).toHaveValue(selectedResponsible);

    await page.getByRole('tab', { name: 'Plantillas y formatos', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Plantillas y formatos' })).toBeVisible();
  });

  await test.step('Persistencia física y relaciones se verifican por API', async () => {
    const token = await accessToken(request);
    const headers = { Authorization: `Bearer ${token}` };
    const prospectResponse = await request.get(`${apiBase}/api/prospectos/${prospectId}`, { headers });
    expect(prospectResponse.ok()).toBe(true);
    const prospect = await prospectResponse.json();
    expect(prospect.actos).toHaveLength(2);
    expect(prospect.cotizacion?.id).toBe(quoteId);

    const quoteResponse = await request.get(`${apiBase}/api/cotizaciones/${quoteId}`, { headers });
    expect(quoteResponse.ok()).toBe(true);
    const quote = await quoteResponse.json();
    expect(quote.actos).toHaveLength(2);
    expect(quote.contexto_operacion).toBe('VALIDACIÓN INTEGRAL 015 CON TRAZABILIDAD MULTIACTO Y SIN RECAPTURA.');
    expect(quote.expediente?.id).toBe(expedienteId);

    const actsResponse = await request.get(`${apiBase}/api/expedientes/${expedienteId}/actos`, { headers });
    expect(actsResponse.ok()).toBe(true);
    const acts = (await actsResponse.json()).data;
    expect(acts).toHaveLength(2);
    expect(Number(acts[0].porcentaje_objeto)).toBe(50);

    const trackingResponse = await request.get(`${apiBase}/api/expedientes/${expedienteId}/seguimiento`, { headers });
    expect(trackingResponse.ok()).toBe(true);
    const tracking = await trackingResponse.json();
    const completedProcess = tracking.procesos.find((item: { estado_operativo: string }) => item.estado_operativo === 'COMPLETADO');
    expect(completedProcess?.fecha_cumplimiento).toBeTruthy();
    expect(completedProcess?.responsable_id).toBeTruthy();

    const activityResponse = await request.get(`${apiBase}/api/expedientes/${expedienteId}/actividad?category=OPERACION&limit=50`, { headers });
    expect(activityResponse.ok()).toBe(true);
    const activity = await activityResponse.json();
    expect(activity.data.some((item: { title?: string }) => /realizado/i.test(item.title || ''))).toBe(true);
  });

  await test.step('Responsive 1440/1366/1024/768/390 sin overflow', async () => {
    for (const viewport of [
      { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 },
      { width: 768, height: 1024 }, { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/expedientes/${expedienteId}#actos`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('tabpanel', { name: 'Actos' })).toBeVisible();
      await noOverflow(page);
    }
  });

  expect(serverErrors).toEqual([]);
  expect(consoleErrors.filter((item) => !/favicon|ResizeObserver/i.test(item))).toEqual([]);
});
