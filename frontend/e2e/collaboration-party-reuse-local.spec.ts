import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const credentials = {
  email: 'javier.tapia@pravia.test',
  password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '',
};
const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const partyId = '7475c24d-888a-47f3-8b35-6517d1a44a14';
const caseIds = [
  'ac62cbf6-a7bc-43b9-8242-041a6629fc5c',
  'bf3a74fb-e01e-411b-8ee3-fc5b47217567',
];

async function login(page: Page) {
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

test('COL59 · mismo compareciente maestro en dos expedientes comerciales de distintos responsables', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || !credentials.password) throw new Error('COLLAB_PARTY_REUSE_LOCAL_SAFETY_GATE_FAILED');

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const authResponse = await request.post('/api/auth/login', { data: credentials });
    expect(authResponse.status()).toBe(200);
    const auth = await authResponse.json();
    expect(auth.user.organization.id).toBe(orgId);
    const headers = { Authorization: `Bearer ${auth.access_token}` };
    const party = await db.compareciente.findFirstOrThrow({ where: { id: partyId, organization_id: orgId, archived_at: null },
      select: { id: true, nombre_busqueda: true, creado_por_id: true } });
    expect(party.creado_por_id).not.toBe(auth.user.id);
    expect(await db.compareciente.count({ where: { id: partyId, organization_id: orgId, archived_at: null } })).toBe(1);
    const cases = await db.expediente.findMany({ where: { id: { in: caseIds }, organization_id: orgId },
      select: { id: true, abogado_id: true, numero_pravia: true } });
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map((item) => item.abogado_id)).size).toBe(2);
    const relations = await db.expedienteCompareciente.findMany({ where: {
      expediente_id: { in: caseIds }, compareciente_id: partyId, organization_id: orgId, archived_at: null, estatus: 'ACTIVO',
    }, select: { id: true, expediente_id: true, expediente_acto_id: true, compareciente_id: true } });
    expect(relations).toHaveLength(2);
    expect(new Set(relations.map((item) => item.id)).size).toBe(2);
    expect(new Set(relations.map((item) => item.expediente_acto_id)).size).toBe(2);

    await login(page);
    for (const caseId of caseIds) {
      const response = await request.get(`/api/expedientes/${caseId}/comparecientes`, { headers });
      expect(response.status(), await response.text()).toBe(200);
      const body = await response.json();
      const linked = body.data.filter((item: { compareciente_id: string }) => item.compareciente_id === partyId);
      expect(linked).toHaveLength(1);
      expect(linked[0].expediente_acto_id).toBe(relations.find((item) => item.expediente_id === caseId)?.expediente_acto_id);
      await page.goto(`/expedientes/${caseId}#comparecientes`);
      await expect(page.getByRole('tabpanel', { name: 'Comparecientes' }).getByText(/COLABORACI.N QA SINT.TICA LOCAL/i).first()).toBeVisible();
      await expect(page.getByText('Ficha maestra única', { exact: false }).first()).toBeVisible();
    }
    expect(await db.compareciente.count({ where: { id: partyId, organization_id: orgId, archived_at: null } })).toBe(1);
  } finally {
    await db.$disconnect();
  }
});
