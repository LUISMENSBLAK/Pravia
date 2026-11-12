import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const quoteId = 'e9549c97-05d7-47ad-b3ad-7be329ac33d1';
const act = 'ACTO SINTÉTICO COLABORACIÓN QA 20261027';
const priorQaFixture = { id: '22b3e59e-e7e9-40f2-b3c0-d623c6ff01b5', code: 'QA-ARANCEL-1794336044045' };

async function suspendPriorFixture(db: PrismaClient, organizationId: string) {
  const changed = await db.knowledgeCriterion.updateMany({
    where: { ...priorQaFixture, organization_id: organizationId, active: true }, data: { active: false },
  });
  return async () => {
    if (changed.count === 1) await db.knowledgeCriterion.updateMany({
      where: { ...priorQaFixture, organization_id: organizationId, active: false }, data: { active: true },
    });
  };
}

async function login(page: Page, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function confirmTerritory(page: Page, state = 'Nayarit', municipality = 'Tepic') {
  await page.getByLabel('Jurisdicción de la operación').fill('Nayarit');
  await page.getByLabel('Estado de la operación').fill(state);
  await page.getByLabel('Municipio de la operación').fill(municipality);
  await page.getByRole('checkbox', { name: /Confirmo el territorio/ }).check();
  const saving = page.waitForResponse((response) => response.url().endsWith(`/api/cotizaciones/${quoteId}/presupuesto`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Confirmar territorio', exact: true }).click();
  const response = await saving;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole('checkbox', { name: /Confirmo el territorio/ })).not.toBeChecked();
}

test('NOV-COT-01..06 · arancel interno versionado alimenta propuesta trazable sin alterar el presupuesto', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os') {
    throw new Error('NOV_KNOWLEDGE_QUOTE_LOCAL_SAFETY_GATE_FAILED');
  }

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const marker = Date.now();
  const code = `QA-ARANCEL-${marker}`;
  const title = `Honorarios QA biblioteca ${marker}`;
  let criterionId = '';
  let proposalId = '';
  let restoreFixture = async () => {};
  try {
    const before = await db.cotizacion.findUniqueOrThrow({
      where: { id: quoteId },
      select: { organization_id: true, total_cliente: true, conceptos: { orderBy: { orden: 'asc' } } },
    });
    expect(before.organization_id).toBeTruthy();
    restoreFixture = await suspendPriorFixture(db, before.organization_id!);
    expect(before.conceptos).toHaveLength(0);
    await login(page, password);

    await page.goto('/configuracion/biblioteca-conocimiento');
    await page.getByRole('button', { name: 'CRITERIOS INTERNOS', exact: true }).click();
    await page.getByRole('button', { name: 'Registrar criterio o arancel propio' }).click();
    const create = page.getByRole('dialog', { name: 'Registrar criterio interno' });
    await create.getByLabel('Código').fill(code);
    await create.getByLabel('Tipo').selectOption('ARANCEL_PROPIO');
    await create.getByLabel('Título').fill(title);
    await create.getByLabel('Regla, tabla o fórmula').fill('Honorario fijo interno de QA. No constituye norma ni tarifa oficial.');
    await create.getByLabel('Jurisdicción').fill('NAYARIT');
    await create.getByLabel('Estado').fill('Nayarit');
    await create.getByLabel('Municipio').fill('Tepic');
    await create.getByLabel('Acto aplicable').fill(act);
    await create.getByLabel('Vigente desde').fill('2026-01-01');
    await create.getByLabel('Fuente interna').fill('Acuerdo interno sintético de QA');
    await create.getByLabel('Autor / aprobador').fill('Dirección QA');
    await create.getByLabel('Honorario fijo MXN').fill('4321.00');
    await create.getByLabel('Revisión').selectOption('REVISADO');
    await create.getByLabel('Aprobación').selectOption('APROBADO');
    const creation = page.waitForResponse((response) => response.url().endsWith('/api/settings/knowledge/criteria')
      && response.request().method() === 'POST');
    await create.getByRole('button', { name: 'Guardar versión' }).click();
    const created = await creation;
    expect(created.status(), await created.text()).toBe(201);
    criterionId = (await created.json()).data.id;

    await page.reload();
    await page.getByRole('button', { name: 'CRITERIOS INTERNOS', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(title) }).click();
    const detail = page.getByRole('article').filter({ hasText: title });
    await expect(detail.getByText('CRITERIO INTERNO — NO ES NORMA.', { exact: true })).toBeVisible();
    await expect(detail.getByText('ARANCEL PROPIO · V1', { exact: true })).toBeVisible();
    await expect(detail.getByText('$4,321.00 MXN', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Editar y crear nueva versión' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar criterio interno' });
    await expect(edit.getByLabel('Código')).toBeDisabled();
    await edit.getByLabel('Honorario fijo MXN').fill('4322.00');
    const update = page.waitForResponse((response) => response.url().endsWith(`/api/settings/knowledge/criteria/${criterionId}`)
      && response.request().method() === 'PATCH');
    await edit.getByRole('button', { name: 'Guardar versión' }).click();
    const updated = await update;
    expect(updated.status(), await updated.text()).toBe(200);
    await expect(detail.getByText('ARANCEL PROPIO · V2', { exact: true })).toBeVisible();
    await expect(detail.getByText('$4,322.00 MXN', { exact: true })).toBeVisible();

    await page.goto(`/cotizaciones/${quoteId}`);
    await expect(page.getByRole('heading', { name: 'COT-0070-2026' })).toBeVisible();
    await confirmTerritory(page);
    await page.reload();
    await expect(page.getByLabel('Municipio de la operación')).toHaveValue('TEPIC');
    for (const width of [1440,1366,1024,768,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.getByLabel('Jurisdicción de la operación').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const input = await page.getByLabel('Municipio de la operación').boundingBox();
      expect(input).not.toBeNull(); expect(input!.x).toBeGreaterThanOrEqual(0); expect(input!.x + input!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path:testInfo.outputPath(`quote-territory-${width}.png`) });
    }
    await page.setViewportSize({width:1440,height:900});
    const confirmed = await db.cotizacion.findUniqueOrThrow({ where:{ id:quoteId } });
    expect(confirmed.territorio_operacion).toMatchObject({ jurisdiction:'NAYARIT',state:'NAYARIT',municipality:'TEPIC',confirmedById:expect.any(String),confirmedAt:expect.any(String) });
    const generation = page.waitForResponse((response) => response.url().endsWith(`/api/cotizaciones/${quoteId}/propuestas-ia`)
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generar cotización con IA' }).click();
    const generated = await generation;
    expect(generated.status(), await generated.text()).toBe(201);
    const payload = await generated.json();
    proposalId = payload.data.id;
    expect(payload.data.model_version).toBe('PRAVIA-COT-IA-001/layered-v3');
    expect(payload.data.evidence_packet.operation_territory).toEqual(confirmed.territorio_operacion);
    expect(payload.data.proposal.concepts).toEqual([expect.objectContaining({
      categoria: 'HONORARIOS', concepto: title, importe: 4322,
      explanation: expect.objectContaining({ layer: 'CRITERIO_INTERNO_APROBADO', criterion_id: criterionId, version: 2 }),
    })]);
    expect(payload.data.evidence_packet.layers.internal_policy).toEqual([
      expect.objectContaining({ criterion_id: criterionId, code, label: 'CRITERIO INTERNO — NO ES NORMA.' }),
    ]);
    expect(payload.data.evidence_packet.taxes_notice).toContain('no se estiman libremente');

    const proposal = page.getByRole('region', { name: 'Propuesta de cotización con IA' });
    await expect(proposal.getByText(title, { exact: true })).toBeVisible();
    await expect(proposal.getByText('$4,322.00', { exact: true })).toBeVisible();
    await expect(proposal.getByText('CRITERIO INTERNO — NO ES NORMA.', { exact: true })).toBeVisible();
    await expect(proposal.getByText(/Impuestos, derechos e ISR no se estiman libremente/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Propuesta de cotización con IA' })).toBeVisible();

    // A changed municipality invalidates the existing proposal before any budget write.
    await confirmTerritory(page, 'Nayarit', 'Bahía de Banderas');
    const authResponse = await page.request.post('/api/auth/login', { data:{ email:'adrian.hernandez@pravia.test',password } });
    expect(authResponse.status()).toBe(200);
    const auth = await authResponse.json();
    const headers = { Authorization:`Bearer ${auth.access_token}` };
    const stale = await page.request.patch(`/api/cotizaciones/${quoteId}/propuestas-ia/${proposalId}`, { headers,data:{ action:'APLICAR' } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe('QUOTE_AI_STALE');
    const mismatch = await page.request.post(`/api/cotizaciones/${quoteId}/propuestas-ia`, { headers,data:{ idempotency_key:`territory-mismatch-${marker}` } });
    expect(mismatch.status()).toBe(201);
    const mismatchedProposal = (await mismatch.json()).data;
    expect(mismatchedProposal.evidence_packet.layers.internal_policy).toEqual([]);
    expect(mismatchedProposal.proposal.concepts.every((row: { explanation:{ layer:string } }) => row.explanation.layer === 'HISTORICO_VALIDADO')).toBe(true);
    expect((await page.request.patch(`/api/cotizaciones/${quoteId}/propuestas-ia/${mismatchedProposal.id}`, { headers,data:{ action:'DESCARTAR' } })).status()).toBe(200);
    await confirmTerritory(page);

    const discard = page.waitForResponse((response) => response.url().endsWith(`/api/cotizaciones/${quoteId}/propuestas-ia/${proposalId}`)
      && response.request().method() === 'PATCH');
    await page.getByRole('region', { name: 'Propuesta de cotización con IA' }).getByRole('button', { name: 'Descartar', exact: true }).click();
    const discarded = await discard;
    expect(discarded.status(), await discarded.text()).toBe(200);
    await expect(page.getByRole('region', { name: 'Propuesta de cotización con IA' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Propuesta de cotización con IA' })).toHaveCount(0);

    const [criterion, storedProposal, after, audits] = await Promise.all([
      db.knowledgeCriterion.findUniqueOrThrow({ where: { id: criterionId } }),
      db.cotizacionIAProposal.findUniqueOrThrow({ where: { id: proposalId } }),
      db.cotizacion.findUniqueOrThrow({ where: { id: quoteId }, select: { total_cliente: true, conceptos: true } }),
      db.auditLog.findMany({ where: { entidad_id: { in: [criterionId, proposalId] } }, orderBy: { created_at: 'asc' } }),
    ]);
    expect(criterion.scope).toMatchObject({ kind: 'ARANCEL_PROPIO', approval_status: 'APROBADO', review_status: 'REVISADO',
      act, fixed_honorarium: '4322.00', version: 2, source: 'Acuerdo interno sintético de QA', author: 'Dirección QA' });
    expect(storedProposal.status).toBe('DESCARTADA');
    expect(after.conceptos).toEqual(before.conceptos);
    expect(String(after.total_cliente)).toBe(String(before.total_cliente));
    expect(audits.map((item) => item.accion)).toEqual(expect.arrayContaining([
      'CREAR_CRITERIO_INTERNO_CONOCIMIENTO', 'ACTUALIZAR_CRITERIO_INTERNO_CONOCIMIENTO',
      'GENERAR_PROPUESTA_COTIZACION_IA', 'DESCARTAR_PROPUESTA_COTIZACION_IA',
    ]));
    expect(audits.find((item) => item.accion === 'GENERAR_PROPUESTA_COTIZACION_IA')?.detalles).toMatchObject({ persisted_to_budget: false });
    expect(audits.find((item) => item.accion === 'DESCARTAR_PROPUESTA_COTIZACION_IA')?.detalles).toMatchObject({ budget_changed: false });
    expect(await db.auditLog.count({ where:{ organization_id:before.organization_id!,entidad_id:quoteId,accion:'QUOTE_OPERATION_TERRITORY_CONFIRMED' } })).toBeGreaterThanOrEqual(3);
  } finally {
    try {
      if (criterionId) await db.knowledgeCriterion.updateMany({
        where: { id: criterionId, code }, data: { active: false },
      });
    } finally { try { await restoreFixture(); } finally { await db.$disconnect(); } }
  }
});

test('NOV-COT-07 · sin Biblioteca activa propone honorarios del histórico validado', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.origin !== 'http://127.0.0.1:5176' || !password
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os') {
    throw new Error('NOV_KNOWLEDGE_QUOTE_LOCAL_SAFETY_GATE_FAILED');
  }
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  // Prior synthetic fixture from the first certification run. Never deactivate
  // tenant configuration that did not originate from this local QA run.
  let restoreFixture = async () => {};
  try {
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.numero_cotizacion).toBe('COT-0070-2026');
    const organizationId = quote.organization_id!;
    expect(await db.knowledgeSource.count({ where: { organization_id: organizationId, active: true } })).toBe(0);
    restoreFixture = await suspendPriorFixture(db, organizationId);
    expect(await db.knowledgeCriterion.count({ where: { organization_id: organizationId, active: true } })).toBe(0);

    await login(page, password);
    await page.goto(`/cotizaciones/${quoteId}`);
    const generation = page.waitForResponse((response) => response.url().endsWith(`/api/cotizaciones/${quoteId}/propuestas-ia`)
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generar cotización con IA' }).click();
    const generated = await generation;
    expect(generated.status()).toBe(201);
    const { data } = await generated.json();
    expect(data.evidence_packet.layers).toMatchObject({ internal_policy: [], tariff: [],
      validated_comparables: { organization_id: organizationId, act } });
    expect(data.evidence_packet.layers.validated_comparables.sample_quotes).toBeGreaterThan(0);
    expect(data.proposal.concepts.length).toBeGreaterThan(0);
    for (const concept of data.proposal.concepts) expect(concept).toMatchObject({
      categoria: 'HONORARIOS', explanation: { layer: 'HISTORICO_VALIDADO' },
    });
    const panel = page.getByRole('region', { name: 'Propuesta de cotización con IA' });
    await expect(panel.getByText(/cotización\(es\) comparables/)).toBeVisible();
    const discard = page.waitForResponse((response) => response.url().endsWith(`/api/cotizaciones/${quoteId}/propuestas-ia/${data.id}`)
      && response.request().method() === 'PATCH');
    await panel.getByRole('button', { name: 'Descartar', exact: true }).click();
    expect((await discard).status()).toBe(200);
    expect(await db.cotizacionConcepto.count({ where: { cotizacion_id: quoteId } })).toBe(0);
    expect((await db.cotizacionIAProposal.findUniqueOrThrow({ where: { id: data.id } })).status).toBe('DESCARTADA');
  } finally {
    try { await restoreFixture(); } finally { await db.$disconnect(); }
  }
});
