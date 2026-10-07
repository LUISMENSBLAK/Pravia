import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

const caseId = '7a139000-0000-4000-8000-000000000001';

test('Archivo local: asignación, resumen, recarga y restricciones físicas', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_ARCHIVO_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local' });

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const loginPayload = await (await loginResponse).json();
  let token = loginPayload.accessToken ?? loginPayload.access_token ?? loginPayload.token;
  expect(token).toBeTruthy();
  await page.waitForURL('**/mi-dia');

  await page.goto(`/expedientes/${caseId}#archivo`);
  await expect(page.getByRole('tab', { name: 'Archivo' })).toBeVisible();
  const form = page.getByRole('region', { name: 'Datos del instrumento' });
  if (await form.getByRole('button', { name: 'Asignar escritura y folios' }).isVisible()) {
    await form.getByLabel('Número de escritura').fill('23500');
    await form.getByLabel('Folio inicial').fill('39511');
    await form.getByLabel('Folio final').fill('39520');
    await expect(form.getByLabel('Número de folios')).toHaveValue('10');
    await form.getByLabel('Fecha de firma / instrumento').fill('2026-10-05');
    const save = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${caseId}/archivo`) && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Asignar escritura y folios' }).click();
    const result = await save;
    expect(result.status(), await result.text()).toBe(201);
    const assigned = await result.json();
    expect(assigned).toMatchObject({ numero_escritura: '23500', folio_inicio: '39511', folio_fin: '39520', numero_folios: '10' });
  }

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Escritura 23500' })).toBeVisible();
  const appendix = page.getByRole('region', { name: 'Apéndice de la escritura' });
  const fixtureName = 'apendice-archivo-qa.png';
  if (!(await appendix.getByText(fixtureName).count())) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64');
    const uploaded = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${caseId}/archivo/apendice`) && response.request().method() === 'POST');
    await appendix.getByLabel('Agregar documentos').setInputFiles({ name: fixtureName, mimeType: 'image/png', buffer: png });
    expect((await uploaded).status(), await (await uploaded).text()).toBe(201);
  }
  await expect(appendix.getByText(fixtureName)).toBeVisible();
  const multiNames = ['apendice-archivo-multi-a-qa.png', 'apendice-archivo-multi-b-qa.png'];
  if (!(await appendix.getByText(multiNames[0]).count())) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64');
    await appendix.getByLabel('Agregar documentos').setInputFiles(multiNames.map((name) => ({ name, mimeType: 'image/png', buffer: png })));
  }
  for (const name of multiNames) await expect(appendix.getByText(name)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Apéndice de la escritura' }).getByText(fixtureName)).toBeVisible();
  for (const name of multiNames) await expect(page.getByRole('region', { name: 'Apéndice de la escritura' }).getByText(name)).toBeVisible();
  const notes = page.getByRole('region', { name: 'Formatos y notas de Archivo' });
  await expect(notes.getByText('Nota sintética de Archivo (QA local)')).toBeVisible();
  await notes.getByLabel('Instrucción opcional para el formato').fill('Revisión sintética QA');
  const generatedResponse = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${caseId}/archivo/formatos/generar`) && response.request().method() === 'POST');
  await notes.getByRole('button', { name: 'Generar Word para revisión' }).click();
  const generated = await generatedResponse;
  expect(generated.status(), await generated.text()).toBe(201);
  const note = await generated.json();
  expect(note.documento.nombre_original).toBe('nota-archivo-23500.docx');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Formatos y notas de Archivo' }).getByText('nota-archivo-23500.docx').first()).toBeVisible();
  await expect(page.getByLabel('Número de escritura', { exact: true }).first()).toHaveValue('23500');
  const header = page.getByRole('region', { name: 'Información del expediente' });
  await expect(header.getByLabel(/Número de escritura/)).toHaveValue('23500');
  await expect(header.getByLabel(/Número de escritura/)).toHaveAttribute('readonly', '');
  for (const width of [1440, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: 'Datos del instrumento' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `Detalle de Archivo tiene overflow horizontal a ${width}px`).toBe(false);
  }

  await page.goto('/archivo');
  await expect(page.getByRole('heading', { name: 'Archivo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /23500.*39511/ })).toBeVisible();
  for (const width of [1440, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Archivo', exact: true })).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(horizontalOverflow, `Archivo tiene overflow horizontal a ${width}px`).toBe(false);
  }

  // Reload rotates the cookie-backed session; use the current token, not the
  // access token captured at the original login.
  const apiLogin = await request.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(apiLogin.status(), await apiLogin.text()).toBe(200);
  token = (await apiLogin.json()).access_token;
  const currentAuth = () => ({ Authorization: `Bearer ${token}` });
  const archiveResponse = await request.get(`/api/expedientes/${caseId}/archivo`, { headers: currentAuth() });
  expect(archiveResponse.status()).toBe(200);
  const archived = await archiveResponse.json();
  const mainOverview = await request.get('/api/archivo', { headers: currentAuth() });
  expect(mainOverview.status()).toBe(200);
  expect((await mainOverview.json()).records.find((record: { expediente_id: string }) => record.expediente_id === caseId)?.id).toBe(archived.record.id);
  const file = archived.appendix.find((item: any) => item.documento.nombre_original === fixtureName);
  expect(file).toBeTruthy();
  expect(archived.appendix.map((item: any) => item.documento.nombre_original)).toEqual(expect.arrayContaining(multiNames));
  const downloaded = await request.get(`/api/expedientes/${caseId}/archivo/apendice/${file.id}/descargar`, { headers: currentAuth() });
  expect(downloaded.status()).toBe(200);
  expect(Buffer.from(await downloaded.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const noteDownloaded = await request.get(`/api/expedientes/${caseId}/archivo/apendice/${note.id}/descargar`, { headers: currentAuth() });
  expect(noteDownloaded.status()).toBe(200);
  const word = await JSZip.loadAsync(await noteDownloaded.body());
  const xml = await word.file('word/document.xml')?.async('string');
  expect(xml).toContain('23500');
  expect(xml).toContain('39511');
  expect(xml).toContain('39520');
  expect(xml).not.toContain('{{');
  const duplicate = await request.post(`/api/expedientes/${caseId}/archivo`, { headers: currentAuth(), data: { numero_escritura: '23500', folio_inicio: '39521', folio_fin: '39521', fecha_instrumento: '2026-10-05' } });
  expect(duplicate.status(), JSON.stringify(await duplicate.json())).toBe(409);
  const summaryEdit = await request.patch(`/api/expedientes/${caseId}`, { headers: currentAuth(), data: { numero_escritura: '99999' } });
  expect(summaryEdit.status()).toBe(409);
  expect((await summaryEdit.json()).code).toBe('ARCHIVO_SUMMARY_READ_ONLY');
});
