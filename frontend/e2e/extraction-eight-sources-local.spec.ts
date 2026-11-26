import { expect, test } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { createCanvas } from '../../backend/node_modules/@napi-rs/canvas/index.js';
import { PDFDocument } from '../../backend/node_modules/pdf-lib/cjs/index.js';
import JSZip from '../../backend/node_modules/jszip/lib/index.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

// Deliberately non-official fixtures: no seals, signature or real identity.
function photo(lines: string[], obscured = false) {
  const canvas = createCanvas(1500, 1120), c = canvas.getContext('2d');
  c.fillStyle = '#88847f'; c.fillRect(0, 0, 1500, 1120);
  c.translate(100, 25); c.rotate(.065); c.transform(1, -.018, -.045, 1, 0, 0);
  c.fillStyle = '#f5f1df'; c.fillRect(0, 0, 1350, 1000);
  c.font = 'bold 27px sans-serif'; c.fillStyle = '#463e34'; c.fillText('SINTETICO QA - SIN VALIDEZ OFICIAL', 55, 60);
  c.font = '32px sans-serif'; lines.forEach((line, i) => c.fillText(line, 55, 145 + 59 * i));
  const shade = c.createLinearGradient(0, 0, 1350, 1000); shade.addColorStop(0, '#00000065'); shade.addColorStop(.55, '#00000000'); shade.addColorStop(1, '#00000030');
  c.fillStyle = shade; c.fillRect(0, 0, 1350, 1000);
  if (obscured) { c.fillStyle = '#a49d8f'; c.fillRect(0, 90, 1350, 900); }
  return canvas.toBuffer('image/jpeg', 43);
}
async function scan(lines: string[]) {
  const pdf = await PDFDocument.create(), img = await pdf.embedJpg(photo(lines));
  pdf.addPage([750, 560]).drawImage(img, { x: 0, y: 0, width: 750, height: 560 });
  return Buffer.from(await pdf.save());
}
async function word(lines: string[]) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ['SINTETICO QA - SIN VALIDEZ', ...lines].map(line => '<w:p><w:r><w:t>' + line + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Ocho fuentes mixtas: alta nueva, OpenAI real, revisión, borrador PostgreSQL y originales íntegros', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const url = new URL(process.env.QA_CLIENT_CASE_DATABASE_URL!);
  expect([url.hostname, url.port, url.pathname]).toEqual(['127.0.0.1', '55521', '/pravia_client_qa']);
  const db = new PrismaClient({ datasourceUrl: url.href }), run = randomUUID().slice(0, 8);
  const root = '/tmp/pravia-extraction-eight-' + run; await mkdir(root);
  let auth = '', sessionId = '';
  page.on('request', req => { if (req.url().startsWith(baseURL + '/api/') && req.headers().authorization) auth = req.headers().authorization; });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await expect.poll(async () => (await page.request.get('/api/health')).status(), { timeout: 60000 }).toBe(200);
    await page.goto('/login'); await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.QA_LOCAL_PASSWORD!);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await page.waitForURL('**/mi-dia');
    const mastersBefore = await db.compareciente.count();
    const movementsBefore = await db.movimientoFinanciero.count();
    await page.goto('/comparecientes/nuevo');
    const documents = [
      { name: '01-identidad-foto.jpg', mimeType: 'image/jpeg', buffer: photo(['Nombre(s): ELISA', 'Primer apellido: DOCUMENTAL', 'Segundo apellido: SINTETICA', 'RFC: QAFA900101QA1', 'CURP: GARA900101HDFRBC78']) },
      { name: '02-nacimiento-escaneado.pdf', mimeType: 'application/pdf', buffer: await scan(['ELISA DOCUMENTAL SINTETICA', 'Fecha de nacimiento: 01/01/1990', 'Lugar de nacimiento: TEPIC, NAYARIT', 'Nacionalidad: MEXICANA', 'Pais de nacimiento: MEXICO']) },
      { name: '03-domicilio-foto.jpg', mimeType: 'image/jpeg', buffer: photo(['COMPROBANTE DE DOMICILIO PARTICULAR', 'ELISA DOCUMENTAL SINTETICA', 'Calle: AVENIDA QA', 'Numero exterior: 45', 'Colonia: CENTRO', 'Codigo postal: 63000', 'Municipio: TEPIC', 'Estado: NAYARIT', 'Pais: MEXICO']) },
      { name: '04-ficha-notarial.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await word(['ELISA DOCUMENTAL SINTETICA', 'Ocupacion: ARQUITECTA', 'Escolaridad: LICENCIATURA', 'Telefono: 3111234567', 'Correo: elisa.qa@example.test']) },
      { name: '05-estado-civil.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await word(['ELISA DOCUMENTAL SINTETICA', 'Estado civil: CASADA', 'Regimen matrimonial: SEPARACION DE BIENES']) },
      { name: '06-domicilio-fiscal.pdf', mimeType: 'application/pdf', buffer: await scan(['DOMICILIO FISCAL - FICHA SINTETICA', 'ELISA DOCUMENTAL SINTETICA', 'RFC: QAFA900101QA1', 'Calle: AVENIDA FISCAL QA', 'Numero exterior: 80', 'Colonia: CENTRO', 'Codigo postal: 63000', 'Municipio: TEPIC', 'Estado: NAYARIT']) },
      { name: '07-actividad-foto.jpg', mimeType: 'image/jpeg', buffer: photo(['ELISA DOCUMENTAL SINTETICA', 'Actividad economica: SERVICIOS DE ARQUITECTURA', 'No se acredita ningun regimen fiscal.']) },
      { name: '08-identificacion-escaneada.pdf', mimeType: 'application/pdf', buffer: await scan(['PASAPORTE SINTETICO DE PRUEBA', 'ELISA DOCUMENTAL SINTETICA', 'Pais emisor: MEXICO', 'Autoridad emisora: SECRETARIA DE RELACIONES EXTERIORES', 'Fecha de expedicion: 10/02/2024', 'Fecha de vencimiento: 10/02/2034']) },
    ];
    for (const doc of documents) await writeFile(root + '/' + doc.name, doc.buffer);
    // This reproduces the reported upload category, without relying on names.
    await page.getByLabel('Tipo de documento', { exact: true }).selectOption('IDENTIFICACION');
    await page.locator('input[type=file]').setInputFiles(documents);
    await expect(page.getByRole('button', { name: 'Extraer información con IA', exact: true })).toBeEnabled({ timeout: 60000 });
    const extracted = page.waitForResponse(r => /\/altas\/[^/]+\/extraer$/.test(r.url()) && r.request().method() === 'POST', { timeout: 300000 });
    const extractionStarted = Date.now();
    await page.getByRole('button', { name: 'Extraer información con IA', exact: true }).click();
    const response = await extracted; expect(response.status()).toBe(200);
    if (process.env.QA_EXPECT_DIRECT_API_BASE) expect(response.url().startsWith(process.env.QA_EXPECT_DIRECT_API_BASE + '/')).toBe(true);
    const body = await response.json(); sessionId = body.sesion_id;
    expect(body.errores).toEqual([]); expect(body.procesados).toBe(8);
    expect(body.borrador_actualizado).toMatchObject({ nombre: 'ELISA', apellido_paterno: 'DOCUMENTAL', apellido_materno: 'SINTETICA', rfc: 'QAFA900101QA1' });
    const curpReviewNeeded = !body.borrador_actualizado.curp;
    if (curpReviewNeeded) {
      // Ambiguous vision must NOT choose an identifier. Verify the faithful
      // reading is present among the sourced alternatives, then review it as
      // a human would against the fixture. Wrong/absent readings still fail.
      expect(body.propuesta.curp.estado).toBe('EN_CONFLICTO');
      expect(body.propuesta.curp.alternativas.map((item: any) => item.valor)).toContain('GARA900101HDFRBC78');
      await expect(page.locator('#compareciente-curp')).toHaveValue('');
      await page.locator('#compareciente-curp').fill('GARA900101HDFRBC78');
    } else expect(body.borrador_actualizado.curp).toBe('GARA900101HDFRBC78');
    for (const key of ['fecha_nacimiento','lugar_nacimiento','nacionalidad','ocupacion','estado_civil','regimen_matrimonial','telefono','correo']) expect(body.borrador_actualizado[key], key).toBeTruthy();
    await expect(page.getByRole('textbox', { name: /^RFC/ })).toHaveValue('QAFA900101QA1');
    await expect(page.getByRole('textbox', { name: /^CURP/ })).toHaveValue('GARA900101HDFRBC78');
    await expect(page.locator('#compareciente-fecha_nacimiento')).toHaveValue('1990-01-01');
    await expect(page.locator('#compareciente-estado_civil')).toHaveValue('CASADO');
    await expect(page.locator('#compareciente-regimen_matrimonial')).toHaveValue('SEPARACION_DE_BIENES');
    await expect(page.locator('#compareciente-tipo_identificacion')).toHaveValue('PASAPORTE');
    for (const key of ['nombre','apellido_paterno','apellido_materno','lugar_nacimiento','nacionalidad','ocupacion','telefono','correo']) await expect(page.locator('#compareciente-' + key)).not.toHaveValue('');
    expect(await db.compareciente.count()).toBe(mastersBefore); // Never auto-create.
    const persisted = await db.comparecienteAltaSession.findUniqueOrThrow({ where: { id: sessionId }, include: { cargasTemporales: true } });
    expect(persisted.estatus).toBe('PENDIENTE_CONFIRMACION'); expect(persisted.cargasTemporales).toHaveLength(8);
    const events = await db.aiUsageEvent.findMany({ where: { trace_id: { startsWith: `compareciente-alta-extraction:${persisted.organization_id}:${sessionId}:` } } });
    expect(events.length).toBeGreaterThanOrEqual(2); expect(events.every(e => e.status === 'COMPLETED')).toBe(true);
    expect(new Set(events.map(e => e.trace_id)).size).toBe(events.length);
    for (const row of persisted.cargasTemporales) {
      const original = await page.request.get(`/api/comparecientes/altas/${sessionId}/documentos/${row.id}/stream`, { headers: { Authorization: auth } });
      expect(original.status()).toBe(200);
      const source = documents.find(d => d.name === row.nombre_original)!;
      expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(createHash('sha256').update(source.buffer).digest('hex'));
    }
    await page.screenshot({ path: root + '/alta-revision.png', fullPage: true });
    expect(errors).toEqual([]);
    expect(await db.movimientoFinanciero.count()).toBe(movementsBefore);
    console.log(JSON.stringify({ status: 'PASS', sources: 8, ledgerCalls: events.length, curpReviewNeeded, root, extractionMs: Date.now() - extractionStarted, directBackend: Boolean(process.env.QA_EXPECT_DIRECT_API_BASE), realOpenAI: true, productionWrites: false }));
  } finally { await db.$disconnect(); }
});

