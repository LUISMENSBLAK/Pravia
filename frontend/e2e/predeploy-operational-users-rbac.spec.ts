import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.PRAVIA_E2E_API_URL || 'http://127.0.0.1:3001';
const organizationId = '30000000-0000-4000-8000-000000000001';
const foreignOrganizationId = '30000000-0000-4000-8000-0000000000b1';
const foreignDocumentId = '7fc966b3-0488-4917-91de-27bf525b01d4';
const financialExpedienteId = '304fdd79-c56f-4035-8865-f435d1ebe21f';

type UserCase = {
  key: string;
  name: string;
  email: string;
  password: string;
  role: 'ABOGADO' | 'DIRECCION' | 'FINANCIERO';
  visible: string[];
  hidden: string[];
};

const requiredPassword = (key: string) => {
  const password = process.env[key];
  if (!password) throw new Error(`Falta ${key} para validar los usuarios locales.`);
  return password;
};

const lawyerVisible = ['Mi Día', 'Prospectos', 'Cotizaciones', 'Expedientes', 'Predios', 'Notarías', 'Comparecientes', 'Agenda', 'Reportes', 'Cálculo ISR', 'Cumplimiento'];
const users: UserCase[] = [
  { key: 'JAVIER', name: 'Javier Tapia', email: 'javier.tapia@pravia.test', password: requiredPassword('PRAVIA_USER_JAVIER_PASSWORD'), role: 'ABOGADO', visible: lawyerVisible, hidden: ['Finanzas'] },
  { key: 'ALEJANDRO', name: 'Alejandro Abarca', email: 'alejandro.abarca@pravia.test', password: requiredPassword('PRAVIA_USER_ALEJANDRO_PASSWORD'), role: 'ABOGADO', visible: lawyerVisible, hidden: ['Finanzas'] },
  { key: 'MARIA', name: 'María Careaga', email: 'maria.careaga@pravia.test', password: requiredPassword('PRAVIA_USER_MARIA_PASSWORD'), role: 'ABOGADO', visible: lawyerVisible, hidden: ['Finanzas'] },
  { key: 'ADRIAN', name: 'Adrián Hernández', email: 'adrian.hernandez@pravia.test', password: requiredPassword('PRAVIA_USER_ADRIAN_PASSWORD'), role: 'DIRECCION', visible: [...lawyerVisible, 'Finanzas'], hidden: [] },
  { key: 'ROSA', name: 'Rosa Dolores Becerra', email: 'rosa.becerra@pravia.test', password: requiredPassword('PRAVIA_USER_ROSA_PASSWORD'), role: 'FINANCIERO', visible: ['Mi Día', 'Finanzas', 'Reportes'], hidden: ['Prospectos', 'Cotizaciones', 'Expedientes', 'Predios', 'Notarías', 'Comparecientes', 'Agenda', 'Cálculo ISR', 'Cumplimiento'] },
];

async function uiLogin(page: Page, user: UserCase) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const password = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await email.fill(user.email);
    await password.fill(user.password);
    await page.waitForTimeout(100);
    if (await email.inputValue() === user.email && await password.inputValue() === user.password) break;
  }
  await expect(email).toHaveValue(user.email);
  await expect(password).toHaveValue(user.password);
  await expect(submit).toBeEnabled();
  const loginResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await submit.click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status(), `${user.name}: login UI/API`).toBe(200);
  const payload = await loginResponse.json();
  expect(payload.user).toMatchObject({ email: user.email, rol: user.role, organization: { id: organizationId } });
  await page.waitForURL('**/mi-dia');
  await expect(page.getByRole('button', { name: new RegExp(`Menú de usuario de ${user.name}`, 'i') })).toBeVisible();
  return { token: String(payload.access_token), payload };
}

