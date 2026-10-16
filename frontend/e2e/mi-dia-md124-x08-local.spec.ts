import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, request as requestFactory, test, type APIRequestContext, type Page } from '@playwright/test';

const container = 'pravia-new-lot-qa-20260926';
const sql = (statement: string) => execFileSync('docker', [
  'exec', container, 'psql', '-U', 'pravia', '-d', 'pravia_qa', '-Atc', statement,
], { encoding: 'utf8' }).trim();

type Headers = { Authorization: string };
type LayoutItem = { key: string; size: string; scope: string; parameters: Record<string, string | number>; fixed?: boolean };
type DetailItem = { id: string; amount?: string };
type Detail = { key: string; scope: string; totalCount: number; totalAmount?: string; page: number; pageSize: number;
  totalPages: number; available: boolean; items: DetailItem[] };

const cents = (value: string | number) => {
  const [units, fraction = ''] = String(value).split('.');
  return BigInt(units) * 100n + BigInt((fraction + '00').slice(0, 2));
};

async function login(api: APIRequestContext, email: string, password: string): Promise<Headers> {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  expect(response.status(), `${email}: login`).toBe(200);
  return { Authorization: `Bearer ${(await response.json() as { access_token: string }).access_token}` };
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  await expect(emailInput).toBeVisible();
  await passwordInput.fill(password);
  await emailInput.fill(email);
  await expect(emailInput).toHaveValue(email);
  await expect(passwordInput).toHaveValue(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-dia$/);
}