test('Chat desde alta nueva: comprobante fotografiado sin identidad, lectura real y foto tapada sin inventar', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const url = new URL(process.env.QA_CLIENT_CASE_DATABASE_URL!);
  expect([url.hostname, url.port, url.pathname]).toEqual(['127.0.0.1', '55521', '/pravia_client_qa']);
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    const mastersBefore = await db.compareciente.count(), movementsBefore = await db.movimientoFinanciero.count();
    await expect.poll(async () => (await page.request.get('/api/health')).status(), { timeout: 60000 }).toBe(200);
    await page.goto('/login'); await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.QA_LOCAL_PASSWORD!);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await page.waitForURL('**/mi-dia');
    await page.goto('/comparecientes/nuevo');
    await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
    const chat = page.getByRole('dialog', { name: 'PRAVIA IA', exact: true });
    await chat.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    const uploads = page.waitForResponse(r => r.url().endsWith('/attachments') && r.request().method() === 'POST', { timeout: 60000 });
    await chat.locator('input[type=file]').setInputFiles({ name: 'comprobante-sintetico.jpg', mimeType: 'image/jpeg', buffer: photo(['COMPROBANTE INTERNO SINTETICO', 'Anticipo: 12500 MXN', 'Referencia: QA-ORD-73', 'Fecha: 25/11/2026', 'No autoriza pagos ni movimientos.']) });
    expect((await uploads).status()).toBe(201);
    const send = async (message: string) => { const pending = page.waitForResponse(r => r.url().endsWith('/assistant/messages') && r.request().method() === 'POST', { timeout: 300000 }); await chat.getByLabel('Pregúntame algo...').fill(message); await chat.getByRole('button', { name: 'Enviar mensaje', exact: true }).click(); const result = await pending; expect(result.status()).toBe(200); if (process.env.QA_EXPECT_DIRECT_API_BASE) expect(result.url().startsWith(process.env.QA_EXPECT_DIRECT_API_BASE + '/')).toBe(true); return result.json(); };
    const answer = await send('Extrae los datos importantes de esta foto, dime el anticipo y la referencia. No hagas movimientos.');
    expect(answer.message).toContain('QA-ORD-73'); expect(answer.message.replace(/[, .]/g, '')).toContain('12500');
    await expect(chat.getByLabel('Adjuntos temporales')).toHaveCount(0);
    const badUpload = page.waitForResponse(r => r.url().endsWith('/attachments') && r.request().method() === 'POST', { timeout: 60000 });
    await chat.locator('input[type=file]').setInputFiles({ name: 'foto-tapada.jpg', mimeType: 'image/jpeg', buffer: photo(['Nombre: NO VISIBLE', 'RFC: NO VISIBLE'], true) });
    expect((await badUpload).status()).toBe(201);
    const noData = await send('Transcribe únicamente lo legible de esta nueva foto. No reutilices los datos del comprobante anterior ni inventes RFC, CURP o nombre.');
    expect(noData.message).not.toContain('QA-ORD-73'); expect(noData.message).not.toMatch(/RFC:\s*[A-Z]{4}\d{6}/);
    expect(noData.message).not.toContain('No respondo consultas ajenas');
    expect(await db.movimientoFinanciero.count()).toBe(movementsBefore);
    expect(await db.compareciente.count()).toBe(mastersBefore);
    console.log(JSON.stringify({ status: 'PASS', generalPhoto: true, illegiblePhoto: true, realOpenAI: true, productionWrites: false }));
  } finally { await db.$disconnect(); }
});
