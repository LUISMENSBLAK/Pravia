import { expect, test, type Page } from '@playwright/test';

const directorPassword = process.env.PRAVIA_E2E_PASSWORD;
const colleaguePassword = process.env.PRAVIA_E2E_MARIA_PASSWORD;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  const catalogRequest = page.waitForRequest((request) => request.url().endsWith('/api/agenda/catalogos'));
  await page.goto('/agenda');
  const authorization = (await catalogRequest).headers().authorization;
  if (!authorization?.startsWith('Bearer ')) throw new Error('LOCAL_AGENDA_AUTH_TOKEN_MISSING');
  return authorization;
}

test('Agenda: privacidad, visibilidad de Notaría y cambio inmediato sobreviven reload', async ({ browser }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  if (base.hostname !== '127.0.0.1' || !directorPassword || !colleaguePassword) {
    throw new Error('LOCAL_AGENDA_QA_SAFETY_GATE_FAILED');
  }
  const directorContext = await browser.newContext({ baseURL: base.toString() });
  const colleagueContext = await browser.newContext({ baseURL: base.toString() });
  const director = await directorContext.newPage();
  const colleague = await colleagueContext.newPage();
  let createdId: string | undefined;
  let directorAuthorization = '';
  try {
    directorAuthorization = await login(director, 'adrian.hernandez@pravia.test', directorPassword);
    let colleagueAuthorization = await login(colleague, 'maria.careaga@pravia.test', colleaguePassword);
    const title = `QA VISIBILIDAD ${Date.now()}`;
    const date = new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10);
    const nextDate = new Date(`${date}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const start = `${date}T12:00:00.000Z`;
    const end = `${date}T13:00:00.000Z`;
    const create = await director.request.post('/api/agenda', { headers: { Authorization: directorAuthorization }, data: {
      titulo: title, tipo: 'CITA', fecha_inicio: start, fecha_fin: end, visibilidad: 'PRIVATE',
    } });
    expect(create.status()).toBe(201);
    const created = (await create.json()).evento;
    expect(created.visibilidad).toBe('PRIVATE');
    const id = created.id;
    createdId = id;
    const listUrl = `/api/agenda?desde=${encodeURIComponent(`${date}T00:00:00.000Z`)}&hasta=${encodeURIComponent(nextDate.toISOString())}&estatus=TODOS`;
    const listIds = async (page: Page, authorization: string) => {
      const response = await page.request.get(listUrl, { headers: { Authorization: authorization } });
      expect(response.status()).toBe(200);
      return (await response.json()).eventos.map((event: { id: string }) => event.id);
    };
    const myDayIds = async (page: Page, authorization: string) => {
      const response = await page.request.get('/api/mi-dia', { headers: { Authorization: authorization } });
      expect(response.status()).toBe(200);
      return (await response.json()).eventos.citas_proximas.map((event: { id: string }) => event.id);
    };
    expect(await listIds(director, directorAuthorization)).toContain(id);
    expect(await listIds(colleague, colleagueAuthorization)).not.toContain(id);
    expect(await myDayIds(director, directorAuthorization)).toContain(id);
    expect(await myDayIds(colleague, colleagueAuthorization)).not.toContain(id);
    expect((await colleague.request.get(`/api/agenda/${id}`, { headers: { Authorization: colleagueAuthorization } })).status()).toBe(404);

    const shared = await director.request.patch(`/api/agenda/${id}`, { headers: { Authorization: directorAuthorization }, data: { visibilidad: 'ORGANIZATION' } });
    expect(shared.status()).toBe(200);
    expect((await shared.json()).evento.visibilidad).toBe('ORGANIZATION');
    expect(await listIds(colleague, colleagueAuthorization)).toContain(id);
    // María puede leer la cita compartida en Agenda, pero su Mi Día permanece en alcance OWN.
    expect(await myDayIds(colleague, colleagueAuthorization)).not.toContain(id);
    await colleague.goto(`/agenda?date=${date}`);
    await colleague.getByRole('tab', { name: 'Día' }).click();
    await expect(colleague.getByText(title).first()).toBeVisible();
    const reloadedCatalog = colleague.waitForRequest((request) => request.url().endsWith('/api/agenda/catalogos'));
    await colleague.reload();
    colleagueAuthorization = (await reloadedCatalog).headers().authorization;
    await expect(colleague.getByText(title).first()).toBeVisible();

    const privateAgain = await director.request.patch(`/api/agenda/${id}`, { headers: { Authorization: directorAuthorization }, data: { visibilidad: 'PRIVATE' } });
    expect(privateAgain.status()).toBe(200);
    expect(await listIds(colleague, colleagueAuthorization)).not.toContain(id);
    expect(await myDayIds(colleague, colleagueAuthorization)).not.toContain(id);
    const privateCatalog = colleague.waitForRequest((request) => request.url().endsWith('/api/agenda/catalogos'));
    await colleague.reload();
    colleagueAuthorization = (await privateCatalog).headers().authorization;
    await expect(colleague.getByText(title)).toHaveCount(0);
    expect((await colleague.request.get(`/api/agenda/${id}`, { headers: { Authorization: colleagueAuthorization } })).status()).toBe(404);
    expect((await director.request.get(`/api/agenda/${id}`, { headers: { Authorization: directorAuthorization } })).status()).toBe(200);
  } finally {
    if (createdId && directorAuthorization) {
      const cancelled = await director.request.post(`/api/agenda/${createdId}/cancelar`, {
        headers: { Authorization: directorAuthorization }, data: { motivo_cancelacion: 'Fin de prueba local de visibilidad.' },
      });
      expect(cancelled.status()).toBe(200);
    }
    await Promise.all([directorContext.close(), colleagueContext.close()]);
  }
});
