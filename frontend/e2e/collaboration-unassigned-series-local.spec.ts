import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import bcrypt from '../../backend/node_modules/bcryptjs/index.js';

const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const director = { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' };
const alejandro = { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' };
const javier = { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' };

async function login(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  if (await page.getByRole('textbox', { name: 'Contraseña', exact: true }).inputValue() !== credentials.password) {
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  }
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

test('COL35 · Prospecto realmente sin responsable, lectura compartida y asignación auditada', async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || !/^postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres\?schema=pravia_os$/.test(dbUrl)
    || [director, alejandro, javier].some((user) => !user.password)) throw new Error('COL35_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const context = await browser.newContext({ baseURL: base.toString(), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    const reception = { email: `reception-col35-${randomUUID().slice(0, 8)}@pravia.test`, password: `Pravia!REC-${randomUUID().slice(0, 12)}` };
    const receptionUser = await db.user.create({ data: { email: reception.email, nombre: 'Recepción', apellido: 'QA', rol: 'RECEPCION',
      password_hash: await bcrypt.hash(reception.password, 12), activo: true, requires_password_change: false, password_changed_at: new Date() } });
    await db.organizationMembership.create({ data: { organization_id: orgId, user_id: receptionUser.id, rol: 'RECEPCION' } });
    const auths = await Promise.all([director, reception, alejandro, javier].map((user) => request.post('/api/auth/login', { data: user })));
    auths.forEach((response) => expect(response.status()).toBe(200));
    const [adminAuth, receptionAuth, alejandroAuth, javierAuth] = await Promise.all(auths.map((response) => response.json()));
    for (const auth of [adminAuth, receptionAuth, alejandroAuth, javierAuth]) expect(auth.user.organization.id).toBe(orgId);
    const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
    const marker = `COL35-QA-${randomUUID().slice(0, 8)}`;

    await login(page, reception);
    await page.goto('/prospectos');
    await page.getByRole('button', { name: 'Nuevo prospecto' }).click();
    await page.getByRole('textbox', { name: /Nombre o razón social/ }).fill(marker);
    await page.getByRole('checkbox', { name: /Dejar sin asignar/ }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Crear prospecto' }).click();
    await page.waitForURL(/\/prospectos\/[0-9a-f-]+$/);
    const id = page.url().split('/').pop()!;
    await expect(page.getByText('Sin asignar', { exact: true }).first()).toBeVisible();
    const persisted = await db.prospecto.findUniqueOrThrow({ where: { id } });
    expect(persisted.user_id).toBeNull();
    expect(persisted.organization_id).toBe(orgId);
    expect(persisted.folio).toMatch(/^PRO-\d{4}-\d{4}$/);
    expect((await request.post('/api/prospectos', { headers: { ...headers(alejandroAuth), 'Idempotency-Key': randomUUID() }, data: {
      nombre: `DENIED-${randomUUID().slice(0, 8)}`, sinAsignar: true,
    } })).status()).toBe(403);
    await page.reload();
    await expect(page.getByText('Sin asignar', { exact: true }).first()).toBeVisible();

    for (const auth of [alejandroAuth, javierAuth]) {
      expect((await request.get(`/api/prospectos/${id}`, { headers: headers(auth) })).status()).toBe(200);
      expect((await request.put(`/api/prospectos/${id}`, { headers: headers(auth), data: { responsable_id: auth.user.id, expectedVersion: 1 } })).status()).toBe(403);
    }
    const operation = await request.get(`/api/prospectos/${id}/operacion`, { headers: headers(adminAuth) });
    expect(operation.status()).toBe(200);
    const assigned = await request.put(`/api/prospectos/${id}`, { headers: headers(adminAuth), data: {
      responsable_id: alejandroAuth.user.id, expectedVersion: (await operation.json()).version,
    } });
    expect(assigned.status(), await assigned.text()).toBe(200);
    expect((await db.prospecto.findUniqueOrThrow({ where: { id } })).user_id).toBe(alejandroAuth.user.id);
    expect(await db.auditLog.count({ where: { organization_id: orgId, entidad: 'Prospecto', entidad_id: id, accion: 'PRO001_EDITAR_FICHA' } })).toBeGreaterThan(0);
    expect((await request.put(`/api/prospectos/${id}`, { headers: headers(alejandroAuth), data: { telefono: '5550000001', expectedVersion: 2 } })).status()).toBe(200);
    const viewer = await browser.newPage({ baseURL: base.toString(), viewport: { width: 320, height: 800 } });
    await login(viewer, javier);
    await viewer.goto(`/prospectos/${id}`);
    await expect(viewer.getByRole('heading', { name: marker.toUpperCase() })).toBeVisible();
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await viewer.close();
  } finally { await context.close(); await db.$disconnect(); }
});

test('COL46 · series configuradas por tenant y visibles en el diálogo de conversión', async ({ browser, request }, testInfo) => {
  test.setTimeout(90_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || !/^postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres\?schema=pravia_os$/.test(dbUrl)
    || !director.password || !alejandro.password) throw new Error('COL46_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const context = await browser.newContext({ baseURL: base.toString() });
  const page = await context.newPage();
  try {
    const adminResponse = await request.post('/api/auth/login', { data: director });
    const lawyerResponse = await request.post('/api/auth/login', { data: alejandro });
    expect(adminResponse.status()).toBe(200);
    expect(lawyerResponse.status()).toBe(200);
    const admin = await adminResponse.json();
    const lawyer = await lawyerResponse.json();
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const existing = await db.expedienteFolioSerie.findUnique({ where: { organization_id_code: { organization_id: orgId, code: 'ESP' } } });
    if (!existing) {
      const created = await request.post('/api/cotizaciones/expediente-series', { headers: auth(admin.access_token), data: { code: 'ESP' } });
      expect(created.status(), await created.text()).toBe(201);
    }
    const denied = await request.post('/api/cotizaciones/expediente-series', { headers: auth(lawyer.access_token), data: { code: 'OTRA' } });
    expect(denied.status()).toBe(403);
    const listed = await request.get('/api/cotizaciones/expediente-series', { headers: auth(lawyer.access_token) });
    expect(listed.status()).toBe(200);
    expect(await listed.json()).toEqual(expect.arrayContaining([{ code: '', label: 'Ordinaria' }, { code: 'ESP', label: 'ESP' }]));
    await login(page, director);
    const quote = await db.cotizacion.findFirst({ where: { organization_id: orgId, etapa_contractual: 'ACEPTADA' }, select: { id: true } });
    if (quote) {
      await page.goto(`/cotizaciones/${quote.id}`);
      const button = page.getByRole('button', { name: 'Convertir en expediente', exact: true });
      if (await button.isVisible()) {
        await button.click();
        await expect(page.getByLabel('Serie del expediente')).toBeVisible();
        await expect(page.getByLabel('Serie del expediente').getByRole('option', { name: 'ESP' })).toHaveCount(1);
      }
    }
  } finally { await context.close(); await db.$disconnect(); }
});