async function uiLogout(page: Page, user: UserCase) {
  await page.getByRole('button', { name: new RegExp(`Menú de usuario de ${user.name}`, 'i') }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await page.waitForURL('**/login');
}

async function expectDenied(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(String(body.code || '')).toMatch(/DENIED|FORBIDDEN|PERMISSION/);
}

test('cinco usuarios operativos · login, RBAC, object access, IA, aislamiento y sesión', async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 950 });

  for (const user of users) {
    let authenticated: { token: string; payload: any } | null = null;
    await test.step(`${user.name} · login real, organización y rol persistidos`, async () => {
      authenticated = await uiLogin(page, user);
      const { token, payload } = authenticated;
      const headers = { Authorization: `Bearer ${token}` };
      const me = await request.get(`${apiBase}/api/auth/me`, { headers });
      expect(me.status()).toBe(200);
      const mePayload = await me.json();
      expect(mePayload.user).toMatchObject({ email: user.email, rol: user.role, organization: { id: organizationId }, organizations: [{ id: organizationId }] });
      expect(mePayload.user.permissions).toEqual(payload.user.permissions);

      const foreignDocument = await request.get(`${apiBase}/api/documentos/${foreignDocumentId}/url`, { headers });
      await expectDenied(foreignDocument);

      const tools = await request.get(`${apiBase}/api/ia/assistant/tools`, { headers });
      expect(tools.status()).toBe(200);
      const names = (await tools.json()).tools.map((tool: { name: string }) => tool.name);

      if (user.role === 'FINANCIERO') {
        expect(names).toContain('getFinancialSummary');
        expect(names).toContain('getReportingSummary');
        expect(names).not.toContain('getExpedienteSummary');
        const finance = await request.get(`${apiBase}/api/finanzas/resumen?periodo=30_DIAS`, { headers });
        expect(finance.status()).toBe(200);
        const invoices = await request.get(`${apiBase}/api/finanzas/facturacion/expedientes`, { headers });
        expect(invoices.status()).toBe(200);
        const invoicePayload = await invoices.json();
        expect(invoicePayload.data?.source || invoicePayload.source).toBe('expediente_ingresos_reportados');
        const reports = await request.get(`${apiBase}/api/reportes/finanzas?periodo=ESTE_MES`, { headers });
        expect(reports.status()).toBe(200);
        await expectDenied(await request.get(`${apiBase}/api/expedientes?page=1&pageSize=1`, { headers }));
        await expectDenied(await request.get(`${apiBase}/api/settings/audit`, { headers }));
        const expedienteInvoiceMutation = await request.post(`${apiBase}/api/expedientes/${financialExpedienteId}/finanzas-operativas/ingresos/00000000-0000-0000-0000-000000000000/factura`, { headers });
        await expectDenied(expedienteInvoiceMutation);
        const legalTool = await request.post(`${apiBase}/api/ia/assistant/tools/getExpedienteSummary`, { headers, data: { args: { expediente_id: financialExpedienteId } } });
        await expectDenied(legalTool);
        const financialTool = await request.post(`${apiBase}/api/ia/assistant/tools/getFinancialSummary`, { headers, data: { args: { expediente_id: financialExpedienteId } } });
        expect(financialTool.status(), JSON.stringify(await financialTool.json())).toBe(200);
      } else if (user.role === 'ABOGADO') {
        expect(names).toContain('getExpedienteSummary');
        expect(names).not.toContain('getFinancialSummary');
        for (const path of ['/api/prospectos?page=1&pageSize=1', '/api/cotizaciones?page=1&pageSize=1', '/api/expedientes?page=1&pageSize=1', '/api/comparecientes?page=1&pageSize=1']) {
          expect((await request.get(`${apiBase}${path}`, { headers })).status(), `${user.name}: ${path}`).toBe(200);
        }
        await expectDenied(await request.get(`${apiBase}/api/finanzas/resumen?periodo=30_DIAS`, { headers }));
        await expectDenied(await request.get(`${apiBase}/api/settings/audit`, { headers }));
      } else {
        expect(names).toContain('getExpedienteSummary');
        expect(names).toContain('getFinancialSummary');
        expect((await request.get(`${apiBase}/api/expedientes?page=1&pageSize=1`, { headers })).status()).toBe(200);
        expect((await request.get(`${apiBase}/api/finanzas/resumen?periodo=30_DIAS`, { headers })).status()).toBe(200);
        expect((await request.get(`${apiBase}/api/settings/audit`, { headers })).status()).toBe(200);
        const switchTenant = await request.post(`${apiBase}/api/auth/organization`, { headers, data: { organizationId: foreignOrganizationId } });
        await expectDenied(switchTenant);
        expect(mePayload.user.organizations).toHaveLength(1);
      }

    });

    await test.step(`${user.name} · Chrome real, módulos, reload, logout y reingreso`, async () => {
      expect(authenticated).not.toBeNull();
      const sidebar = page.locator('aside[aria-label="Navegación principal"]');
      for (const label of user.visible) await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
      for (const label of user.hidden) await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveCount(0);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page).toHaveURL(/\/mi-dia$/);
      await expect(page.getByRole('button', { name: new RegExp(`Menú de usuario de ${user.name}`, 'i') })).toBeVisible();
      await uiLogout(page, user);
      await uiLogin(page, user);
      await expect(page.getByRole('button', { name: new RegExp(`Menú de usuario de ${user.name}`, 'i') })).toBeVisible();
      await uiLogout(page, user);
    });
  }
});
