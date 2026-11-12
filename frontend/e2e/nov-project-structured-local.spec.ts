import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from '../../backend/node_modules/jszip/lib/index.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const qaCaseId = 'c9c131ce-e69f-4b1d-b1cd-541a2c94cecd';
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test('NOV-PRO · Word estructurado conserva machote, texto fijo y pendientes', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL;
  const templatePath = process.env.PRAVIA_E2E_NOV_PROJECT_TEMPLATE || '';
  if (base.origin !== 'http://127.0.0.1:5176' || !password
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !/^\/(?:private\/)?tmp\/pravia-nov-project\.[A-Za-z0-9]+\/Machote_NOV_PRO_QA\.docx$/.test(templatePath)) {
    throw new Error('NOV_PROJECT_LOCAL_QA_ONLY');
  }
  expect(await (await request.get('/api/health')).json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const file = await readFile(templatePath);
    const email = 'adrian.hernandez@pravia.test';
    const login = await request.post('/api/auth/login', { data: { email, password } });
    expect(login.status()).toBe(200);
    const auth = await login.json();
    const target = await db.expediente.findUniqueOrThrow({ where: { id: qaCaseId }, select: {
      organization_id: true, numero_pravia: true,
      comparecientes: { where: { estatus: 'ACTIVO' }, select: { compareciente: { select: { nombre_busqueda: true } } } },
      predios: { where: { estatus: 'ACTIVO' }, select: { id: true } },
    } });
    expect(target.organization_id).toBe(auth.user.organization.id);
    expect(target.numero_pravia).toBe('EXP-0045-2026');
    expect(target.comparecientes).toHaveLength(1);
    expect(target.predios).toHaveLength(0);
    const beforeUsage = await db.aiUsageEvent.count({ where: { organization_id: auth.user.organization.id } });

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    await page.goto(`/expedientes/${qaCaseId}#proyecto`);
    await expect(page.getByRole('heading', { name: 'Proyecto de escritura', exact: true })).toBeVisible();
    const options = page.locator('#project-advanced-options');
    await options.locator('summary').first().click();
    await options.locator('input[type=file]').setInputFiles(templatePath);
    await expect(page.getByText('Machote_NOV_PRO_QA.docx · exclusivo para esta proyección')).toBeVisible();
    const reviewRequests: string[] = [];
    page.on('request', (item) => { if (item.method() === 'POST' && item.url().endsWith('/proyecto/analizar-ia')) reviewRequests.push(item.url()); });
    const generation = page.waitForResponse((item) => item.request().method() === 'POST'
      && item.url().endsWith(`/expedientes/${qaCaseId}/proyecto/generar-desde-machote`));
    await page.getByRole('button', { name: 'PROYECTAR CON IA', exact: true }).click();
    const generated = await generation;
    expect(generated.status()).toBe(201);
    const result = await generated.json();
    expect(result).toMatchObject({ generation_origin: 'UI', pending_count: 2, review_required: true,
      docx_structural_fidelity: 'PASS', template: { exclusive: true, name: 'Machote_NOV_PRO_QA.docx' } });
    const resultPanel = page.getByRole('region', { name: 'Proyecto generado' });
    await expect(resultPanel).toContainText(`Versión ${result.version.version_numero}`);
    await expect(page.getByRole('status').filter({ hasText: 'Proyecto generado y guardado. Revisa el Word y sus pendientes antes de validarlo.' })).toBeVisible();

    const stored = await db.documento.findUniqueOrThrow({ where: { id: result.version.id } });
    const metadata = (stored.datos_extraidos as { proyecto: { template_version_id: string; template_checksum: string } }).proyecto;
    expect(metadata.template_checksum).toBe(digest(file));
    expect((await db.documento.findUniqueOrThrow({ where: { id: metadata.template_version_id } })).checksum_sha256).toBe(digest(file));
    const download = page.waitForEvent('download');
    await resultPanel.getByRole('button', { name: 'Descargar Word' }).click();
    const saved = await download;
    const downloaded = await readFile((await saved.path())!);
    expect(digest(downloaded)).toBe(stored.checksum_sha256);
    if (process.env.PRAVIA_E2E_NOV_PROJECT_SAVE_OUTPUT === 'true') {
      await saved.saveAs(testInfo.outputPath('Proyecto_NOV_PRO_QA.docx'));
    }
    const original = await JSZip.loadAsync(file);
    const produced = await JSZip.loadAsync(downloaded);
    const xml = await produced.file('word/document.xml')!.async('string');
    const sourceXml = await original.file('word/document.xml')!.async('string');
    expect(xml).toContain(target.numero_pravia);
    expect(xml).toContain(target.comparecientes[0].compareciente.nombre_busqueda);
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>[\s\S]{0,180}\[PENDIENTE: INMUEBLE SUPERFICIE\]/);
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>[\s\S]{0,180}\*\* de \*\*\*\* de \*\*\*\*\*\*\*/);
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
    const fixedParagraph = (body: string) => body.match(/<w:p>(?:(?!<w:p>).)*Cláusula de control\.(?:(?!<w:p>).)*?<\/w:p>/s)?.[0];
    expect(fixedParagraph(sourceXml)).toBeTruthy();
    expect(fixedParagraph(xml)).toBe(fixedParagraph(sourceXml));
    for (const part of ['word/header1.xml', 'word/footer1.xml']) {
      expect(await produced.file(part)!.async('string')).toBe(await original.file(part)!.async('string'));
    }
    await resultPanel.getByRole('button', { name: 'Ver proyecto' }).click();
    await expect(page.getByRole('dialog').locator('[data-preview-loaded="true"]')).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Observaciones automáticas de generación' })).toContainText('2 pendiente(s) explícito(s)');
    const apply = page.getByRole('region', { name: 'Aplicar indicaciones a la versión vigente' });
    await page.locator('#project-advanced-options').locator('summary').first().click();
    const instruction = 'Corregir sólo la etiqueta Superficie; conservar la cláusula fija y no completar los datos pendientes.';
    await page.getByLabel(/Indicaciones para la proyección/).fill(instruction);
    const pendingResponse = () => page.waitForResponse((item) => item.request().method() === 'POST'
      && item.url().endsWith(`/expedientes/${qaCaseId}/proyecto/aplicar-indicaciones`));
    await apply.getByLabel('Texto actual').fill('Texto inexistente en el proyecto QA');
    await apply.getByLabel('Texto corregido').fill('No se debe aplicar');
    const denied = pendingResponse();
    await apply.getByRole('button', { name: 'APLICAR INDICACIONES' }).click();
    const denial = await denied;
    expect(denial.status()).toBe(409);
    expect(await denial.json()).toMatchObject({ code: 'PROJECT_PATCH_TARGET_NOT_FOUND' });
    await expect(apply).toContainText(`versión ${result.version.version_numero}`);
    await apply.getByLabel('Texto actual').fill('Superficie');
    await apply.getByLabel('Texto corregido').fill('Superficie registrada');
    const correction = pendingResponse();
    await apply.getByRole('button', { name: 'APLICAR INDICACIONES' }).click();
    const corrected = await correction;
    expect(corrected.status(), await corrected.text()).toBe(201);
    const patched = await corrected.json();
    expect(patched.application).toMatchObject({ source_project_document_id: stored.id,
      result_project_document_id: patched.version.id, instructions: instruction });
    expect(patched.learnedCriterion).toBeNull();
    expect(patched.version.datos_extraidos.proyecto.pending_count).toBe(2);
    const patchedNumber = patched.version.datos_extraidos.proyecto.version_numero;
    await page.reload();
    await expect(apply).toContainText(`versión ${patchedNumber}`);
    await expect(page.getByRole('region', { name: 'Observaciones automáticas de generación' })).toContainText('2 pendiente(s) explícito(s)');
    const patchedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: `Descargar versión ${patchedNumber}`, exact: true }).click();
    const patchedFile = await patchedDownload;
    const patchedBytes = await readFile((await patchedFile.path())!);
    const patchedXml = await (await JSZip.loadAsync(patchedBytes)).file('word/document.xml')!.async('string');
    expect(patchedXml).toBe(xml.replace('>Superficie<', '>Superficie registrada<'));
    expect(digest(patchedBytes)).toBe(patched.version.checksum_sha256);
    const priorDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: `Descargar versión ${result.version.version_numero}`, exact: true }).click();
    expect(digest(await readFile((await (await priorDownload).path())!))).toBe(digest(downloaded));
    expect(await db.auditLog.count({ where: { organization_id: target.organization_id!,
      entidad_id: patched.application.id, accion: 'APLICAR_INDICACIONES_PROYECTO' } })).toBe(1);
    if (process.env.PRAVIA_E2E_NOV_PROJECT_SAVE_OUTPUT === 'true') {
      await patchedFile.saveAs(testInfo.outputPath('Proyecto_NOV_PRO_QA_Corregido.docx'));
    }
    expect(reviewRequests).toEqual([]);
    expect(await db.aiUsageEvent.count({ where: { organization_id: auth.user.organization.id } })).toBe(beforeUsage);
  } finally { await db.$disconnect(); }
});
