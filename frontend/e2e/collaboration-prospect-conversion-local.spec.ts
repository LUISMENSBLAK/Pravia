import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const actId = '11aa1757-2b3d-4e6c-86e2-3818da8df765';
const users = {
  owner: { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  collaborator: { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
  director: { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' },
};

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(user.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(user.password);
  if (await page.getByRole('textbox', { name: 'Contraseña', exact: true }).inputValue() !== user.password) {
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(user.password);
  }
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(user.email);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

test('COL57 · colaborador autorizado convierte Prospecto compartido a una sola Cotización real', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || Object.values(users).some((user) => !user.password)) throw new Error('COLLAB_PROSPECT_CONVERSION_LOCAL_SAFETY_GATE_FAILED');

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const context = await browser.newContext({ baseURL: base.toString() });
  const page = await context.newPage();
  try {
    const loginResponses = await Promise.all(Object.values(users).map((user) => request.post('/api/auth/login', { data: user })));
    loginResponses.forEach((response) => expect(response.status()).toBe(200));
    const [owner, collaborator, director] = await Promise.all(loginResponses.map((response) => response.json()));
    for (const actor of [owner, collaborator, director]) expect(actor.user.organization.id).toBe(orgId);
    const headers = (actor: any) => ({ Authorization: `Bearer ${actor.access_token}` });
    const marker = `COL57-QA-${randomUUID()}`;
    const created = await request.post('/api/prospectos', { headers: { ...headers(owner), 'Idempotency-Key': marker },
      data: { nombre: marker, tipo_acto_ids: [actId] } });
    expect(created.status(), await created.text()).toBe(201);
    const prospect = await created.json();
    expect(prospect.user_id).toBe(owner.user.id);
    const unassigned = await request.get(`/api/prospectos/${prospect.id}/operacion`, { headers: headers(collaborator) });
    expect(unassigned.status()).toBe(200);
    expect((await unassigned.json()).actions.some((action: { code: string }) => action.code === 'CONVERTIR')).toBe(false);
    const assignment = await request.post(`/api/collaboration/prospecto/${prospect.id}/asistentes`, {
      headers: headers(director), data: { user_id: collaborator.user.id },
    });
    expect(assignment.status(), await assignment.text()).toBe(201);

    const advance = async (actor: any, action: string, extra: Record<string, unknown> = {}) => {
      const state = await request.get(`/api/prospectos/${prospect.id}/operacion`, { headers: headers(actor) });
      expect(state.status()).toBe(200);
      const result = await request.post(`/api/prospectos/${prospect.id}/transiciones`, { headers: headers(actor), data: {
        action, expectedVersion: (await state.json()).version, confirm: true, idempotencyKey: `${marker}:${action}`, ...extra,
      } });
      expect(result.status(), await result.text()).toBe(200);
      return result.json();
    };
    await advance(owner, 'COMENZAR_INTEGRACION');
    await advance(owner, 'MARCAR_LISTO_PARA_COTIZAR', { quoteAssigneeId: collaborator.user.id });
    await login(page, users.collaborator);
    await page.goto(`/prospectos/${prospect.id}`);
    await expect(page.getByRole('heading', { name: marker.toUpperCase() })).toBeVisible();
    const before = await request.get(`/api/prospectos/${prospect.id}/operacion`, { headers: headers(collaborator) });
    expect(before.status()).toBe(200);
    expect((await before.json()).actions.some((action: { code: string }) => action.code === 'CONVERTIR')).toBe(true);
    const conversion = await advance(collaborator, 'CONVERTIR');
    const quoteId = conversion.quoteId as string;
    expect(quoteId).toBeTruthy();
    const quote = await db.cotizacion.findUniqueOrThrow({ where: { id: quoteId }, select: {
      id: true, prospecto_id: true, organization_id: true, user_id: true, numero_cotizacion: true,
    } });
    expect(quote.prospecto_id).toBe(prospect.id);
    expect(quote.organization_id).toBe(orgId);
    expect(quote.user_id).toBe(collaborator.user.id);
    expect(quote.numero_cotizacion).toMatch(/^COT-\d{4}-\d{4}$/);
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id, organization_id: orgId } })).toBe(1);
    const converted = await db.prospectoTransicion.findFirstOrThrow({ where: { prospecto_id: prospect.id, etapa_nueva: 'CONVERTIDO_EN_COTIZACION' }, orderBy: { version: 'desc' } });
    expect(converted.actor_id).toBe(collaborator.user.id);
    await page.goto(`/cotizaciones/${quoteId}`);
    await expect(page.getByText(quote.numero_cotizacion, { exact: true }).first()).toBeVisible();
    await page.goto(`/prospectos/${prospect.id}`);
    await expect(page.getByText('Convertido en cotización', { exact: false }).first()).toBeVisible();
    expect(await db.cotizacion.count({ where: { prospecto_id: prospect.id, organization_id: orgId } })).toBe(1);
  } finally {
    await context.close();
    await db.$disconnect();
  }
});
