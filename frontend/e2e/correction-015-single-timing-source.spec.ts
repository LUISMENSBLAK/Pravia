import { expect, test } from '@playwright/test';

const credentials = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };

test('015-20 · la URL legacy conduce a la única fuente Actos y tiempos', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');

  await page.goto('/configuracion/politicas-tiempo', { waitUntil: 'networkidle' });
  await page.waitForURL('**/configuracion/actos-tiempos');
  await expect(page.getByRole('heading', { level: 1, name: 'Actos y tiempos', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Políticas de tiempo/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Actos y tiempos/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catálogo general de procesos', exact: true })).toBeVisible();
});
