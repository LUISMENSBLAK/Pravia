import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const qaEmail = 'adrian.hernandez@pravia.test';

async function login(page: Page) {
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (!password) throw new Error('PRAVIA_E2E_PASSWORD_REQUIRED');
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill(qaEmail);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== qaEmail) await email.fill(qaEmail);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  const response = page.waitForResponse((item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL('**/mi-dia');
}

test.describe.serial('Finanzas CFDI local', () => {
  test('prefactura y XML/PDF reales persisten, archivos descargan y el PAC no se simula', async ({ page }, testInfo) => {
    const base = new URL(String(testInfo.project.use.baseURL || ''));
    if (base.hostname !== '127.0.0.1') throw new Error('LOCAL_CFDI_QA_SAFETY_GATE_FAILED');
    await login(page);
    const authRequest = page.waitForRequest((request) => request.url().endsWith('/api/finanzas/catalogos'));
    await page.goto('/finanzas?view=facturacion');
    let authorization = (await authRequest).headers().authorization;
    if (!authorization?.startsWith('Bearer ')) throw new Error('LOCAL_CFDI_AUTH_TOKEN_MISSING');

    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await expect(page.getByRole('heading', { name: 'CFDI, cuentas y proveedores' })).toBeVisible();
    await expect(page.getByText(/Proveedor fiscal configurado|Timbrado externo no configurado/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Timbrar/i })).toHaveCount(0);

    const entitiesResponse = await page.request.get('/api/finanzas/facturacion/entidades', { headers: { Authorization: authorization } });
    expect(entitiesResponse.status(), await entitiesResponse.text()).toBe(200);
    const entities = (await entitiesResponse.json()).data;
    expect(entities.length).toBeGreaterThan(0);
    expect(typeof entities[0].siguiente_folio).toBe('string');
    expect(JSON.stringify(entities[0])).not.toContain('secret://');

    const concept = `QA prefactura navegador ${Date.now()}`;
    await page.getByRole('button', { name: 'Nueva prefactura' }).click();
    const draft = page.getByRole('dialog', { name: 'Nueva prefactura' });
    await draft.getByLabel('RFC receptor').fill('XAXX010101000');
    await draft.getByLabel('Nombre receptor').fill('Cliente QA navegación');
    await draft.getByLabel('Régimen receptor').fill('616');
    await draft.getByLabel('CP receptor').fill('63735');
    await draft.getByLabel('Subtotal').fill('100.00');
    await draft.getByLabel('IVA trasladado').fill('16.00');
    await draft.getByLabel('Total', { exact: true }).fill('116.00');
    await draft.getByLabel('Concepto').fill(concept);
    const draftResponse = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/borradores') && response.request().method() === 'POST');
    await draft.getByRole('button', { name: 'Crear prefactura' }).click();
    expect((await draftResponse).status()).toBe(201);
    await expect(page.getByText('Prefactura creada sin invocar al PAC.')).toBeVisible();
    await expect(page.getByText('Cliente QA navegación').first()).toBeVisible();

    const uuid = randomUUID();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="QA" Folio="${Date.now()}" Fecha="2026-10-06T20:00:00" SubTotal="200.00" Moneda="MXN" Total="232.00" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03">
        <cfdi:Emisor Rfc="${entities[0].rfc}" Nombre="${entities[0].razon_social}" RegimenFiscal="601"/>
        <cfdi:Receptor Rfc="XAXX010101000" Nombre="Público QA E2E" DomicilioFiscalReceptor="63735" RegimenFiscalReceptor="616" UsoCFDI="G03"/>
        <cfdi:Impuestos TotalImpuestosTrasladados="32.00" TotalImpuestosRetenidos="0.00"/>
        <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}" FechaTimbrado="2026-10-06T20:00:01"/></cfdi:Complemento>
      </cfdi:Comprobante>`;
    await page.getByRole('button', { name: 'Cargar XML/PDF' }).click();
    const upload = page.getByRole('dialog', { name: 'Cargar CFDI manual' });
    await upload.getByLabel('XML CFDI 4.0').setInputFiles({ name: `qa-${uuid}.xml`, mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await upload.getByLabel('PDF opcional').setInputFiles({ name: `qa-${uuid}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nPRAVIA QA CFDI\n%%EOF') });
    const uploadResponse = page.waitForResponse((response) => response.url().endsWith('/api/finanzas/facturacion/manual') && response.request().method() === 'POST');
    await upload.getByRole('button', { name: 'Cargar CFDI' }).click();
    expect((await uploadResponse).status()).toBe(201);
    await expect(page.getByText(/CFDI y archivos guardados correctamente|CFDI guardado/)).toBeVisible();
    await expect(page.getByText('Público QA E2E').first()).toBeVisible();

    const reloadAuthRequest = page.waitForRequest((request) => request.url().endsWith('/api/finanzas/catalogos'));
    await page.reload();
    authorization = (await reloadAuthRequest).headers().authorization;
    if (!authorization?.startsWith('Bearer ')) throw new Error('LOCAL_CFDI_RELOAD_AUTH_TOKEN_MISSING');
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await expect(page.getByText('Público QA E2E').first()).toBeVisible();
    const documentsResponse = await page.request.get('/api/finanzas/facturacion/documentos', { headers: { Authorization: authorization } });
    expect(documentsResponse.status(), await documentsResponse.text()).toBe(200);
    const persisted = (await documentsResponse.json()).data.items.find((item: { uuid_fiscal?: string }) => item.uuid_fiscal === uuid.toUpperCase());
    expect(persisted).toBeTruthy();
    expect(persisted.xmlDocumento.nombre_original).toBe(`qa-${uuid}.xml`);
    expect(persisted.pdfDocumento.nombre_original).toBe(`qa-${uuid}.pdf`);
    for (const kind of ['xml', 'pdf'] as const) {
      const signedResponse = await page.request.get(`/api/finanzas/facturacion/documentos/${persisted.id}/archivos/${kind}`, { headers: { Authorization: authorization } });
      expect(signedResponse.status(), await signedResponse.text()).toBe(200);
      const signed = (await signedResponse.json()).data;
      const file = await page.request.get(new URL(signed.url, base).toString());
      expect(file.status()).toBe(200);
      expect((await file.body()).length).toBeGreaterThan(12);
    }

    const stampResponse = await page.request.post(`/api/finanzas/facturacion/documentos/${persisted.id}/timbrar`, { headers: { Authorization: authorization }, data: {} });
    expect(stampResponse.status()).toBe(503);
    expect((await stampResponse.json()).code).toBe('CFDI_PROVIDER_NOT_CONFIGURED');
    const afterRefusal = (await (await page.request.get('/api/finanzas/facturacion/documentos', { headers: { Authorization: authorization } })).json()).data.items.find((item: { id: string }) => item.id === persisted.id);
    expect(afterRefusal.estado).toBe('VIGENTE');
    expect(afterRefusal.uuid_fiscal).toBe(uuid.toUpperCase());

    const exportResponse = await page.request.get('/api/finanzas/facturacion/exportar.xlsx', { headers: { Authorization: authorization } });
    expect(exportResponse.status(), await exportResponse.text()).toBe(200);
    expect(exportResponse.headers()['content-type']).toContain('spreadsheetml');
    expect((await exportResponse.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('responsive 1440/1366/1024/768/390/320 sin overflow de página', async ({ page }, testInfo) => {
    const base = new URL(String(testInfo.project.use.baseURL || ''));
    if (base.hostname !== '127.0.0.1') throw new Error('LOCAL_CFDI_QA_SAFETY_GATE_FAILED');
    await login(page);
    await page.goto('/finanzas?view=facturacion');
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    await expect(page.getByRole('heading', { name: 'CFDI, cuentas y proveedores' })).toBeVisible();
    for (const width of [1440, 1366, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : width <= 390 ? 844 : 900 });
      await expect(page.getByRole('heading', { name: 'CFDI, cuentas y proveedores' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `Finanzas CFDI presenta overflow horizontal a ${width}px`).toBe(false);
      await expect(page.getByRole('button', { name: 'Cargar XML/PDF' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nueva prefactura' })).toBeVisible();
      if (width <= 390) {
        await page.getByRole('button', { name: 'Cargar XML/PDF' }).click();
        const dialog = page.getByRole('dialog', { name: 'Cargar CFDI manual' });
        const submit = dialog.getByRole('button', { name: 'Cargar CFDI', exact: true });
        await expect(submit).toBeVisible();
        const submitBox = await submit.boundingBox();
        const launcherBox = await page.getByRole('button', { name: 'Abrir PRAVIA IA' }).boundingBox();
        expect(submitBox).not.toBeNull();
        expect(launcherBox).not.toBeNull();
        const left = Math.max(submitBox!.x, launcherBox!.x);
        const right = Math.min(submitBox!.x + submitBox!.width, launcherBox!.x + launcherBox!.width);
        const top = Math.max(submitBox!.y, launcherBox!.y);
        const bottom = Math.min(submitBox!.y + submitBox!.height, launcherBox!.y + launcherBox!.height);
        if (width === 320) {
          expect(right - left, 'El caso de 320px debe cubrir la intersección real').toBeGreaterThan(0);
          expect(bottom - top, 'El caso de 320px debe cubrir la intersección real').toBeGreaterThan(0);
        }
        if (right > left && bottom > top) {
          const dialogOwnsOverlap = await dialog.evaluate(
            (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
            { x: (left + right) / 2, y: (top + bottom) / 2 },
          );
          expect(dialogOwnsOverlap, `PRAVIA IA cubre el botón CFDI a ${width}px`).toBe(true);
        }
        await dialog.getByRole('button', { name: 'Cancelar' }).click();
      }
    }
  });
});
