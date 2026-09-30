import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.PRAVIA_E2E_API_URL || 'http://127.0.0.1:3101';
const expedienteId = '770a40da-3ba5-4d24-a293-75fa8d064c05';
const quoteId = '30000000-0000-4000-8000-000000000491';
const isrId = '6d36d8c4-a732-450d-8069-a48e3a6552ef';

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill((process.env.PRAVIA_E2E_PASSWORD ?? ''));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/auth/login'));
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    const response = await responsePromise;
    if (response.ok()) { await page.waitForURL('**/mi-dia'); return; }
    await page.waitForTimeout(500 * (attempt + 1));
  }
  throw new Error('No fue posible iniciar la sesión local de QA después de tres intentos.');
}

async function token(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/api/auth/login`, { data: { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') } });
  expect(response.ok()).toBe(true);
  return String((await response.json()).access_token);
}

async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `overflow horizontal ${size.scroll}px > ${size.client}px`).toBeLessThanOrEqual(size.client + 1);
}

test('nuevo lote · Chrome real integra Knowledge, COT IA, ISR y Proyecto persistidos', async ({ page, request }) => {
  test.setTimeout(300_000);
  const serverErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await login(page);
  serverErrors.length = 0;
  consoleErrors.length = 0;

  await test.step('KNOW-001 · inventario y recuperación verificable', async () => {
    await page.goto('/configuracion/biblioteca-conocimiento', { waitUntil: 'networkidle' });
    await expect(page.getByText('85 fuentes inventariadas', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'NAYARIT', exact: true }).click();
    await expect(page.getByText('NAY-002', { exact: true }).first()).toBeVisible();
    const search = page.getByRole('textbox', { name: 'Buscar en Biblioteca jurídica' });
    await search.fill('Artículo 7 capacidad jurídica Nayarit');
    await page.getByRole('button', { name: 'Buscar fundamento', exact: true }).click();
    const evidence = page.getByRole('region', { name: 'Paquete de evidencia' });
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText('NAY-002');
    await expect(evidence).toContainText('Versión 1');
    await expect(evidence.locator('li').first()).toContainText('Artículo 7o');
    await expect(evidence).toContainText('evidencia verificable');
    await page.getByRole('button', { name: 'CRITERIOS INTERNOS', exact: true }).click();
    const criteria = page.getByRole('region', { name: 'Criterios internos' });
    await expect(criteria).toContainText('INT-QA-COMPRAVENTA');
    await expect(page.getByText('CRITERIO INTERNO — NO ES NORMA.', { exact: true })).toBeVisible();
    await noOverflow(page);
  });

  await test.step('COT-IA-001 · aplicación persistida sin propuesta silenciosa', async () => {
    await page.goto(`/cotizaciones/${quoteId}`, { waitUntil: 'networkidle' });
    await expect(page.getByText('COT-0490-2026', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generar cotización con IA', exact: true })).toBeVisible();
    await expect(page.getByText('Presupuesto guardado.', { exact: true })).toBeVisible();
    await expect(page.getByText('Cliente sintético COT IA', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Concepto 1', exact: true })).toHaveValue('Honorarios profesionales');
    await expect(page.getByRole('spinbutton', { name: 'Importe concepto 1', exact: true })).toHaveValue('12345.67');
    const layers = page.getByRole('region', { name: 'Capas de fundamento de la propuesta' });
    await expect(layers).toContainText('Arancel / fuente oficial');
    await expect(layers).toContainText('CRITERIO INTERNO — NO ES NORMA.');
    await expect(layers).toContainText('1 cotización(es) comparables para Compraventa');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('textbox', { name: 'Concepto 1', exact: true })).toHaveValue('Honorarios profesionales');
    await expect(page.getByRole('spinbutton', { name: 'Importe concepto 1', exact: true })).toHaveValue('12345.67');
    await noOverflow(page);
  });

  await test.step('ISR · versión, traza, capacidades, catálogo postal y utilidades', async () => {
    await page.goto(`/calculo-isr/${isrId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'ISR-2026-48967839', exact: true })).toBeVisible();
    await expect(page.getByText('Federal calculado', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('$63,135.08', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Versión 2', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Distribución entre múltiples contribuyentes', { exact: true })).toBeVisible();
    await expect(page.getByText('Tratamiento de residencia fiscal extranjera', { exact: true })).toBeVisible();
    await expect(page.getByText('Snapshot estructurado de la operación', { exact: true })).toBeVisible();
    await expect(page.getByText('Número de escritura / instrumento', { exact: true })).toBeVisible();
    await expect(page.getByText('Folio real', { exact: true })).toBeVisible();
    await expect(page.getByText('Tipo de transmisión', { exact: true })).toBeVisible();
    await expect(page.getByText('signal is aborted without reason')).toHaveCount(0);
    await page.getByText('Utilidades fiscales y perfiles de salida', { exact: true }).click();
    const postal = page.getByPlaceholder('63000, Centro, Tepic…');
    await postal.fill('63000');
    await expect(page.getByRole('button', { name: /63000 ·/ }).first()).toBeVisible();
    await expect(page.getByText(/Versión SEPOMEX-2026-09-25/)).toBeVisible();
    await noOverflow(page);

    const access = await token(request);
    const headers = { Authorization: `Bearer ${access}` };
    const resourcesResponse = await request.get(`${apiBase}/api/isr/resources?legal_date=2026-06-01`, { headers });
    expect(resourcesResponse.ok()).toBe(true);
    const resources = (await resourcesResponse.json()).data;
    expect(resources.references.some((item: { type: string }) => item.type === 'INPC')).toBe(true);
    expect(resources.references.some((item: { type: string }) => item.type === 'UDI')).toBe(true);
    expect(resources.references.filter((item: { type: string }) => item.type === 'RECARGO')).toHaveLength(12);
    expect(resources.export_profiles.map((item: { target: string }) => item.target).sort()).toEqual(['SAT', 'UIF']);
    expect(resources.export_profiles.every((item: { authority?: string; validFrom?: string; sourceUrl?: string }) => Boolean(item.authority && item.validFrom && item.sourceUrl))).toBe(true);
    expect(resources.catalogs.instrument_types.map((item: { code: string }) => item.code)).toContain('ESCRITURA_PUBLICA');
    expect(resources.catalogs.transmission_types.map((item: { code: string }) => item.code)).toContain('ONEROSA');
    expect(resources.catalogs.property_types.map((item: { code: string }) => item.code)).toContain('HOUSE');
    const inpc = resources.references.find((item: { type: string }) => item.type === 'INPC');
    const referred = await request.post(`${apiBase}/api/isr/utilities/referred-value`, { headers, data: { reference_id: inpc.id, amount: '1000.00', factor: '1.0123', valuation_date: '2026-06-01', target_date: '2026-01-01' } });
    expect(referred.ok()).toBe(true);
    expect((await referred.json()).data.referredValue).toBe('1012.30');
    const surcharges = await request.post(`${apiBase}/api/isr/utilities/surcharges`, { headers, data: { principal: '1000.00', origin_date: '2026-01-01', due_date: '2026-01-31', payment_date: '2026-03-01' } });
    expect(surcharges.ok()).toBe(true);
    expect(Number((await surcharges.json()).data.total)).toBeGreaterThan(0);
    const postalApi = await request.get(`${apiBase}/api/isr/resources/postal-codes?q=63000`, { headers });
    expect(postalApi.ok()).toBe(true);
    const postalPayload = await postalApi.json();
    expect(postalPayload.data.length).toBeGreaterThan(0);
    expect(postalPayload.source.version).toBe('SEPOMEX-2026-09-25');
    const satProfile = resources.export_profiles.find((item: { target: string }) => item.target === 'SAT');
    const validation = await request.post(`${apiBase}/api/isr/${isrId}/export-validation`, { headers, data: { profile_id: satProfile.id } });
    expect(validation.ok()).toBe(true);
    expect((await validation.json()).data).toMatchObject({ valid: true, fictitiousValues: false, transformedValues: false });
    const firstExport = await request.post(`${apiBase}/api/isr/${isrId}/export-data`, { headers, data: { profile_id: satProfile.id } });
    const secondExport = await request.post(`${apiBase}/api/isr/${isrId}/export-data`, { headers, data: { profile_id: satProfile.id } });
    expect(firstExport.ok()).toBe(true); expect(secondExport.ok()).toBe(true);
    const firstPayload = (await firstExport.json()).data; const secondPayload = (await secondExport.json()).data;
    expect(firstPayload.checksum_sha256).toBe(secondPayload.checksum_sha256);
    expect(firstPayload.payload).toEqual(secondPayload.payload);
    expect(firstPayload.payload).toMatchObject({ profile: { target: 'SAT', validFrom: '2026-01-01' }, fictitiousValues: false, transformedValues: false });
  });

  await test.step('EXP-010 · V3 dirigida, versiones anteriores y contradicción no resuelta', async () => {
    await page.goto(`/expedientes/${expedienteId}#proyecto`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'PROYECTAR ESCRITURA', exact: true })).toHaveCount(1);
    await expect(page.getByText('Versión 3', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Versión 2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Versión 1', { exact: true }).first()).toBeVisible();
    const review = page.getByRole('region', { name: 'Resultado de la revisión notarial' });
    await expect(review).toContainText('Persona Anterior QA');
    await expect(review).toContainText('Restituir el texto');
    await expect(page.getByText('VALOR DOCUMENTAL EN CONFLICTO QA', { exact: true })).toBeVisible();
    await expect(page.getByText('Ficha de hechos congelada de la versión 3', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Aplicar indicaciones a la versión vigente' })).toBeVisible();
    await page.getByRole('button', { name: 'Ver versión 3', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Proyecto_EXP-0001-2026_V3.docx' });
    await expect(preview.locator('[data-preview-loaded="true"]')).toBeVisible();
    await expect(preview).toContainText('Cliente QA cabecera');
    await expect(preview.getByText('Persona Anterior QA')).toHaveCount(0);
    await expect(preview.getByText('$980,000.00')).toHaveCount(0);
    await preview.getByRole('button', { name: 'Cerrar vista previa' }).click();
    await noOverflow(page);
  });

  expect(serverErrors).toEqual([]);
  expect(consoleErrors.filter((item) => !/favicon|ResizeObserver/i.test(item))).toEqual([]);
});

test('nuevo lote · superficies críticas sin overflow en seis viewports', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  const routes = [
    '/configuracion/biblioteca-conocimiento',
    `/cotizaciones/${quoteId}`,
    `/calculo-isr/${isrId}`,
    `/expedientes/${expedienteId}#proyecto`,
  ];
  const viewports = [
    { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 },
    { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 700 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('main').first()).toBeVisible();
      if (route === '/configuracion/biblioteca-conocimiento') {
        await expect(page.getByRole('heading', { name: 'Biblioteca de conocimiento' })).toBeVisible();
        const search = page.getByRole('textbox', { name: 'Buscar en Biblioteca jurídica' });
        await search.fill('Artículo 7 capacidad jurídica Nayarit');
        await page.getByRole('button', { name: 'Buscar fundamento', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Paquete de evidencia' })).toBeVisible();
      } else if (route === `/cotizaciones/${quoteId}`) {
        await expect(page.getByRole('region', { name: 'Propuesta de cotización con IA' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Capas de fundamento de la propuesta' })).toBeVisible();
      } else if (route === `/calculo-isr/${isrId}`) {
        await expect(page.getByText('Distribución entre múltiples contribuyentes', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Deducciones y documentos soporte' })).toBeVisible();
        await expect(page.getByText('Resultado federal', { exact: true })).toBeVisible();
        await page.getByText('Utilidades fiscales y perfiles de salida', { exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Validación SAT / UIF' })).toBeVisible();
      } else if (route === `/expedientes/${expedienteId}#proyecto`) {
        await expect(page.getByText('VALOR DOCUMENTAL EN CONFLICTO QA', { exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Aplicar indicaciones a la versión vigente' })).toBeVisible();
        await page.getByRole('button', { name: 'Ver versión 3', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Proyecto_EXP-0001-2026_V3.docx' });
        await expect(preview.locator('[data-preview-loaded="true"]')).toBeVisible();
        await noOverflow(page);
        await preview.getByRole('button', { name: 'Cerrar vista previa' }).click();
      }
      await noOverflow(page);
    }
  }
});
