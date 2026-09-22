import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const detailId = '770a40da-3ba5-4d24-a293-75fa8d064c05';
const stageId = '955b61c5-bbeb-4783-bd67-c3b84d07cc28';
const selectorId = '30000000-0000-4000-8000-000000000102';
const dynamicId = '30000000-0000-4000-8000-000000000103';
const quoteId = '30000000-0000-4000-8000-000000000403';
const quoteArtifactId = '30000000-0000-4000-8000-000000000408';
const templateBPath = '/private/tmp/pravia-corr003v2-007-storage-qa/qa-inputs/CFG002-ADM-001-B.docx';
const sharedDocumentPath = '/private/tmp/pravia-corr003v2-007-storage-qa/organizations/30000000-0000-4000-8000-000000000001/documentos/expedientes/770a40da-3ba5-4d24-a293-75fa8d064c05/qa-cotizacion-003v2.docx';
const evidenceDir = resolve(process.cwd(), 'artifacts/qa-correction-003v2-007');
const runId = Date.now().toString().slice(-8);
const temporaryAct = `QA E2E FIRMA SOLVENCIA ${runId}`;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Pravia!QA-Release-2026');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function qaAccessToken(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: {
    email: 'qa.correcciones@pravia.test', password: 'Pravia!QA-Release-2026', remember: false,
  } });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { accessToken?: string; access_token?: string; token?: string };
  const token = body.accessToken ?? body.access_token ?? body.token;
  expect(token).toBeTruthy();
  return token!;
}

