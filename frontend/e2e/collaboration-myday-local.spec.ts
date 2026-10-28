import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';
import { EXPEDIENTE_MACROPHASE_STATUSES } from '../../backend/src/domain/expedienteReadModel';

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

test('COL64 · Mi Día personal no incorpora Expedientes del compañero aunque se fuerce user_id', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || users.some((user) => !user.password)) throw new Error('COLLAB_MYDAY_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const contexts = await Promise.all(users.map(() => browser.newContext({ baseURL: base.toString() })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const originalConfigs: Array<{ headers: { Authorization: string }; layout: any[]; personalized: boolean }> = [];
  try {
    const authResponses = await Promise.all(users.map((user) => request.post('/api/auth/login', { data: user })));
    authResponses.forEach((response) => expect(response.status()).toBe(200));
    const auth = await Promise.all(authResponses.map((response) => response.json()));
    const statuses = [...new Set([
      ...EXPEDIENTE_MACROPHASE_STATUSES.INTEGRACION,
      ...EXPEDIENTE_MACROPHASE_STATUSES.PROYECTO,
      ...EXPEDIENTE_MACROPHASE_STATUSES.FIRMA,
      ...EXPEDIENTE_MACROPHASE_STATUSES.POSTFIRMA,
    ])];
    for (const [index, actor] of auth.entries()) {
      expect(actor.user.organization.id).toBe(orgId);
      const headers = { Authorization: `Bearer ${actor.access_token}` };
      const config = await request.get('/api/mi-dia/config', { headers });
      expect(config.status(), await config.text()).toBe(200);
      const configPayload = (await config.json()).data;
      expect(configPayload.catalog.some((card: { key: string }) => card.key === 'MY_ACTIVE_CASES')).toBe(true);
      originalConfigs.push({ headers, layout: configPayload.layout, personalized: configPayload.personalized });
      if (!configPayload.layout.some((card: { key: string }) => card.key === 'MY_ACTIVE_CASES')) {
        const save = await request.put('/api/mi-dia/layout', { headers, data: {
          version: configPayload.layoutVersion,
          layout: [...configPayload.layout, { key: 'MY_ACTIVE_CASES', size: 'S', scope: 'OWN', parameters: {} }],
        } });
        expect(save.status(), await save.text()).toBe(200);
      }
      const owned = await db.expediente.findMany({ where: { organization_id: orgId, archived_at: null,
        abogado_id: actor.user.id, estatus: { in: statuses as any } }, select: { id: true } });
      const detail = await request.get(`/api/mi-dia/cards/MY_ACTIVE_CASES/detail?page=1&page_size=50&user_id=${auth[1 - index].user.id}`, { headers });
      expect(detail.status(), await detail.text()).toBe(200);
      const payload = (await detail.json()).data;
      expect(payload.scope).toBe('OWN');
      expect(payload.totalCount).toBe(owned.length);
      expect(new Set(payload.items.map((item: { id: string }) => item.id))).toEqual(new Set(owned.map((row) => row.id)));
      await login(pages[index], users[index]);
      await expect(pages[index].getByText('Mis expedientes activos', { exact: true })).toBeVisible();
      await pages[index].reload();
      await expect(pages[index].getByText('Mis expedientes activos', { exact: true })).toBeVisible();
    }
  } finally {
    for (const original of originalConfigs) {
      if (!original.personalized) {
        const reset = await request.delete('/api/mi-dia/layout', { headers: original.headers });
        expect(reset.status(), await reset.text()).toBe(200);
      } else {
        const latest = await request.get('/api/mi-dia/config', { headers: original.headers });
        const version = (await latest.json()).data.layoutVersion;
        const restore = await request.put('/api/mi-dia/layout', { headers: original.headers,
          data: { version, layout: original.layout } });
        expect(restore.status(), await restore.text()).toBe(200);
      }
    }
    await Promise.all(contexts.map((context) => context.close()));
    await db.$disconnect();
  }
});
