import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const incomeId = '699731d9-af88-4afb-9c77-4ff0131e3b3e';
const comparecienteId = '3a83988e-fafa-4de4-a5f9-235a41ff76a8';

function blankPdfOfSize(size: number) {
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]) {
    offsets.push(Buffer.byteLength(content));
    content += `${offsets.length - 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdf = Buffer.from(content);
  return Buffer.concat([pdf, Buffer.alloc(size - pdf.length, 0x20)]);
}

test('CFDI distingue CSF guardada de extracción fallida y conserva el documento de 5 MB', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_CSF_PROCESSING_SAFETY_GATE_FAILED');
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  await page.goto('/login');
  const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await emailInput.fill('adrian.hernandez@pravia.test');
    await passwordInput.fill(password);
    if (await submit.isEnabled()) break;
  }
  await expect(submit).toBeEnabled();
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await submit.click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  const authorization = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const uploadPolicy = await request.get('/api/upload-policy', { headers: authorization });
  expect(uploadPolicy.status()).toBe(200);
  expect(await uploadPolicy.json()).toMatchObject({
    standard_file_max_bytes: 50 * 1024 * 1024,
    fiscal_file_max_bytes: 50 * 1024 * 1024,
    catalog_import_file_max_bytes: 50 * 1024 * 1024,
  });
  const invoices = await request.get('/api/finanzas/facturacion/expedientes?estado=', { headers: authorization });
  expect(invoices.status()).toBe(200);
  const index = (await invoices.json()).data.items.findIndex((item: { id: string }) => item.id === incomeId);
  expect(index).toBeGreaterThanOrEqual(0);

  await page.goto('/finanzas?view=facturacion');
  await page.locator('table tbody tr').nth(index).getByRole('button', { name: 'Completar factura' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generar factura CFDI' });
  await expect(dialog.getByText('Faltan datos fiscales confirmados', { exact: false })).toBeVisible();
  const body = blankPdfOfSize(5 * 1024 * 1024);
  const name = `qa-csf-sin-texto-${Date.now()}.pdf`;
  const uploaded = page.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${comparecienteId}/documentos`) && response.request().method() === 'POST');
  const extracted = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/proveedores/csf/extraer') && response.request().method() === 'POST');
  await dialog.getByLabel('Cargar CSF para extraer datos').setInputFiles({ name, mimeType: 'application/pdf', buffer: body });
  const upload = await uploaded;
  expect(upload.status(), await upload.text()).toBe(201);
  const documentId = (await upload.json()).data.docMaster.id as string;
  const extraction = await extracted;
  expect(extraction.status()).toBe(422);
  await expect(dialog.getByText('CSF cargada — error de extracción. El documento sigue disponible.')).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('La CSF se cargó y permanece disponible');

  const textName = `qa-csf-textual-${Date.now()}.txt`;
  const textHeader = Buffer.from('RFC: AAA010101AAA\nDenominación/Razón Social: CLIENTE QA\nCódigo Postal: 63735\nRégimen Fiscal: 601 General\n', 'utf8');
  const textBody = Buffer.concat([textHeader, Buffer.alloc(50 * 1024 * 1024 - textHeader.length, 0x20)]);
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'pravia-csf-qa-'));
  const fixturePath = join(fixtureDirectory, textName);
  writeFileSync(fixturePath, textBody);
  const textUploaded = page.waitForResponse((response) => response.url().endsWith(`/api/comparecientes/${comparecienteId}/documentos`) && response.request().method() === 'POST', { timeout: 60_000 });
  const textExtracted = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/proveedores/csf/extraer') && response.request().method() === 'POST', { timeout: 60_000 });
  let textExtraction: Awaited<typeof textExtracted>;
  let textDocumentId = '';
  try {
    await dialog.getByLabel('Cargar CSF para extraer datos').setInputFiles(fixturePath);
    const textUpload = await textUploaded;
    expect(textUpload.status()).toBe(201);
    textDocumentId = (await textUpload.json()).data.docMaster.id as string;
    textExtraction = await textExtracted;
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
  const extractedPayload = await textExtraction.json();
  expect(textExtraction.status(), JSON.stringify(extractedPayload)).toBe(200);
  expect(extractedPayload).toMatchObject({ data: { rfc: 'AAA010101AAA', codigo_postal: '63735' } });
  await expect(dialog.getByRole('textbox', { name: 'RFC' })).toHaveValue('AAA010101AAA');
  await expect(dialog.getByText('CSF guardada en documentos del compareciente.')).toBeVisible();

  const apiLogin = await request.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(apiLogin.status()).toBe(200);
  const currentAuth = { Authorization: `Bearer ${(await apiLogin.json()).access_token}` };
  const download = await request.get(`/api/comparecientes/${comparecienteId}/documentos/${documentId}/descargar`, { headers: currentAuth });
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body())).toEqual(body);
  const textDownload = await request.get(`/api/comparecientes/${comparecienteId}/documentos/${textDocumentId}/descargar`, { headers: currentAuth });
  expect(textDownload.status()).toBe(200);
  const downloadedText = await textDownload.body();
  expect(downloadedText.length).toBe(textBody.length);
  expect(createHash('sha256').update(downloadedText).digest('hex')).toBe(createHash('sha256').update(textBody).digest('hex'));
  await page.reload();
  const documents = await request.get(`/api/comparecientes/${comparecienteId}/documentos`, { headers: currentAuth });
  expect(documents.status()).toBe(200);
  const documentList = JSON.stringify(await documents.json());
  expect(documentList).toContain(name);
  expect(documentList).toContain(textName);
  await page.goto(`/comparecientes/${comparecienteId}`);
  await expect(page.locator('article').filter({ hasText: name })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: textName })).toBeVisible();
});
