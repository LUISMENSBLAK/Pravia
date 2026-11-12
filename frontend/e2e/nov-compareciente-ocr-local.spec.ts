import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '../../backend/node_modules/@napi-rs/canvas/index.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

function raster(lines: string[], photo = false) {
  const canvas = createCanvas(1224, 1584);
  const ctx = canvas.getContext('2d');
  const light = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  light.addColorStop(0, '#f2e9d8'); light.addColorStop(1, '#fffdf9');
  ctx.fillStyle = photo ? light : 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = photo ? '#282525' : 'black';
  if (photo) { ctx.translate(15, 0); ctx.rotate(0.017); }
  ctx.font = '34px sans-serif';
  ['SINTETICO - SIN VALIDEZ OFICIAL', ...lines].forEach((line, index) => ctx.fillText(line, 72, 120 + index * 72));
  return canvas;
}

async function scannedPdf(lines: string[]) {
  const canvas = raster(lines);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawImage(await pdf.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 612, height: 792 });
  return Buffer.from(await pdf.save());
}

const digest = (file: Buffer) => createHash('sha256').update(file).digest('hex');
async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
}

for (const photo of [false, true]) test(`NOV-COM · ${photo ? 'JPG/PNG con inclinación y luz desigual' : 'PDF rasterizados'}: revisión, persistencia y originales intactos`, async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL;
  const ownerPassword = process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '';
  const viewerPassword = process.env.PRAVIA_E2E_JAVIER_PASSWORD || '';
  if (base.origin !== 'http://127.0.0.1:5176' || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !ownerPassword || !viewerPassword) throw new Error('NOV_COM_LOCAL_ONLY');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ api: 'ok', database_mode: 'local', storage_mode: 'local' });
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const owner = await browser.newPage({ baseURL: base.origin });
  const viewer = await browser.newPage({ baseURL: base.origin });
  const fixtures: Array<{ id: string; headers: { Authorization: string } }> = [];
  try {
    const ownerEmail = 'alejandro.abarca@pravia.test';
    const viewerEmail = 'javier.tapia@pravia.test';
    const auth = await request.post('/api/auth/login', { data: { email: ownerEmail, password: ownerPassword } });
    expect(auth.status()).toBe(200);
    const actor = await auth.json();
    const organizationId = actor.user.organization.id;
    const headers = { Authorization: `Bearer ${actor.access_token}` };
    const name = `QA OCR NOV ${randomUUID().slice(0, 8).toUpperCase()}`;
    const rfc = 'QAFA010101QA1';
    const originalRfc = `QAFA010102${randomUUID().replaceAll('-', '').slice(0, 3).toUpperCase()}`;
    // The physical uniqueness constraint also protects archived records.
    const candidates = [...'78965432'].flatMap((a) => [...'78965432'].map((b) => `GARA900101HDFRBC${a}${b}`));
    const existing = new Set((await db.personaFisica.findMany({
      where: { organization_id: organizationId, curp: { in: candidates } }, select: { curp: true },
    })).map((row) => row.curp));
    const curp = candidates.find((candidate) => !existing.has(candidate));
    if (!curp) throw new Error('No queda identificador sintético libre para QA OCR.');
    const created = await request.post('/api/comparecientes/persona-fisica', { headers, data: { nombre: name, rfc: originalRfc } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).data.compareciente.id as string;
    fixtures.push({ id, headers });
    await login(owner, ownerEmail, ownerPassword);
    await owner.goto(`/comparecientes/${id}`);
    const image = async (kind: string, stem: string, lines: string[], png = false) => ({ kind,
      name: `${stem}.${photo ? png ? 'png' : 'jpg' : 'pdf'}`,
      mimeType: photo ? png ? 'image/png' : 'image/jpeg' : 'application/pdf',
      bytes: photo ? png ? raster(lines, true).toBuffer('image/png') : raster(lines, true).toBuffer('image/jpeg', 75) : await scannedPdf(lines),
    });
    const documents = [
      await image('CONSTANCIA_FISCAL', 'CSF-QA-ESCANEADA', [
        'Constancia de Situacion Fiscal', `RFC: ${rfc}`, 'Nombre completo: PERSONA SINTETICA',
        'Codigo Postal: 63735', 'Domicilio Fiscal: CALLE DE PRUEBA']),
      await image('CURP', 'CURP-QA-ESCANEADA', ['Clave Unica de Registro de Poblacion', 'Clave:', curp], true),
      await image('IDENTIFICACION', 'INE-QA-ESCANEADA', ['Credencial para votar', 'CIC: 123456789', 'OCR: 1234567890123']),
    ];
    const uploaded = new Map<string, string>();
    for (const doc of documents) {
      await owner.getByLabel('Tipo de documento').selectOption(doc.kind);
      const sent = owner.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${id}/documentos`) && response.request().method() === 'POST');
      await owner.locator('input[type=file]').setInputFiles({ name: doc.name, mimeType: doc.mimeType, buffer: doc.bytes });
      const upload = await sent;
      expect(upload.status()).toBe(201);
      uploaded.set(doc.kind, (await upload.json()).data.docMaster.id);
      await expect(owner.getByRole('article').getByText(doc.name, { exact: true })).toBeVisible();
    }
    const usageBefore = await db.aiUsageEvent.count({ where: { organization_id: organizationId } });
    const extracted = owner.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${id}/extraer-ia`) && response.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Extraer información con IA' }).click();
    const response = await extracted;
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toMatchObject({
      proposals: { rfc: { valor: rfc, documento_id: uploaded.get('CONSTANCIA_FISCAL') },
        curp: { valor: curp, confianza: 'LECTURA_DUDOSA', documento_id: uploaded.get('CURP') } },
      documentos_ine: [{ document_id: uploaded.get('IDENTIFICACION'), method: photo ? 'LOCAL_OCR_IMAGE' : 'LOCAL_OCR_PDF',
        status: 'REVIEW_REQUIRED', identificadores_ine: { cic: '123456789', ocr: '1234567890123' } }],
      documentos_omitidos: [],
    });
    expect(await db.aiUsageEvent.count({ where: { organization_id: organizationId } })).toBe(usageBefore);
    const master = () => db.personaFisica.findUniqueOrThrow({ where: { compareciente_id: id }, select: { rfc: true, curp: true } });
    expect(await master()).toEqual({ rfc: originalRfc, curp: null });
    const review = owner.getByRole('region', { name: 'Resultado de extracción documental' });
    await expect(review.getByText('Diferencias con datos guardados')).toBeVisible();
    await expect(owner.getByRole('textbox', { name: /^RFC/ })).toHaveValue(originalRfc);
    await review.getByRole('button', { name: 'Conservar actual' }).click();
    await expect(owner.getByRole('textbox', { name: /^CURP/ })).toHaveValue(curp);
    await owner.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(owner.getByRole('status').filter({ hasText: 'Cambios guardados correctamente.' })).toBeVisible();
    expect(await master()).toEqual({ rfc: originalRfc, curp });
    expect(await db.comparecienteDatoFuente.findFirst({ where: { organization_id: organizationId, compareciente_id: id,
      campo: 'curp', documento_id: uploaded.get('CURP') } })).toMatchObject({ proveedor_ia: 'LOCAL_OCR', estado: 'CONFIRMADO' });
    expect(await db.comparecienteDatoFuente.findFirst({ where: { organization_id: organizationId, compareciente_id: id,
      campo: 'ine_ocr_processing_status', documento_id: uploaded.get('IDENTIFICACION') } })).toMatchObject({ valor_detectado: 'REVIEW_REQUIRED' });

    await owner.reload();
    await expect(owner.getByRole('textbox', { name: /^CURP/ })).toHaveValue(curp);
    await login(viewer, viewerEmail, viewerPassword);
    await viewer.goto(`/comparecientes/${id}`);
    await expect(viewer.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(viewer.getByRole('textbox', { name: /^CURP/ })).toHaveValue(curp);
    const viewerAuth = await request.post('/api/auth/login', { data: { email: viewerEmail, password: viewerPassword } });
    expect(viewerAuth.status()).toBe(200);
    const viewerActor = await viewerAuth.json();
    expect(viewerActor.user.organization.id).toBe(organizationId);
    for (const doc of documents) {
      const documentId = uploaded.get(doc.kind);
      await expect(viewer.getByRole('article').getByText(doc.name, { exact: true })).toBeVisible();
      const saved = await db.documento.findUniqueOrThrow({ where: { id: documentId } });
      expect(saved).toMatchObject({ organization_id: organizationId, checksum_sha256: digest(doc.bytes) });
      const original = await request.get(`/api/comparecientes/${id}/documentos/${documentId}/descargar`, {
        headers: { Authorization: `Bearer ${viewerActor.access_token}` },
      });
      expect(original.status()).toBe(200);
      expect(digest(await original.body())).toBe(digest(doc.bytes));
    }
    const duplicate = await request.post('/api/comparecientes/persona-fisica', {
      headers, data: { nombre: `${name} DUPLICADO` },
    });
    expect(duplicate.status()).toBe(201);
    const duplicateId = (await duplicate.json()).data.compareciente.id as string;
    fixtures.push({ id: duplicateId, headers });
    const refused = await request.patch(`/api/comparecientes/${duplicateId}`, { headers, data: { curp } });
    expect(refused.status()).toBe(409);
    const refusal = await refused.json();
    expect(refusal).toMatchObject({ code: 'COMPARECIENTE_DATOS_DUPLICADOS' });
    expect(JSON.stringify(refusal)).not.toMatch(/Prisma|personaFisica\.update|node_modules/);
    expect((await db.personaFisica.findUniqueOrThrow({ where: { compareciente_id: duplicateId } })).curp).toBeNull();
  } finally {
    try {
      for (const fixture of fixtures) {
        const archived = await request.patch(`/api/comparecientes/${fixture.id}/archivar`, {
          headers: fixture.headers, data: { motivo: 'Cierre del fixture sintético de QA OCR' },
        });
        expect(archived.status()).toBe(200);
      }
    } finally { await Promise.all([owner.close(), viewer.close(), db.$disconnect()]); }
  }
});
