import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const actors = {
  direccion: { email: 'adrian.hernandez@pravia.test', password: process.env.PRAVIA_E2E_PASSWORD || '' },
  assigned: { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
  colleague: { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
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

test('COL66 · aviso de tarea sólo al destinatario autorizado, sin difusión ni duplicado', async ({ browser, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || Object.values(actors).some((actor) => !actor.password)) throw new Error('COLLAB_NOTIFICATIONS_LOCAL_SAFETY_GATE_FAILED');

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const context = await browser.newContext({ baseURL: base.toString() });
  const page = await context.newPage();
  let taskId = '';
  try {
    const loginResponses = await Promise.all(Object.values(actors).map((actor) => request.post('/api/auth/login', { data: actor })));
    loginResponses.forEach((response) => expect(response.status()).toBe(200));
    const [director, assigned, colleague] = await Promise.all(loginResponses.map((response) => response.json()));
    for (const actor of [director, assigned, colleague]) expect(actor.user.organization.id).toBe(orgId);
    const headers = (actor: any) => ({ Authorization: `Bearer ${actor.access_token}` });
    const title = `AVISO QA PRIVADO ${randomUUID().slice(0, 8).toUpperCase()}`;
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const create = await request.post('/api/agenda/tareas', { headers: headers(director), data: {
      titulo: title, responsable_id: assigned.user.id, fecha_limite: dueAt, prioridad: 'ALTA',
    } });
    expect(create.status(), await create.text()).toBe(201);
    taskId = (await create.json()).tarea.id;
    const taskAudit = await db.auditLog.findFirstOrThrow({ where: { entidad: 'Tarea', entidad_id: taskId, accion: 'CREATE_TASK' } });
    expect(taskAudit.organization_id).toBe(orgId);
    expect(taskAudit.user_id).toBe(director.user.id);
    const update = await request.patch(`/api/agenda/tareas/${taskId}`, { headers: headers(director), data: { prioridad: 'URGENTE' } });
    expect(update.status(), await update.text()).toBe(200);
    const updateAudit = await db.auditLog.findFirstOrThrow({ where: { entidad: 'Tarea', entidad_id: taskId, accion: 'UPDATE_TASK' } });
    expect(updateAudit.organization_id).toBe(orgId);
    expect(updateAudit.user_id).toBe(director.user.id);
    const key = `TASK:${taskId}`;

    const first = await request.get('/api/settings/notifications', { headers: headers(assigned) });
    expect(first.status(), await first.text()).toBe(200);
    expect((await first.json()).notifications.filter((item: { deterministic_key: string }) => item.deterministic_key === key)).toHaveLength(1);
    const repeated = await request.get('/api/settings/notifications', { headers: headers(assigned) });
    expect(repeated.status()).toBe(200);
    expect((await repeated.json()).notifications.filter((item: { deterministic_key: string }) => item.deterministic_key === key)).toHaveLength(1);
    const colleagueResponse = await request.get('/api/settings/notifications', { headers: headers(colleague) });
    expect(colleagueResponse.status(), await colleagueResponse.text()).toBe(200);
    expect((await colleagueResponse.json()).notifications.some((item: { deterministic_key: string }) => item.deterministic_key === key)).toBe(false);
    const owlAssigned = await request.get('/api/ia/assistant/alerts', { headers: headers(assigned) });
    const owlColleague = await request.get('/api/ia/assistant/alerts', { headers: headers(colleague) });
    expect(owlAssigned.status(), await owlAssigned.text()).toBe(200);
    expect(owlColleague.status(), await owlColleague.text()).toBe(200);
    expect((await owlAssigned.json()).data.filter((item: { deterministic_key: string }) => item.deterministic_key === key)).toHaveLength(1);
    expect((await owlColleague.json()).data.some((item: { deterministic_key: string }) => item.deterministic_key === key)).toBe(false);
    expect(await db.notification.count({ where: { organization_id: orgId, deterministic_key: key, recipient_id: assigned.user.id } })).toBe(1);
    expect(await db.notification.count({ where: { organization_id: orgId, deterministic_key: key, recipient_id: colleague.user.id } })).toBe(0);
    const notification = await db.notification.findFirstOrThrow({ where: { organization_id: orgId, deterministic_key: key, recipient_id: assigned.user.id } });
    expect(notification.target_scope).toBe('USER');
    const forbiddenRead = await request.post(`/api/settings/notifications/${notification.id}/read`, { headers: headers(colleague) });
    expect(forbiddenRead.status()).toBe(404);

    await login(page, actors.assigned);
    await page.getByRole('button', { name: /notificaciones sin leer/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notificaciones' }).getByText(title)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /notificaciones sin leer/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notificaciones' }).getByText(title)).toBeVisible();
    await page.getByRole('button', { name: /notificaciones sin leer/ }).click();
    await page.getByRole('button', { name: 'Abrir PRAVIA IA' }).click();
    await expect(page.getByRole('region', { name: 'Centro de acción de PRAVIA IA' }).getByText(title)).toBeVisible();
  } finally {
    if (taskId) {
      const key = `TASK:${taskId}`;
      const records = await db.notification.findMany({ where: { organization_id: orgId, deterministic_key: key }, select: { id: true } });
      await db.notificationReminder.deleteMany({ where: { notification_id: { in: records.map((item) => item.id) } } });
      await db.notification.deleteMany({ where: { organization_id: orgId, deterministic_key: key } });
      await db.auditLog.deleteMany({ where: { entidad: 'Tarea', entidad_id: taskId } });
      await db.tarea.delete({ where: { id: taskId } });
    }
    await context.close();
    await db.$disconnect();
  }
});
