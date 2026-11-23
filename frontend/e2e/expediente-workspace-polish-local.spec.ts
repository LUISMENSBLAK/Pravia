import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { Document, Header, Packer, Paragraph } from '../../backend/node_modules/docx/dist/index.cjs';
import JSZip from '../../backend/node_modules/jszip/lib/index.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const app = 'http://127.0.0.1:5176';
const backend = 'http://127.0.0.1:3011';
const casePath = '/expedientes/23110000-0000-4000-8000-000000000031';
const localOrigins = new Set([app, backend]);

test('Expediente: ficha, navegación continua y Proyecto a seis anchos en Chrome local', async ({ page, request, baseURL }) => {
  expect(baseURL).toBe(app);
  const password = process.env.QA_LOCAL_PASSWORD;
  if (!password) throw new Error('Falta QA_LOCAL_PASSWORD de la cuenta sintética local.');
  const health = await request.get(`${backend}/health`);
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({
    api: 'ok', database: 'ok', storage: 'ok', database_mode: 'local', storage_mode: 'local',
  });
  const errors: string[] = [];
  await page.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    if (localOrigins.has(url.origin)) return route.continue();
    if (route.request().resourceType() === 'document' || url.pathname.startsWith('/api/')) errors.push('Solicitud de aplicación fuera de QA');
    return route.abort();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (localOrigins.has(url.origin) && response.status() >= 500) errors.push(`${response.status()} ${url.pathname}`);
  });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('documentos.qa@pravia.test');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const width of [1440, 1366, 1024, 768, 390, 320]) {
    await test.step(`${width} px: alineación, navegación y contenido sin recortes`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${casePath}#proyecto`);
      const sheet = page.getByRole('region', { name: 'Información del expediente' });
      await expect(sheet.getByLabel('Número de expediente')).toHaveValue('EXP-QA-STYLE-2026');
      const deed = sheet.getByLabel(/Número de escritura/);
      const folios = sheet.getByRole('group', { name: 'Folios' });
      const first = folios.getByRole('textbox', { name: 'De', exact: true });
      const last = folios.getByRole('textbox', { name: 'A', exact: true });
      for (const field of [deed, first, last]) await expect(field).toHaveAttribute('readonly', '');
      const { card, deedBox, folioBoxes } = await deed.evaluate((field) => {
        // Take all measurements in one layout frame, while the client search loads independently.
        const sheet = field.closest('section')!;
        return {
          card: sheet.getBoundingClientRect().toJSON() as DOMRect,
          deedBox: field.getBoundingClientRect().toJSON() as DOMRect,
          folioBoxes: Array.from(sheet.querySelectorAll('fieldset input'), (input) => input.getBoundingClientRect().toJSON() as DOMRect),
        };
      });
      expect(folioBoxes).toHaveLength(2);
      const [firstBox, lastBox] = folioBoxes;
      for (const box of [deedBox, firstBox, lastBox]) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x - card.x).toBeGreaterThanOrEqual(15);
        expect(card.x + card.width - box.x - box.width).toBeGreaterThanOrEqual(15);
      }
      expect(Math.abs(firstBox.width - lastBox.width)).toBeLessThan(1);
      expect(firstBox.y).toBe(lastBox.y);
      if (width >= 1024) expect(Math.abs(firstBox.y - deedBox.y)).toBeLessThan(1);

      const picker = page.getByLabel('Ir a una sección del expediente');
      const tabstrip = page.getByRole('tablist', { name: 'Secciones del expediente' });
      const project = page.getByRole('tabpanel', { name: 'Proyecto' });
      const instructions = project.getByRole('textbox', { name: /Indicaciones para la proyección/ });
      await expect(instructions).toBeVisible();
      await instructions.fill('Indicación sintética local, sin generar ni modificar el expediente.');
      await expect(instructions).toHaveValue(/Indicación sintética local/);
      await project.getByText('Opciones avanzadas', { exact: true }).click();
      await expect(project.getByLabel('Uso del machote')).toBeVisible();
      expect(await page.evaluate(() => {
        const main = document.querySelector('#main-content');
        return Math.max(document.documentElement.scrollWidth - innerWidth, (main?.scrollWidth ?? 0) - (main?.clientWidth ?? 0));
      })).toBeLessThanOrEqual(1);

      const next = page.getByRole('button', { name: 'Sección siguiente' });
      await expect(next).toBeInViewport();
      const nextBox = (await next.boundingBox())!;
      expect(Math.min(nextBox.width, nextBox.height)).toBeGreaterThanOrEqual(44);
      await next.click();
      await expect(page).toHaveURL(/#finanzas$/);
      await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toBeVisible();
      const previous = page.getByRole('button', { name: 'Sección anterior' });
      await previous.click();
      await expect(page).toHaveURL(/#proyecto$/);

      if (width <= 390) {
        await expect(tabstrip).toBeHidden();
        await expect(picker).toHaveValue('proyecto');
        await picker.selectOption('documentos');
      } else if (await tabstrip.isVisible()) {
        const projectTab = tabstrip.getByRole('tab', { name: 'Proyecto' });
        await projectTab.focus();
        await projectTab.press('ArrowLeft');
        const budgetTab = tabstrip.getByRole('tab', { name: 'Presupuesto' });
        await expect(budgetTab).toBeFocused();
        await budgetTab.press('Home');
        await expect(tabstrip.getByRole('tab', { name: 'Actos' })).toHaveAttribute('aria-selected', 'true');
        await tabstrip.getByRole('tab', { name: 'Documentos', exact: true }).click();
      } else {
        await picker.selectOption('documentos');
      }
      await expect(page).toHaveURL(/#documentos$/);
      await expect(page.getByRole('tabpanel', { name: 'Documentos' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('tabpanel', { name: 'Documentos' })).toBeVisible();
      await page.getByRole('button', { name: 'Volver a información del expediente' }).click();
      await expect(sheet.getByRole('heading')).toBeInViewport();
    });
  }
  expect(errors).toEqual([]);
});

