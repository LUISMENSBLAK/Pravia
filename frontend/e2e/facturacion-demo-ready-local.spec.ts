import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { expect, test, type Locator, type Page } from '@playwright/test';

const qaEmail = process.env.PRAVIA_E2E_EMAIL;
const qaPassword = process.env.PRAVIA_E2E_PASSWORD;
const qaIncomeId = process.env.PRAVIA_E2E_INCOME_ID;
const qaEntityId = process.env.PRAVIA_E2E_ENTITY_ID;
const qaConceptId = process.env.PRAVIA_E2E_CONCEPT_ID;

async function enterLocalBilling(page: Page) {
  const host = new URL(String(test.info().project.use.baseURL)).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('LOCAL_BILLING_QA_SAFETY_GATE_FAILED');
  if (!qaEmail || !qaPassword) throw new Error('LOCAL_BILLING_QA_CREDENTIALS_REQUIRED');
  let observedAuthorization = '';
  page.on('request', request => {
    if (request.url().includes('/api/finanzas/facturacion/entidades')) observedAuthorization = request.headers().authorization || observedAuthorization;
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const password = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  await email.fill(qaEmail);
  await password.fill(qaPassword);
  if (await email.inputValue() !== qaEmail) await email.fill(qaEmail);
  if (await password.inputValue() !== qaPassword) await password.fill(qaPassword);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  const login = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const loginResponse = await login;
  expect(loginResponse.status()).toBe(200);
  const loginPayload = await loginResponse.json() as { access_token?: string; data?: { access_token?: string } };
  const token = loginPayload.access_token || loginPayload.data?.access_token;
  if (!token) throw new Error('QA_ACCESS_TOKEN_MISSING');
  await page.goto('/finanzas?view=facturacion');
  await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
  await expect(page.getByRole('heading', { name: 'CFDI, cuentas y proveedores' })).toBeVisible();
  return { authorization: observedAuthorization || `Bearer ${token}` };
}

async function selectConfiguredFiscalConcept(editor: Locator) {
  if (!qaEntityId || !qaConceptId) throw new Error('LOCAL_BILLING_QA_ENTITY_AND_CONCEPT_IDS_REQUIRED');
  await editor.getByLabel('Entidad fiscal').selectOption(qaEntityId);
  const emitterRegime = editor.getByLabel('Régimen emisor para esta factura');
  if (await emitterRegime.count() && !await emitterRegime.inputValue()) {
    const confirmed = await emitterRegime.locator('option:not([value=""])').first().getAttribute('value');
    if (!confirmed) throw new Error('QA_EMITTER_HAS_NO_CONFIRMED_REGIME');
    await emitterRegime.selectOption(confirmed);
  }
  await editor.getByLabel('Concepto fiscal configurado').selectOption(qaConceptId);
}

test.describe.serial('Facturación Demo-Ready en Chrome local aislado', () => {
  test('logotipo fiscal privado: carga, persistencia tras reload y retiro autorizado', async ({ page }) => {
    await enterLocalBilling(page);
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    const openEntity = page.getByRole('button', { name: 'Abrir ficha' }).first();
    await expect(openEntity).toBeVisible();
    await openEntity.click();
    let detail = page.getByRole('dialog', { name: 'Ficha de entidad fiscal' });
    const logo = await readFile('public/icons/pravia-192.png');
    const upload = page.waitForResponse(response => /\/api\/finanzas\/facturacion\/entidades\/[^/]+\/logo$/.test(response.url()) && response.request().method() === 'POST');
    await detail.getByLabel('Subir logotipo PNG/JPG (máx. 2 MiB)').setInputFiles({ name: 'logo-qa.png', mimeType: 'image/png', buffer: logo });
    const uploaded = await upload;
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const uploadedData = (await uploaded.json()).data;
    expect(uploadedData.sha256).toBe(createHash('sha256').update(logo).digest('hex'));
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await page.getByRole('button', { name: 'Abrir ficha' }).first().click();
    detail = page.getByRole('dialog', { name: 'Ficha de entidad fiscal' });
    await expect(detail.getByRole('button', { name: 'Ver logotipo' })).toBeVisible();
    const removed = page.waitForResponse(response => /\/api\/finanzas\/facturacion\/entidades\/[^/]+\/logo$/.test(response.url()) && response.request().method() === 'DELETE');
    await detail.getByRole('button', { name: 'Quitar logotipo' }).click();
    expect((await removed).status()).toBe(200);
    await page.getByRole('button', { name: 'Abrir ficha' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Ficha de entidad fiscal' }).getByText('Sin logotipo de entidad; se usará el de la Notaría si está configurado.')).toBeVisible();
  });

  test('machote Word original se selecciona como versión privada CFG-002 del emisor', async ({ page }) => {
    const { authorization } = await enterLocalBilling(page);
    const headers = { Authorization: authorization };
    const session = await page.request.get('/api/auth/me', { headers });
    expect(session.status()).toBe(200);
    const me = (await session.json()).user;
    expect(me.permissions).toContain('configuracion.plantillas_formatos.manage');
    expect(me.permissions).toContain('finanzas.validate');
    const entityResponse = await page.request.get('/api/finanzas/facturacion/entidades', { headers });
    const entityRows = (await entityResponse.json()).data as Array<{ id: string; rfc: string }>;
    const entityIndex = qaEntityId ? entityRows.findIndex(item => item.id === qaEntityId) : 0;
    expect(entityIndex).toBeGreaterThanOrEqual(0);
    const entityId = entityRows[entityIndex].id;
    const selectedEntityCard = () => page.locator('article').filter({ hasText: entityRows[entityIndex].rfc });
    const source = await readFile('../backend/assets/fiscal/Factura_PRAVIA.docx');
    const sourceSha = createHash('sha256').update(source).digest('hex');
    const listed = await page.request.get('/api/finanzas/facturacion/plantillas', { headers });
    expect(listed.status()).toBe(200);
    let versionId = (await listed.json()).data.find((item: { checksum_sha256: string }) => item.checksum_sha256 === sourceSha)?.id as string | undefined;
    if (!versionId) {
      const created = await page.request.post('/api/settings/catalogs/artifacts', { headers, multipart: {
        metadata: JSON.stringify({ tipo: 'PLANTILLA', propietario_tipo: 'ORGANIZACION', organization_id: me.organization.id,
          nombre: 'Factura cliente QA · versión privada', version: 1 }),
        file: { name: 'Factura_PRAVIA.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: source },
      } });
      expect(created.status(), await created.text()).toBe(201);
      const newList = await page.request.get('/api/finanzas/facturacion/plantillas', { headers });
      versionId = (await newList.json()).data.find((item: { checksum_sha256: string }) => item.checksum_sha256 === sourceSha)?.id;
    }
    expect(versionId).toBeTruthy();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await selectedEntityCard().getByRole('button', { name: 'Abrir ficha' }).click();
    let detail = page.getByRole('dialog', { name: 'Ficha de entidad fiscal' });
    await expect(detail.locator(`option[value="${versionId}"]`)).toHaveCount(1);
    if (await detail.getByLabel('Versión Word de prefactura').inputValue() === versionId) {
      await detail.getByLabel('Versión Word de prefactura').selectOption('');
      const unset = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/entidades/${entityId}`) && response.request().method() === 'PATCH');
      await detail.getByRole('button', { name: 'Guardar machote' }).click();
      expect((await unset).status()).toBe(200);
      await expect(detail).toHaveCount(0);
      await expect(page.getByText('Cargando información fiscal…')).toHaveCount(0);
      await selectedEntityCard().getByRole('button', { name: 'Abrir ficha' }).click();
      detail = page.getByRole('dialog', { name: 'Ficha de entidad fiscal' });
      await expect(detail.locator(`option[value="${versionId}"]`)).toHaveCount(1);
      await expect(detail.getByLabel('Versión Word de prefactura')).toHaveValue('');
    }
    await detail.getByLabel('Versión Word de prefactura').selectOption(versionId!);
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/entidades/${entityId}`) && response.request().method() === 'PATCH');
    await detail.getByRole('button', { name: 'Guardar machote' }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.getByRole('button', { name: 'Entidades fiscales' }).click();
    await selectedEntityCard().getByRole('button', { name: 'Abrir ficha' }).click();
    await expect(page.getByRole('dialog', { name: 'Ficha de entidad fiscal' }).getByLabel('Versión Word de prefactura')).toHaveValue(versionId!);
  });

  test('catálogos SAT: selectores reales, borrador persistido y rechazo de claves no publicadas', async ({ page }) => {
    const { authorization } = await enterLocalBilling(page);
    const headers = { Authorization: authorization };
    const catalogResponse = await page.request.get('/api/finanzas/facturacion/catalogos-comprobante', { headers });
    expect(catalogResponse.status()).toBe(200);
    const catalog = (await catalogResponse.json()).data as { source: { sha256: string }; formasPago: Array<{ clave: string }>;
      exportaciones: Array<{ clave: string }>; monedasHabilitadas: Array<{ clave: string }> };
    expect(catalog.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.formasPago).toHaveLength(22);
    expect(catalog.exportaciones).toHaveLength(4);
    expect(catalog.monedasHabilitadas.map(item => item.clave)).toEqual(['MXN', 'USD', 'CAD']);
    const invalidBase = { direccion: 'EMITIDO', tipo: 'I', allow_incomplete: true,
      subtotal: '0.00', total: '0.00' };
    const invalidExport = await page.request.post('/api/finanzas/facturacion/borradores', { headers,
      data: { ...invalidBase, idempotency_key: crypto.randomUUID(), exportacion: '99' } });
    expect(invalidExport.status()).toBe(400);
    expect((await invalidExport.json()).code).toBe('CFDI_EXPORT_INVALID');
    const invalidForm = await page.request.post('/api/finanzas/facturacion/borradores', { headers,
      data: { ...invalidBase, idempotency_key: crypto.randomUUID(), forma_pago: '07' } });
    expect(invalidForm.status()).toBe(422);
    expect((await invalidForm.json()).code).toBe('CFDI_PAYMENT_FORM_INVALID');
    const invalidTerms = await page.request.post('/api/finanzas/facturacion/borradores', { headers,
      data: { ...invalidBase, idempotency_key: crypto.randomUUID(), condiciones_pago: '15 DÍAS' } });
    expect(invalidTerms.status()).toBe(400);
    expect((await invalidTerms.json()).code).toBe('CFDI_PAYMENT_TERMS_INVALID');
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const editor = page.getByRole('dialog', { name: 'Nueva factura' });
    await expect(editor.getByLabel('Exportación SAT').locator('option[value="04"]')).toHaveText(/Definitiva con clave distinta a A1/);
    await expect(editor.getByLabel('Forma de pago').locator('option[value="03"]')).toHaveText(/Transferencia electrónica/);
    await expect(editor.getByLabel('Forma de pago').locator('option[value="07"]')).toHaveCount(0);
    await editor.getByLabel('Exportación SAT').selectOption('01');
    await editor.getByLabel('Forma de pago').selectOption('03');
    await editor.getByLabel('Condiciones de pago (opcional)').selectOption('CREDITO');
    const save = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: 'Guardar borrador' }).click();
    const saved = await save;
    expect(saved.status(), await saved.text()).toBe(201);
    const draft = (await saved.json()).data.cfdi;
    expect(draft.forma_pago).toBe('03');
    expect(draft.draft_payload.fiscal_comprobante.exportacion).toBe('01');
    expect(draft.draft_payload.fiscal_comprobante.condiciones_pago).toBe('CREDITO');
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.locator(`#cfdi-${draft.id}`).getByRole('button', { name: 'Abrir borrador' }).click();
    const reopened = page.getByRole('dialog', { name: /Borrador/ });
    await expect(reopened.getByLabel('Exportación SAT')).toHaveValue('01');
    await expect(reopened.getByLabel('Forma de pago')).toHaveValue('03');
    await expect(reopened.getByLabel('Condiciones de pago (opcional)')).toHaveValue('CREDITO');
  });

  test('un ingreso permite guardar y reabrir borrador incompleto sin PDF ni reserva', async ({ page }) => {
    test.skip(!qaIncomeId, 'Se requiere un ingreso sintético local explícito.');
    await enterLocalBilling(page);
    await page.getByRole('tab', { name: 'Ingresos de expedientes' }).click();
    await page.goto(`/finanzas?view=facturacion&income_id=${encodeURIComponent(qaIncomeId!)}`);
    const row = page.locator(`#income-${qaIncomeId}`);
    await expect(row).toBeVisible();
    const contextRequest = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/ingresos/${qaIncomeId}/contexto`));
    await row.getByRole('button', { name: 'Completar factura' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    const sourceResponse = await contextRequest;
    expect(sourceResponse.status()).toBe(200);
    const source = (await sourceResponse.json()).data;
    expect(source.income.id).toBe(qaIncomeId);
    await expect(dialog.getByText(source.income.expediente.numero_pravia, { exact: true })).toBeVisible();
    await expect(dialog.getByText(source.income.expediente.cliente_alias, { exact: true })).toBeVisible();
    // A previous interrupted QA run may leave an incomplete local draft.
    // Start from the same synthetic income, never a production record.
    await expect(dialog.getByText(/Ingreso facturable/)).toBeVisible();
    if (await dialog.getByLabel('Continuar prefactura').count()) {
      await dialog.getByRole('button', { name: 'Eliminar borrador' }).click();
      await expect(dialog.getByText(/Prefactura eliminada; saldo liberado/)).toBeVisible();
    }
    await expect(dialog.getByLabel('Continuar prefactura')).toHaveCount(0);
    await dialog.getByRole('combobox', { name: 'Método', exact: true }).selectOption('PPD');
    await expect(dialog.getByRole('combobox', { name: 'Forma de pago SAT' })).toHaveValue('99');
    await expect(dialog.getByRole('combobox', { name: 'Forma de pago SAT' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Guardar borrador incompleto' })).toBeEnabled();
    const created = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Guardar borrador incompleto' }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const saved = (await response.json()).data.cfdi;
    expect(Number(saved.total)).toBe(0);
    expect(saved.draft_payload.incomplete_income).toBe(true);
    expect(saved.ingreso_reportado_id).toBe(qaIncomeId);
    expect(saved.expediente_id).toBe(source.income.expediente_id);
    expect(saved.metodo_pago).toBe('PPD');
    expect(saved.forma_pago).toBe('99');
    await expect(dialog.getByText(/Borrador incompleto: todavía no reserva saldo ni puede generar PDF/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Generar prefactura PDF' })).toBeDisabled();
    await page.reload();
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const reopened = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await reopened.getByLabel('Continuar prefactura').selectOption(saved.id);
    await expect(reopened.getByRole('combobox', { name: 'Método', exact: true })).toHaveValue('PPD');
    await reopened.getByRole('combobox', { name: 'Método', exact: true }).selectOption('PUE');
    await expect(reopened.getByRole('combobox', { name: 'Forma de pago SAT' })).toBeEnabled();
    await expect(reopened.getByRole('combobox', { name: 'Forma de pago SAT' }).locator('option[value="99"]')).toHaveCount(0);
    const updated = page.waitForResponse(item => item.url().endsWith(`/api/finanzas/facturacion/borradores/${saved.id}`) && item.request().method() === 'PATCH');
    await reopened.getByRole('button', { name: 'Guardar borrador incompleto' }).click();
    const updateResponse = await updated;
    expect(updateResponse.status(), await updateResponse.text()).toBe(200);
    expect((await updateResponse.json()).data.metodo_pago).toBe('PUE');
    await page.reload();
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const finalDraft = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await finalDraft.getByLabel('Continuar prefactura').selectOption(saved.id);
    await expect(finalDraft.getByRole('combobox', { name: 'Método', exact: true })).toHaveValue('PUE');
    await expect(finalDraft.getByText(/Borrador incompleto: todavía no reserva saldo ni puede generar PDF/)).toBeVisible();
    await finalDraft.getByRole('button', { name: 'Eliminar borrador' }).click();
    await expect(finalDraft.getByText(/Prefactura eliminada; saldo liberado/)).toBeVisible();
  });

  test('un ingreso aplicado genera prefactura multipágina con veinte conceptos y conserva su origen', async ({ page }) => {
    test.skip(!qaIncomeId || !qaEntityId || !qaConceptId, 'Requiere ingreso, emisor y concepto sintéticos locales explícitos.');
    await enterLocalBilling(page);
    await page.goto(`/finanzas?view=facturacion&income_id=${encodeURIComponent(qaIncomeId!)}`);
    const row = page.locator(`#income-${qaIncomeId}`);
    await expect(row).toBeVisible();
    const contextRequest = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/ingresos/${qaIncomeId}/contexto`));
    await row.getByRole('button', { name: 'Completar factura' }).click();
    const sourceResponse = await contextRequest;
    expect(sourceResponse.status()).toBe(200);
    const source = (await sourceResponse.json()).data;
    expect(source.income.estado).toBe('APLICADO');
    expect(Number(source.remainingInvoiceableAmount)).toBeGreaterThanOrEqual(40);
    const dialog = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    if (!source.receivers[0]?.compareciente.fiscalProfile) {
      await dialog.getByRole('textbox', { name: 'RFC', exact: true }).fill('QAQA010101ABC');
      await dialog.getByRole('textbox', { name: 'Nombre fiscal' }).fill('RECEPTOR SINTÉTICO SIN VALIDEZ FISCAL');
      await dialog.getByRole('combobox', { name: 'Régimen', exact: true }).selectOption('612');
      await dialog.getByRole('textbox', { name: 'CP fiscal' }).fill('63735');
      const confirmed = page.waitForResponse(response => response.url().includes(`/api/finanzas/facturacion/ingresos/${qaIncomeId}/receptores/`) && response.request().method() === 'PUT');
      await dialog.getByRole('button', { name: 'Confirmar y guardar datos fiscales' }).click();
      expect((await confirmed).status()).toBe(200);
    }
    await expect(dialog.getByText(/Perfil fiscal confirmado/)).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Entidad fiscal' }).selectOption(qaEntityId!);
    await dialog.getByRole('combobox', { name: 'Régimen para esta factura' }).selectOption('612');
    await dialog.getByRole('combobox', { name: 'Uso CFDI' }).selectOption('G03');
    await dialog.getByRole('combobox', { name: 'Exportación SAT' }).selectOption('01');
    await dialog.getByRole('combobox', { name: 'Método', exact: true }).selectOption('PUE');
    await expect(dialog.getByRole('combobox', { name: 'Forma de pago SAT' })).toHaveValue('03');
    for (let index = 0; index < 20; index += 1) {
      if (index) await dialog.getByRole('button', { name: 'Agregar concepto' }).click();
      await dialog.getByRole('combobox', { name: `Concepto ${index + 1}` }).selectOption(qaConceptId!);
      await dialog.getByRole('textbox', { name: 'Descripción para esta factura' }).nth(index).fill(
        `Línea sintética ${String(index + 1).padStart(2, '0')} para comprobar que la prefactura conserva íntegra la descripción de cada servicio notarial de QA.`,
      );
      await dialog.getByRole('textbox', { name: 'Valor unitario sin impuestos' }).nth(index).fill('2.00');
    }
    await expect(dialog.getByRole('button', { name: 'Guardar borrador', exact: true })).toBeEnabled();
    const created = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const draft = (await createResponse.json()).data.cfdi;
    expect(draft.ingreso_reportado_id).toBe(qaIncomeId);
    expect(draft.expediente_id).toBe(source.income.expediente_id);
    expect(Number(draft.total)).toBe(40);
    expect(draft.draft_payload.concepts).toHaveLength(20);
    await expect(dialog.getByRole('button', { name: 'Generar prefactura PDF' })).toBeEnabled();
    const generated = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/borradores/${draft.id}/prefacturas`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Generar prefactura PDF' }).click();
    const generatedResponse = await generated;
    expect(generatedResponse.status(), await generatedResponse.text()).toBe(201);
    await dialog.getByRole('button', { name: 'Ver PDF versión 1' }).click();
    const viewer = page.getByRole('dialog', { name: /\.pdf/ });
    await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const authorization = generatedResponse.request().headers().authorization;
    if (!authorization?.startsWith('Bearer ')) throw new Error('QA_ACCESS_TOKEN_MISSING');
    const signed = await page.request.get(`/api/finanzas/facturacion/borradores/${draft.id}/prefacturas/1`, { headers: { Authorization: authorization } });
    expect(signed.status()).toBe(200);
    const file = (await signed.json()).data;
    const bytes = await (await page.request.get(file.url)).body();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    await page.reload();
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const reopened = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await reopened.getByRole('combobox', { name: 'Continuar prefactura' }).selectOption(draft.id);
    await expect(reopened.getByRole('textbox', { name: 'Descripción para esta factura' }).last()).toHaveValue(/Línea sintética 20/);
    await expect(reopened.getByRole('button', { name: 'Ver PDF versión 1' })).toBeVisible();
  });

  test('regenera el PDF multipágina sin perder emisor ni aislar los totales en una página vacía', async ({ page }) => {
    const draftId = process.env.PRAVIA_E2E_INCOME_DRAFT_ID;
    test.skip(!qaIncomeId || !draftId, 'Requiere borrador multipágina sintético ya creado en PostgreSQL local.');
    await enterLocalBilling(page);
    await page.goto(`/finanzas?view=facturacion&income_id=${encodeURIComponent(qaIncomeId!)}`);
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await dialog.getByRole('combobox', { name: 'Continuar prefactura' }).selectOption(draftId!);
    await expect(dialog.getByRole('textbox', { name: 'Descripción para esta factura' }).last()).toHaveValue(/Línea sintética 20/);
    const generated = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/borradores/${draftId}/prefacturas`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Regenerar PDF (nueva versión)' }).click();
    const response = await generated;
    expect(response.status(), await response.text()).toBe(201);
    const version = (await response.json()).data.representation.version as number;
    expect(version).toBeGreaterThan(1);
    await dialog.getByRole('button', { name: `Ver PDF versión ${version}` }).click();
    const viewer = page.getByRole('dialog', { name: /\.pdf/ });
    await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const authorization = response.request().headers().authorization;
    if (!authorization?.startsWith('Bearer ')) throw new Error('QA_ACCESS_TOKEN_MISSING');
    const signed = await page.request.get(`/api/finanzas/facturacion/borradores/${draftId}/prefacturas/${version}`, { headers: { Authorization: authorization } });
    expect(signed.status()).toBe(200);
    const file = (await signed.json()).data;
    const bytes = await (await page.request.get(file.url)).body();
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pageContent = await (await document.getPage(pageNumber)).getTextContent();
      pages.push(pageContent.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    expect(pages.join(' ')).toContain('PERSONA FISICA SINTETICA');
    expect(pages.join(' ')).toContain('Línea sintética 20');
    expect(pages.at(-1)).toContain('Línea sintética');
    expect(pages.at(-1)).toContain('40.00');
    await page.reload();
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const reopened = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await reopened.getByRole('combobox', { name: 'Continuar prefactura' }).selectOption(draftId!);
    await expect(reopened.getByRole('button', { name: `Ver PDF versión ${version}` })).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Ver PDF versión 1' })).toBeVisible();
  });

  test('corrige en Chrome un perfil fiscal confirmado y conserva su versión tras reload', async ({ page }) => {
    test.skip(!qaIncomeId, 'Requiere ingreso sintético local explícito.');
    await enterLocalBilling(page);
    await page.goto(`/finanzas?view=facturacion&income_id=${encodeURIComponent(qaIncomeId!)}`);
    const contextRequest = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/ingresos/${qaIncomeId}/contexto`));
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const contextResponse = await contextRequest;
    expect(contextResponse.status()).toBe(200);
    const source = (await contextResponse.json()).data;
    const previous = source.receivers[0]?.compareciente.fiscalProfile;
    expect(previous?.version).toBeGreaterThan(0);
    const nextName = previous.razon_social === 'RECEPTOR SINTÉTICO QA CORREGIDO'
      ? 'RECEPTOR SINTÉTICO SIN VALIDEZ FISCAL'
      : 'RECEPTOR SINTÉTICO QA CORREGIDO';
    const dialog = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await dialog.getByRole('button', { name: 'Editar datos fiscales' }).click();
    await dialog.getByRole('textbox', { name: 'Nombre fiscal' }).fill(nextName);
    const corrected = page.waitForResponse(response => response.url().includes(`/api/finanzas/facturacion/ingresos/${qaIncomeId}/receptores/`) && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Guardar corrección fiscal' }).click();
    const correctionResponse = await corrected;
    expect(correctionResponse.status(), await correctionResponse.text()).toBe(200);
    const profile = (await correctionResponse.json()).data;
    expect(profile.razon_social).toBe(nextName);
    expect(profile.version).toBe(previous.version + 1);
    await expect(dialog.getByText(`Perfil fiscal confirmado · versión ${profile.version}`)).toBeVisible();
    await page.reload();
    await page.locator(`#income-${qaIncomeId}`).getByRole('button', { name: 'Completar factura' }).click();
    const reopened = page.getByRole('dialog', { name: 'Generar factura CFDI' });
    await expect(reopened.getByText(nextName, { exact: true })).toBeVisible();
    await expect(reopened.getByText(`Perfil fiscal confirmado · versión ${profile.version}`)).toBeVisible();
  });

  test('borrador central incompleto persiste y se reabre tras reload', async ({ page }) => {
    await enterLocalBilling(page);
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const editor = page.getByRole('dialog', { name: 'Nueva factura' });
    await expect(editor.getByLabel('RFC receptor')).toBeVisible();
    const save = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: 'Guardar borrador' }).click();
    const response = await save;
    expect(response.status(), await response.text()).toBe(201);
    const id = (await response.json()).data.cfdi.id as string;
    await expect(page.locator(`#cfdi-${id}`)).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    const card = page.locator(`#cfdi-${id}`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Abrir borrador' }).click();
    await expect(page.getByRole('dialog', { name: /Borrador/ }).getByLabel('RFC receptor')).toHaveValue('');
  });

  test('USD incompleto se guarda sin inventar FX y exige tasa antes del PDF', async ({ page }) => {
    await enterLocalBilling(page);
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const editor = page.getByRole('dialog', { name: 'Nueva factura' });
    await editor.getByLabel('Moneda').selectOption('USD');
    await expect(editor.getByLabel('Tipo de cambio a MXN')).toHaveValue('');
    const save = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: 'Guardar borrador' }).click();
    const saved = await save;
    expect(saved.status(), await saved.text()).toBe(201);
    const id = (await saved.json()).data.cfdi.id as string;
    const card = page.locator(`#cfdi-${id}`);
    await expect(card).toBeVisible();
    await expect(card.getByText('USD 0.00').first()).toBeVisible();
    const generate = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/borradores/${id}/prefacturas`) && response.request().method() === 'POST');
    await card.getByRole('button', { name: 'Generar nueva versión PDF' }).click();
    expect((await generate).status()).toBe(409);
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.locator(`#cfdi-${id}`).getByRole('button', { name: 'Abrir borrador' }).click();
    const reopened = page.getByRole('dialog', { name: /Borrador/ });
    await expect(reopened.getByLabel('Moneda')).toHaveValue('USD');
    await expect(reopened.getByLabel('Tipo de cambio a MXN')).toHaveValue('');
    await reopened.getByLabel('Tipo de cambio a MXN').fill('17.123456');
    const update = page.waitForResponse(response => response.url().endsWith(`/api/finanzas/facturacion/borradores/${id}`) && response.request().method() === 'PATCH');
    await reopened.getByRole('button', { name: 'Guardar borrador' }).click();
    expect((await update).status()).toBe(200);
    await page.locator(`#cfdi-${id}`).getByRole('button', { name: 'Abrir borrador' }).click();
    await expect(page.getByRole('dialog', { name: /Borrador/ }).getByLabel('Tipo de cambio a MXN')).toHaveValue('17.123456');
  });

  test('USD y CAD conservan FX y generan PDF real visible con SHA íntegro', async ({ page }) => {
    await enterLocalBilling(page);
    for (const [currency, fx, mxn] of [['USD', '17.000000', 'MXN 1,700.00'], ['CAD', '12.500000', 'MXN 1,250.00']] as const) {
      await page.getByRole('button', { name: 'Nueva factura' }).click();
      const editor = page.getByRole('dialog', { name: 'Nueva factura' });
      await selectConfiguredFiscalConcept(editor);
      await editor.getByLabel('RFC receptor').fill('FIC010101ABC');
      await editor.getByLabel('Nombre o razón social').fill('RECEPTOR SINTÉTICO SIN VALIDEZ');
      await editor.getByLabel('Régimen receptor').selectOption('601');
      await editor.getByLabel('Código postal fiscal').fill('63735');
      await editor.getByLabel('Uso CFDI').selectOption('G03');
      await editor.getByLabel('Lugar de expedición').fill('63735');
      await editor.getByLabel('Método de pago').selectOption('PUE');
      await editor.getByLabel('Forma de pago').selectOption('03');
      await editor.getByLabel('Valor unitario').fill('100.00');
      await editor.getByLabel('Moneda').selectOption(currency);
      await editor.getByLabel('Tipo de cambio a MXN').fill(fx);
      await expect(editor.getByRole('status').filter({ hasText: 'equivalentes' })).toContainText(mxn);
      const save = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
      await editor.getByRole('button', { name: 'Guardar borrador' }).click();
      const response = await save;
      expect(response.status(), await response.text()).toBe(201);
      const id = (await response.json()).data.cfdi.id as string;
      await page.reload();
      await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
      const card = page.locator(`#cfdi-${id}`);
      await expect(card.getByText(`${currency} 100.00`).first()).toBeVisible();
      await card.getByRole('button', { name: 'Abrir borrador' }).click();
      const reopened = page.getByRole('dialog', { name: /Borrador/ });
      await expect(reopened.getByLabel('Moneda')).toHaveValue(currency);
      await expect(reopened.getByLabel('Tipo de cambio a MXN')).toHaveValue(fx);
      await reopened.getByRole('button', { name: 'Cerrar', exact: true }).click();
      const generated = page.waitForResponse(item => item.url().endsWith(`/api/finanzas/facturacion/borradores/${id}/prefacturas`) && item.request().method() === 'POST');
      await card.getByRole('button', { name: 'Generar nueva versión PDF' }).click();
      const generatedResponse = await generated;
      expect(generatedResponse.status(), await generatedResponse.text()).toBe(201);
      await expect(card.getByText(/v1 ·/)).toBeVisible();
      await card.getByRole('button', { name: 'Ver', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /\.pdf/ });
      await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
      await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
      const authorization = generatedResponse.request().headers().authorization;
      if (!authorization?.startsWith('Bearer ')) throw new Error('QA_ACCESS_TOKEN_MISSING');
      const signed = await page.request.get(`/api/finanzas/facturacion/borradores/${id}/prefacturas/1`, { headers: { Authorization: authorization } });
      expect(signed.status()).toBe(200);
      const file = (await signed.json()).data;
      const bytes = await (await page.request.get(file.url)).body();
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  });

  test('borrador central con concepto genera PDF real, abre, descarga y conserva v1 al regenerar v2', async ({ page }) => {
    await enterLocalBilling(page);
    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const editor = page.getByRole('dialog', { name: 'Nueva factura' });
    await selectConfiguredFiscalConcept(editor);
    await expect(editor.getByLabel('Descripción para esta factura')).not.toHaveValue('');
    const lineDescription = 'Servicio notarial particular QA para expediente sintético';
    await editor.getByLabel('Descripción para esta factura').fill(lineDescription);
    await editor.getByLabel('RFC receptor').fill('FIC010101ABC');
    await editor.getByLabel('Nombre o razón social').fill('RECEPTOR SINTÉTICO SIN VALIDEZ');
    await editor.getByLabel('Régimen receptor').selectOption('601');
    await editor.getByLabel('Código postal fiscal').fill('63735');
    await editor.getByLabel('Uso CFDI').selectOption('G03');
    await editor.getByLabel('Lugar de expedición').fill('63735');
    await editor.getByLabel('Método de pago').selectOption('PUE');
    await editor.getByLabel('Forma de pago').selectOption('03');
    await editor.getByLabel('Valor unitario').fill('100.00');
    const save = page.waitForResponse(response => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: 'Guardar borrador' }).click();
    const response = await save;
    expect(response.status(), await response.text()).toBe(201);
    const saved = (await response.json()).data.cfdi;
    const id = saved.id as string;
    expect(saved.draft_payload.concepts[0].descripcion).toBe(lineDescription);
    const card = page.locator(`#cfdi-${id}`);
    await expect(card).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await card.getByRole('button', { name: 'Abrir borrador' }).click();
    await expect(page.getByRole('dialog', { name: /Borrador/ }).getByLabel('Descripción para esta factura')).toHaveValue(lineDescription);
    await page.getByRole('dialog', { name: /Borrador/ }).getByRole('button', { name: 'Cerrar', exact: true }).click();
    const generate = card.getByRole('button', { name: 'Generar nueva versión PDF' });
    const generatedV1 = page.waitForResponse(item => item.url().endsWith(`/api/finanzas/facturacion/borradores/${id}/prefacturas`) && item.request().method() === 'POST');
    await generate.click();
    const firstGeneration = await generatedV1;
    expect(firstGeneration.status(), await firstGeneration.text()).toBe(201);
    if (!firstGeneration.request().headers().authorization?.startsWith('Bearer ')) throw new Error('QA_ACCESS_TOKEN_MISSING');
    await expect(card.getByRole('button', { name: 'Timbrar CFDI' })).toBeDisabled();
    await expect(card.getByText('Timbrado no disponible: PAC no configurado.')).toBeVisible();
    await expect(card.getByText(/v1 ·/)).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    const reloaded = page.locator(`#cfdi-${id}`);
    await reloaded.getByRole('button', { name: 'Versiones PDF' }).click();
    await expect(reloaded.getByText(/v1 ·/)).toBeVisible();
    await reloaded.getByRole('button', { name: 'Ver', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: /\.pdf/ });
    await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
    await viewer.getByRole('button', { name: 'Cerrar vista previa' }).click();
    const downloadEvent = page.waitForEvent('download');
    await reloaded.getByRole('listitem').filter({ hasText: /v1 ·/ }).getByRole('button', { name: 'Descargar', exact: true }).click();
    const downloaded = await downloadEvent;
    const downloadedPath = await downloaded.path();
    if (!downloadedPath) throw new Error('QA_PDF_DOWNLOAD_MISSING');
    const downloadedBytes = await readFile(downloadedPath);
    expect(downloadedBytes.subarray(0, 5).toString()).toBe('%PDF-');
    const generatedV2 = page.waitForResponse(item => item.url().endsWith(`/api/finanzas/facturacion/borradores/${id}/prefacturas`) && item.request().method() === 'POST');
    await reloaded.getByRole('button', { name: 'Generar nueva versión PDF' }).click();
    const secondGeneration = await generatedV2;
    expect(secondGeneration.status()).toBe(201);
    const authorization = secondGeneration.request().headers().authorization;
    if (!authorization?.startsWith('Bearer ')) throw new Error('QA_ACCESS_TOKEN_MISSING');
    await expect(reloaded.getByText(/v1 ·/)).toBeVisible();
    await expect(reloaded.getByText(/v2 ·/)).toBeVisible();
    const hashes: string[] = [];
    for (const version of [1, 2]) {
      const signed = await page.request.get(`/api/finanzas/facturacion/borradores/${id}/prefacturas/${version}`, { headers: { Authorization: authorization } });
      expect(signed.status()).toBe(200);
      const file = (await signed.json()).data;
      const bytes = await (await page.request.get(file.url)).body();
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(sha).toBe(file.sha256);
      hashes.push(sha);
    }
    expect(createHash('sha256').update(downloadedBytes).digest('hex')).toBe(hashes[0]);
    expect(hashes[0]).not.toBe(hashes[1]);

    await page.getByRole('button', { name: 'Nueva factura' }).click();
    const secondEditor = page.getByRole('dialog', { name: 'Nueva factura' });
    await selectConfiguredFiscalConcept(secondEditor);
    const otherDescription = 'Otra descripción particular QA con el mismo concepto maestro';
    await secondEditor.getByLabel('Descripción para esta factura').fill(otherDescription);
    await secondEditor.getByLabel('Valor unitario').fill('80.00');
    const saveOther = page.waitForResponse(item => item.url().endsWith('/api/finanzas/facturacion/borradores') && item.request().method() === 'POST');
    await secondEditor.getByRole('button', { name: 'Guardar borrador' }).click();
    const otherResponse = await saveOther;
    expect(otherResponse.status(), await otherResponse.text()).toBe(201);
    const other = (await otherResponse.json()).data.cfdi;
    expect(other.id).not.toBe(id);
    expect(other.draft_payload.concepts[0].concepto_fiscal_id).toBe(qaConceptId);
    expect(other.draft_payload.concepts[0].descripcion).toBe(otherDescription);
    await page.reload();
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await page.locator(`#cfdi-${id}`).getByRole('button', { name: 'Abrir borrador' }).click();
    await expect(page.getByRole('dialog', { name: /Borrador/ }).getByLabel('Descripción para esta factura')).toHaveValue(lineDescription);
    await page.getByRole('dialog', { name: /Borrador/ }).getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.locator(`#cfdi-${other.id}`).getByRole('button', { name: 'Abrir borrador' }).click();
    await expect(page.getByRole('dialog', { name: /Borrador/ }).getByLabel('Descripción para esta factura')).toHaveValue(otherDescription);
  });

  test('editor central y acciones PDF son accesibles sin overflow entre 1440 y 320 px', async ({ page }, testInfo) => {
    await enterLocalBilling(page);
    for (const width of [1440, 1366, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 740 : 900 });
      await expect(page.getByRole('button', { name: 'Nueva factura' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `Overflow horizontal en Facturación a ${width}px`).toBe(false);
      const stamp = page.getByRole('button', { name: 'Timbrar CFDI' }).first();
      await expect(stamp).toBeDisabled();
      await stamp.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        `Overflow en tarjeta fiscal con timbrado bloqueado a ${width}px`).toBe(false);
      await page.getByRole('button', { name: 'Nueva factura' }).click();
      const editor = page.getByRole('dialog', { name: 'Nueva factura' });
      await expect(editor.getByLabel('RFC receptor')).toBeVisible();
      await expect(editor.getByRole('button', { name: 'Guardar borrador' })).toBeVisible();
      const box = await editor.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      if (width === 390 || width === 320) await page.screenshot({ path: testInfo.outputPath(`facturacion-editor-${width}.png`) });
      await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
    }
  });
});
