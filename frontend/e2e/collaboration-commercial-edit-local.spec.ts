import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const actId = '11aa1757-2b3d-4e6c-86e2-3818da8df765';
const users = {
  alejandro: { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  javier: { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
  adrian: { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' },
};

async function login(page: Page, credentials: { email: string; password: string }) {
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

test('COL13/COL16/COL17/COL19 · dueño/Dirección editan Prospecto y Cotización; asistente edita presupuesto hasta revocación', async ({ browser, request }, testInfo) => {
  test.setTimeout(150_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || Object.values(users).some((user) => !user.password)) throw new Error('COLLAB_COMMERCIAL_EDIT_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(Array.from({ length: 2 }, () => browser.newContext({ baseURL: base.toString() })));
  const [ownerPage, directorPage] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const responses = await Promise.all(Object.values(users).map((user) => request.post('/api/auth/login', { data: user })));
    responses.forEach((response) => expect(response.status()).toBe(200));
    const [owner, colleague, director] = await Promise.all(responses.map((response) => response.json()));
    for (const auth of [owner, colleague, director]) expect(auth.user.organization.id).toBe(orgId);
    const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
    const marker = `COL-COMMERCIAL-EDIT-QA-${randomUUID()}`;
    const created = await request.post('/api/prospectos', { headers: { ...headers(owner), 'Idempotency-Key': marker },
      data: { nombre: marker, tipo_acto_ids: [actId] } });
    expect(created.status(), await created.text()).toBe(201);
    const prospect = await created.json();
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } })).user_id).toBe(owner.user.id);
    const firstEdit = await request.put(`/api/prospectos/${prospect.id}`, { headers: headers(owner),
      data: { telefono: '5551112222', expectedVersion: prospect.version_operativa } });
    expect(firstEdit.status(), await firstEdit.text()).toBe(200);
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } })).telefono).toBe('5551112222');
    await login(ownerPage, users.alejandro);
    await ownerPage.goto(`/prospectos/${prospect.id}`);
    await expect(ownerPage.getByText('5551112222', { exact: true })).toBeVisible();
    const currentProspect = await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } });
    const directorEdit = await request.put(`/api/prospectos/${prospect.id}`, { headers: headers(director),
      data: { telefono: '5553334444', expectedVersion: currentProspect.version_operativa } });
    expect(directorEdit.status(), await directorEdit.text()).toBe(200);
    await login(directorPage, users.adrian);
    await directorPage.goto(`/prospectos/${prospect.id}`);
    await expect(directorPage.getByText('5553334444', { exact: true })).toBeVisible();
    await ownerPage.reload();
    await expect(ownerPage.getByText('5553334444', { exact: true })).toBeVisible();
    expect((await db.prospecto.findUniqueOrThrow({ where: { id: prospect.id } })).user_id).toBe(owner.user.id);

    const advance = async (action: string, extra: Record<string, unknown> = {}) => {
      const state = await request.get(`/api/prospectos/${prospect.id}/operacion`, { headers: headers(owner) });
      expect(state.status()).toBe(200);
      const response = await request.post(`/api/prospectos/${prospect.id}/transiciones`, { headers: headers(owner), data: {
        action, expectedVersion: (await state.json()).version, confirm: true,
        idempotencyKey: `${marker}:${action}`, ...extra,
      } });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };
    await advance('COMENZAR_INTEGRACION');
    await advance('MARCAR_LISTO_PARA_COTIZAR', { quoteAssigneeId: owner.user.id });
    const conversion = await advance('CONVERTIR');
    const quoteId = conversion.quoteId as string;
    expect(quoteId).toBeTruthy();
    const quoteResponse = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(owner) });
    expect(quoteResponse.status()).toBe(200);
    const quote = await quoteResponse.json();
    expect(quote.user_id).toBe(owner.user.id);
    const ownerBudget = await request.put(`/api/cotizaciones/${quoteId}/presupuesto`, { headers: headers(owner), data: {
      expectedUpdatedAt: quote.updated_at, origin: 'MANUAL', operationContext: 'Presupuesto sintético de colaboración',
      concepts: [{ concepto: 'Honorarios QA', categoria: 'HONORARIOS', importe: '100.00' }],
    } });
    expect(ownerBudget.status(), await ownerBudget.text()).toBe(200);
    const firstQuote = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(owner) });
    expect(firstQuote.status()).toBe(200);
    expect(Number((await firstQuote.json()).presupuesto.totals.honorarios)).toBe(100);
    const assignment = await request.post(`/api/collaboration/cotizacion/${quoteId}/asistentes`, { headers: headers(director),
      data: { user_id: colleague.user.id } });
    expect(assignment.status(), await assignment.text()).toBe(201);
    const assignedQuote = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(colleague) });
    expect(assignedQuote.status()).toBe(200);
    const colleagueBudget = await request.put(`/api/cotizaciones/${quoteId}/presupuesto`, { headers: headers(colleague), data: {
      expectedUpdatedAt: (await assignedQuote.json()).updated_at, origin: 'MANUAL', operationContext: 'Edición sintética de asistente QA',
      concepts: [{ concepto: 'Honorarios QA', categoria: 'HONORARIOS', importe: '150.00' }],
    } });
    expect(colleagueBudget.status(), await colleagueBudget.text()).toBe(200);
    const editedQuote = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(owner) });
    expect(editedQuote.status()).toBe(200);
    const editedBody = await editedQuote.json();
    expect(Number(editedBody.presupuesto.totals.honorarios)).toBe(150);
    const revoked = await request.delete(`/api/collaboration/cotizacion/${quoteId}/asistentes/${colleague.user.id}`, { headers: headers(director) });
    expect(revoked.status(), await revoked.text()).toBe(200);
    const afterRevocation = await request.put(`/api/cotizaciones/${quoteId}/presupuesto`, { headers: headers(colleague), data: {
      expectedUpdatedAt: editedBody.updated_at, origin: 'MANUAL',
      concepts: [{ concepto: 'Intrusión QA', categoria: 'HONORARIOS', importe: '1.00' }],
    } });
    expect(afterRevocation.status()).toBe(403);
    const readable = await request.get(`/api/cotizaciones/${quoteId}`, { headers: headers(colleague) });
    expect(readable.status()).toBe(200);
    expect(Number((await readable.json()).presupuesto.totals.honorarios)).toBe(150);
    expect(await db.recordCollaboration.count({ where: { cotizacion_id: quoteId, user_id: colleague.user.id, revoked_at: null } })).toBe(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});