test('Proyecto: motivo independiente, error recuperable y versión corregida persistida', async ({ page, request, baseURL }) => {
  const password = process.env.QA_LOCAL_PASSWORD;
  const database = new URL(process.env.QA_CLIENT_CASE_DATABASE_URL || 'postgresql://invalid');
  if (baseURL !== app || !password || database.protocol !== 'postgresql:'
      || database.hostname !== '127.0.0.1' || database.port !== '55521'
      || database.pathname !== '/pravia_client_qa' || database.searchParams.get('schema') !== 'pravia_os') {
    throw new Error('EXP010_CORRECTION_LOCAL_QA_ONLY');
  }
  expect(await (await request.get(`${backend}/health`)).json()).toMatchObject({
    api: 'ok', database: 'ok', storage: 'ok', database_mode: 'local', storage_mode: 'local',
  });
  await page.route(/^https?:/, (route) => localOrigins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  const login = await request.post(`${backend}/api/auth/login`, {
    data: { email: 'documentos.qa@pravia.test', password },
  });
  expect(login.status()).toBe(200);
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const db = new PrismaClient({ datasourceUrl: database.toString() });
  const id = randomUUID();
  try {
    const sample = await db.expediente.findUniqueOrThrow({ where: { id: casePath.split('/').at(-1) } });
    const who = await db.user.findUniqueOrThrow({ where: { email: 'documentos.qa@pravia.test' } });
    expect(sample.organization_id).toBe(auth.user.organization.id);
    await db.expediente.create({ data: {
      id, organization_id: sample.organization_id, creador_id: who.id, abogado_id: who.id,
      numero_pravia: `EXP-QA-UX-${id.slice(0, 8)}`, descripcion: 'QA SINTÉTICO / SIN VALIDEZ JURÍDICA', tipo_acto_id: sample.tipo_acto_id,
    } });
    const file = await Packer.toBuffer(new Document({ sections: [{
      headers: { default: new Header({ children: [new Paragraph('QA SINTÉTICO')] }) },
      children: [new Paragraph('SIN VALIDEZ JURÍDICA'), new Paragraph('Superficie de prueba: 7.25 metros.'), new Paragraph('Cláusula fija de control.')],
    }] }));
    const projectRoute = `/api/expedientes/${id}/proyecto`;
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('documentos.qa@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/mi-dia');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/expedientes/${id}#proyecto`);
    await page.getByRole('button', { name: 'REVISAR PROYECTO', exact: true }).click();
    const upload = page.waitForResponse((response) => new URL(response.url()).pathname === `${projectRoute}/upload`);
    await page.getByRole('heading', { name: '¿Ya tienes un proyecto?' }).locator('xpath=ancestor::section[1]').locator('input[type=file]').setInputFiles({
      name: 'Proyecto-sintetico-UX.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: file,
    });
    expect((await upload).status()).toBe(201);
    const editor = page.getByRole('region', { name: 'Aplicar indicaciones a la versión vigente' });
    await expect(editor).toContainText('versión 1');
    const prior = await db.documento.findFirstOrThrow({ where: { expediente_id: id, tipo: 'PROYECTO_ESCRITURA' } });
    expect(prior.checksum_sha256).toBe(createHash('sha256').update(file).digest('hex'));

    await page.getByLabel(/Indicaciones para la proyección/).fill('Texto que sólo pertenece a la generación.');
    const motive = editor.getByLabel(/Motivo de la corrección/);
    const current = editor.getByLabel('Texto actual');
    const replacement = editor.getByLabel('Texto corregido');
    const apply = editor.getByRole('button', { name: 'APLICAR INDICACIONES' });
    await current.fill('No figura en el documento');
    await replacement.fill('Superficie registrada');
    await expect(apply).toBeDisabled();
    const reason = 'Aclarar la etiqueta en el documento sintético sin modificar el dato.';
    await motive.fill(reason);
    const actionPath = `${projectRoute}/aplicar-indicaciones`;
    const awaitAction = () => page.waitForResponse((response) => new URL(response.url()).pathname === actionPath);
    const denial = awaitAction();
    await apply.click();
    expect((await denial).status()).toBe(409);
    await expect(editor.getByRole('alert')).toBeVisible();
    await expect(motive).toHaveValue(reason);
    expect(await db.documento.count({ where: { expediente_id: id, tipo: 'PROYECTO_ESCRITURA' } })).toBe(1);

    await current.fill('Superficie de prueba');
    let releaseResponse!: () => void;
    const release = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route((url) => url.pathname === actionPath, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      await release;
      await route.fulfill({ response });
    }, { times: 1 });
    const successful = awaitAction();
    await apply.click();
    try {
      await expect(editor.getByText('Guardando corrección', { exact: true })).toBeInViewport();
      await expect(apply).toBeDisabled();
      await expect(current).toBeDisabled();
    } finally { releaseResponse(); }
    const response = await successful;
    expect(response.status()).toBe(201);
    const corrected = await response.json();
    await expect(editor.getByRole('status')).toContainText('La versión anterior permanece intacta.');
    await expect(editor).toContainText('versión 2');
    await expect(page.getByLabel(/Indicaciones para la proyección/)).toHaveValue('Texto que sólo pertenece a la generación.');
    await page.reload();
    await expect(editor).toContainText('versión 2');
    const stored = await db.projectInstructionApplication.findFirstOrThrow({ where: { expediente_id: id } });
    expect(stored).toMatchObject({ instructions: reason, source_project_document_id: prior.id, result_project_document_id: corrected.version.id });
    expect(await db.auditLog.count({ where: { entidad_id: stored.id, accion: 'APLICAR_INDICACIONES_PROYECTO', organization_id: sample.organization_id } })).toBe(1);
    expect(await db.documento.count({ where: { expediente_id: id, tipo: 'PROYECTO_ESCRITURA' } })).toBe(2);

    const download = async (version: string) => {
      const artifact = await request.get(`${backend}${projectRoute}/versions/${version}/visualizar`, { headers });
      expect(artifact.status()).toBe(200);
      return artifact.body();
    };
    expect(await download(prior.id)).toEqual(file);
    const patched = await JSZip.loadAsync(await download(corrected.version.id));
    const xml = await patched.file('word/document.xml')!.async('string');
    const header = await patched.file('word/header1.xml')!.async('string');
    expect(xml).toContain('Superficie registrada: 7.25 metros.');
    expect(xml).toContain('Cláusula fija de control.');
    expect(header).toBe(await (await JSZip.loadAsync(file)).file('word/header1.xml')!.async('string'));
  } finally {
    await db.$disconnect();
  }
});
