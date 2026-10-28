import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import { PDFDocument } from '../../backend/node_modules/pdf-lib/cjs/index.js';

const rosa = { email: 'rosa.becerra@pravia.test', password: process.env.PRAVIA_E2E_ROSA_PASSWORD || '' };
const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';

test('COL05/COL25/COL62 · Finanzas registra y aplica ingreso QA sin permiso jurídico', async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || !/^postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres\?schema=pravia_os$/.test(dbUrl)
    || !rosa.password) throw new Error('COLLABORATION_FINANCE_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const context = await browser.newContext({ baseURL: base.toString() });
  const page = await context.newPage();
  try {
    const login = await request.post('/api/auth/login', { data: rosa });
    expect(login.status()).toBe(200);
    const auth = await login.json();
    expect(auth.user.rol).toBe('FINANCIERO');
    expect(auth.user.organization.id).toBe(orgId);
    const headers = { Authorization: `Bearer ${auth.access_token}` };
    const record = await db.expediente.findFirstOrThrow({ where: {
      organization_id: orgId, cotizacion: { prospecto: { nombre: { startsWith: 'COL-COMMERCIAL-QA-' } } },
    }, orderBy: { created_at: 'desc' }, include: { comparecientes: { where: { estatus: 'ACTIVO' } } } });
    expect(record.comparecientes.length).toBeGreaterThan(0);
    const caseId = record.id;
    expect((await request.get(`/api/expedientes/${caseId}`, { headers })).status()).toBe(200);
    expect((await request.get(`/api/expedientes/${caseId}/finanzas-operativas`, { headers })).status()).toBe(200);
    expect((await request.patch(`/api/expedientes/${caseId}`, { headers,
      data: { cliente_alias: 'Intrusión jurídica de Finanzas QA' } })).status()).toBe(403);
    const initialAlias = (await db.expediente.findUniqueOrThrow({ where: { id: caseId } })).cliente_alias;

    await db.categoriaFinanciera.upsert({ where: { clave: 'HONORARIOS' }, update: {}, create: {
      organization_id: orgId, clave: 'HONORARIOS', nombre: 'Honorarios', naturaleza: 'DESPACHO', direccion: 'INGRESO',
    } });
    const account = await db.cuentaFinanciera.findFirst({ where: { organization_id: orgId,
      institucion: 'BANCO SINTETICO QA', alias: 'CUENTA LOCAL COLABORACION QA' } })
      || await db.cuentaFinanciera.create({ data: { organization_id: orgId, institucion: 'BANCO SINTETICO QA',
        alias: 'CUENTA LOCAL COLABORACION QA', tipo: 'QA', moneda: 'MXN', creada_por_id: auth.user.id } });

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(rosa.email);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(rosa.password);
    if (await page.getByRole('textbox', { name: 'Contraseña', exact: true }).inputValue() !== rosa.password) {
      await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(rosa.password);
    }
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(rosa.email);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/mi-dia');
    await page.goto(`/expedientes/${caseId}#finanzas`);
    await expect(page.getByRole('tab', { name: 'Finanzas' })).toBeVisible();
    await page.getByRole('tab', { name: 'Finanzas' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reportar ingreso' })).toBeVisible();

    const marker = `COL-FIN-QA-${randomUUID()}`;
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]).drawText(`Comprobante sintetico local ${marker}`, { x: 40, y: 790, size: 12 });
    await page.getByRole('button', { name: 'Reportar ingreso' }).click();
    const reportDialog = page.getByRole('dialog', { name: 'Reportar ingreso' });
    await reportDialog.getByLabel('Concepto o contexto').fill(marker);
    await reportDialog.getByLabel('Monto reportado (opcional)').fill('50.00');
    await reportDialog.getByLabel('¿A quién se va a facturar?').selectOption(record.comparecientes[0].id);
    await reportDialog.getByLabel('Forma de pago').selectOption('TRANSFERENCIA');
    await reportDialog.getByLabel('Comprobante del ingreso').setInputFiles({ name: 'comprobante-sintetico-qa.pdf',
      mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await reportDialog.getByRole('button', { name: 'Registrar ingreso' }).click();
    await expect(reportDialog).toHaveCount(0);
    const reported = await db.expedienteIngresoReportado.findFirstOrThrow({ where: { organization_id: orgId,
      expediente_id: caseId, concepto_contexto: marker } });
    const incomeId = reported.id;
    expect((await db.expedienteIngresoReportado.findUniqueOrThrow({ where: { id: incomeId } })).reportado_por_id).toBe(auth.user.id);
    const incomeRow = page.getByRole('tabpanel', { name: 'Finanzas' }).locator('article').filter({ hasText: marker });
    await expect(incomeRow).toBeVisible();
    await incomeRow.getByRole('button', { name: 'Aplicar' }).click();
    const applyDialog = page.getByRole('dialog', { name: 'Aplicar ingreso' });
    await applyDialog.getByLabel('Monto validado').fill('50.00');
    await applyDialog.getByLabel('Honorarios').fill('50.00');
    await applyDialog.getByLabel('Impuestos y derechos').fill('0.00');
    await applyDialog.getByLabel('Cuenta').selectOption(account.id);
    await applyDialog.getByRole('button', { name: 'Validar y aplicar' }).click();
    await expect(applyDialog).toHaveCount(0);
    const persisted = await db.expedienteIngresoReportado.findUniqueOrThrow({ where: { id: incomeId }, include: { movimiento: true } });
    expect(persisted.estado).toBe('APLICADO');
    expect(Number(persisted.monto_validado)).toBe(50);
    expect(persisted.movimiento?.capturado_por_id).toBe(auth.user.id);
    expect((await db.expediente.findUniqueOrThrow({ where: { id: caseId } })).cliente_alias).toBe(initialAlias);
    expect(await db.auditLog.count({ where: { organization_id: orgId, user_id: auth.user.id,
      OR: [{ entidad_id: incomeId }, { entidad_id: caseId }] } })).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Finanzas' })).toBeVisible();
    await page.getByRole('tab', { name: 'Finanzas' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toContainText(marker);
    await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toContainText('Aplicado');
  } finally {
    await context.close();
    await db.$disconnect();
  }
});
