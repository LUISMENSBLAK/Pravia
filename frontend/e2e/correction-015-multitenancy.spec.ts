import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = 'http://127.0.0.1:3001/api';
const notaryA = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };
const notaryB = { email: 'qa.notaria.b@pravia.test', password: (process.env.PRAVIA_E2E_TENANT_B_PASSWORD ?? '') };

async function apiLogin(request: APIRequestContext, credentials: typeof notaryA) {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials });
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.access_token).toEqual(expect.any(String));
  return { token: payload.access_token as string, organization: payload.user.organization as { id: string; name: string } };
}

async function uiLogin(page: Page, credentials: typeof notaryA) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

test('015-01 · Notaría A no accede a datos, búsqueda, IA ni documentos de Notaría B', async ({ page, request }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const marker = `TENANT-B-PRIVATE-${suffix}`;
  const [a, b] = await Promise.all([apiLogin(request, notaryA), apiLogin(request, notaryB)]);
  expect(a.organization.id).not.toBe(b.organization.id);

  const bHeaders = { Authorization: `Bearer ${b.token}` };
  const aHeaders = { Authorization: `Bearer ${a.token}` };
  const created = await request.post(`${apiBase}/prospectos`, {
    headers: { ...bHeaders, 'Idempotency-Key': `c015-multi-${suffix}` },
    data: { nombre: marker },
  });
  expect(created.status()).toBe(201);
  const prospect = await created.json();
  expect(prospect.organization_id).toBe(b.organization.id);

  const uploaded = await request.post(`${apiBase}/documentos`, {
    headers: bHeaders,
    multipart: {
      archivo: { name: `private-${suffix}.txt`, mimeType: 'text/plain', buffer: Buffer.from(marker) },
      tipo: 'IDENTIFICACION', categoria: 'OTROS', prospecto_id: prospect.id,
    },
  });
  expect(uploaded.status()).toBe(201);
  const document = await uploaded.json();
  expect(document.organization_id).toBe(b.organization.id);

  const [direct, workflow, documentUrl, list, search, assistant] = await Promise.all([
    request.get(`${apiBase}/prospectos/${prospect.id}`, { headers: aHeaders }),
    request.get(`${apiBase}/prospectos/${prospect.id}/operacion`, { headers: aHeaders }),
    request.get(`${apiBase}/documentos/${document.id}/url`, { headers: aHeaders }),
    request.get(`${apiBase}/prospectos`, { headers: aHeaders, params: { search: marker } }),
    request.get(`${apiBase}/settings/search`, { headers: aHeaders, params: { q: marker } }),
    request.post(`${apiBase}/ia/assistant/tools/globalSearch`, { headers: aHeaders, data: { args: { query: marker } } }),
  ]);
  expect(direct.status()).toBe(403);
  expect(workflow.status()).toBe(403);
  expect(documentUrl.status()).toBe(403);
  expect(await list.json()).toEqual([]);
  expect((await search.json()).data).toEqual([]);
  const assistantPayload = await assistant.json();
  expect(assistantPayload.data).toEqual({ expedientes: [], comparecientes: [], notarias: [] });
  expect(JSON.stringify(assistantPayload)).not.toContain(marker);

  const [bDirect, bDocumentUrl] = await Promise.all([
    request.get(`${apiBase}/prospectos/${prospect.id}`, { headers: bHeaders }),
    request.get(`${apiBase}/documentos/${document.id}/url`, { headers: bHeaders }),
  ]);
  expect(bDirect.status()).toBe(200);
  expect((await bDirect.json()).nombre).toBe(marker.toLocaleUpperCase('es-MX'));
  expect(bDocumentUrl.status()).toBe(200);
  expect((await bDocumentUrl.json()).url).toMatch(/^\/api\/storage\/local\?/);

  await uiLogin(page, notaryA);
  const directResponse = page.waitForResponse((response) => response.url().endsWith(`/api/prospectos/${prospect.id}`));
  await page.goto(`/prospectos/${prospect.id}`, { waitUntil: 'domcontentloaded' });
  expect((await directResponse).status()).toBe(403);
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await page.goto(`/prospectos?search=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' });
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
});