test('MD124: KPI y detalle canónico paginado reconcilian en Chrome, móvil y alcance persistido', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MD124_LOCAL_ONLY');
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const headers = await login(api, 'adrian.hernandez@pravia.test', password);
  const readConfig = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: { layout: LayoutItem[]; layoutVersion: number; personalized: boolean;
      catalog: Array<{ key: string; defaultSize: string; allowedScopes: string[] }> } }).data;
  };
  const original = await readConfig();
  const required = ['CASES', 'OVERDUE_PROCESSES', 'UPCOMING_SIGNINGS', 'RECEIVABLE', 'INCOME_COLLECTED',
    'INVOICES_PENDING', 'QUOTES_ACTIVE_VALUE', 'PLD_INCOMPLETE', 'NOTICES_PENDING', 'DEEDS_TODAY'];
  try {
    const byKey = new Map(original.layout.map((item) => [item.key, item]));
    const catalog = new Map(original.catalog.map((item) => [item.key, item]));
    for (const key of required) {
      const definition = catalog.get(key);
      if (!definition) continue;
      const current = byKey.get(key);
      byKey.set(key, { key, size: current?.size || definition.defaultSize,
        scope: key === 'CASES' && definition.allowedScopes.includes('OWN') ? 'OWN' : current?.scope
          || (definition.allowedScopes.includes('ORGANIZATION') ? 'ORGANIZATION' : definition.allowedScopes[0]),
        parameters: current?.parameters || {} });
    }
    const saved = await api.put('/api/mi-dia/layout', { headers, data: { version: original.layoutVersion, layout: [...byKey.values()] } });
    expect(saved.status(), await saved.text()).toBe(200);
    const dashboardResponse = await api.get('/api/mi-dia', { headers });
    expect(dashboardResponse.status()).toBe(200);
    const dashboard = await dashboardResponse.json() as any;
    const expected = new Map<string, { count: number; amount?: string }>();
    expected.set('CASES', { count: dashboard.metricas.expedientes_total });
    expected.set('UPCOMING_SIGNINGS', { count: dashboard.metricas.firmas_proximas });
    expected.set('RECEIVABLE', { count: dashboard.metricas.cobros_pendientes, amount: Number(dashboard.metricas.saldo_pendiente_total).toFixed(2) });
    for (const key of ['OVERDUE_PROCESSES']) {
      const value = dashboard.operacion.procesos[key]; if (value) expected.set(key, { count: value.count, amount: value.amount });
    }
    for (const key of ['INCOME_COLLECTED', 'INVOICES_PENDING']) {
      const value = dashboard.operacion.finanzas_cards[key]; if (value) expected.set(key, { count: value.count, amount: value.amount });
    }
    const quoteValue = dashboard.operacion.comercial_cards.QUOTES_ACTIVE_VALUE;
    if (quoteValue) expected.set('QUOTES_ACTIVE_VALUE', { count: quoteValue.count, amount: quoteValue.amount });
    const compliance = dashboard.operacion.cumplimiento_cards.PLD_INCOMPLETE;
    if (compliance) expected.set('PLD_INCOMPLETE', { count: compliance.count });
    const notices = dashboard.operacion.cumplimiento_cards.NOTICES_PENDING;
    if (catalog.has('NOTICES_PENDING')) {
      expect(notices).toMatchObject({ count: 0, items: [] });
      expected.set('NOTICES_PENDING', { count: 0 });
    }
    const deeds = dashboard.operacion.archivo_cards.DEEDS_TODAY;
    if (deeds) expected.set('DEEDS_TODAY', { count: Number(deeds.value ?? deeds.count ?? 0) });

    expect(expected.has('CASES')).toBe(true);
    expect(expected.has('RECEIVABLE')).toBe(true);
    expect(expected.has('INCOME_COLLECTED')).toBe(true);
    expect(expected.has('INVOICES_PENDING')).toBe(true);
    for (const [key, metric] of expected) {
      const all: DetailItem[] = [];
      let canonical: Detail | null = null;
      for (let pageNumber = 1; ; pageNumber += 1) {
        const response = await api.get(`/api/mi-dia/cards/${key}/detail?page=${pageNumber}&page_size=5&scope=ORGANIZATION`, { headers });
        expect(response.status(), `${key}: detalle página ${pageNumber}`).toBe(200);
        const detail = (await response.json() as { data: Detail }).data;
        canonical ||= detail;
        expect(detail.totalCount).toBe(metric.count);
        all.push(...detail.items);
        if (pageNumber >= detail.totalPages) break;
      }
      expect(all).toHaveLength(metric.count);
      expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
      if (metric.amount !== undefined) {
        expect(canonical!.totalAmount).toBe(metric.amount);
        expect(all.reduce((sum, item) => sum + cents(item.amount || '0.00'), 0n)).toBe(cents(metric.amount));
      }
      if (key === 'CASES') expect(canonical!.scope).toBe('OWN');
    }

    await uiLogin(page, 'adrian.hernandez@pravia.test', password);
    const invoiceCard = () => page.locator('[class*="boardItem"]').filter({
      has: page.getByRole('heading', { name: 'Facturas pendientes', exact: true }),
    }).first();
    await invoiceCard().getByRole('button', { name: 'Ver detalle paginado' }).click();
    const dialog = page.getByRole('dialog', { name: /Facturas pendientes/ });
    const invoiceCount = expected.get('INVOICES_PENDING')!.count;
    const invoicePages = Math.max(1, Math.ceil(invoiceCount / 20));
    await expect(dialog).toContainText(`de ${invoiceCount}`);
    await expect(dialog.getByText(`Página 1 de ${invoicePages}`)).toBeVisible();
    if (invoicePages > 1) {
      await dialog.getByRole('button', { name: /Siguiente/ }).click();
      await expect(dialog.getByText(`Página 2 de ${invoicePages}`)).toBeVisible();
    }
    await page.reload();
    await expect(page).toHaveURL(/\/mi-dia$/);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await invoiceCard().getByRole('button', { name: 'Ver detalle paginado' }).click();
      await expect(page.getByRole('dialog', { name: /Facturas pendientes/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const buttons = page.getByRole('dialog').getByRole('button');
      for (let index = 0; index < await buttons.count(); index += 1) expect((await buttons.nth(index).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Cerrar detalle' }).click();
    }
  } finally {
    const current = await readConfig();
    const restore = original.personalized
      ? api.put('/api/mi-dia/layout', { headers, data: { version: current.layoutVersion, layout: original.layout } })
      : api.delete('/api/mi-dia/layout', { headers });
    expect((await restore).status()).toBe(200);
    await api.dispose();
  }
});

test('X08: validación humana persiste, audita y deniega usuario/tenant no autorizados', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const adrianPassword = process.env.PRAVIA_E2E_PASSWORD || '';
  const rosaPassword = process.env.PRAVIA_USER_ROSA_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !adrianPassword || !rosaPassword) throw new Error('X08_LOCAL_ONLY');
  const fixtureCaseId = randomUUID();
  const fixtureRelationId = randomUUID();
  const fixtureSuffix = Date.now().toString(36).toUpperCase();
  sql(`INSERT INTO pravia_os.expedientes
    (id, organization_id, numero_pravia, tipo_acto_id, abogado_id, creador_id, cliente_alias, estatus,
      fecha_apertura, fecha_estimada_firma, flujo_version_id, notaria_id, etapa_actual_nombre, version, created_at, updated_at)
    SELECT '${fixtureCaseId}', e.organization_id, 'EXP-X08-${fixtureSuffix}', e.tipo_acto_id, e.abogado_id, e.creador_id,
      'QA X08 Firma', 'EN_PROCESO', now(), now(), e.flujo_version_id, e.notaria_id, 'En proceso', 1, now(), now()
    FROM pravia_os.expedientes e
    WHERE e.id='506e92b0-e41d-447d-a1bd-f520ec633211'`);
  sql(`INSERT INTO pravia_os.expediente_comparecientes
    (id, organization_id, expediente_id, compareciente_id, caracter_id, forma_comparecencia,
      orden_comparecencia, es_principal, estatus, creado_por_id, datos_validados, created_at, updated_at)
    SELECT '${fixtureRelationId}', ep.organization_id, '${fixtureCaseId}', ep.compareciente_id, ep.caracter_id,
      ep.forma_comparecencia, 1, true, 'ACTIVO', ep.creado_por_id, false, now(), now()
    FROM pravia_os.expediente_comparecientes ep
    WHERE ep.expediente_id='506e92b0-e41d-447d-a1bd-f520ec633211' AND ep.estatus='ACTIVO'
    ORDER BY ep.created_at ASC LIMIT 1`);
  const candidate = sql(`SELECT ep.expediente_id || '|' || ep.id || '|' || replace(c.nombre_busqueda, '|', ' ') FROM pravia_os.expediente_comparecientes ep
    JOIN pravia_os.comparecientes c ON c.id=ep.compareciente_id AND c.organization_id=ep.organization_id
    WHERE ep.expediente_id='${fixtureCaseId}' AND ep.id='${fixtureRelationId}'`);
  const [caseId, relationId, partyName] = candidate.split('|');
  expect(caseId).toMatch(/^[0-9a-f-]{36}$/); expect(relationId).toMatch(/^[0-9a-f-]{36}$/);
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const adrian = await login(api, 'adrian.hernandez@pravia.test', adrianPassword);
  const configResponse = await api.get('/api/mi-dia/config', { headers: adrian });
  expect(configResponse.status()).toBe(200);
  const originalConfig = (await configResponse.json() as { data: { layout: LayoutItem[]; layoutVersion: number;
    personalized: boolean; catalog: Array<{ key: string; defaultSize: string; allowedScopes: string[] }> } }).data;
  if (!originalConfig.layout.some((item) => item.key === 'SIGNED_TODAY')) {
    const definition = originalConfig.catalog.find((item) => item.key === 'SIGNED_TODAY')!;
    const saved = await api.put('/api/mi-dia/layout', { headers: adrian, data: { version: originalConfig.layoutVersion,
      layout: [...originalConfig.layout, { key: 'SIGNED_TODAY', size: definition.defaultSize,
        scope: definition.allowedScopes.includes('OWN') ? 'OWN' : definition.allowedScopes[0], parameters: {} }] } });
    expect(saved.status(), await saved.text()).toBe(200);
  }
  const scheduledAt = new Date(Date.now() - 60_000).toISOString();
  const blockedSchedule = await api.post(`/api/expedientes/${caseId}/transicion-estatus`, {
    headers: adrian,
    data: { expected_version: 1, nuevo_estatus: 'FIRMA_PROGRAMADA', datos_firma: { fecha_firma: scheduledAt, lugar: 'Notaría QA' } },
  });
  expect(blockedSchedule.status()).toBe(400);
  expect((await blockedSchedule.json() as { error: string }).error).toContain('datos sin validar');
  const rosa = await login(api, 'rosa.becerra@pravia.test', rosaPassword);
  const denied = await api.post(`/api/expedientes/${caseId}/comparecientes/${relationId}/validar-datos`, {
    headers: { ...rosa, 'Idempotency-Key': `x08-denied-${Date.now()}` }, data: { confirmed: true },
  });
  expect(denied.status()).toBe(403);
  const foreign = sql(`SELECT ep.expediente_id || '|' || ep.id FROM pravia_os.expediente_comparecientes ep
    WHERE ep.organization_id <> '30000000-0000-4000-8000-000000000001' ORDER BY ep.created_at DESC LIMIT 1`);
  if (foreign) {
    const [foreignCase, foreignRelation] = foreign.split('|');
    const crossTenant = await api.post(`/api/expedientes/${foreignCase}/comparecientes/${foreignRelation}/validar-datos`, {
      headers: { ...adrian, 'Idempotency-Key': `x08-tenant-${Date.now()}` }, data: { confirmed: true },
    });
    expect([403, 404]).toContain(crossTenant.status());
  }

  await uiLogin(page, 'adrian.hernandez@pravia.test', adrianPassword);
  await page.goto(`/expedientes/${caseId}#comparecientes`);
  const action = page.locator('article').filter({ hasText: partyName }).getByRole('button', { name: 'Confirmar datos revisados' }).first();
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.getByRole('dialog', { name: /Confirmar datos revisados/ })).toBeVisible();
  const response = page.waitForResponse((item) => item.url().includes(`/comparecientes/${relationId}/validar-datos`) && item.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmar revisión' }).click();
  expect([200, 201]).toContain((await response).status());
  await expect(page.getByText(/Validada ·/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Validada ·/).first()).toBeVisible();
  expect(sql(`SELECT datos_validados || '|' || (validado_at IS NOT NULL) FROM pravia_os.expediente_comparecientes WHERE id='${relationId}'`)).toBe('true|true');
  expect(Number(sql(`SELECT count(*) FROM pravia_os.audit_logs WHERE entidad='ExpedienteCompareciente' AND entidad_id='${relationId}' AND accion='VALIDATE_EXPEDIENTE_PARTY_DATA'`))).toBe(1);
  const scheduled = await api.post(`/api/expedientes/${caseId}/transicion-estatus`, {
    headers: adrian,
    data: { expected_version: 1, nuevo_estatus: 'FIRMA_PROGRAMADA', datos_firma: { fecha_firma: scheduledAt, lugar: 'Notaría QA' } },
  });
  expect(scheduled.status(), await scheduled.text()).toBe(200);

  await page.goto(`/expedientes/${caseId}#seguimiento`);
  await page.reload();
  const signButton = page.getByRole('button', { name: 'Firmado', exact: true });
  await expect(signButton).toBeVisible();
  await signButton.click();
  const signatureDialog = page.getByRole('dialog', { name: 'Registrar firma efectiva' });
  await expect(signatureDialog).toContainText('Listo para firma');
  const effectiveAt = new Date(Date.now() - 30_000).toISOString().slice(0, 16);
  await signatureDialog.locator('input[type="datetime-local"]').fill(effectiveAt);
  const signatureResponse = page.waitForResponse((item) => item.url().endsWith(`/api/expedientes/${caseId}/transicion-estatus`)
    && item.request().method() === 'POST' && item.request().postData()?.includes('FIRMADO'));
  await signatureDialog.getByRole('button', { name: 'Registrar firma y congelar apéndice' }).click();
  expect((await signatureResponse).status()).toBe(200);
  await expect(page.getByText('Firmado', { exact: true }).first()).toBeVisible();
  await page.reload();
  expect(sql(`SELECT estatus || '|' || (fecha_real_firma IS NOT NULL) FROM pravia_os.expedientes WHERE id='${caseId}'`)).toBe('FIRMADO|true');
  const dashboardResponse = await api.get('/api/mi-dia', { headers: adrian });
  expect(dashboardResponse.status()).toBe(200);
  const signedToday = (await dashboardResponse.json() as any).operacion.firma_cards.SIGNED_TODAY;
  expect(signedToday.items.map((item: { id: string }) => item.id)).toContain(caseId);
  const currentConfig = (await (await api.get('/api/mi-dia/config', { headers: adrian })).json() as { data: { layoutVersion: number } }).data;
  const restore = originalConfig.personalized
    ? api.put('/api/mi-dia/layout', { headers: adrian, data: { version: currentConfig.layoutVersion, layout: originalConfig.layout } })
    : api.delete('/api/mi-dia/layout', { headers: adrian });
  expect((await restore).status()).toBe(200);
  await api.dispose();
});
