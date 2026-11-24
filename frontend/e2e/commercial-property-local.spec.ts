import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, WidthType } from '../../backend/node_modules/docx/dist/index.cjs';
import JSZip from '../../backend/node_modules/jszip/lib/index.js';
import { uploadFile } from '../../backend/src/storage/storage.service';
import { runWithActorContext } from '../../backend/src/auth/actorContext';

const app = 'http://127.0.0.1:5176';
const backend = 'http://127.0.0.1:3011';

test('Inmueble comercial: alta, selección, fuente canónica, regreso, recarga y seis anchos en Chrome', async ({ page, request, baseURL }) => {
  expect(baseURL).toBe(app);
  const target = process.env.QA_CLIENT_CASE_DATABASE_URL;
  const password = process.env.QA_LOCAL_PASSWORD;
  if (!target || !password) throw Error('Falta configuración de QA local.');
  const url = new URL(target);
  expect([url.hostname, url.port, url.pathname, url.searchParams.get('schema')]).toEqual(['127.0.0.1', '55521', '/pravia_client_qa', 'pravia_os']);
  expect(await (await request.get(`${backend}/health`)).json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  const db = new PrismaClient({ datasources: { db: { url: target } } });
  const quoteId = randomUUID(), prospectId = randomUUID(), suffix = randomUUID().slice(0, 8);
  let qaArtifactId: string | null = null;
  const errors: string[] = [];
  let token = '';
  page.on('pageerror', error => errors.push(error.message));
  // Reload rotates the refresh session; use the token actually sent by the app,
  // not the now-revoked token returned by the original login.
  page.on('request', outbound => {
    if (![app, backend].includes(new URL(outbound.url()).origin)) return;
    const auth = outbound.headers().authorization;
    if (auth?.startsWith('Bearer ')) token = auth.slice(7);
  });
  await page.route(/^https?:/, route => [app, backend].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: 'documentos.qa@pravia.test' } });
    const membership = await db.organizationMembership.findFirstOrThrow({ where: { user_id: user.id, status: 'ACTIVE' } });
    const org = membership.organization_id;
    await db.cotizacion.create({ data: { id: quoteId, organization_id: org, user_id: user.id, numero_cotizacion: `COT-QA-INM-${suffix}`, estado: 'BORRADOR', cuenta_predial: '000-HIST-QA', importe_predial: '45.67' } });
    await db.prospecto.create({ data: { id: prospectId, organization_id: org, user_id: user.id, nombre: `SINTÉTICO QA origen ${suffix}` } });
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(user.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    const loginPromise = page.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    const login = await (await loginPromise).json();
    token = login.accessToken ?? login.access_token ?? login.token ?? login.data?.accessToken;
    expect(typeof token).toBe('string');
    await page.waitForURL('**/mi-dia');
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto(`/cotizaciones/${quoteId}#inmueble`);
    const picker = page.getByRole('region', { name: 'Inmueble de la operación' });
    await expect(picker.getByText('Sin inmueble vinculado')).toBeVisible();
    const operation = page.getByLabel('Valor de operación (MXN)', { exact: true });
    await operation.fill('111.11');
    await page.getByLabel('Valor catastral (MXN)', { exact: true }).fill('0');
    await page.getByLabel('Valor de avalúo (MXN)', { exact: true }).fill('12.34');
    await expect(picker.getByRole('link', { name: 'Dar de alta inmueble' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar datos del inmueble', exact: true }).click();
    await expect(picker.getByRole('link', { name: 'Dar de alta inmueble' })).toBeVisible();
    let quote = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.valor_avaluo?.toFixed(2)).toBe('12.34'); expect(quote.cuenta_predial).toBe('000-HIST-QA'); expect(quote.importe_predial?.toFixed(2)).toBe('45.67');

    await picker.getByRole('link', { name: 'Dar de alta inmueble' }).click();
    await expect(page).toHaveURL(new RegExp(`/predios/nuevo\\?fromQuote=${quoteId}`));
    await page.getByLabel('Apodo / nombre corto', { exact: true }).fill(`SINTÉTICO QA inmueble ${suffix}`);
    await page.getByLabel('Valor de operación', { exact: true }).fill('2500000.50');
    await page.getByLabel('Valor fiscal / catastral', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cotizaciones/${quoteId}#inmueble$`));
    await expect(picker.getByRole('button', { name: 'Confirmar vínculo' })).toBeVisible();
    expect((await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId } })).predio_principal_id).toBeNull();
    await picker.getByRole('button', { name: 'Confirmar vínculo' }).click();
    await expect(picker.getByRole('link', { name: 'Ver ficha maestra' })).toBeVisible();
    await expect(operation).toHaveValue('2500000.5');
    await expect(page.getByLabel('Valor catastral (MXN)', { exact: true })).toHaveValue('0');
    await expect(page.getByLabel('Valor de avalúo (MXN)', { exact: true })).toHaveValue('');
    await expect(operation).toBeDisabled();
    quote = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    const propertyId = quote.predio_principal_id!;
    expect(propertyId).toBeTruthy(); expect(quote.valor_operacion?.toFixed(2)).toBe('111.11');
    expect(await db.predio.count({ where: { organization_id: org, apodo: { equals: `SINTÉTICO QA inmueble ${suffix}`, mode: 'insensitive' } } })).toBe(1);

    await picker.getByRole('link', { name: 'Ver ficha maestra' }).click();
    await expect(page.getByRole('link', { name: 'Volver a la cotización' })).toBeVisible();
    await page.getByLabel('Valor de operación', { exact: true }).fill('2600000.75');
    await page.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
    await expect(page.getByText('Ficha maestra guardada.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Volver a la cotización' }).click();
    await expect(operation).toHaveValue('2600000.75');
    await page.reload(); await expect(operation).toHaveValue('2600000.75');

    for (const width of [1440, 1366, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await picker.scrollIntoViewIfNeeded();
      await expect(picker.getByRole('link', { name: 'Ver ficha maestra' })).toBeVisible();
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, (document.querySelector('#main-content')?.scrollWidth ?? 0) - (document.querySelector('#main-content')?.clientWidth ?? 0)))).toBeLessThanOrEqual(1);
      const box = (await picker.getByRole('link', { name: 'Ver ficha maestra' }).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: test.info().outputPath(`commercial-property-${width}.png`) });
    }

    await page.goto(`/prospectos/${prospectId}#inmueble`);
    await picker.getByRole('searchbox').fill(suffix);
    await picker.getByRole('button', { name: new RegExp(`SINTÉTICO QA inmueble ${suffix}`, 'i') }).click();
    await picker.getByRole('button', { name: 'Confirmar vínculo' }).click();
    await expect(picker.getByRole('link', { name: 'Ver ficha maestra' })).toBeVisible();
    await page.reload();
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospectId } })).predio_principal_id).toBe(propertyId);
    await picker.getByRole('link', { name: 'Ver ficha maestra' }).click();
    await page.getByRole('link', { name: 'Volver al prospecto' }).click();
    await expect(page).toHaveURL(new RegExp(`/prospectos/${prospectId}#inmueble$`));

    const auth = { Authorization: `Bearer ${token}` };
    const api = await request.get(`${backend}/api/cotizaciones/${quoteId}/inmueble`, { headers: auth });
    expect(api.status()).toBe(200);
    expect((await api.json()).data).toMatchObject({ source: 'PREDIO_MASTER', property: { id: propertyId }, values: { operationValue: '2600000.75', cadastralValue: '0', appraisalValue: null } });
    const unowned = await db.cotizacion.findFirstOrThrow({ where: { organization_id: { not: org } } });
    const denied = await request.get(`${backend}/api/cotizaciones/${unowned.id}/inmueble`, { headers: auth });
    expect(denied.status()).toBe(403);
    expect(await db.auditLog.count({ where: { organization_id: org, entidad_id: { in: [quoteId, prospectId] }, accion: 'COMMERCIAL_PROPERTY_SELECTED' } })).toBe(2);
    expect(await db.pago.count({ where: { cotizacion_id: quoteId } })).toBe(0);

    // Register a clearly synthetic CFG-002 fixture only when this QA tenant has
    // no active quote template. Never replace or deactivate an existing format.
    expect(await db.catalogoArtefactoDestino.count({ where: { organization_id: org, destino: 'COTIZACION_SERVICIOS', activo: true } })).toBe(0);
    const row = (...cells: string[]) => new TableRow({ children: cells.map(text => new TableCell({ children: [new Paragraph(text)] })) });
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('SINTÉTICO QA / SIN VALIDEZ FISCAL'),
      new Paragraph('Operación: {{operacion.valor}}'), new Paragraph('Catastro: {{inmueble.valor_catastral}}'), new Paragraph('Avalúo: {{inmueble.valor_avaluo}}'),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [6000, 2000], rows: [row('CONCEPTO', 'IMPORTE'), row('DETALLE', '0.00'), row('TOTAL', '0.00')] }),
      new Paragraph('ESTRUCTURA ORIGINAL QA CONSERVADA'),
    ] }] }));
    const artifactId = randomUUID(), versionId = randomUUID();
    const storageKey = `organizations/${org}/qa/commercial-property/${artifactId}.docx`;
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await runWithActorContext({ userId: user.id, organizationId: org, membershipId: membership.id, role: membership.rol,
      scope: 'GLOBAL', permissions: login.user.permissions, sessionId: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sid },
    () => uploadFile(source, storageKey, mime));
    await db.catalogoArtefacto.create({ data: { id: artifactId, organization_id: org, propietario_tipo: 'ORGANIZACION', tipo: 'FORMATO', nombre: `SINTÉTICO QA inmueble ${suffix}`, creado_por_id: user.id, actualizado_por_id: user.id } });
    qaArtifactId = artifactId;
    await db.catalogoArtefactoVersion.create({ data: { id: versionId, organization_id: org, artefacto_id: artifactId, version: 1, activa: true, nombre_original: 'SINTETICO_QA.docx', mime_type: mime, storage_key: storageKey, size_bytes: source.length, checksum_sha256: createHash('sha256').update(source).digest('hex'), origen: 'SYNTHETIC_QA', creado_por_id: user.id } });
    await db.catalogoArtefactoDestino.create({ data: { organization_id: org, artefacto_id: artifactId, destino: 'COTIZACION_SERVICIOS', predeterminado: true, creado_por_id: user.id, actualizado_por_id: user.id,
      mapeo_datos_json: { quote_economic: { schema_version: 1, versions: { [versionId]: { table_index: 0, detail_row_index: 1, total_row_index: 2, label_column: 0, amount_column: 1 } } } } } });
    const revision = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    const budget = await request.put(`${backend}/api/cotizaciones/${quoteId}/presupuesto`, { headers: auth, data: { concepts: [{ concepto: 'HONORARIO SINTÉTICO QA', categoria: 'HONORARIOS', importe: '100.00' }], expectedUpdatedAt: revision.updated_at.toISOString() } });
    expect(budget.status()).toBe(200);
    const generated = await request.post(`${backend}/api/cotizaciones/${quoteId}/generar-documento`, { headers: auth });
    expect(generated.status(), await generated.text()).toBe(201);
    const document = await generated.json();
    const download = await request.get(`${backend}/api/cotizaciones/${quoteId}/documentos/${document.id}/descargar`, { headers: auth });
    expect(download.status()).toBe(200);
    const bytes = await download.body(); const sha = createHash('sha256').update(bytes).digest('hex');
    const archive = await JSZip.loadAsync(bytes);
    const xml = await archive.file('word/document.xml')!.async('string');
    expect(xml).toContain('Operación: 2,600,000.75'); expect(xml).toContain('Catastro: 0.00'); expect(xml).toContain('Avalúo: Sin información');
    expect(xml).toContain('ESTRUCTURA ORIGINAL QA CONSERVADA'); expect(xml).not.toContain('111.11');
    expect((xml.match(/<w:tbl>/g) ?? [])).toHaveLength(1);
    const persisted = await db.documento.findUniqueOrThrow({ where: { id: document.id } });
    expect(persisted.checksum_sha256).toBe(sha);
    expect(persisted.datos_extraidos).toMatchObject({ generation: { property_source: { kind: 'PREDIO_MASTER', id: propertyId, version: 2 }, property_values: { operation: '2600000.75', cadastral: '0', appraisal: null } } });
    await db.predio.update({ where: { id: propertyId }, data: { valor_avaluo: '2700000.25', version: { increment: 1 } } });
    const regenerated = await request.post(`${backend}/api/cotizaciones/${quoteId}/generar-documento`, { headers: auth });
    expect(regenerated.status(), await regenerated.text()).toBe(201);
    const second = await regenerated.json();
    expect(second.id).not.toBe(document.id);
    const secondBytes = await (await request.get(`${backend}/api/cotizaciones/${quoteId}/documentos/${second.id}/descargar`, { headers: auth })).body();
    const secondArchive = await JSZip.loadAsync(secondBytes);
    expect(await secondArchive.file('word/document.xml')!.async('string')).toContain('Avalúo: 2,700,000.25');
    const old = await request.get(`${backend}/api/cotizaciones/${quoteId}/documentos/${document.id}/descargar`, { headers: auth });
    expect(createHash('sha256').update(await old.body()).digest('hex')).toBe(sha);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/cotizaciones/${quoteId}`);
    await page.getByRole('button', { name: `Ver ${second.nombre_original}`, exact: true }).click();
    const preview = page.getByLabel(`Vista previa de ${second.nombre_original}`, { exact: true });
    await expect(preview).toContainText('Avalúo: 2,700,000.25');
    await expect(preview).toContainText('ESTRUCTURA ORIGINAL QA CONSERVADA');
    await page.screenshot({ path: test.info().outputPath('commercial-property-docx-preview.png') });
    await page.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click();
    await page.goto(`/prospectos/${prospectId}#inmueble`);
    await picker.getByRole('link', { name: 'Dar de alta inmueble' }).click();
    await expect(page).toHaveURL(new RegExp(`/predios/nuevo\\?fromProspect=${prospectId}$`));
    await page.getByLabel('Apodo / nombre corto', { exact: true }).fill(`SINTÉTICO QA otro inmueble ${suffix}`);
    await page.getByLabel('Valor de operación', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/prospectos/${prospectId}#inmueble$`));
    await expect(picker.getByRole('button', { name: 'Confirmar vínculo' })).toBeVisible();
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospectId } })).predio_principal_id).toBe(propertyId);
    await picker.getByRole('button', { name: 'Confirmar vínculo' }).click();
    await expect(picker.getByRole('button', { name: 'Confirmar vínculo' })).toHaveCount(0);
    await page.reload();
    await expect(picker.getByText(new RegExp(`SINTÉTICO QA OTRO INMUEBLE ${suffix}`, 'i'), { exact: true })).toBeVisible();
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospectId } })).predio_principal_id).not.toBe(propertyId);
    expect((await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId } })).predio_principal_id).toBe(propertyId);
    expect(errors).toEqual([]);
  } finally {
    if (qaArtifactId) await db.catalogoArtefactoDestino.updateMany({ where: { artefacto_id: qaArtifactId }, data: { activo: false } });
    await db.$disconnect();
  }
});
