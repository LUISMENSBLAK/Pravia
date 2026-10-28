import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const users = [
  { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
];
const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const prospectId = '57ec986e-8751-424d-8871-14574464c638';
const quoteId = '626bddf1-7563-4479-a3e7-757b6172b424';
const caseId = 'ac62cbf6-a7bc-43b9-8242-041a6629fc5c';

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

test('COL10/COL11 · búsqueda Chrome y paginación compartida cuadran con PostgreSQL', async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000);
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || users.some((user) => !user.password)) throw new Error('COLLAB_SEARCH_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(users.map(() => browser.newContext({ baseURL: base.toString() })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const authResponses = await Promise.all(users.map((user) => request.post('/api/auth/login', { data: user })));
    authResponses.forEach((response) => expect(response.status()).toBe(200));
    const [alejandro, javier] = await Promise.all(authResponses.map((response) => response.json()));
    const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
    for (const auth of [alejandro, javier]) expect(auth.user.organization.id).toBe(orgId);
    await Promise.all(pages.map((page, index) => login(page, users[index])));
    const prospect = await db.prospecto.findUniqueOrThrow({ where: { id: prospectId } });
    const targets = [
      { query: prospect.nombre, id: prospectId, type: 'PROSPECTO' },
      { query: 'COT-0016-2026', id: quoteId, type: 'COTIZACION' },
      { query: 'EXP-0007-2026', id: caseId, type: 'EXPEDIENTE' },
    ];
    for (const [index, page] of pages.entries()) {
      const auth = [alejandro, javier][index];
      for (const target of targets) {
        const api = await request.get(`/api/settings/search?q=${encodeURIComponent(target.query)}`, { headers: headers(auth) });
        expect(api.status(), await api.text()).toBe(200);
        expect((await api.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: target.id, type: target.type })]));
        await page.getByRole('button', { name: 'Abrir búsqueda global' }).first().click();
        await page.getByRole('textbox', { name: 'Buscar en PRAVIA OS' }).fill(target.query);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button').filter({ hasText: target.query }).filter({ hasText: target.type })).toBeVisible();
        await dialog.getByRole('button', { name: 'Cerrar búsqueda' }).click();
      }
    }
    const totalPhysical = await db.prospecto.count({ where: { organization_id: orgId, archived_at: null } });
    for (const auth of [alejandro, javier]) {
      const seen = new Set<string>();
      let page = 1;
      while (true) {
        const response = await request.get(`/api/prospectos?page=${page}&pageSize=10&includeSummary=false`, { headers: headers(auth) });
        expect(response.status(), await response.text()).toBe(200);
        const payload = await response.json();
        expect(payload.meta.total).toBe(totalPhysical);
        expect(payload.data.length).toBeLessThanOrEqual(10);
        for (const record of payload.data) {
          expect(record.organization_id).toBe(orgId);
          expect(seen.has(record.id)).toBe(false);
          seen.add(record.id);
        }
        if (!payload.meta.hasNextPage) break;
        page++;
        expect(page).toBeLessThan(100);
      }
      expect(seen.size).toBe(totalPhysical);
      expect(seen.has(prospectId)).toBe(true);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});
