import { expect, test, type Page } from '@playwright/test';

const expedienteId = '7a139000-0000-4000-8000-000000000001';
const credentials = {
  email: process.env.PRAVIA_E2E_EMAIL || 'qa.correcciones@pravia.test',
  password: (process.env.PRAVIA_E2E_PASSWORD ?? ''),
};

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Bienvenido a PRAVIA OS' })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const password = page.getByRole('textbox', { name: 'Contraseña', exact: true });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await email.fill(credentials.email);
    await password.fill(credentials.password);
    await page.waitForTimeout(100);
    if (await email.inputValue() === credentials.email && await password.inputValue() === credentials.password) break;
  }
  await expect(email).toHaveValue(credentials.email);
  await expect(password).toHaveValue(credentials.password);
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL('**/mi-dia');
}

async function expectPersistedProjectEvidence(page: Page) {
  const pendingSummary = page.locator('strong').filter({ hasText: /^\d+ pendiente\(s\) explícito\(s\) dentro del proyecto$/ });
  await expect(pendingSummary).toBeVisible();
  const pendingText = (await pendingSummary.textContent()) || '';
  const pendingCount = Number(pendingText.match(/^\d+/)?.[0] || 0);
  expect(pendingCount).toBeGreaterThan(0);
  await expect(page.getByText(/PRAVIA no inventó ni los marcó como resueltos/i)).toBeVisible();
  const observationSummaries = page.locator('strong').filter({ hasText: /^\d+ observación\(es\) para revisión humana$/ });
  await expect(observationSummaries.first()).toBeVisible();
  const observationCounts = (await observationSummaries.allTextContents()).map((text) => Number(text.match(/^\d+/)?.[0] || 0));
  expect(observationCounts.length).toBeGreaterThanOrEqual(2);
  expect(observationCounts.every((count) => count > 0)).toBe(true);
  await expect(page.getByText(/40 de 40 fuentes analizadas/i)).toBeVisible();
  await expect(page.locator('p').filter({ hasText: 'Fuentes no leídas:' })).toContainText('01 - PRIMER AVISO PREVENTIVO  UP139.doc');
  const legacyDocNotice = page.locator('p').filter({ hasText: /Formato \.DOC antiguo/i });
  await expect(legacyDocNotice).toBeVisible();
  await expect(legacyDocNotice).toContainText(/requiere revisión manual/i);
  await expect(page.getByText(/Las observaciones no modifican el Word/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Aplicar indicaciones/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Validar proyecto/i })).toBeVisible();
  return { pendingCount, observationCounts };
}

test('EXP-010 conserva pendientes y trazabilidad documental tras reload', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto(`/expedientes/${expedienteId}#proyecto`, { waitUntil: 'networkidle' });
  const beforeReload = await expectPersistedProjectEvidence(page);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`/expedientes/${expedienteId}#proyecto$`));
  const afterReload = await expectPersistedProjectEvidence(page);
  expect(afterReload).toEqual(beforeReload);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 950 },
  { name: 'desktop-1366', width: 1366, height: 900 },
  { name: 'laptop', width: 1024, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 780 },
]) {
  test(`EXP-010 sin overflow horizontal en ${viewport.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page);
    await page.goto(`/expedientes/${expedienteId}#proyecto`, { waitUntil: 'networkidle' });
    await expect(page.locator('strong').filter({ hasText: /^\d+ pendiente\(s\) explícito\(s\) dentro del proyecto$/ })).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(horizontalOverflow).toBe(false);
  });
}
