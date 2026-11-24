import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

test('Prefacturas reales: MXN/USD/CAD, PostgreSQL, Storage, visor, descarga y regeneración sin PAC', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const raw = process.env.QA_CLIENT_CASE_DATABASE_URL || '';
  const url = new URL(raw);
  expect([url.hostname, url.port, url.pathname]).toEqual(['127.0.0.1', '55521', '/pravia_client_qa']);
  if (!process.env.QA_LOCAL_PASSWORD) throw Error('LOCAL_QA_PASSWORD_REQUIRED');
  const db = new PrismaClient({ datasourceUrl: raw });
  const org = '21110000-0000-4000-8000-000000000001';
  const errors: string[] = [];
  let authorization = '';
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!new URL(request.url()).origin.startsWith('http://127.0.0.1:')) return;
    authorization = request.headers().authorization || authorization;
  });
  await page.route(/^https?:/, route => {
    const request = route.request(), target = new URL(request.url());
    if (!['http://127.0.0.1:5176', 'http://127.0.0.1:3011'].includes(target.origin) || /\/timbrar(?:$|\/)/.test(target.pathname)) {
      errors.push('External/PAC request attempted'); return route.abort();
    }
    return route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    const entity = await db.entidadFiscalCfdi.findFirstOrThrow({ where: { organization_id: org, rfc: 'EKU9003173C9' } });
    const concept = await db.conceptoFiscalCfdi.findFirstOrThrow({ where: { organization_id: org, entidad_fiscal_id: entity.id, activo: true } });
    const movementCount = await db.movimientoFinanciero.count({ where: { organization_id: org } });
    // Explicit fixture policy, not a universal fiscal rate or invented tax.
    expect([String(concept.iva_tasa), String(concept.iva_retencion_tasa), String(concept.isr_retencion_tasa)]).toEqual(['0.16', '0', '0']);
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.QA_LOCAL_PASSWORD!);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/mi-dia');
    await page.goto('/finanzas?view=facturacion');
    await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
    for (const [currency, fx] of [['MXN', ''], ['USD', '17.000000'], ['CAD', '12.500000']] as const) {
      await page.getByRole('button', { name: 'Nueva factura', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Nueva factura' });
      await editor.getByRole('combobox', { name: 'Entidad fiscal', exact: true }).selectOption(entity.id);
      const regime = editor.getByLabel('Régimen emisor para esta factura');
      if (await regime.count()) await regime.selectOption('601');
      await editor.getByLabel('Concepto fiscal configurado').selectOption(concept.id);
      const description = `SINTÉTICO QA ${currency} ${randomUUID().slice(0, 8)} SIN VALIDEZ FISCAL`;
      await editor.getByLabel('Descripción para esta factura').fill(description);
      await editor.getByLabel('RFC receptor').fill('FIC010101ABC');
      await editor.getByLabel('Nombre o razón social').fill('RECEPTOR SINTÉTICO SIN VALIDEZ');
      await editor.getByRole('combobox', { name: 'Régimen receptor', exact: true }).selectOption('601');
      await editor.getByLabel('Código postal fiscal').fill('63735');
      await editor.getByRole('combobox', { name: 'Uso CFDI', exact: true }).selectOption('G03');
      await editor.getByLabel('Lugar de expedición').fill('42501');
      await editor.getByLabel('Método de pago').selectOption('PUE');
      await editor.getByRole('combobox', { name: 'Forma de pago', exact: true }).selectOption('03');
      await editor.getByLabel('Valor unitario', { exact: true }).fill('100.00');
      await editor.getByRole('combobox', { name: 'Moneda', exact: true }).selectOption(currency);
      if (fx) await editor.getByLabel('Tipo de cambio a MXN').fill(fx);
      const save = page.waitForResponse(response => response.url().endsWith('/facturacion/borradores') && response.request().method() === 'POST');
      await editor.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
      const saved = await save;
      expect(saved.status(), await saved.text()).toBe(201);
      const draft = (await saved.json()).data.cfdi;
      expect(draft.uuid_fiscal).toBeNull();
      let stored = await db.documentoCfdi.findUniqueOrThrow({ where: { id: draft.id } });
      expect(stored.total.toFixed(2)).toBe('116.00'); expect(stored.moneda).toBe(currency);
      expect(stored.source).toBe('LOCAL_DRAFT');
      await page.reload();
      await page.getByRole('tab', { name: 'CFDI y cuentas' }).click();
      const card = page.locator(`#cfdi-${draft.id}`);
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Abrir borrador', exact: true }).click();
      const reopened = page.getByRole('dialog', { name: /Borrador/ });
      await expect(reopened.getByLabel('Descripción para esta factura')).toHaveValue(description);
      await expect(reopened.getByRole('combobox', { name: 'Moneda', exact: true })).toHaveValue(currency);
      if (fx) await expect(reopened.getByLabel('Tipo de cambio a MXN')).toHaveValue(fx);
      await reopened.getByRole('button', { name: 'Cerrar', exact: true }).click();
      const generate = () => page.waitForResponse(response => response.url().endsWith(`/borradores/${draft.id}/prefacturas`) && response.request().method() === 'POST');
      const generated = generate();
      await card.getByRole('button', { name: 'Generar nueva versión PDF', exact: true }).click();
      const response = await generated;
      expect(response.status(), await response.text()).toBe(201);
      await expect(card.getByText(/v1 ·/)).toBeVisible();
      await card.getByRole('button', { name: 'Ver', exact: true }).click();
      const viewer = page.getByRole('dialog', { name: /\.pdf/ });
      await expect(viewer.locator('canvas[data-preview-loaded="true"]').first()).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`prefactura-${currency}.png`) });
      for (const width of [1920, 1440, 1366, 1280, 1024, 768, 390, 320, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => Math.max(
          document.documentElement.scrollWidth - innerWidth,
          ...[...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
            .map(element => element.getBoundingClientRect().right - innerWidth),
        ))).toBeLessThanOrEqual(0.5);
        await expect(viewer.getByRole('button', { name: 'Cerrar vista previa', exact: true })).toBeInViewport();
        await viewer.getByRole('button', { name: 'Ajustar a página', exact: true }).click();
        await expect.poll(async () => {
          const canvas = await viewer.locator('canvas[data-preview-loaded="true"]').first().boundingBox();
          const dialog = await viewer.boundingBox();
          return canvas && dialog ? canvas.width - dialog.width : Number.POSITIVE_INFINITY;
        }, { message: `Ajustar a página debe adaptar el PDF al visor de ${width}px` }).toBeLessThanOrEqual(0.5);
        const canvas = viewer.locator('canvas[data-preview-loaded="true"]').first();
        await expect.poll(async()=>{const box=await canvas.boundingBox();return box?box.height:Infinity;}).toBeLessThanOrEqual(900);
        if (width === 390 || width === 320) {
          await page.screenshot({ path: test.info().outputPath(`prefactura-${currency}-${width}.png`) });
        }
      }
      await viewer.getByRole('button',{name:'Ajustar al ancho',exact:true}).click();
      const canvas=viewer.locator('canvas[data-preview-loaded="true"]').first();
      await page.setViewportSize({width:768,height:1024});
      await expect.poll(async()=>{const box=await canvas.boundingBox(),dialog=await viewer.boundingBox();return box&&dialog?box.width-dialog.width:Infinity;}).toBeLessThanOrEqual(0.5);
      await viewer.getByRole('button',{name:'Aumentar zoom',exact:true}).click();
      const manual=await canvas.boundingBox();expect(manual).not.toBeNull();
      const percent=await viewer.locator('[aria-label="Nivel de zoom"]').textContent().catch(()=>null);
      await page.setViewportSize({width:1024,height:768});
      await expect.poll(async()=>{const box=await canvas.boundingBox();return Math.abs((box?.width??0)-manual!.width);}).toBeLessThanOrEqual(0.5);
      if(percent!==null)expect(await viewer.locator('[aria-label="Nivel de zoom"]').textContent()).toBe(percent);
      await viewer.getByRole('button',{name:'Ajustar a página',exact:true}).click();
      await viewer.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click();
      await page.setViewportSize({ width: 1280, height: 720 });
      const download = page.waitForEvent('download');
      await card.getByRole('button', { name: 'Descargar', exact: true }).click();
      const filename = await (await download).path();
      expect(filename).toBeTruthy();
      const bytes = await readFile(filename!);
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      const first = await db.prefacturaRepresentacion.findFirstOrThrow({ where: { cfdi_id: draft.id, version: 1 }, include: { documento: true } });
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(sha).toBe(first.pdf_sha256); expect(sha).toBe(first.documento.checksum_sha256);
      expect(bytes.length).toBe(first.size_bytes);
      const regeneration = generate();
      await card.getByRole('button', { name: 'Generar nueva versión PDF', exact: true }).click();
      expect((await regeneration).status()).toBe(201);
      expect(await db.prefacturaRepresentacion.count({ where: { cfdi_id: draft.id } })).toBe(2);
      const oldFile = await page.request.get(`/api/finanzas/facturacion/borradores/${draft.id}/prefacturas/1`, { headers: { Authorization: authorization } });
      expect(oldFile.status()).toBe(200);
      const oldBytes = await (await page.request.get((await oldFile.json()).data.url)).body();
      expect(createHash('sha256').update(oldBytes).digest('hex')).toBe(sha);
      stored = await db.documentoCfdi.findUniqueOrThrow({ where: { id: draft.id } });
      expect(stored.uuid_fiscal).toBeNull(); expect(stored.xml_documento_id).toBeNull();
      expect(stored.estado).toBe('PREFACTURA');
      expect(await db.aplicacionPagoCfdi.count({ where: { cfdi_id: draft.id } })).toBe(0);
      expect(await db.movimientoFinanciero.count({ where: { organization_id: org } })).toBe(movementCount);
    }
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
