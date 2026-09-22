import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const detailId = '770a40da-3ba5-4d24-a293-75fa8d064c05';
const selectorId = '30000000-0000-4000-8000-000000000102';
const quoteId = '30000000-0000-4000-8000-000000000403';
const quoteArtifactId = '30000000-0000-4000-8000-000000000408';
const root = '/private/tmp/pravia-corr003v2-007-storage-qa';
const inePath = `${root}/qa-inputs/CMP-008-INE.docx`;
const predioPath = `${root}/qa-inputs/PRD-009-PREDIO.docx`;
const templateAPath = `${root}/organizations/30000000-0000-4000-8000-000000000001/catalogos/qa/ADM-001-A.docx`;
const templateBPath = `${root}/qa-inputs/CFG002-ADM-001-B.docx`;
const pdfPath = `${root}/organizations/30000000-0000-4000-8000-000000000001/documentos/expedientes/${detailId}/qa-preview-real.pdf`;
const pngPath = `${root}/organizations/30000000-0000-4000-8000-000000000001/documentos/expedientes/${detailId}/qa-preview-real.png`;
const jpgPath = `${root}/organizations/30000000-0000-4000-8000-000000000001/documentos/expedientes/${detailId}/qa-preview-real.jpg`;
const evidenceDir = resolve(process.cwd(), 'artifacts/qa-corrections-008-009-010');
const runId = Date.now().toString().slice(-8);

async function login(page: Page) {
  await open(page, '/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Pravia!QA-Release-2026');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

const open = (page: Page, path: string) => page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });

async function token(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', { data: { email: 'qa.correcciones@pravia.test', password: 'Pravia!QA-Release-2026', remember: false } });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { accessToken?: string; access_token?: string; token?: string };
  const value = body.accessToken || body.access_token || body.token;
  expect(value).toBeTruthy();
  return value!;
}

const auth = (value: string) => ({ Authorization: `Bearer ${value}` });
const bodyData = async (response: any) => {
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = await response.json();
  return payload.data ?? payload;
};

async function upload(request: APIRequestContext, path: string, bearer: string, multipart: Record<string, string>, filePath: string, name: string, mimeType: string) {
  const response = await request.post(path, {
    headers: auth(bearer),
    multipart: { ...multipart, file: { name, mimeType, buffer: readFileSync(filePath) } },
  });
  return bodyData(response);
}

