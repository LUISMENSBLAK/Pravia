import { expect, type Page } from '@playwright/test';

const QA_EMAIL = 'qa.controlplane@pravia.test';

export async function signInLocalControlPlane(page: Page, password: string) {
  await page.goto('/login');
  const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  await expect(emailInput).toBeVisible();

  // A cold Vite dependency optimization can reload the first local page while
  // the form is being filled. Retry only until both controlled inputs persist.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await emailInput.fill(QA_EMAIL);
    await passwordInput.fill(password);
    try {
      await expect(emailInput).toHaveValue(QA_EMAIL, { timeout: 1_000 });
      await expect(passwordInput).toHaveValue(password, { timeout: 1_000 });
      await expect(submit).toBeEnabled({ timeout: 1_000 });
      await submit.click();
      await expect(page).not.toHaveURL(/\/login$/);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}
