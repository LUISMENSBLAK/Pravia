import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import { PDFDocument } from '../../backend/node_modules/pdf-lib/cjs/index.js';

const alejandro = { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' };
const javier = { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' };
const adrian = { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' };
const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const actId = '11aa1757-2b3d-4e6c-86e2-3818da8df765';
const applicantId = '7475c24d-888a-47f3-8b35-6517d1a44a14';
const characterId = '55c81d88-8345-4c09-9ebf-08b6527bec17';

async function login(page: Page, credentials: typeof alejandro) {
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

test('COL03/COL37/COL58 · conversión comercial canónica y lectura entre compañeros', async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || !/^postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres\?schema=pravia_os$/.test(dbUrl)
    || !alejandro.password || !javier.password || !adrian.password) {
    throw new Error('COLLABORATION_COMMERCIAL_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL: base.toString() })));
  const [owner, viewer, manager] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const responses = await Promise.all([alejandro, javier, adrian].map((credentials) => request.post('/api/auth/login', { data: credentials })));
    responses.forEach((response) => expect(response.status()).toBe(200));
    const [ownerAuth, viewerAuth, managerAuth] = await Promise.all(responses.map((response) => response.json()));
    const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
    for (const auth of [ownerAuth, viewerAuth, managerAuth]) expect(auth.user.organization.id).toBe(orgId);
    const marker = `COL-COMMERCIAL-QA-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const create = await request.post('/api/prospectos', { headers: { ...headers(ownerAuth), 'Idempotency-Key': marker },
      data: { nombre: marker, email: `${randomUUID()}@pravia.test`, tipo_acto_ids: [actId] } });
    expect(create.status(), await create.text()).toBe(201);
    const prospect = await create.json();
    expect(prospect.folio).toMatch(/^PRO-\d{4}-\d{4}$/);
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } })).user_id).toBe(ownerAuth.user.id);
    const qaPdf = await PDFDocument.create();
    qaPdf.addPage([595, 842]).drawText(`Documento comercial sintetico ${marker}`, { x: 40, y: 790, size: 12 });
    const upload = await request.post('/api/documentos', { headers: headers(ownerAuth), multipart: {
      archivo: { name: 'colaboracion-comercial-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await qaPdf.save()) },
      tipo: 'DOCUMENTACION_INICIAL', categoria: 'OTROS', prospecto_id: prospect.id,
    } });
    expect(upload.status(), await upload.text()).toBe(201);
    const prospectDocument = await upload.json();
    expect(prospectDocument.id).toBeTruthy();
    const advanceProspect = async (action: string, extra: Record<string, unknown> = {}) => {
      const current = await request.get(`/api/prospectos/${prospect.id}/operacion`, { headers: headers(ownerAuth) });
      expect(current.status()).toBe(200);
      const response = await request.post(`/api/prospectos/${prospect.id}/transiciones`, { headers: headers(ownerAuth),
        data: { action, expectedVersion: (await current.json()).version, confirm: true,
          idempotencyKey: `${marker}:${action}`, ...extra } });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };
    await advanceProspect('COMENZAR_INTEGRACION');
    await advanceProspect('MARCAR_LISTO_PARA_COTIZAR', { quoteAssigneeId: ownerAuth.user.id });
    const prospectConversion = await advanceProspect('CONVERTIR');
    const quoteId = prospectConversion.quoteId as string;
    expect(quoteId).toBeTruthy();
    const getQuote = async () => {
      const response = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(ownerAuth) });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const draft = await getQuote();
    expect(draft.numero_cotizacion).toMatch(/^COT-\d{4}-\d{4}$/);
    expect(draft.prospecto_id).toBe(prospect.id);
    expect(draft.user_id).toBe(ownerAuth.user.id);
    expect(draft.actos).toHaveLength(1);
    expect(draft.actos[0].tipo_acto_id).toBe(actId);
    await login(owner, alejandro);
    await login(viewer, javier);
    await owner.goto(`/cotizaciones/${quoteId}`);
    await expect(owner.getByRole('heading', { name: draft.numero_cotizacion })).toBeVisible();
    await viewer.goto(`/cotizaciones/${quoteId}`);
    await expect(viewer.getByRole('heading', { name: draft.numero_cotizacion })).toBeVisible();

    const save = await request.put(`/api/cotizaciones/${quoteId}/presupuesto`, { headers: headers(ownerAuth),
      data: { expectedUpdatedAt: draft.updated_at, origin: 'MANUAL', operationContext: 'Operación sintética de certificación local', concepts: [
        { concepto: 'Honorarios QA', categoria: 'HONORARIOS', importe: '1000.00' },
        { concepto: 'Derechos QA', categoria: 'IMPUESTOS_DERECHOS', importe: '160.00' },
      ] } });
    expect(save.status(), await save.text()).toBe(200);
    const budget = await getQuote();
    expect(Number(budget.presupuesto.totals.honorarios)).toBe(1000);
    expect(Number(budget.presupuesto.totals.iva_honorarios)).toBe(160);
    expect(Number(budget.presupuesto.totals.impuestos_derechos)).toBe(160);
    const sharedBudget = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(viewerAuth) });
    expect(sharedBudget.status()).toBe(200);
    const sharedQuote = await sharedBudget.json();
    expect(Number(sharedQuote.presupuesto.totals.total)).toBe(1320);
    expect(sharedQuote.prospecto.documentos.some((doc: { id: string }) => doc.id === prospectDocument.id)).toBe(true);
    const forbiddenBudget = await request.put(`/api/cotizaciones/${quoteId}/presupuesto`, { headers: headers(viewerAuth),
      data: { expectedUpdatedAt: budget.updated_at, concepts: [{ concepto: 'Intrusión QA', categoria: 'HONORARIOS', importe: '1.00' }] } });
    expect(forbiddenBudget.status()).toBe(403);
    expect((await request.post(`/api/cotizaciones/${quoteId}/acciones`, { headers: headers(viewerAuth), data: {
      action: 'COMENZAR_ELABORACION', expectedVersion: budget.workflow.version, confirm: true,
      idempotencyKey: `${marker}:DENIED`, effectiveAt: new Date().toISOString(),
    } })).status()).toBe(403);
    expect((await request.delete(`/api/cotizaciones/${quoteId}/documentos/${prospectDocument.id}`, { headers: headers(viewerAuth) })).status()).toBe(403);
    expect(Number((await getQuote()).presupuesto.totals.total)).toBe(1320);
    expect(await db.documento.count({ where: { id: prospectDocument.id } })).toBe(1);
    const advanceQuote = async (action: string, extra: Record<string, unknown> = {}) => {
      const current = await getQuote();
      const response = await request.post(`/api/cotizaciones/${quoteId}/acciones`, { headers: headers(ownerAuth),
        data: { action, expectedVersion: current.workflow.version, confirm: true,
          idempotencyKey: `${marker}:${action}`, effectiveAt: new Date().toISOString(), ...extra } });
      expect(response.status(), `${action}: ${await response.text()}`).toBe(201);
      return response.json();
    };
    await advanceQuote('COMENZAR_ELABORACION');
    await advanceQuote('ENVIAR_CLIENTE', { channel: 'correo', recipient: 'cliente-sintetico@pravia.test',
      subject: 'Cotización sintética de certificación local', messageBody: 'Mensaje sintético QA. Sin cliente real.',
      deliveryMode: 'MANUAL_CONFIRMED', evidence: 'Registro QA controlado; entrega externa no certificada' });
    const sent = await getQuote();
    expect(sent.versiones.some((version: { aprobada: boolean }) => version.aprobada)).toBe(true);
    const sentForViewer = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(viewerAuth) });
    expect(sentForViewer.status()).toBe(200);
    expect((await sentForViewer.json()).versiones.some((version: { aprobada: boolean }) => version.aprobada)).toBe(true);
    await advanceQuote('ACEPTAR', { confirmedActIds: [draft.actos[0].id], formalApplicantId: applicantId,
      reason: 'Aceptación sintética QA controlada; no representa aceptación de cliente real' });
    const accepted = await getQuote();
    expect(accepted.etapa_contractual).toBe('ACEPTADA');
    expect(accepted.conversion.eligible).toBe(true);
    const conversionBody = { expectedVersion: accepted.workflow.version, idempotencyKey: `${marker}:CONVERTIR`,
      confirm: true, effectiveAt: new Date().toISOString(), solicitante_caracter_por_acto: { [draft.actos[0].id]: characterId } };
    const conversion = await request.post(`/api/cotizaciones/${quoteId}/convertir`, { headers: headers(ownerAuth), data: conversionBody });
    expect(conversion.status(), await conversion.text()).toBe(201);
    const expediente = await conversion.json();
    expect(expediente.id).toBeTruthy();
    expect(expediente.numero_pravia).toMatch(/^EXP-\d{4}-\d{4}$/);
    const physical = await db.expediente.findUniqueOrThrow({ where: { id: expediente.id }, include: {
      actos: true, comparecientes: true, cotizacion: { include: { versiones: true } },
    } });
    expect(physical.organization_id).toBe(orgId);
    expect(physical.abogado_id).toBe(ownerAuth.user.id);
    expect(physical.cotizacion_id).toBe(quoteId);
    expect(physical.actos.some((act) => act.tipo_acto_id === actId)).toBe(true);
    expect(physical.comparecientes.some((party) => party.compareciente_id === applicantId)).toBe(true);
    expect(physical.cotizacion?.versiones.some((version) => version.aprobada)).toBe(true);
    const linkedDocument = await db.expedienteDocumento.findFirst({ where: { expediente_id: expediente.id,
      documento_id: prospectDocument.id, estatus: 'ACTIVO' } });
    expect(linkedDocument).toBeTruthy();
    expect(await db.documento.count({ where: { id: prospectDocument.id } })).toBe(1);
    await viewer.goto(`/expedientes?search=${encodeURIComponent(expediente.numero_pravia)}`);
    await expect(viewer.getByText(expediente.numero_pravia).first()).toBeVisible();
    await viewer.goto(`/expedientes/${expediente.id}`);
    await expect(viewer.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue(expediente.numero_pravia);
    expect((await request.get(`/api/documentos/${prospectDocument.id}/url`, { headers: headers(viewerAuth) })).status()).toBe(200);
    const appendix = await request.get(`/api/expedientes/${expediente.id}/documentos/apendice`, { headers: headers(viewerAuth) });
    expect(appendix.status()).toBe(200);
    expect(JSON.stringify(await appendix.json())).toContain(prospectDocument.id);
    const blocked = await request.patch(`/api/expedientes/${expediente.id}`, { headers: headers(viewerAuth),
      data: { cliente_alias: 'Modificación sin permiso QA' } });
    expect(blocked.status()).toBe(403);
    await login(manager, adrian);
    await manager.goto(`/expedientes/${expediente.id}`);
    const selector = manager.getByLabel('Asignar colaborador');
    await expect(selector).toBeVisible();
    const memberId = await selector.getByRole('option', { name: /Javier Tapia/ }).getAttribute('value');
    expect(memberId).toBe(viewerAuth.user.id);
    await selector.selectOption(memberId!);
    await manager.getByRole('button', { name: 'Asignar', exact: true }).click();
    await expect(manager.getByRole('region', { name: 'Colaboradores autorizados' }).getByText('Javier Tapia', { exact: true })).toBeVisible();
    const edited = await request.patch(`/api/expedientes/${expediente.id}`, { headers: headers(viewerAuth),
      data: { cliente_alias: 'Actualizado por Javier en QA' } });
    expect(edited.status(), await edited.text()).toBe(200);
    await viewer.reload();
    await expect(viewer.getByRole('textbox', { name: 'Cliente' })).toHaveValue('Actualizado por Javier en QA');
    await manager.getByRole('button', { name: 'Retirar a Javier Tapia' }).click();
    await expect(manager.getByRole('region', { name: 'Colaboradores autorizados' }).getByText('Javier Tapia', { exact: true })).toHaveCount(0);
    expect((await request.patch(`/api/expedientes/${expediente.id}`, { headers: headers(viewerAuth),
      data: { cliente_alias: 'Intento tras revocación QA' } })).status()).toBe(403);
    expect((await request.get(`/api/expedientes/${expediente.id}`, { headers: headers(viewerAuth) })).status()).toBe(200);
    const retry = await request.post(`/api/cotizaciones/${quoteId}/convertir`, { headers: headers(ownerAuth), data: conversionBody });
    expect(retry.status(), await retry.text()).toBe(200);
    expect((await retry.json()).id).toBe(expediente.id);
    expect(await db.expediente.count({ where: { cotizacion_id: quoteId } })).toBe(1);
    expect(await db.auditLog.count({ where: { organization_id: orgId, entidad_id: expediente.id } })).toBeGreaterThan(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});

test('COL38/COL39/COL40/COL43 · consecutivos EXP comerciales con dos actores y diez conversiones concurrentes', async ({ browser, request }, testInfo) => {
  test.setTimeout(300_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || !/^postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres\?schema=pravia_os$/.test(dbUrl)
    || !alejandro.password || !javier.password) throw new Error('COLLABORATION_EXP_CONCURRENCY_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const context = await browser.newContext({ baseURL: base.toString() });
  const page = await context.newPage();
  try {
    const authResponses = await Promise.all([alejandro, javier].map((credentials) => request.post('/api/auth/login', { data: credentials })));
    authResponses.forEach((response) => expect(response.status()).toBe(200));
    const [alejandroAuth, javierAuth] = await Promise.all(authResponses.map((response) => response.json()));
    const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
    const historicFolios = await db.expediente.findMany({ where: { organization_id: orgId }, select: { id: true, numero_pravia: true } });
    const prepare = async (auth: any, ordinal: number) => {
      const marker = `COL-EXP-SERIES-QA-${Date.now()}-${ordinal}-${randomUUID().slice(0, 8)}`;
      const created = await request.post('/api/prospectos', { headers: { ...headers(auth), 'Idempotency-Key': marker },
        data: { nombre: marker, tipo_acto_ids: [actId] } });
      expect(created.status(), `Prospecto ${ordinal}: ${await created.text()}`).toBe(201);
      const prospect = await created.json();
      for (const [action, extra] of [
        ['COMENZAR_INTEGRACION', {}],
        ['MARCAR_LISTO_PARA_COTIZAR', { quoteAssigneeId: auth.user.id }],
        ['CONVERTIR', {}],
      ] as const) {
        const current = await request.get(`/api/prospectos/${prospect.id}/operacion`, { headers: headers(auth) });
        expect(current.status()).toBe(200);
        const transition = await request.post(`/api/prospectos/${prospect.id}/transiciones`, { headers: headers(auth),
          data: { action, expectedVersion: (await current.json()).version, confirm: true,
            idempotencyKey: `${marker}:${action}`, ...extra } });
        expect(transition.status(), `${action} ${ordinal}: ${await transition.text()}`).toBe(200);
      }
      const quoteRow = await db.cotizacion.findFirstOrThrow({ where: { prospecto_id: prospect.id } });
      const read = async () => {
        const response = await request.get(`/api/cotizaciones/${quoteRow.id}`, { headers: headers(auth) });
        expect(response.status()).toBe(200);
        return response.json();
      };
      const draft = await read();
      const save = await request.put(`/api/cotizaciones/${quoteRow.id}/presupuesto`, { headers: headers(auth),
        data: { expectedUpdatedAt: draft.updated_at, origin: 'MANUAL', concepts: [
          { concepto: `Honorarios QA ${ordinal}`, categoria: 'HONORARIOS', importe: '100.00' },
        ] } });
      expect(save.status(), `Presupuesto ${ordinal}: ${await save.text()}`).toBe(200);
      for (const [action, extra] of [
        ['COMENZAR_ELABORACION', {}],
        ['ENVIAR_CLIENTE', { channel: 'correo', recipient: 'cliente-sintetico@pravia.test',
          subject: 'Cotización sintética de concurrencia', messageBody: 'Mensaje QA sin cliente real.',
          deliveryMode: 'MANUAL_CONFIRMED', evidence: 'Registro QA controlado; entrega externa no certificada' }],
        ['ACEPTAR', { confirmedActIds: [draft.actos[0].id], formalApplicantId: applicantId,
          reason: 'Aceptación sintética QA; no representa aceptación de cliente real' }],
      ] as const) {
        const current = await read();
        const transition = await request.post(`/api/cotizaciones/${quoteRow.id}/acciones`, { headers: headers(auth),
          data: { action, expectedVersion: current.workflow.version, confirm: true,
            idempotencyKey: `${marker}:${action}`, effectiveAt: new Date().toISOString(), ...extra } });
        expect(transition.status(), `${action} ${ordinal}: ${await transition.text()}`).toBe(201);
      }
      const accepted = await read();
      expect(accepted.conversion.eligible).toBe(true);
      return { auth, marker, quoteId: quoteRow.id, actLinkId: draft.actos[0].id,
        version: accepted.workflow.version as number, effectiveAt: new Date().toISOString() };
    };
    const convert = (item: Awaited<ReturnType<typeof prepare>>, series?: string) => request.post(`/api/cotizaciones/${item.quoteId}/convertir`, {
      headers: headers(item.auth), data: { expectedVersion: item.version, idempotencyKey: `${item.marker}:CONVERTIR`,
        confirm: true, effectiveAt: item.effectiveAt, ...(series ? { folio_serie: series } : {}), solicitante_caracter_por_acto: { [item.actLinkId]: characterId } },
    });

    const previous = await db.expediente.findFirst({ where: { organization_id: orgId,
      numero_pravia: { startsWith: 'EXP-' } }, orderBy: { created_at: 'desc' } });
    const next = await prepare(javierAuth, 0);
    const nextResult = await convert(next);
    expect(nextResult.status(), await nextResult.text()).toBe(201);
    const nextCase = await nextResult.json();
    if (previous && /^EXP-\d{4}-2026$/.test(previous.numero_pravia)) {
      expect(Number(nextCase.numero_pravia.slice(4, 8))).toBe(Number(previous.numero_pravia.slice(4, 8)) + 1);
    }
    expect((await db.expediente.findUniqueOrThrow({ where: { id: nextCase.id } })).abogado_id).toBe(javierAuth.user.id);
    await login(page, javier);
    await page.goto(`/expedientes?search=${encodeURIComponent(nextCase.numero_pravia)}`);
    await expect(page.getByText(nextCase.numero_pravia).first()).toBeVisible();

    const batch = [];
    for (let index = 1; index <= 10; index++) batch.push(await prepare(index % 2 ? alejandroAuth : javierAuth, index));
    const doubled = convert(batch[0]);
    const responses = await Promise.all(batch.map((item) => convert(item)).concat(doubled));
    const statuses = responses.map((response) => response.status());
    expect(statuses.filter((status) => status === 201)).toHaveLength(10);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    const cases = await Promise.all(responses.map((response) => response.json()));
    expect(cases[10].id).toBe(cases[0].id);
    const ids = new Set(cases.slice(0, 10).map((item) => item.id));
    const folios = new Set(cases.slice(0, 10).map((item) => item.numero_pravia));
    expect(ids.size).toBe(10);
    expect(folios.size).toBe(10);
    const numbers = [...folios].map((folio) => Number(String(folio).slice(4, 8))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, index) => numbers[0] + index));
    expect(await db.expediente.count({ where: { id: { in: [...ids] }, organization_id: orgId } })).toBe(10);
    for (const item of batch) expect(await db.expediente.count({ where: { cotizacion_id: item.quoteId } })).toBe(1);

    const configured = await db.expedienteFolioSerie.findUnique({ where: { organization_id_code: { organization_id: orgId, code: 'ESP' } } });
    if (!configured) {
      const managerAuth = await request.post('/api/auth/login', { data: adrian });
      expect(managerAuth.status()).toBe(200);
      const created = await request.post('/api/cotizaciones/expediente-series', {
        headers: headers(await managerAuth.json()), data: { code: 'ESP' },
      });
      expect(created.status(), await created.text()).toBe(201);
    }
    const year = new Date().getFullYear();
    const beforeEsp = await db.folioCounter.findUnique({ where: { organization_id_kind_series_year: {
      organization_id: orgId, kind: 'EXP', series: 'ESP', year,
    } } });
    const beforeOrdinary = await db.folioCounter.findUniqueOrThrow({ where: { organization_id_kind_series_year: {
      organization_id: orgId, kind: 'EXP', series: 'EXP', year,
    } } });
    const espReady = await Promise.all([
      prepare(alejandroAuth, 101), prepare(javierAuth, 102), prepare(alejandroAuth, 103),
    ]);
    const espResponses = await Promise.all(espReady.map((item) => convert(item, 'ESP')));
    espResponses.forEach((response) => expect(response.status()).toBe(201));
    const espCases = await Promise.all(espResponses.map((response) => response.json()));
    expect(new Set(espCases.map((item) => item.numero_pravia)).size).toBe(3);
    const espNumbers = espCases.map((item) => Number(String(item.numero_pravia).split('-')[2])).sort((a, b) => a - b);
    expect(espNumbers).toEqual(Array.from({ length: 3 }, (_, index) => (beforeEsp?.last_value ?? 0) + index + 1));
    for (const item of espCases) {
      expect(item.numero_pravia).toMatch(/^EXP-ESP-\d{4}-\d{4}$/);
      const apiCase = await request.get(`/api/expedientes/${item.id}`, { headers: headers(alejandroAuth) });
      expect(apiCase.status()).toBe(200);
      expect((await apiCase.json()).numero_pravia).toBe(item.numero_pravia);
      expect((await db.expediente.findUniqueOrThrow({ where: { id: item.id } })).numero_pravia).toBe(item.numero_pravia);
    }
    const afterOrdinary = await db.folioCounter.findUniqueOrThrow({ where: { organization_id_kind_series_year: {
      organization_id: orgId, kind: 'EXP', series: 'EXP', year,
    } } });
    expect(afterOrdinary.last_value).toBe(beforeOrdinary.last_value);
    await page.goto(`/expedientes/${espCases[0].id}`);
    await expect(page.getByRole('textbox', { name: 'Número de expediente' })).toHaveValue(espCases[0].numero_pravia);
    await expect(db.expediente.create({ data: { organization_id: orgId, numero_pravia: espCases[0].numero_pravia,
      abogado_id: alejandroAuth.user.id, creador_id: alejandroAuth.user.id } })).rejects.toMatchObject({ code: 'P2002' });
    const oldRows = await db.expediente.findMany({ where: { id: { in: historicFolios.map((row) => row.id) } }, select: { id: true, numero_pravia: true } });
    expect(new Map(oldRows.map((row) => [row.id, row.numero_pravia]))).toEqual(new Map(historicFolios.map((row) => [row.id, row.numero_pravia])));
  } finally {
    await context.close();
    await db.$disconnect();
  }
});
