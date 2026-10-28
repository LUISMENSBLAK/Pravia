import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const users = [
  { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
];
const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';

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

test('COL65 · cita privada invisible a colega y cita organizacional compartida en Chrome', async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || users.some((user) => !user.password)) throw new Error('COLLAB_AGENDA_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(users.map(() => browser.newContext({ baseURL: base.toString() })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const eventIds: string[] = [];
  try {
    const authResponses = await Promise.all(users.map((user) => request.post('/api/auth/login', { data: user })));
    authResponses.forEach((response) => expect(response.status()).toBe(200));
    const [alejandro, javier] = await Promise.all(authResponses.map((response) => response.json()));
    expect(alejandro.user.organization.id).toBe(orgId);
    expect(javier.user.organization.id).toBe(orgId);
    const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
    const marker = randomUUID().slice(0, 8).toUpperCase();
    for (const [visibility, hour] of [['PRIVATE', '10'], ['ORGANIZATION', '12']] as const) {
      const title = `CITA COL ${visibility} ${marker}`;
      const created = await request.post('/api/agenda', { headers: headers(alejandro), data: {
        titulo: title, tipo: 'CITA', fecha_inicio: `2026-11-16T${hour}:00:00.000Z`,
        fecha_fin: `2026-11-16T${hour}:30:00.000Z`, visibilidad: visibility,
        participante_ids: [], responsable_id: alejandro.user.id, idempotency_key: `${marker}:${visibility}`,
      } });
      expect(created.status(), await created.text()).toBe(201);
      const payload = await created.json();
      eventIds.push(payload.evento.id);
      expect((await db.eventoAgenda.findUniqueOrThrow({ where: { id: payload.evento.id } })).visibilidad).toBe(visibility);
    }
    const range = 'desde=2026-11-16T00%3A00%3A00.000Z&hasta=2026-11-17T00%3A00%3A00.000Z&estatus=TODOS';
    const ownerList = await request.get(`/api/agenda?${range}`, { headers: headers(alejandro) });
    const colleagueList = await request.get(`/api/agenda?${range}`, { headers: headers(javier) });
    expect(ownerList.status()).toBe(200);
    expect(colleagueList.status()).toBe(200);
    const ownerIds = (await ownerList.json()).eventos.map((event: { id: string }) => event.id);
    const colleagueIds = (await colleagueList.json()).eventos.map((event: { id: string }) => event.id);
    expect(ownerIds).toEqual(expect.arrayContaining(eventIds));
    expect(colleagueIds).not.toContain(eventIds[0]);
    expect(colleagueIds).toContain(eventIds[1]);
    expect((await request.get(`/api/agenda/${eventIds[0]}`, { headers: headers(javier) })).status()).toBe(404);
    expect((await request.get(`/api/agenda/${eventIds[1]}`, { headers: headers(javier) })).status()).toBe(200);

    for (const [index, page] of pages.entries()) {
      await login(page, users[index]);
      await page.goto('/agenda?date=2026-11-16');
      await page.getByRole('tab', { name: 'Lista' }).click();
      await expect(page.getByRole('region', { name: 'Lista cronológica de eventos' }).getByText(`CITA COL ORGANIZATION ${marker}`)).toBeVisible();
      if (index === 0) await expect(page.getByRole('region', { name: 'Lista cronológica de eventos' }).getByText(`CITA COL PRIVATE ${marker}`)).toBeVisible();
      else await expect(page.getByRole('region', { name: 'Lista cronológica de eventos' }).getByText(`CITA COL PRIVATE ${marker}`)).toHaveCount(0);
    }
  } finally {
    if (eventIds.length) {
      await db.auditLog.deleteMany({ where: { entidad: 'EventoAgenda', entidad_id: { in: eventIds } } });
      await db.eventoAgendaParticipante.deleteMany({ where: { evento_id: { in: eventIds } } });
      await db.eventoAgenda.deleteMany({ where: { id: { in: eventIds } } });
    }
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});
