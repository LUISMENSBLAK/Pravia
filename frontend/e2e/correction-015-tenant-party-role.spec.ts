import { expect, test } from '@playwright/test';

const credentials = { email: 'qa.correcciones@pravia.test', password: (process.env.PRAVIA_E2E_PASSWORD ?? '') };
const expedienteId = process.env.PRAVIA_E2E_EXPEDIENTE_ID || 'e21e9a47-bb94-45ba-8605-e11b8b161726';
const roleName = 'ALBACEA QA 015';

test('015-09 · crea un rol de la Notaría, lo selecciona y lo reutiliza tras recargar', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(credentials.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');

  await page.goto(`/expedientes/${expedienteId}#comparecientes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Agregar compareciente', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Agregar compareciente' });
  await expect(dialog.getByLabel('Acto')).not.toHaveValue('');
  await dialog.getByRole('button', { name: /Nueva comparecencia \/ rol/ }).click();
  await dialog.getByLabel('Nombre del rol').fill('albacea qa 015');
  await dialog.getByLabel('Descripción').fill('Rol sintético local para validación de Corrección 015');
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/comparecientes/roles'));
  await dialog.getByRole('button', { name: 'Crear y seleccionar', exact: true }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(dialog.getByLabel('Rol / carácter')).toHaveValue(/.+/);
  await expect(dialog.getByRole('option', { name: roleName, exact: true })).toBeAttached();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).last().click();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Agregar compareciente', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Agregar compareciente' });
  await expect(dialog.getByRole('option', { name: roleName, exact: true })).toBeAttached();
  await dialog.getByLabel('Rol / carácter').selectOption({ label: roleName });
  await expect(dialog.getByLabel('Rol / carácter')).toHaveValue(/.+/);
});
