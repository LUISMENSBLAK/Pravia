import { expect, test } from '@playwright/test';

const credentials = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };
const expedienteId = process.env.PRAVIA_E2E_EXPEDIENTE_ID || 'e21e9a47-bb94-45ba-8605-e11b8b161726';

test('015-16 · Expediente muestra obligaciones pendientes y no separa plantillas de formatos', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');

  await page.goto(`/expedientes/${expedienteId}#plantillas`, { waitUntil: 'networkidle' });
  const panel = page.getByRole('tabpanel', { name: 'Plantillas y formatos' });
  await expect(panel.getByRole('heading', { name: 'Obligaciones y formatos', exact: true })).toBeVisible();
  await expect(panel).toContainText('Los documentos sólo se crean al pulsar Generar');
  await expect(panel.getByRole('heading', { name: 'Plantillas de la Notaría', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Formatos aplicables', exact: true })).toHaveCount(0);

  const update = panel.getByRole('button', { name: 'Actualizar pendientes', exact: true });
  if (await update.count()) {
    const response = page.waitForResponse((item) => item.request().method() === 'POST' && item.url().includes('/plantillas-formatos/materializar'));
    await update.click();
    expect((await response).ok()).toBe(true);
  }
  await expect(panel).not.toContainText('Generar con IA');
  await expect(panel).not.toContainText('Plantillas de la Notaría');
});
