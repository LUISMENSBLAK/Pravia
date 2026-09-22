import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const expedienteId = '770a40da-3ba5-4d24-a293-75fa8d064c05';
const evidenceDir = resolve(process.cwd(), 'artifacts/qa-corrections-011-012-014');

const open = (page: Page, path: string) => page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });

async function login(page: Page) {
  await open(page, '/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('Pravia!QA-Release-2026');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, `overflow horizontal ${dimensions.scroll}px > ${dimensions.width}px`).toBeLessThanOrEqual(dimensions.width + 1);
}

const xmlText = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

async function createControlledDefectiveProject(sourcePath: string, targetPath: string) {
  const zip = await JSZip.loadAsync(readFileSync(sourcePath));
  const document = zip.file('word/document.xml');
  if (!document) throw new Error('PROJECT_DOCUMENT_XML_NOT_FOUND');
  let xml = await document.async('string');
  xml = xml.replace(
    'CERTIFICO: Que la presente transcripción conserva MAYÚSCULAS, puntuación; y números 123/2026.',
    'CERTIFICO: Que la presente transcripción conserva MAYÚSCULAS.',
  );
  xml = xml.replace(
    '$1,234.50 (MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N.)',
    '$1,234.50',
  );
  xml = xml.replace(/<w:r([^>]*)>([\s\S]*?<w:t[^>]*>)PROYECTO DE ESCRITURA(<\/w:t>[\s\S]*?<\/w:r>)/, (_match, attrs, before, after) => (
    `<w:r${attrs}>${before.replace(/<w:b\/?[^>]*>/g, '')}proyecto de escritura alterado${after.replace(/<w:b\/?[^>]*>/g, '')}`
  ));
  const defects = [
    'PERSONA AJENA AL EXPEDIENTE: Roberto Intruso QA, RFC INTR900101XX1.',
    'SUPERFICIE DEL INMUEBLE: 999.9999 m².',
    'ANTECEDENTE SEGUNDO FUERA DE ORDEN: 15/04/2025, subdivisión.',
    'ANTECEDENTE PRIMERO FUERA DE ORDEN: 10/01/2024, adquisición.',
  ].map((value) => `<w:p><w:r><w:t>${xmlText(value)}</w:t></w:r></w:p>`).join('');
  xml = xml.replace('</w:body>', `${defects}</w:body>`);
  zip.file('word/document.xml', xml);
  writeFileSync(targetPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

test('Correcciones 011 + 012 + 014: UAT integrado en Chrome real', async ({ page }) => {
  test.setTimeout(1_200_000);
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await login(page);
  consoleErrors.length = 0;
  serverErrors.length = 0;

  await test.step('011 · generar proyecto desde CFG-002, fuentes y persistencia', async () => {
    await open(page, `/expedientes/${expedienteId}#proyecto`);
    await expect(page.getByRole('heading', { name: 'Proyecto de escritura', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Generar proyecto', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Revisar proyecto', exact: true })).toBeVisible();
    await expect(page.getByLabel('Plantilla sugerida')).toContainText('Machote proyecto notarial QA');
    await page.getByLabel('Instrucciones opcionales').fill('Conservar estructura notarial y marcar cualquier dato no comprobado.');
    await page.getByText('Ver / ajustar fuentes', { exact: false }).click();
    await expect(page.getByText('1 seleccionada(s)', { exact: true })).toBeVisible();
    await expect(page.getByText('Certificado_Literal_QA.docx', { exact: true })).toBeVisible();
    const generationResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/expedientes/${expedienteId}/proyecto/generar`));
    await page.getByRole('button', { name: 'Generar desde machote', exact: true }).click();
    const generated = await generationResponse;
    expect(generated.status()).toBe(201);
    const generatedPayload = await generated.json();
    expect(generatedPayload).toMatchObject({ docx_structural_fidelity: 'PASS', pending_count: 1, residual_observation_count: 6 });
    expect(generatedPayload.generation_observation_count).toBeGreaterThanOrEqual(7);
    const versionNumber = generatedPayload.version.version_numero;
    await expect(page.getByRole('status').filter({ hasText: /fidelidad estructural verificada/ })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(`Versión ${versionNumber}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Observaciones de generación', exact: true })).toBeVisible();
    await expect(page.getByText('Posible dato residual del machote', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('AAAA800101AA1', { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Versión ${versionNumber}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Observaciones de generación', exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Descargar versión ${versionNumber}`, exact: true }).click();
    const downloadedProject = await download;
    expect(downloadedProject.suggestedFilename()).toMatch(/\.docx$/);
    const downloadedProjectPath = `${evidenceDir}/011-project-for-manual-review.docx`;
    await downloadedProject.saveAs(downloadedProjectPath);
    const concurrentPayload = { template_version_id: '31100000-0000-4000-8000-000000000011', instructions: 'Prueba concurrente local aislada.', source_document_ids: ['31100000-0000-4000-8000-000000000020'] };
    const refreshUrl = new URL('/api/auth/refresh', generated.url()).toString();
    const refreshed = await page.request.post(refreshUrl);
    expect(refreshed.ok()).toBe(true);
    const refreshedPayload = await refreshed.json();
    const accessToken = refreshedPayload.accessToken || refreshedPayload.access_token || refreshedPayload.token || refreshedPayload.data?.accessToken || refreshedPayload.data?.access_token || refreshedPayload.data?.token;
    expect(typeof accessToken).toBe('string');
    const concurrentResponses = await Promise.all([
      page.request.post(generated.url(), { data: concurrentPayload, headers: { Authorization: `Bearer ${accessToken}` } }),
      page.request.post(generated.url(), { data: concurrentPayload, headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    expect(concurrentResponses.map((response) => response.status())).toEqual([201, 201]);
    const concurrentProjects = await Promise.all(concurrentResponses.map((response) => response.json()));
    const concurrentVersions = concurrentProjects.map((item) => item.version.version_numero).sort((a, b) => a - b);
    expect(concurrentVersions[1] - concurrentVersions[0]).toBe(1);
    for (const item of concurrentProjects) expect(item.version.nombre_original).toContain(`_V${item.version.version_numero}.docx`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Versión ${concurrentVersions[1]}`, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Revisar proyecto', exact: true }).click();
    const defectiveProjectPath = `${evidenceDir}/011-project-controlled-defects.docx`;
    await createControlledDefectiveProject(downloadedProjectPath, defectiveProjectPath);
    const uploadResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/expedientes/${expedienteId}/proyecto/upload`));
    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(defectiveProjectPath);
    const uploaded = await uploadResponse;
    expect(uploaded.status()).toBe(201);
    const uploadedPayload = await uploaded.json();
    expect(uploadedPayload.version_numero).toBe(concurrentVersions[1] + 1);
    await expect(page.getByRole('status').filter({ hasText: 'Nueva versión cargada.' })).toBeVisible();
    await expect(page.getByText(`Versión ${uploadedPayload.version_numero}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Versión ${concurrentVersions[1]}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar versión vigente', exact: true })).toBeEnabled();
    const reviewResponse = page.waitForResponse(
      (response) => response.url().includes('/proyecto/analizar-ia'),
      { timeout: 360_000 },
    );
    await page.getByRole('button', { name: 'Revisar versión vigente', exact: true }).click();
    const localReview = await reviewResponse;
    expect(localReview.status()).toBe(201);
    const reviewPayload = await localReview.json();
    expect(reviewPayload.documentos_analizados_count).toBe(1);
    expect(reviewPayload.documentos_totales_count).toBe(1);
    expect(reviewPayload.documentos_no_leidos).toEqual([]);
    expect(reviewPayload.observaciones.length).toBeGreaterThan(0);
    const reviewCategories = reviewPayload.observaciones.map((item: { tipo_discrepancia: string }) => item.tipo_discrepancia);
    for (const category of ['TRANSCRIPCION_INCOMPLETA', 'PERSONA_AJENA', 'PREDIO', 'CANTIDAD_FORMAL', 'ESTILO_ESTRUCTURA', 'CONTEXTO_ANTECEDENTES']) {
      expect(reviewCategories, `categoría ausente: ${category}`).toContain(category);
    }
    await expect(page.getByRole('status').filter({ hasText: 'Revisión terminada.' })).toBeVisible({ timeout: 30_000 });
    const reviewResult = page.getByRole('region', { name: 'Resultado de la revisión notarial' });
    await expect(reviewResult.getByRole('heading', { name: 'Resultado de la revisión', exact: true })).toBeVisible();
    await expect(reviewResult.getByText(/observación\(es\) para revisión humana/)).toBeVisible();
    const correctedUploadResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/expedientes/${expedienteId}/proyecto/upload`));
    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(downloadedProjectPath);
    expect((await correctedUploadResponse).status()).toBe(201);
    const correctedReviewResponse = page.waitForResponse(
      (response) => response.url().includes('/proyecto/analizar-ia'),
      { timeout: 360_000 },
    );
    await page.getByRole('button', { name: 'Revisar versión vigente', exact: true }).click();
    const correctedReview = await correctedReviewResponse;
    expect(correctedReview.status()).toBe(201);
    const correctedPayload = await correctedReview.json();
    expect(correctedPayload.documentos_no_leidos).toEqual([]);
    const correctedText = JSON.stringify(correctedPayload.observaciones);
    expect(correctedText).not.toContain('Roberto Intruso QA');
    expect(correctedText).not.toContain('999.9999');
    expect(correctedText).not.toContain('proyecto de escritura alterado');
    await expect(page.getByRole('status').filter({ hasText: 'Revisión terminada.' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${evidenceDir}/011-project-generate-review.png`, fullPage: true });
  });

  await test.step('012 · exactamente dos bancos globales y CRUD versionado', async () => {
    await open(page, '/configuracion/cuestionarios');
    const tabs = page.getByRole('tablist', { name: 'Banco de preguntas' }).getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText('Personal');
    await expect(tabs.nth(1)).toHaveText('Acto / Operación');
    await expect(page.getByText('La aplicabilidad la determina exclusivamente Cumplimiento PLD/UIF.', { exact: false })).toBeVisible();
    await expect(page.getByText('¿Cuál es su ocupación actual?', { exact: true })).toBeVisible();
    await tabs.nth(1).click();
    await expect(page.getByText('Origen de los recursos de la operación', { exact: true })).toBeVisible();
    const questionA = 'Pregunta temporal UAT 012 A';
    const questionB = 'Pregunta temporal UAT 012 B';
    for (const label of [questionA, questionB]) {
      const remove = page.getByRole('button', { name: `Eliminar ${label}`, exact: true });
      while (await remove.count()) {
        const before = await remove.count();
        await remove.first().click({ force: true });
        await expect(remove).toHaveCount(before - 1);
      }
    }
    const createQuestion = async (label: string) => {
      await page.getByRole('button', { name: 'Nueva pregunta', exact: true }).click();
      await page.getByRole('region', { name: 'Nueva pregunta' }).getByLabel('Pregunta').fill(label);
      const required = page.getByRole('region', { name: 'Nueva pregunta' }).getByLabel('Obligatoria');
      await expect(required).toBeVisible();
      await required.click({ force: true });
      await page.getByRole('region', { name: 'Nueva pregunta' }).getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    };
    await createQuestion(questionA);
    await createQuestion(questionB);
    await page.getByRole('button', { name: `Subir ${questionB}`, exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Acto / Operación', exact: true }).click();
    const questionCards = page.locator('section[aria-label="Bancos de preguntas"] article');
    const orderedLabels = await questionCards.locator('strong').allTextContents();
    expect(orderedLabels.indexOf(questionB)).toBeGreaterThanOrEqual(0);
    expect(orderedLabels.indexOf(questionB)).toBeLessThan(orderedLabels.indexOf(questionA));
    await page.getByRole('button', { name: `Desactivar ${questionA}`, exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Acto / Operación', exact: true }).click();
    await expect(questionCards.filter({ hasText: questionA }).getByText('Inactiva', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: `Eliminar ${questionA}`, exact: true }).click();
    await page.getByRole('button', { name: `Eliminar ${questionB}`, exact: true }).click();
    await expect(page.getByText(questionA, { exact: true })).toHaveCount(0);
    await expect(page.getByText(questionB, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}/012-two-global-banks.png`, fullPage: true });
  });

  await test.step('012 · una instancia por persona y una por acto, borrador y snapshot final', async () => {
    await open(page, `/expedientes/${expedienteId}#cuestionarios`);
    await expect(page.getByRole('heading', { name: 'Cuestionarios', exact: true })).toBeVisible();
    const cards = page.locator('article').filter({ has: page.locator('fieldset') });
    await expect(cards).toHaveCount(3);
    await expect(page.getByText('María Transmitente QA', { exact: true })).toBeVisible();
    await expect(page.getByText('Carlos Adquirente QA', { exact: true })).toBeVisible();
    const operation = cards.filter({ hasText: 'Cuestionario del acto / operación' });
    const alreadyFinalized = await operation.getByText('Finalizado', { exact: true }).count();
    if (!alreadyFinalized) {
      await operation.getByLabel('Origen de los recursos de la operación *').fill('Recursos propios comprobados en QA local');
      await operation.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Borrador guardado.' })).toBeVisible();
      await page.reload({ waitUntil: 'domcontentloaded' });
      const draft = page.locator('article').filter({ hasText: 'Cuestionario del acto / operación' });
      await expect(draft.getByLabel('Origen de los recursos de la operación *')).toHaveValue('Recursos propios comprobados en QA local');
      await draft.getByRole('button', { name: 'Finalizar cuestionario', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Cuestionario finalizado y registrado.' })).toBeVisible();
    }
    const persisted = page.locator('article').filter({ hasText: 'Cuestionario del acto / operación' });
    await expect(persisted.getByText('Finalizado', { exact: true })).toBeVisible();
    await expect(persisted.locator('fieldset')).toHaveAttribute('disabled', '');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('article').filter({ hasText: 'Cuestionario del acto / operación' }).getByText('Finalizado', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/012-expediente-instances.png`, fullPage: true });
  });

  await test.step('014 · conexión funcional visible y separada de carpetas/nombre', async () => {
    await open(page, '/configuracion/plantillas-formatos');
    await page.getByRole('button', { name: /Notaría.*Notaría QA Local/ }).click();
    await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'Plantillas', exact: true }) }).click();
    const artifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Machote proyecto notarial QA', exact: true }) });
    await expect(artifact).toBeVisible();
    await expect(artifact.getByText('Machote para proyecto · principal', { exact: true })).toBeVisible();
    await artifact.getByRole('button', { name: 'Conectar a módulos', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Destinos funcionales · Machote proyecto notarial QA' });
    await expect(dialog.getByText('Las carpetas organizan; estas conexiones determinan dónde se usa el archivo.', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Machote para proyecto', { exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Predeterminado para este destino', { exact: true })).toBeChecked();
    await page.screenshot({ path: `${evidenceDir}/014-functional-destination.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await page.getByRole('button', { name: 'Nueva plantilla', exact: true }).click();
    const quick = page.getByRole('dialog', { name: 'Nueva plantilla' });
    await expect(quick.getByLabel('Destino funcional')).toContainText('Machote para proyecto');
    await expect(quick.getByRole('checkbox', { name: 'Activo', exact: true })).toBeChecked();
    await expect(quick.getByRole('checkbox', { name: 'Predeterminado para este destino', exact: true })).toBeChecked();
    await quick.getByRole('button', { name: 'Cancelar', exact: true }).click();

    const originalFolder = 'QA 014 temporal';
    const renamedFolder = 'QA 014 renombrada';
    if (!await page.getByRole('button', { name: new RegExp(`${originalFolder}|${renamedFolder}`) }).count()) {
      await page.getByRole('button', { name: 'Nueva carpeta', exact: true }).click();
      const createFolder = page.getByRole('dialog', { name: 'Nueva carpeta' });
      await createFolder.getByLabel('Nombre').fill(originalFolder);
      await createFolder.getByRole('button', { name: 'Crear carpeta', exact: true }).click();
      await expect(page.getByRole('button', { name: new RegExp(originalFolder) })).toBeVisible();
    }
    const folderName = await page.getByRole('button', { name: new RegExp(`${originalFolder}|${renamedFolder}`) }).first().textContent();
    await page.getByRole('button', { name: new RegExp(`${originalFolder}|${renamedFolder}`) }).first().click();
    if (folderName?.includes(originalFolder)) {
      await page.getByRole('button', { name: 'Renombrar carpeta', exact: true }).click();
      const renameFolder = page.getByRole('dialog', { name: 'Renombrar carpeta' });
      await renameFolder.getByLabel('Nombre').fill(renamedFolder);
      await renameFolder.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(page.getByRole('heading', { name: renamedFolder, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Plantillas', exact: true }).click();
    const rootArtifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Machote proyecto notarial QA', exact: true }) });
    await rootArtifact.getByRole('button', { name: 'Organizar', exact: true }).click();
    const moveIntoFolder = page.getByRole('dialog', { name: 'Organizar · Machote proyecto notarial QA' });
    await moveIntoFolder.getByLabel('Carpeta').selectOption({ label: renamedFolder });
    await moveIntoFolder.getByRole('button', { name: 'Guardar organización', exact: true }).click();
    await expect(rootArtifact).toHaveCount(0);
    await page.getByRole('button', { name: new RegExp(renamedFolder) }).click();
    const movedArtifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Machote proyecto notarial QA', exact: true }) });
    await expect(movedArtifact.getByText('Machote para proyecto · principal', { exact: true })).toBeVisible();
    await movedArtifact.getByRole('button', { name: 'Organizar', exact: true }).click();
    const moveToRoot = page.getByRole('dialog', { name: 'Organizar · Machote proyecto notarial QA' });
    await moveToRoot.getByLabel('Carpeta').selectOption('');
    await moveToRoot.getByRole('button', { name: 'Guardar organización', exact: true }).click();
    await expect(movedArtifact).toHaveCount(0);
    await page.getByRole('button', { name: 'Plantillas', exact: true }).click();
    const restoredArtifact = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Machote proyecto notarial QA', exact: true }) });
    await expect(restoredArtifact).toBeVisible();
    const versionsBefore = await restoredArtifact.locator('strong').filter({ hasText: /^v\d+$/ }).count();
    await restoredArtifact.getByRole('button', { name: 'Nueva versión', exact: true }).click();
    const newVersion = page.getByRole('dialog', { name: 'Nueva versión · Machote proyecto notarial QA' });
    await newVersion.getByLabel('Archivo').setInputFiles('/private/tmp/pravia-corr011-012-014-storage-qa/organizations/30000000-0000-4000-8000-000000000001/qa/correction-011/Machote_Proyecto_QA.docx');
    await newVersion.getByRole('button', { name: 'Guardar nueva versión', exact: true }).click();
    await expect(restoredArtifact.locator('strong').filter({ hasText: /^v\d+$/ })).toHaveCount(versionsBefore + 1);
    const signedUrlResponse = page.waitForResponse((response) => response.url().includes('/settings/catalogs/artifact-versions/') && response.url().endsWith('/url'));
    await restoredArtifact.getByRole('button', { name: /Descargar Machote_Proyecto_QA\.docx/ }).first().click();
    expect((await signedUrlResponse).ok()).toBe(true);
    await restoredArtifact.getByRole('button', { name: 'Desactivar', exact: true }).click();
    await expect(restoredArtifact.getByText('Inactivo', { exact: true })).toBeVisible();
    await expect(restoredArtifact.getByText('Machote para proyecto · principal', { exact: true })).toBeVisible();
    await restoredArtifact.getByRole('button', { name: 'Activar', exact: true }).click();
    await expect(restoredArtifact.getByText('Activo', { exact: true })).toBeVisible();
  });

  await test.step('Responsive 1440/1366/1024/768/390/320 sin overflow horizontal', async () => {
    for (const width of [1440, 1366, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      await open(page, `/expedientes/${expedienteId}#proyecto`);
      await expect(page.getByRole('heading', { name: 'Proyecto de escritura', exact: true })).toBeVisible();
      await expectNoPageOverflow(page);
      await page.screenshot({ path: `${evidenceDir}/responsive-project-${width}.png`, fullPage: true });
      await open(page, `/expedientes/${expedienteId}#cuestionarios`);
      await expect(page.getByRole('heading', { name: 'Cuestionarios', exact: true })).toBeVisible();
      await expectNoPageOverflow(page);
    }
  });

  expect(serverErrors, `respuestas 5xx: ${serverErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('favicon')), `errores de consola: ${consoleErrors.join('\n')}`).toEqual([]);
});