test('Correcciones 008 v2 + 009 + 010: recorrido integrado en Chrome real', async ({ page, request }) => {
  test.setTimeout(1_800_000);
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 500) networkErrors.push(`${response.status()} ${response.url()}`); });
  await login(page);
  const bearer = await token(request);
  consoleErrors.length = 0;
  networkErrors.length = 0;

  let pfId = '';
  let pmId = '';
  let predioId = '';

  await test.step('PF 1..12: documentos vigentes, IA real, CIC/OCR, decisión humana y persistencia', async () => {
    const created = await bodyData(await request.post('/api/comparecientes/persona-fisica', {
      headers: auth(bearer),
      data: { nombre: `María QA ${runId}`, apellido_paterno: 'Controlada', apellido_materno: 'Local', nacionalidad: 'Mexicana', pep_estado: 'NO' },
    }));
    pfId = created.compareciente.id;
    await upload(request, `/api/comparecientes/${pfId}/documentos`, bearer, { categoria: 'IDENTIFICACION', vigencia: 'VIGENTE' }, inePath, `INE-VIGENTE-${runId}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await upload(request, `/api/comparecientes/${pfId}/documentos`, bearer, { categoria: 'IDENTIFICACION', vigencia: 'HISTORICO' }, pdfPath, `INE-HISTORICA-${runId}.pdf`, 'application/pdf');

    await open(page, `/comparecientes/${pfId}`);
    await expect(page.getByRole('heading', { name: new RegExp(`María QA ${runId}`, 'i') })).toBeVisible();
    await expect(page.locator('article').filter({ hasText: `INE-VIGENTE-${runId}.docx` })).toBeVisible();
    await expect(page.locator('article').filter({ hasText: `INE-HISTORICA-${runId}.pdf` })).toContainText('Histórico');
    await page.getByRole('button', { name: 'Extraer información con IA', exact: true }).click();
    await expect(page.getByText('Identificadores detectados en INE', { exact: true })).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText('CIC: IDMEX1234567890', { exact: false })).toBeVisible();
    await expect(page.getByText('OCR: 9876543210123', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Folio', { exact: true })).toHaveValue('');
    await expect(page.getByText(/Clave de Elector/i)).toHaveCount(0);
    await page.getByText('CIC: IDMEX1234567890', { exact: false }).click();
    await expect(page.getByLabel('Folio', { exact: true })).toHaveValue('IDMEX1234567890');
    await page.locator('label').filter({ hasText: /^CURP/ }).locator('input').fill('');
    await page.locator('label').filter({ hasText: /^RFC/ }).locator('input').first().fill('');
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados correctamente.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Folio', { exact: true })).toHaveValue('IDMEX1234567890');
    await expect(page.locator('article').filter({ hasText: `INE-HISTORICA-${runId}.pdf` })).toBeVisible();
  });

  await test.step('PM 1..18: estructura vigente, vinculación canónica, administración e identificación separada de BC', async () => {
    const created = await bodyData(await request.post('/api/comparecientes/persona-moral', {
      headers: auth(bearer),
      data: { razon_social: `Sociedad QA ${runId}, S.A. de C.V.`, tipo_societario: 'SOCIEDAD ANÓNIMA', nacionalidad: 'Mexicana' },
    }));
    pmId = created.compareciente.id;
    await upload(request, `/api/comparecientes/${pmId}/documentos`, bearer, { categoria: 'ACTA_CONSTITUTIVA', vigencia: 'VIGENTE' }, predioPath, `ACTA-VIGENTE-${runId}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await upload(request, `/api/comparecientes/${pmId}/documentos`, bearer, { categoria: 'ACTA_CONSTITUTIVA', vigencia: 'HISTORICO' }, pdfPath, `ACTA-HISTORICA-${runId}.pdf`, 'application/pdf');
    const current = await bodyData(await request.get(`/api/comparecientes/${pmId}/estructura-propiedad`, { headers: auth(bearer) }));
    const rootId = current.root_node_id || randomUUID();
    const rootNode = current.nodes.find((node: any) => node.id === current.root_node_id) || { id: rootId, party_kind: 'PM', identity_mode: 'LINKED', linked_compareciente_id: pmId, canonical_label: `Sociedad QA ${runId}, S.A. de C.V.`, incomplete: false, metadata: {} };
    const shareholderId = randomUUID();
    const adminId = randomUUID();
    const graph = {
      root_node_id: rootId,
      nodes: [
        { ...rootNode, metadata: { ...(rootNode.metadata || {}), governance_type: 'SOLE_ADMINISTRATOR' } },
        { id: shareholderId, party_kind: 'PF', identity_mode: 'LINKED', linked_compareciente_id: pfId, canonical_label: `María QA ${runId} Controlada Local`, incomplete: false, metadata: { shareholder: true, share_count: '600', share_class: 'A', requires_identification: true, beneficial_controller_declared: true } },
        { id: adminId, party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: `Administrador QA ${runId}`, incomplete: false, metadata: { shareholder: false, administration_role: 'Administrador único', requires_identification: true, beneficial_controller_declared: false } },
      ],
      edges: [{ id: randomUUID(), owner_node_id: shareholderId, owned_node_id: rootId, percentage: '60' }],
      controls: [{ id: randomUUID(), subject_node_id: adminId, kind: 'MANAGEMENT', description: 'Administrador único vigente', human_confirmed: true }],
      incomplete_markers: ['Cadena indirecta pendiente de evidencia'],
    };
    const previews = await bodyData(await request.post(`/api/comparecientes/${pmId}/estructura-propiedad/vinculos/preview`, { headers: auth(bearer), data: graph }));
    const confirmations = Object.fromEntries(previews.map((item: any) => [item.node_id, item.confirmation]));
    await bodyData(await request.put(`/api/comparecientes/${pmId}/estructura-propiedad`, {
      headers: auth(bearer), data: { ...graph, expected_revision: current.revision, idempotency_key: randomUUID(), identity_confirmations: confirmations },
    }));

    await open(page, `/comparecientes/${pmId}#ownership`);
    const ownership = page.getByRole('region', { name: 'Estructura de propiedad y control' });
    await expect(ownership).toBeVisible();
    await expect(ownership.getByText('Estructura incompleta', { exact: true })).toBeVisible();
    await expect(ownership.getByText('Cuadro accionario vigente', { exact: true }).first()).toBeVisible();
    await expect(ownership.getByText('Órgano de administración vigente', { exact: true }).first()).toBeVisible();
    await expect(ownership.getByText('Personas a identificar', { exact: true }).first()).toBeVisible();
    await expect(ownership.getByText('Beneficiario controlador', { exact: true }).first()).toBeVisible();
    await expect(ownership.locator('input[value="Administrador único"]')).toBeVisible();
    await ownership.getByText('Vista derivada de la estructura', { exact: true }).click();
    await expect(ownership.getByLabel('Expansión canónica').getByText('MARÍA PRUEBA OCHO CONTROLADA LOCAL', { exact: true })).toBeVisible();
    const governance = ownership.getByText('Forma de administración vigente').locator('..').getByRole('combobox');
    await expect(governance).toHaveValue('SOLE_ADMINISTRATOR');
    const summaries = ownership.locator('div').filter({ has: page.getByText('Personas a identificar', { exact: true }) });
    await expect(summaries.first()).toContainText('2');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Estructura de propiedad y control' }).locator('input[value="Administrador único"]')).toBeVisible();
    await expect(page.locator('article').filter({ hasText: `ACTA-HISTORICA-${runId}.pdf` })).toBeVisible();
  });

  await test.step('Predios global 1..8 y Expediente 1..12: alta, auto-vínculo, IA, reuso e importación idempotente', async () => {
    await open(page, `/expedientes/${detailId}#predios`);
    await page.getByRole('button', { name: 'Crear nuevo', exact: true }).click();
    await page.waitForURL('**/predios/nuevo?**');
    const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/predios') && response.request().method() === 'POST');
    await page.getByLabel('Apodo / nombre corto').fill(`Casa QA ${runId}`);
    await page.getByLabel('Ubicación descriptiva').fill('Avenida Pruebas 109, Tepic, Nayarit');
    await page.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
    const createdPayload = await (await createdResponse).json();
    predioId = createdPayload.data.id;
    await page.waitForURL(new RegExp(`/expedientes/${detailId}#predios`));
    await expect(page.getByRole('status').filter({ hasText: 'Inmueble creado y vinculado automáticamente' })).toBeVisible();

    await upload(request, `/api/predios/${predioId}/documentos`, bearer, { tipo: 'TÍTULO', vigencia: 'VIGENTE', es_antecedente_principal: 'true' }, predioPath, `PREDIO-VIGENTE-${runId}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await upload(request, `/api/predios/${predioId}/documentos`, bearer, { tipo: 'AVALÚO', vigencia: 'VIGENTE', es_antecedente_principal: 'false' }, pdfPath, `AVALUO-VIGENTE-${runId}.pdf`, 'application/pdf');
    await upload(request, `/api/predios/${predioId}/documentos`, bearer, { tipo: 'ANTECEDENTE', vigencia: 'HISTORICO', es_antecedente_principal: 'false' }, jpgPath, `ANTECEDENTE-HISTORICO-${runId}.jpg`, 'image/jpeg');

    await open(page, `/predios/${predioId}`);
    await expect(page.getByRole('heading', { name: `Casa QA ${runId}`, exact: true })).toBeVisible();
    await expect(page.getByText(`ANTECEDENTE-HISTORICO-${runId}.jpg`, { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: `PREDIO-VIGENTE-${runId}.docx`, exact: true }).check();
    await page.getByRole('button', { name: 'Analizar 1 fuente seleccionada', exact: true }).click();
    const review = page.getByRole('dialog', { name: /Propuesta desde 1 fuente/ });
    await expect(review).toBeVisible({ timeout: 180_000 });
    const proposals = review.locator('article');
    expect(await proposals.count()).toBeGreaterThan(0);
    for (let index = 0; index < await proposals.count(); index += 1) {
      const proposal = proposals.nth(index);
      const hasReusableIdentifier = await proposal.getByText(/^(Clave catastral|Cuenta predial|Folio real)$/, { exact: true }).count();
      const decision = hasReusableIdentifier
        ? proposal.getByRole('radio', { name: 'Conservar actual', exact: true })
        : proposal.getByRole('radio', { name: 'Aceptar propuesto', exact: true });
      if (await decision.isEnabled()) await decision.check();
    }
    await review.getByRole('button', { name: 'Aplicar decisiones', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Decisiones aplicadas con trazabilidad.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Terreno (m²)')).toHaveValue('250.5');

    await open(page, '/predios');
    await page.getByPlaceholder(/Buscar por apodo/).fill(`Casa QA ${runId}`);
    await expect(page.getByRole('link', { name: new RegExp(`Casa QA ${runId}`) })).toBeVisible();

    await open(page, `/expedientes/${detailId}#documentos`);
    await expect(page.getByText(`PREDIO-VIGENTE-${runId}.docx`, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^(Importar documentos vigentes de|Actualizar desde) Predios \/ Inmuebles$/ }).click();
    const firstImport = page.getByRole('status').filter({ hasText: /\d+ nuevos · \d+ actualizados · \d+ sin cambios · 0 duplicados/ });
    await expect(firstImport).toBeVisible();
    expect(Number((await firstImport.textContent())?.match(/(\d+) nuevos/)?.[1] || 0)).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(`PREDIO-VIGENTE-${runId}.docx`, { exact: true })).toBeVisible();
    await expect(page.getByText(`AVALUO-VIGENTE-${runId}.pdf`, { exact: true })).toBeVisible();
    await expect(page.getByText(`ANTECEDENTE-HISTORICO-${runId}.jpg`, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Actualizar desde Predios / Inmuebles', exact: true }).click();
    const secondImport = page.getByRole('status').filter({ hasText: /0 nuevos · 0 actualizados · \d+ sin cambios · 0 duplicados/ });
    await expect(secondImport).toBeVisible();
    expect(Number((await secondImport.textContent())?.match(/(\d+) sin cambios/)?.[1] || 0)).toBeGreaterThanOrEqual(2);
    await page.reload();
    await expect(page.getByText(`PREDIO-VIGENTE-${runId}.docx`, { exact: true })).toHaveCount(1);

    await open(page, `/expedientes/${selectorId}#predios`);
    await page.getByRole('button', { name: 'Vincular existente', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Vincular inmueble' });
    await dialog.getByPlaceholder(/Apodo, clave/).fill(`Casa QA ${runId}`);
    await dialog.getByRole('button', { name: new RegExp(`Casa QA ${runId}`) }).click();
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: 'Revisar impacto', exact: true }).click();
    await expect(dialog.getByText(/Cambio seguro|Revisión requerida/)).toBeVisible();
    const confirmation = dialog.getByText(/Confirmo que revisé/);
    if (await confirmation.count()) await confirmation.click();
    await dialog.getByRole('button', { name: 'Guardar relación', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Casa QA ${runId}`, exact: true })).toBeVisible();
  });

  await test.step('Presupuesto 1..15: lista inline, independencia, ADM-001 A→B, histórico y fallo sin fallback', async () => {
    // Cada ejecución fija su propia precondición A desde la UI. La prueba
    // anterior deja B como la versión más reciente por diseño, de modo que
    // depender del estado inicial hacía que un rerun verificara el documento
    // equivocado aun cuando la resolución CFG-002 fuese correcta.
    await open(page, '/configuracion/plantillas-formatos');
    await page.getByRole('button', { name: /Notaría.*Notaría QA Local/ }).click();
    await page.getByRole('button', { name: /Formatos/ }).click();
    let artifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'ADM-001 · Cotización QA', exact: true }) });
    await artifact.getByRole('button', { name: 'Nueva versión', exact: true }).click();
    let versionDialog = page.getByRole('dialog', { name: /Nueva versión · ADM-001/ });
    await versionDialog.locator('input[type="file"]').setInputFiles(templateAPath);
    await versionDialog.getByRole('button', { name: 'Guardar nueva versión', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nueva versión guardada' })).toBeVisible();

    await open(page, `/expedientes/${detailId}#presupuesto`);
    const budgetPanel = page.getByRole('tabpanel', { name: 'Presupuesto' });
    await expect(page.getByRole('heading', { name: 'Presupuesto', exact: true })).toBeVisible();
    await expect(page.getByText('Participación PRAVIA', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/versiones editables/i)).toHaveCount(0);
    await page.getByLabel('Importe de Honorarios profesionales').fill('14000');
    await page.getByRole('button', { name: 'Agregar concepto', exact: true }).click();
    await page.getByLabel(/Importe de concepto 3/).fill('2240');
    await page.getByRole('button', { name: 'Eliminar concepto 3' }).click();
    await budgetPanel.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Presupuesto guardado.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Importe de Honorarios profesionales')).toHaveValue('14000.00');

    await page.getByRole('button', { name: 'Generar con ADM-001', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Presupuesto generado con la plantilla CFG-002 ADM-001' })).toBeVisible();
    let firstBudgetDocument = page.locator('li').filter({ hasText: /Presupuesto_EXP-0001-2026/ }).first();
    await firstBudgetDocument.getByRole('button', { name: /Ver Presupuesto_/ }).click();
    let viewer = page.getByRole('dialog', { name: /Presupuesto_EXP-0001-2026/ });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_A_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();

    await open(page, '/configuracion/plantillas-formatos');
    await page.getByRole('button', { name: /Notaría.*Notaría QA Local/ }).click();
    await page.getByRole('button', { name: /Formatos/ }).click();
    artifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'ADM-001 · Cotización QA', exact: true }) });
    await artifact.getByRole('button', { name: 'Nueva versión', exact: true }).click();
    versionDialog = page.getByRole('dialog', { name: /Nueva versión · ADM-001/ });
    await versionDialog.locator('input[type="file"]').setInputFiles(templateBPath);
    await versionDialog.getByRole('button', { name: 'Guardar nueva versión', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nueva versión guardada' })).toBeVisible();

    await open(page, `/cotizaciones/${quoteId}`);
    await page.getByRole('button', { name: 'Generar cotización', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Documento de cotización generado desde ADM-001.' })).toBeVisible();
    const quoteB = page.locator('li').filter({ hasText: /COT-0099-2026_Documento_/ }).first();
    await quoteB.getByRole('button', { name: /Ver COT-0099-2026_Documento_/ }).click();
    viewer = page.getByRole('dialog', { name: /COT-0099-2026_Documento_/ });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_B_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();

    await open(page, `/expedientes/${detailId}#presupuesto`);
    await page.getByRole('button', { name: 'Generar con ADM-001', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Presupuesto generado con la plantilla CFG-002 ADM-001' })).toBeVisible();
    const currentBudgetDocuments = page.locator('li').filter({ hasText: /Presupuesto_EXP-0001-2026/ });
    await expect.poll(() => currentBudgetDocuments.count()).toBeGreaterThanOrEqual(2);
    firstBudgetDocument = currentBudgetDocuments.first();
    await firstBudgetDocument.getByRole('button', { name: /Ver Presupuesto_/ }).click();
    viewer = page.getByRole('dialog', { name: /Presupuesto_EXP-0001-2026/ });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_B_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const previousBudgetDocument = currentBudgetDocuments.nth(1);
    await previousBudgetDocument.getByRole('button', { name: /Ver Presupuesto_/ }).click();
    viewer = page.getByRole('dialog', { name: /Presupuesto_EXP-0001-2026/ });
    await expect(viewer.getByText('PRUEBA_CFG002_COTIZACION_A_20260916', { exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const deactivate = await request.patch(`/api/settings/catalogs/artifacts/${quoteArtifactId}`, { headers: auth(bearer), data: { activo: false } });
    expect(deactivate.ok()).toBeTruthy();
    try {
      await page.getByRole('button', { name: 'Generar con ADM-001', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Configura y activa un formato para este destino funcional' })).toBeVisible();
      await open(page, `/cotizaciones/${quoteId}`);
      await page.getByRole('button', { name: 'Generar cotización', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Configura y activa un formato para este destino funcional' })).toBeVisible();
    } finally {
      const restore = await request.patch(`/api/settings/catalogs/artifacts/${quoteArtifactId}`, { headers: auth(bearer), data: { activo: true } });
      expect(restore.ok()).toBeTruthy();
    }
    await page.reload();
    await expect(page.getByLabel('Importe concepto 1')).toHaveValue('12345.67');
  });

  await test.step('Preview real y responsive 1440/1366/1024/768/390/320 sin overflow', async () => {
    await open(page, `/expedientes/${detailId}#documentos`);
    for (const name of ['QA-PREVIEW-PDF.pdf', 'QA-PREVIEW-PNG.png', 'QA-PREVIEW-JPG.jpg']) {
      await page.getByText(name, { exact: true }).click();
      await page.getByRole('button', { name: 'Visualizar', exact: true }).click();
      const dialog = page.getByRole('dialog', { name });
      await expect(dialog.locator('[data-preview-loaded="true"]')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cerrar vista previa' }).click();
    }
    for (const width of [1440, 1366, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      const responsiveRoutes: Array<[string, () => ReturnType<Page['locator']>]> = [
        [`/comparecientes/${pfId}`, () => page.getByRole('heading', { name: 'Datos notariales', exact: true })],
        [`/comparecientes/${pmId}#ownership`, () => page.getByRole('region', { name: 'Estructura de propiedad y control' })],
        [`/predios/${predioId}`, () => page.getByRole('heading', { name: `Casa QA ${runId}`, exact: true })],
        [`/expedientes/${detailId}#presupuesto`, () => page.getByRole('tabpanel', { name: 'Presupuesto' })],
      ];
      for (const [path, ready] of responsiveRoutes) {
        await open(page, path);
        await expect(ready()).toBeVisible({ timeout: 30_000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} desborda ${overflow}px a ${width}px`).toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: `${evidenceDir}/${width}.png`, fullPage: true });
    }
  });

  expect(networkErrors).toEqual([]);
  expect(consoleErrors.filter((item) => !item.includes('favicon') && !item.includes('409 (Conflict)'))).toEqual([]);
});
