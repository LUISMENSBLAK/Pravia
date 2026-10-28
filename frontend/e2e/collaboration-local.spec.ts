import { expect, test, type Page } from '@playwright/test';

const director = { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' };
const colleague = { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' };
const alejandro = { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' };
const maria = { email: 'maria.careaga@pravia.test', password: process.env.PRAVIA_E2E_MARIA_PASSWORD || '' };
const rosa = { email: 'rosa.becerra@pravia.test', password: process.env.PRAVIA_E2E_ROSA_PASSWORD || '' };

async function login(page: Page, credentials: typeof director) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeVisible();
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

test('COL12/COL14/COL15/COL31/COL32/COL70 · lectura compartida y edición revocable en Chrome local', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !director.password || !colleague.password) {
    throw new Error('COLLABORATION_LOCAL_CHROME_SAFETY_GATE_FAILED');
  }
  const directorContext = await browser.newContext({ baseURL: base.toString() });
  const colleagueContext = await browser.newContext({ baseURL: base.toString() });
  const owner = await directorContext.newPage();
  const viewer = await colleagueContext.newPage();
  let id = '';
  let token = '';
  try {
    const auth = await request.post('/api/auth/login', { data: director });
    expect(auth.status()).toBe(200);
    token = (await auth.json()).access_token;
    expect(token).toEqual(expect.any(String));
    const marker = `COLLAB-QA-${Date.now()}`;
    const created = await request.post('/api/prospectos', {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': marker }, data: { nombre: marker },
    });
    expect(created.status()).toBe(201);
    id = (await created.json()).id;

    await login(owner, director);
    await login(viewer, colleague);
    await viewer.goto(`/prospectos/${id}`);
    await expect(viewer.getByText(marker, { exact: true }).first()).toBeVisible();
    await expect(viewer.getByText('Colaboradores', { exact: true })).toBeVisible();
    const colleagueLogin = await request.post('/api/auth/login', { data: colleague });
    expect(colleagueLogin.status()).toBe(200);
    const colleagueToken = (await colleagueLogin.json()).access_token as string;
    const headers = { Authorization: `Bearer ${colleagueToken}` };
    expect((await request.put(`/api/prospectos/${id}`, { headers, data: { telefono: '5555550000' } })).status()).toBe(403);

    await owner.goto(`/prospectos/${id}`);
    const selector = owner.getByLabel('Asignar colaborador');
    await expect(selector).toBeVisible();
    const optionValue = await selector.getByRole('option', { name: /Javier Tapia/ }).getAttribute('value');
    expect(optionValue).toBeTruthy();
    await selector.selectOption(optionValue!);
    await owner.getByRole('button', { name: 'Asignar', exact: true }).click();
    await expect(owner.getByText('Javier Tapia', { exact: true })).toBeVisible();
    for (const width of [390, 320]) {
      await owner.setViewportSize({ width, height: 844 });
      await expect(owner.getByLabel('Asignar colaborador')).toBeVisible();
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await owner.setViewportSize({ width: 1280, height: 800 });
    await viewer.reload();
    const sharedRecord = await request.get(`/api/prospectos/${id}`, { headers });
    expect(sharedRecord.status()).toBe(200);
    const version = (await sharedRecord.json()).version_operativa as number;
    expect((await request.put(`/api/prospectos/${id}`, { headers, data: { telefono: '5555550001', expectedVersion: version } })).status()).toBe(200);
    await owner.getByRole('button', { name: 'Retirar a Javier Tapia' }).click();
    await expect(owner.getByText('Javier Tapia', { exact: true })).toHaveCount(0);
    expect((await request.put(`/api/prospectos/${id}`, { headers, data: { telefono: '5555550002' } })).status()).toBe(403);
    await viewer.reload();
    await expect(viewer.getByText(marker, { exact: true }).first()).toBeVisible();
  } finally {
    if (id && token) await request.delete(`/api/prospectos/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    await owner.close();
    await viewer.close();
    await directorContext.close();
    await colleagueContext.close();
  }
});

test('Alejandro crea Prospecto/Cotización y Javier los consulta; escritura sólo tras asignación', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !director.password || !colleague.password || !alejandro.password) {
    throw new Error('COLLABORATION_LOCAL_CHROME_SAFETY_GATE_FAILED');
  }
  const ownerContext = await browser.newContext({ baseURL: base.toString() });
  const colleagueContext = await browser.newContext({ baseURL: base.toString() });
  const managerContext = await browser.newContext({ baseURL: base.toString() });
  const owner = await ownerContext.newPage();
  const viewer = await colleagueContext.newPage();
  const manager = await managerContext.newPage();
  try {
    const ownerLogin = await request.post('/api/auth/login', { data: alejandro });
    const colleagueLogin = await request.post('/api/auth/login', { data: colleague });
    expect(ownerLogin.status()).toBe(200);
    expect(colleagueLogin.status()).toBe(200);
    const ownerAuth = await ownerLogin.json();
    const ownerHeaders = { Authorization: `Bearer ${ownerAuth.access_token}` };
    const viewerHeaders = { Authorization: `Bearer ${(await colleagueLogin.json()).access_token}` };
    const catalog = await request.get('/api/prospectos/catalogos', { headers: ownerHeaders });
    expect(catalog.status()).toBe(200);
    const act = (await catalog.json()).actTypes.find((item: { nombre: string }) => item.nombre === 'ACTO SINTÉTICO COLABORACIÓN QA 20261027');
    expect(act?.id).toBeTruthy();
    const marker = `COT-COLLAB-QA-${Date.now()}`;
    const created = await request.post('/api/prospectos', { headers: { ...ownerHeaders, 'Idempotency-Key': marker },
      data: { nombre: marker, tipo_acto_ids: [act.id] } });
    expect(created.status()).toBe(201);
    const prospectId = (await created.json()).id as string;
    await login(owner, alejandro);
    await login(viewer, colleague);
    await viewer.goto(`/prospectos/${prospectId}`);
    await expect(viewer.getByText(marker, { exact: true }).first()).toBeVisible();
    const advance = async (action: string, extra: Record<string, unknown> = {}) => {
      const current = await request.get(`/api/prospectos/${prospectId}/operacion`, { headers: ownerHeaders });
      expect(current.status()).toBe(200);
      const result = await request.post(`/api/prospectos/${prospectId}/transiciones`, { headers: ownerHeaders,
        data: { action, expectedVersion: (await current.json()).version, confirm: true, idempotencyKey: `${marker}:${action}`, ...extra } });
      expect(result.status()).toBe(200);
      return result.json();
    };
    await advance('COMENZAR_INTEGRACION');
    await advance('MARCAR_LISTO_PARA_COTIZAR', { quoteAssigneeId: ownerAuth.user.id });
    const conversion = await advance('CONVERTIR');
    expect(conversion.quoteId).toBeTruthy();
    const quoteId = conversion.quoteId as string;
    const quote = await request.get(`/api/cotizaciones/${quoteId}`, { headers: viewerHeaders });
    expect(quote.status()).toBe(200);
    const folio = (await quote.json()).numero_cotizacion as string;
    expect(folio).toMatch(/^COT-\d{4}-\d{4}$/);
    const preview = await request.post(`/api/cotizaciones/${quoteId}/presupuesto/vista-previa`, { headers: viewerHeaders,
      data: { concepts: [{ concepto: 'Honorarios sintéticos QA', categoria: 'HONORARIOS', importe: '100.00' }] } });
    expect(preview.status()).toBe(200);
    expect((await request.post(`/api/cotizaciones/${quoteId}/seguimientos`, { headers: viewerHeaders,
      data: { resumen: 'Intento sin asignación QA' } })).status()).toBe(403);

    await viewer.goto(`/cotizaciones/${quoteId}`);
    await expect(viewer.getByRole('heading', { name: folio })).toBeVisible();
    await owner.goto(`/cotizaciones/${quoteId}`);
    await expect(owner.getByRole('heading', { name: folio })).toBeVisible();
    await login(manager, director);
    await manager.goto(`/cotizaciones/${quoteId}`);
    const selector = manager.getByLabel('Asignar colaborador');
    await expect(selector).toBeVisible();
    const memberId = await selector.getByRole('option', { name: /Javier Tapia/ }).getAttribute('value');
    expect(memberId).toBeTruthy();
    await selector.selectOption(memberId!);
    await manager.getByRole('button', { name: 'Asignar', exact: true }).click();
    await expect(manager.getByText('Javier Tapia', { exact: true })).toBeVisible();
    const followUp = await request.post(`/api/cotizaciones/${quoteId}/seguimientos`, { headers: viewerHeaders,
      data: { resumen: 'Seguimiento sintético de colaborador QA' } });
    expect(followUp.status()).toBe(201);
    await manager.getByRole('button', { name: 'Retirar a Javier Tapia' }).click();
    await expect(manager.getByText('Javier Tapia', { exact: true })).toHaveCount(0);
    expect((await request.post(`/api/cotizaciones/${quoteId}/seguimientos`, { headers: viewerHeaders,
      data: { resumen: 'Intento tras revocación QA' } })).status()).toBe(403);
    await viewer.reload();
    await expect(viewer.getByRole('heading', { name: folio })).toBeVisible();
  } finally {
    await ownerContext.close();
    await colleagueContext.close();
    await managerContext.close();
  }
});

test('sesiones QA separadas: Dirección, abogada y Finanzas conservan RBAC tras reload', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !director.password || !maria.password || !rosa.password) {
    throw new Error('COLLABORATION_LOCAL_CHROME_SAFETY_GATE_FAILED');
  }
  for (const [credentials, role] of [[director, 'DIRECCION'], [maria, 'ABOGADO'], [rosa, 'FINANCIERO']] as const) {
    const context = await browser.newContext({ baseURL: base.toString() });
    try {
      const page = await context.newPage();
      await login(page, credentials);
      await page.reload();
      await expect(page).toHaveURL(/\/mi-dia$/);
      const response = await request.post('/api/auth/login', { data: credentials });
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.user.rol).toBe(role);
      expect(payload.user.organization.id).toBe('7577aa7b-8149-4ba4-a07d-adca779a1d03');
      const headers = { Authorization: `Bearer ${payload.access_token}` };
      expect((await request.get('/api/expedientes', { headers })).status()).toBe(200);
      if (role === 'FINANCIERO') {
        expect((await request.get('/api/prospectos', { headers })).status()).toBe(403);
        expect((await request.get('/api/cotizaciones', { headers })).status()).toBe(403);
      }
      if (role === 'ABOGADO') expect((await request.get('/api/finanzas', { headers })).status()).toBe(403);
      if (role === 'DIRECCION') expect((await request.get('/api/platform/admin/dashboard', { headers })).status()).toBe(403);
    } finally {
      await context.close();
    }
  }
});