async function setQuoteArtifactActive(page: Page, token: string, activo: boolean) {
  const response = await page.request.patch(`/api/settings/catalogs/artifacts/${quoteArtifactId}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { activo },
  });
  expect(response.ok()).toBeTruthy();
}

const field = (page: Page, label: string) => page.locator('#main-content label').filter({ hasText: label }).locator('input,select').first();

test('Corrección 003 v2 + 007: recorrido contractual completo en Chrome real', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 500) networkErrors.push(`${response.status()} ${response.url()}`); });
  await login(page);
  consoleErrors.length = 0;
  networkErrors.length = 0;

  await test.step('002v2-01..07: edición inline, recálculo, add/remove, guardado y ACEPTADA preservada', async () => {
    await page.goto(`/cotizaciones/${quoteId}`);
    await expect(page.getByRole('heading', { name: 'COT-0099-2026', exact: true })).toBeVisible();
    await expect(page.getByText('Aceptada', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Participación PRAVIA', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/versiones editables/i)).toHaveCount(0);
    const quotationTotal = (amount: string) => page.getByRole('definition').filter({ hasText: amount });
    await page.getByLabel('Importe concepto 1').fill('13000');
    await expect(quotationTotal('$20,654.32')).toBeVisible();
    await page.getByRole('button', { name: 'Agregar concepto', exact: true }).click();
    await page.getByLabel('Categoría concepto 3').selectOption('IVA_HONORARIOS');
    await page.getByRole('textbox', { name: 'Concepto 3', exact: true }).fill('IVA temporal QA');
    await page.getByRole('spinbutton', { name: 'Importe concepto 3', exact: true }).fill('2080');
    await expect(quotationTotal('$22,734.32')).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar concepto 3' }).click();
    await expect(quotationTotal('$20,654.32')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados. El estado comercial no cambió.' })).toBeVisible();
    await expect(page.getByText('Aceptada', { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Importe concepto 1')).toHaveValue('13000');
    await expect(page.getByText('Aceptada', { exact: true }).first()).toBeVisible();
  });

  await test.step('002v2-08/10 + preview global: mismo DOCX en Cotización y Expediente, view/download sin mutar original', async () => {
    await page.goto(`/cotizaciones/${quoteId}`);
    const shared = page.getByRole('listitem').filter({ hasText: 'COT-QA-003V2.docx' });
    await expect(shared).toBeVisible();
    await shared.getByRole('button', { name: 'Ver COT-QA-003V2.docx' }).click();
    let viewer = page.getByRole('dialog', { name: 'COT-QA-003V2.docx' });
    await expect(viewer.locator('[data-preview-loaded="true"]')).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const expectedChecksum = createHash('sha256').update(readFileSync(sharedDocumentPath)).digest('hex');
    const downloadEvent = page.waitForEvent('download');
    await shared.getByRole('button', { name: 'Descargar COT-QA-003V2.docx' }).click();
    const downloaded = await downloadEvent;
    const downloadedPath = await downloaded.path();
    expect(downloadedPath).toBeTruthy();
    expect(createHash('sha256').update(readFileSync(downloadedPath!)).digest('hex')).toBe(expectedChecksum);
    await page.goto(`/expedientes/${detailId}#documentos`);
    await page.getByText('COT-QA-003V2.docx', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
    viewer = page.getByRole('dialog', { name: 'COT-QA-003V2.docx' });
    await expect(viewer.locator('[data-preview-loaded="true"]')).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    expect(createHash('sha256').update(readFileSync(sharedDocumentPath)).digest('hex')).toBe(expectedChecksum);
  });

  await test.step('002v2-08/09/11: CFG-002 A→B, históricos intactos, sin plantilla controlado y restauración', async () => {
    await page.goto(`/cotizaciones/${quoteId}`);
    await page.getByRole('button', { name: 'Generar cotización', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Documento de cotización generado desde ADM-001.' })).toBeVisible();
    const generatedA = page.getByRole('listitem').filter({ hasText: 'COT-0099-2026_Documento_1.docx' });
    await generatedA.getByRole('button', { name: /Ver COT-0099-2026_Documento_1\.docx/ }).click();
    let viewer = page.getByRole('dialog', { name: 'COT-0099-2026_Documento_1.docx' });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_A_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();

    await page.goto('/configuracion/plantillas-formatos');
    await page.getByRole('button', { name: /Notaría.*Notaría QA Local/ }).click();
    await page.getByRole('button', { name: /Formatos/ }).click();
    const artifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'ADM-001 · Cotización QA', exact: true }) });
    await expect(artifact).toBeVisible();
    await artifact.getByRole('button', { name: 'Nueva versión', exact: true }).click();
    const versionDialog = page.getByRole('dialog', { name: /Nueva versión · ADM-001/ });
    await versionDialog.locator('input[type="file"]').setInputFiles(templateBPath);
    await versionDialog.getByRole('button', { name: 'Guardar nueva versión', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nueva versión guardada' })).toBeVisible();
    await expect(artifact.getByText('v2', { exact: true })).toBeVisible();

    await page.goto(`/cotizaciones/${quoteId}`);
    await page.getByRole('button', { name: 'Generar cotización', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Documento de cotización generado desde ADM-001.' })).toBeVisible();
    const generatedB = page.getByRole('listitem').filter({ hasText: 'COT-0099-2026_Documento_2.docx' });
    await generatedB.getByRole('button', { name: /Ver COT-0099-2026_Documento_2\.docx/ }).click();
    viewer = page.getByRole('dialog', { name: 'COT-0099-2026_Documento_2.docx' });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_B_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    await generatedA.getByRole('button', { name: /Ver COT-0099-2026_Documento_1\.docx/ }).click();
    viewer = page.getByRole('dialog', { name: 'COT-0099-2026_Documento_1.docx' });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_A_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();

    const token = await qaAccessToken(page);
    expect(networkErrors).toEqual([]);
    expect(consoleErrors.filter((item) => !item.includes('favicon'))).toEqual([]);
    await setQuoteArtifactActive(page, token, false);
    try {
      await page.getByRole('button', { name: 'Generar cotización', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Configura y activa un formato para este destino funcional' })).toBeVisible();
      await expect(page.getByText('COT-0099-2026_Documento_3.docx', { exact: true })).toHaveCount(0);
      expect(consoleErrors.some((item) => item.includes('409 (Conflict)'))).toBeTruthy();
      consoleErrors.length = 0;
    } finally {
      await setQuoteArtifactActive(page, token, true);
    }
    await page.getByRole('button', { name: 'Generar cotización', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'COT-0099-2026_Documento_3.docx' })).toBeVisible();
  });

  await test.step('002v2-10/12: desvinculación no destructiva, reload final y estado comercial limpio', async () => {
    await page.goto(`/cotizaciones/${quoteId}`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('listitem').filter({ hasText: 'COT-QA-003V2.docx' }).getByRole('button', { name: 'Eliminar COT-QA-003V2.docx' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Documento retirado de la cotización.' })).toBeVisible();
    await expect(page.getByText('COT-QA-003V2.docx', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Importe concepto 1')).toHaveValue('13000');
    await expect(page.getByText('Aceptada', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('COT-0099-2026_Documento_1.docx', { exact: true })).toBeVisible();
    await expect(page.getByText('COT-0099-2026_Documento_2.docx', { exact: true })).toBeVisible();
    await expect(page.getByText('COT-0099-2026_Documento_3.docx', { exact: true })).toBeVisible();
    await page.goto(`/expedientes/${detailId}#documentos`);
    await expect(page.getByText('COT-QA-003V2.docx', { exact: true }).first()).toBeVisible();
  });

  await test.step('003v2-01..07: cabecera única, primera, sin Resumen/Notaría y fijos bloqueados', async () => {
    await page.goto(`/expedientes/${detailId}`);
    await expect(page.getByRole('heading', { name: 'Información del expediente', exact: true })).toHaveCount(1);
    const content = page.locator('#main-content');
    await expect(content.getByText('Resumen', { exact: true })).toHaveCount(0);
    const tabs = content.getByRole('tab');
    await expect(tabs.first()).toHaveText('Actos');
    const header = content.locator('section').filter({ has: page.getByRole('heading', { name: 'Información del expediente', exact: true }) }).first();
    await expect(header.getByText('Notaría', { exact: true })).toHaveCount(0);
    await expect(field(page, 'Responsable de creación')).toHaveAttribute('readonly', '');
    await expect(field(page, 'Número de expediente')).toHaveAttribute('readonly', '');
    await expect(field(page, 'Número de expediente')).toHaveValue(/^EXP-\d{4}-\d{4}$/);
  });

  await test.step('003v2-08..11: edición directa, guardado único y persistencia tras reload', async () => {
    const client = `Cliente QA 003v2 ${runId}`;
    await field(page, 'Cliente').fill(client);
    await field(page, 'Abogado responsable').selectOption({ index: 1 });
    await field(page, 'Acto').selectOption({ label: 'Compraventa' });
    await field(page, 'Fecha de firma').fill('2026-09-18');
    await field(page, 'Fecha estimada de firma').fill('2026-09-25');
    await field(page, 'Fecha estimada de entrega').fill('2026-10-02');
    await field(page, 'Número de escritura').fill(`ESC-${runId}`);
    const folios = page.locator('#main-content fieldset').filter({ hasText: 'Folios' });
    await folios.getByLabel('De', { exact: true }).fill(`D-${runId}`);
    await folios.getByLabel('A', { exact: true }).fill(`A-${runId}`);
    await field(page, 'Valor de la operación').fill('1250000.50');
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados.' })).toBeVisible();
    await page.reload();
    await expect(field(page, 'Cliente')).toHaveValue(client);
    await expect(field(page, 'Fecha de firma')).toHaveValue('2026-09-18');
    await expect(field(page, 'Fecha estimada de firma')).toHaveValue('2026-09-25');
    await expect(field(page, 'Fecha estimada de entrega')).toHaveValue('2026-10-02');
    await expect(field(page, 'Número de escritura')).toHaveValue(`ESC-${runId}`);
    await expect(field(page, 'Valor de la operación')).toHaveValue('1250000.5');
  });

  await test.step('003v2-12..14: cabecera común, hash legacy seguro y acciones vigentes', async () => {
    for (const tab of ['Actos', 'Comparecientes', 'Predios / Inmuebles', 'Documentos', 'Seguimiento']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Información del expediente', exact: true })).toHaveCount(1);
    }
    await page.goto(`/expedientes/${detailId}#resumen`);
    await expect(page).toHaveURL(new RegExp(`/expedientes/${detailId}#actos$`));
    await page.getByRole('button', { name: 'Acciones', exact: true }).click();
    await expect(page).toHaveURL(/#seguimiento$/);
    await expect(page.getByRole('heading', { name: 'Seguimiento operativo' })).toBeVisible();
  });

  await test.step('Preview global: PDF/DOCX/PNG/JPG reales, visor canónico y descarga separada', async () => {
    await page.goto(`/expedientes/${detailId}#documentos`);
    const fixtures = ['QA-PREVIEW-PDF.pdf', 'COT-QA-003V2.docx', 'QA-PREVIEW-PNG.png', 'QA-PREVIEW-JPG.jpg'];
    for (const name of fixtures) {
      const doc = page.getByText(name, { exact: true }).first();
      await expect(doc).toBeVisible();
      await doc.click();
      await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
      const viewer = page.getByRole('dialog', { name });
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('[data-preview-loaded="true"]').first()).toBeVisible();
      await expect(viewer.getByRole('button', { name: `Descargar ${name}` })).toBeVisible();
      await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    }
    const pdf = page.getByText('QA-PREVIEW-PDF.pdf', { exact: true });
    await pdf.click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar', exact: true }).click();
    const downloaded = await download;
    expect(downloaded.suggestedFilename()).toBe('QA-PREVIEW-PDF.pdf');
    expect(await downloaded.path()).toBeTruthy();
    await page.reload();
    await page.getByText('COT-QA-003V2.docx', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'COT-QA-003V2.docx' }).locator('[data-preview-loaded="true"]')).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
  });

  await test.step('007-01..02: folio canónico en listado, ficha y otro lector', async () => {
    await page.goto('/expedientes');
    await expect(page.getByText(/^EXP-\d{4}-\d{4}$/).first()).toBeVisible();
    await page.goto('/mi-dia');
    await expect(page.getByText(/^EXP-\d{4}-\d{4}$/).first()).toBeVisible();
  });

  await test.step('007-03..05: ETAPA derivada de Seguimiento real y persistente', async () => {
    await page.goto(`/expedientes/${stageId}#seguimiento`);
    const first = page.getByRole('article', { name: /Preparar firma:/ });
    await expect(first).toBeVisible();
    if (await first.getByRole('button', { name: 'Iniciar', exact: true }).count()) {
      await first.getByRole('button', { name: 'Iniciar', exact: true }).click();
      await expect(page.getByRole('article', { name: /Preparar firma: En proceso/i })).toBeVisible();
    }
    const inProgress = page.getByRole('article', { name: /Preparar firma: En proceso/i });
    await inProgress.getByRole('button', { name: 'Completar', exact: true }).click();
    await expect(page.getByRole('article', { name: /Preparar firma: Completado/i })).toBeVisible();
    await page.goto('/expedientes?stage=Entrega%20al%20cliente');
    await expect(page.getByRole('row', { name: /EXP-0004-2026/ })).toContainText('Entrega al cliente');
    await page.reload();
    await expect(page.getByRole('row', { name: /EXP-0004-2026/ })).toContainText('Entrega al cliente');
  });

  await test.step('007-06..09: escritura real, fecha independiente, columnas/filtros/fila y sin overflow', async () => {
    await page.goto(`/expedientes/${stageId}#seguimiento`);
    await field(page, 'Número de escritura').fill(`E2E-${runId}`);
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados.' })).toBeVisible();
    const deedDate = page.getByRole('region', { name: 'Datos de escrituración' }).getByLabel('Fecha de escritura');
    await deedDate.fill('2026-09-17');
    await page.getByRole('button', { name: 'Guardar fecha' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Fecha de escritura guardada.' })).toBeVisible();
    await page.goto('/expedientes');
    await expect(page.getByRole('columnheader', { name: 'Actualización' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Número de escritura' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Fecha de escritura' })).toBeVisible();
    await page.getByLabel('Filtrar Número escritura').click();
    await page.getByLabel('Filtrar por número de escritura').fill(`E2E-${runId}`);
    await expect(page.getByRole('row', { name: /EXP-0004-2026/ })).toContainText(`E2E-${runId}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  await test.step('007-10..13: selector amplio jerárquico, búsqueda, impacto e incorporación', async () => {
    await page.goto(`/expedientes/${selectorId}#actos`);
    await page.getByRole('button', { name: 'Agregar acto', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar acto' });
    await expect(dialog.getByRole('heading', { name: 'NO TRASLATIVOS', exact: true })).toBeVisible();
    await dialog.getByLabel('Buscar acto').fill('Compraventa');
    await expect(dialog.getByRole('button', { name: /Compraventa/ }).first()).toBeVisible();
    await dialog.getByRole('button', { name: /Compraventa/ }).first().click();
    await dialog.getByRole('button', { name: 'Revisar impacto' }).click();
    await expect(dialog.getByText(/Cambio seguro|Revisión humana requerida/)).toBeVisible();
    const confirmation = dialog.getByText('Confirmo que revisé el impacto sobre el trabajo existente.');
    if (await confirmation.count()) await confirmation.click();
    await dialog.getByRole('button', { name: 'Confirmar cambio' }).click();
    await expect(page.getByRole('heading', { name: 'Actos del expediente' })).toBeVisible();
  });

  await test.step('007-14: catálogo CFG-001 vivo, alta temporal e inactivación sin cambio de código', async () => {
    await page.goto('/configuracion/actos-tiempos');
    await page.getByRole('button', { name: 'Nuevo acto', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo acto' });
    await dialog.getByLabel('Nombre del acto').fill(temporaryAct);
    await dialog.getByLabel('Clasificación').selectOption('TRASLATIVOS');
    await dialog.getByLabel('Familia').fill('QA E2E');
    await dialog.getByLabel('Descripción').fill('Acto sintético temporal para verificar consumo vivo de CFG-001.');
    await dialog.getByRole('button', { name: 'Crear acto' }).click();
    await expect(page.getByRole('heading', { name: temporaryAct })).toBeVisible();
    for (const stage of ['FIRMA', 'INGRESO A SOLVENCIA']) {
      await page.getByRole('button', { name: 'Agregar etapa', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Agregar etapa' });
      await dialog.getByLabel('Nombre de la etapa').fill(stage);
      await dialog.getByRole('button', { name: 'Agregar etapa' }).click();
      await expect(page.getByRole('heading', { name: stage, exact: true })).toBeVisible();
      await page.getByRole('button', { name: `Agregar actividad a ${stage}` }).click();
      dialog = page.getByRole('dialog', { name: 'Nueva actividad o hito' });
      await dialog.getByLabel('Nombre', { exact: true }).fill(stage);
      await dialog.getByLabel('Orden operativo').fill(stage === 'FIRMA' ? '1' : '2');
      await dialog.getByRole('button', { name: 'Guardar actividad' }).click();
      await expect(page.getByText(stage, { exact: true }).last()).toBeVisible();
    }
    if (await page.getByRole('button', { name: 'Marcar revisado' }).count()) await page.getByRole('button', { name: 'Marcar revisado' }).click();
    await page.goto(`/expedientes/${dynamicId}#actos`);
    await page.getByRole('button', { name: 'Agregar acto', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Agregar acto' });
    await expect(dialog.getByRole('heading', { name: 'TRASLATIVOS', exact: true })).toBeVisible();
    await dialog.getByLabel('Buscar acto').fill(temporaryAct);
    await expect(dialog.getByRole('button', { name: new RegExp(temporaryAct) })).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(temporaryAct) }).click();
    await dialog.getByRole('button', { name: 'Revisar impacto' }).click();
    await expect(dialog.getByText(/Cambio seguro|Revisión humana requerida/)).toBeVisible();
    const confirmation = dialog.getByText('Confirmo que revisé el impacto sobre el trabajo existente.');
    if (await confirmation.count()) await confirmation.click();
    await dialog.getByRole('button', { name: 'Confirmar cambio' }).click();
    await expect(page.getByRole('button', { name: new RegExp(temporaryAct) })).toBeVisible();
    await page.goto('/configuracion/actos-tiempos');
    await page.getByPlaceholder('Buscar acto por nombre').fill(temporaryAct);
    const actRow = page.locator('div').filter({ has: page.getByText(temporaryAct, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Inactivar', exact: true }) }).last();
    await actRow.getByRole('button', { name: 'Inactivar', exact: true }).click();
    await expect(page.getByText('Acto inactivado.')).toBeVisible();
    await page.goto(`/expedientes/${dynamicId}#actos`);
    await page.getByRole('button', { name: 'Agregar acto', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Agregar acto' });
    await dialog.getByLabel('Buscar acto').fill(temporaryAct);
    await expect(dialog.getByRole('button', { name: new RegExp(temporaryAct) })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
  });

  await test.step('007-04/15: FIRMA → INGRESO A SOLVENCIA, reload y sin duplicados', async () => {
    await page.goto(`/expedientes/${dynamicId}#seguimiento`);
    const activeAct = page.getByRole('region', { name: temporaryAct });
    const firma = activeAct.getByRole('article', { name: /^FIRMA:/ });
    await expect(firma).toBeVisible();
    await firma.getByRole('button', { name: 'Iniciar', exact: true }).click();
    await activeAct.getByRole('article', { name: /^FIRMA: En proceso/i }).getByRole('button', { name: 'Completar', exact: true }).click();
    await expect(activeAct.getByRole('article', { name: /^INGRESO A SOLVENCIA:/ })).toBeVisible();
    await page.goto('/expedientes?stage=INGRESO%20A%20SOLVENCIA');
    await expect(page.getByRole('row', { name: /EXP-0003-2026/ })).toContainText('INGRESO A SOLVENCIA');
    await page.reload();
    await expect(page.getByRole('row', { name: /EXP-0003-2026/ })).toContainText('INGRESO A SOLVENCIA');
    await page.goto(`/expedientes/${dynamicId}#actos`);
    await expect(page.getByText(temporaryAct, { exact: true })).toHaveCount(1);
  });

  await test.step('Responsive 1440/1366/1024/768/390/320 y evidencia visual', async () => {
    for (const width of [1440, 1366, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 768 ? 1100 : 1000 });
      await page.goto(`/expedientes/${stageId}#actos`);
      await expect(page.getByRole('heading', { name: 'Información del expediente', exact: true })).toBeVisible();
      const layout = await page.evaluate(() => ({ root: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
      expect(layout.root).toBeLessThanOrEqual(1);
      expect(layout.body).toBeLessThanOrEqual(1);
      await page.screenshot({ path: resolve(evidenceDir, `expediente-${width}.png`), fullPage: true });
      await page.goto('/expedientes');
      await expect(page.getByText(/^EXP-\d{4}-\d{4}$/).filter({ visible: true }).first()).toBeVisible();
      const listLayout = await page.evaluate(() => ({ root: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
      expect(listLayout.root).toBeLessThanOrEqual(1);
      expect(listLayout.body).toBeLessThanOrEqual(1);
      await page.screenshot({ path: resolve(evidenceDir, `listado-${width}.png`), fullPage: true });
      await page.goto(`/cotizaciones/${quoteId}`);
      await expect(page.getByRole('heading', { name: 'COT-0099-2026', exact: true })).toBeVisible();
      const quoteLayout = await page.evaluate(() => ({ root: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
      expect(quoteLayout.root).toBeLessThanOrEqual(1);
      expect(quoteLayout.body).toBeLessThanOrEqual(1);
      const generated = page.getByRole('listitem').filter({ hasText: 'COT-0099-2026_Documento_1.docx' });
      await generated.getByRole('button', { name: /Ver COT-0099-2026_Documento_1\.docx/ }).click();
      const viewer = page.getByRole('dialog', { name: 'COT-0099-2026_Documento_1.docx' });
      await expect(viewer.locator('[data-preview-loaded="true"]')).toBeVisible();
      expect(await viewer.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
      await page.screenshot({ path: resolve(evidenceDir, `cotizacion-${width}.png`), fullPage: true });
    }
  });

  await test.step('003v2-15: consola, API y referencias sin errores', async () => {
    expect(networkErrors).toEqual([]);
    expect(consoleErrors.filter((item) => !item.includes('favicon'))).toEqual([]);
  });
});
