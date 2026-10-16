import { readFileSync } from 'node:fs';
import { expect, request as requestFactory, test } from '@playwright/test';

const caseId = '7a139000-0000-4000-8000-000000000001';

test('X12/X14/X15 · ingreso aplicado y prefactura alteran las tarjetas exactas de Mi Día', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) {
    throw new Error('MI_DIA_INCOME_FLOW_LOCAL_ONLY');
  }
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: {
    email: 'adrian.hernandez@pravia.test', password,
  } });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const getConfig = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: any }).data;
  };
  const getFinanceCards = async () => {
    const response = await api.get('/api/mi-dia', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { operacion: { finanzas_cards: Record<string, {
      count: number; amount: string; items: Array<{ id: string; href: string }>;
    }> } }).operacion.finanzas_cards;
  };
  const original = await getConfig();
  const tenant = original.tenantAdministration;
  expect(tenant).toBeTruthy();
  const keys = ['INCOME_COLLECTED', 'INVOICES_PENDING', 'CFDI_TO_STAMP'];
  try {
    const tenantUpdate = await api.put('/api/mi-dia/tenant-config', { headers, data: {
      version: tenant.version,
      enabled_cards: [...new Set([...tenant.enabledCards, ...keys])],
      default_layout: tenant.defaultLayout,
      fixed_cards: tenant.defaultLayout.filter((item: any) => item.fixed).map((item: any) => item.key),
      recommended_cards: tenant.recommendedCards,
    } });
    expect(tenantUpdate.status()).toBe(200);
    const configured = await getConfig();
    const additions = keys.filter((key) => !configured.layout.some((item: any) => item.key === key))
      .map((key) => ({ key, size: configured.catalog.find((item: any) => item.key === key).defaultSize,
        scope: 'ORGANIZATION', parameters: key === 'INCOME_COLLECTED' ? { period: 'MONTH' } : {} }));
    const layoutUpdate = await api.put('/api/mi-dia/layout', { headers, data: {
      version: configured.layoutVersion, layout: [...configured.layout, ...additions],
    } });
    expect(layoutUpdate.status()).toBe(200);
    const before = (await getFinanceCards()).INCOME_COLLECTED;

    await page.goto('/login');
    const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
    const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
    const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await emailInput.fill('adrian.hernandez@pravia.test');
      await passwordInput.fill(password);
      await page.waitForTimeout(100);
      if (await emailInput.inputValue() === 'adrian.hernandez@pravia.test'
        && await passwordInput.inputValue() === password && await submit.isEnabled()) break;
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    await page.goto(`/expedientes/${caseId}#finanzas`);
    await expect(page.getByRole('tabpanel', { name: 'Finanzas' })).toBeVisible();
    const concept = `QA X12 ingreso aplicado ${Date.now()}`;
    await page.getByRole('button', { name: 'Reportar ingreso', exact: true }).click();
    const report = page.getByRole('dialog', { name: 'Reportar ingreso' });
    await report.getByLabel('Concepto o contexto').fill(concept);
    await report.getByLabel('Monto reportado (opcional)').fill('123.45');
    await report.getByLabel('¿A quién se va a facturar?').selectOption({ index: 1 });
    await report.getByLabel('Forma de pago').selectOption('TRANSFERENCIA');
    await report.getByLabel('Comprobante del ingreso').setInputFiles({
      name: 'qa-x12-receipt.png', mimeType: 'image/png', buffer: readFileSync('public/icons/favicon-32.png'),
    });
    const reported = page.waitForResponse((response) => response.url().includes(`/api/expedientes/${caseId}/finanzas-operativas/ingresos`)
      && response.request().method() === 'POST');
    await report.getByRole('button', { name: 'Registrar ingreso' }).click();
    expect((await reported).status()).toBe(201);
    const row = page.locator('article').filter({ hasText: concept });
    await expect(row).toContainText('Pendiente de aplicación');
    expect((await getFinanceCards()).INCOME_COLLECTED.amount).toBe(before.amount);
    await row.getByRole('button', { name: 'Aplicar', exact: true }).click();
    const apply = page.getByRole('dialog', { name: 'Aplicar ingreso' });
    await apply.getByLabel('Monto validado').fill('123.45');
    await apply.getByLabel('Honorarios').fill('123.45');
    await apply.getByLabel('Impuestos y derechos').fill('0');
    await apply.getByLabel('Cuenta').selectOption({ index: 1 });
    const appliedResponse = page.waitForResponse((response) => response.url().includes(`/api/expedientes/${caseId}/finanzas-operativas/ingresos/`)
      && response.url().endsWith('/aplicar') && response.request().method() === 'POST');
    await apply.getByRole('button', { name: 'Validar y aplicar' }).click();
    expect((await appliedResponse).status()).toBe(200);
    await expect(row).toContainText('Aplicado');

    const financeResponse = await api.get(`/api/expedientes/${caseId}/finanzas-operativas`, { headers });
    expect(financeResponse.status()).toBe(200);
    const finance = await financeResponse.json() as { ingresosReportados: Array<{
      id: string; concepto_contexto: string; estado: string; movimiento_id: string | null;
    }> };
    const source = finance.ingresosReportados.find((item) => item.concepto_contexto === concept);
    expect(source).toMatchObject({ estado: 'APLICADO' });
    expect(source?.movimiento_id).toBeTruthy();
    const afterCards = await getFinanceCards();
    const after = afterCards.INCOME_COLLECTED;
    expect(after.count).toBe(before.count + 1);
    expect(Math.round(Number(after.amount) * 100) - Math.round(Number(before.amount) * 100)).toBe(12345);
    expect(after.items.map((item) => item.id)).toContain(source!.movimiento_id);
    await page.goto('/mi-dia');
    const card = page.locator('section').filter({ has: page.getByRole('heading', {
      name: 'Ingreso cobrado', exact: true,
    }) }).first();
    await expect(card.getByRole('link').first()).toHaveAttribute('href',
      `/finanzas?view=movimientos&movimiento_id=${source!.movimiento_id}`);
    await page.reload();
    await expect(card.getByRole('link').first()).toHaveAttribute('href',
      `/finanzas?view=movimientos&movimiento_id=${source!.movimiento_id}`);

    // A prefactura is a reservation, not a stamped invoice or a second cash
    // movement. Its creation/removal must requery both fiscal cards.
    const fiscalConceptsResponse = await api.get('/api/finanzas/facturacion/conceptos', { headers });
    expect(fiscalConceptsResponse.status()).toBe(200);
    const fiscalConcepts = (await fiscalConceptsResponse.json() as { data: Array<{
      id: string; entidad_fiscal_id: string;
    }> }).data;
    expect(fiscalConcepts.length).toBeGreaterThan(0);
    const contextResponse = await api.get(`/api/finanzas/facturacion/ingresos/${source!.id}/contexto`, { headers });
    expect(contextResponse.status()).toBe(200);
    const context = (await contextResponse.json() as { data: { receivers: Array<{
      compareciente: { nombre_busqueda: string; personaFisica?: { rfc?: string | null } | null;
        personaMoral?: { rfc?: string | null } | null };
    }> } }).data;
    const canonicalReceiver = context.receivers[0]?.compareciente;
    const canonicalRfc = canonicalReceiver?.personaFisica?.rfc || canonicalReceiver?.personaMoral?.rfc;
    expect(canonicalRfc).toBeTruthy();
    await page.goto(`/finanzas?view=facturacion&income_id=${source!.id}`);
    const invoiceRow = page.locator(`#income-${source!.id}`);
    await expect(invoiceRow).toBeVisible();
    await invoiceRow.getByRole('button', { name: 'Completar factura' }).click();
    const generator = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await expect(generator).toBeVisible();
    await expect(generator.getByRole('heading', { name: 'Receptor' })).toBeVisible();
    const fiscalProfile = generator.getByText(/Perfil fiscal confirmado/);
    if (!(await fiscalProfile.count())) {
      await generator.getByLabel('RFC', { exact: true }).fill(canonicalRfc!);
      await generator.getByLabel('Nombre fiscal').fill(canonicalReceiver!.nombre_busqueda);
      await generator.getByLabel('Régimen', { exact: true }).fill('616');
      await generator.getByLabel('CP fiscal').fill('63735');
      await generator.getByRole('button', { name: 'Confirmar y guardar datos fiscales' }).click();
      await expect(generator.getByText(/Datos fiscales confirmados y guardados/)).toBeVisible();
    }
    await generator.getByLabel('Entidad fiscal').selectOption(fiscalConcepts[0].entidad_fiscal_id);
    await generator.getByLabel('Uso CFDI').fill('G03');
    await generator.getByLabel('Exportación SAT').fill('01');
    await generator.getByLabel('Concepto 1').selectOption(fiscalConcepts[0].id);
    await generator.getByLabel('Cantidad').fill('1');
    await generator.getByLabel('Valor unitario sin impuestos').fill('50.00');
    await expect(generator.getByRole('button', { name: 'Guardar prefactura' })).toBeEnabled();
    const draftSaved = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/borradores')
      && response.request().method() === 'POST');
    await generator.getByRole('button', { name: 'Guardar prefactura' }).click();
    expect((await draftSaved).status()).toBe(201);
    await expect(generator.getByText('Prefactura guardada. No se ha timbrado ni creado un nuevo movimiento.')).toBeVisible();
    const withDraft = await getFinanceCards();
    expect(withDraft.CFDI_TO_STAMP.count).toBe(afterCards.CFDI_TO_STAMP.count + 1);
    expect(withDraft.INVOICES_PENDING.count).toBe(afterCards.INVOICES_PENDING.count);
    expect(Math.round(Number(afterCards.INVOICES_PENDING.amount) * 100)
      - Math.round(Number(withDraft.INVOICES_PENDING.amount) * 100)).toBe(5000);
    expect(withDraft.INCOME_COLLECTED).toMatchObject({ count: after.count, amount: after.amount });
    await page.reload();
    await expect(page.locator(`#income-${source!.id}`)).toBeVisible();
    await page.locator(`#income-${source!.id}`).getByRole('button', { name: 'Completar factura' }).click();
    const reopened = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await expect(reopened.getByText('Prefactura guardada')).toBeVisible();
    const draftDeleted = page.waitForResponse((response) => response.url().includes('/api/finanzas/facturacion/borradores/')
      && response.request().method() === 'DELETE');
    await reopened.getByRole('button', { name: 'Eliminar prefactura' }).click();
    expect((await draftDeleted).status()).toBe(200);
    const restoredCards = await getFinanceCards();
    expect(restoredCards.CFDI_TO_STAMP.count).toBe(afterCards.CFDI_TO_STAMP.count);
    expect(restoredCards.INVOICES_PENDING).toMatchObject({
      count: afterCards.INVOICES_PENDING.count, amount: afterCards.INVOICES_PENDING.amount,
    });
    expect(restoredCards.INCOME_COLLECTED).toMatchObject({ count: after.count, amount: after.amount });
  } finally {
    const current = await getConfig();
    const restoreLayout = original.personalized ? api.put('/api/mi-dia/layout', { headers,
      data: { version: current.layoutVersion, layout: original.layout } })
      : api.delete('/api/mi-dia/layout', { headers });
    expect((await restoreLayout).status()).toBe(200);
    const afterLayout = await getConfig();
    const restoreTenant = await api.put('/api/mi-dia/tenant-config', { headers, data: {
      version: afterLayout.tenantAdministration.version,
      enabled_cards: tenant.enabledCards,
      default_layout: tenant.defaultLayout,
      fixed_cards: tenant.defaultLayout.filter((item: any) => item.fixed).map((item: any) => item.key),
      recommended_cards: tenant.recommendedCards,
    } });
    expect(restoreTenant.status()).toBe(200);
    await api.dispose();
  }
});
