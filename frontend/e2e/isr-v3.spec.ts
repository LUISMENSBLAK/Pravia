import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const evidenceDir = resolve(process.cwd(), 'artifacts/qa-isr-v3');
const fixtureUrl = '/calculo-isr/fixture-isr-2026?fixture=result&visual=1';

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(process.env.PRAVIA_E2E_EMAIL || 'qa.correcciones@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill((process.env.PRAVIA_E2E_PASSWORD ?? ''));
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(process.env.PRAVIA_E2E_EMAIL || 'qa.correcciones@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
}

async function mockResources(page: Page) {
  await page.route('**/isr/resources**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        legal_date: '2026-08-17', references: [], export_profiles: [], rule_sets: [],
        acts: [
          { id: 'type-1', name: 'Compraventa de inmueble', code: 'COMPRAVENTA_INMUEBLE' },
          { id: 'type-2', name: 'Donación de inmueble', code: 'DONACION_INMUEBLE' },
        ],
        catalogs: { countries: [
          { code: 'MX', label: 'México' },
          { code: 'US', label: 'Estados Unidos' },
          { code: 'CA', label: 'Canadá' },
          { code: 'OTRO', label: 'Otro' },
        ] },
      } }),
    });
  });
}

async function openFixture(page: Page) {
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'ISR-2026-00418', exact: true })).toBeVisible();
}

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectAssistantLauncherClearOfContent(page: Page) {
  const overlap = await page.evaluate(() => {
    const launcher = document.querySelector<HTMLElement>('button[aria-label="Abrir PRAVIA IA"]');
    if (!launcher) return { missing: true, blockedBy: null };
    const rect = launcher.getBoundingClientRect();
    const previousVisibility = launcher.style.visibility;
    launcher.style.visibility = 'hidden';
    const below = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) as HTMLElement | null;
    launcher.style.visibility = previousVisibility;
    const blocked = below?.closest<HTMLElement>('article, section, button, a, input, select, textarea, [role="row"], [role="button"], [role="navigation"]');
    return {
      missing: false,
      blockedBy: blocked ? `${blocked.tagName}:${blocked.getAttribute('aria-label') || blocked.textContent?.trim().slice(0, 80) || blocked.className}` : null,
    };
  });
  expect(overlap.missing).toBe(false);
  expect(overlap.blockedBy).toBeNull();
}

test.beforeEach(async ({ page }) => {
  await mockResources(page);
  await login(page);
});

test('ISR v3 · presenta exactamente los siete bloques verticales y retira la UI anterior', async ({ page }) => {
  await openFixture(page);
  const flow = page.locator('form main');
  await expect(flow.getByRole('heading', { level: 2 })).toHaveText([
    'Acto',
    'Inmueble',
    'Valores y adquisición',
    'IVA',
    'Comparecientes / partes',
    'Deducciones y variables fiscales adicionales',
    'Resultados',
  ]);
  await expect(page.getByText('ISR-001 · MOTOR V3', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Inmueble y operación|Partes y contribuyente|Resultado federal/i })).toHaveCount(0);
  await expect(page.getByText(/wizard|modo avanzado/i)).toHaveCount(0);
});

test('ISR v3 · selector de acto consume el catálogo y conserva fallback explícito', async ({ page }) => {
  await openFixture(page);
  const act = page.locator('label').filter({ hasText: /^Acto/ }).locator('select');
  await expect(act.locator('option')).toHaveText([
    'Otro / no catalogado',
    'Compraventa de inmueble',
    'Donación de inmueble',
  ]);
  await act.selectOption('');
  await expect(page.getByLabel('Especifique', { exact: true })).toBeVisible();
  await page.getByLabel('Especifique', { exact: true }).fill('Operación no catalogada para revisión humana');
  await act.selectOption('type-1');
  await expect(page.getByLabel('Especifique', { exact: true })).toHaveCount(0);
});

test('ISR v3 · activa únicamente las ramas fiscales condicionadas por las partes', async ({ page }) => {
  await openFixture(page);
  const seller = page.locator('article').filter({ has: page.locator('input[value="María Fernanda López Ramírez"]') }).first();
  const buyer = page.locator('article').filter({ has: page.locator('input[value="Roberto Salinas Vélez"]') }).first();
  await seller.getByLabel('Residencia fiscal').selectOption('EXTRANJERO');
  await expect(seller.getByText('Solicitar opción de cálculo sobre ganancia', { exact: true })).toBeVisible();
  await seller.getByText('Solicitar opción de cálculo sobre ganancia', { exact: true }).click();
  await expect(seller.getByText('Requisitos de la opción verificados', { exact: true })).toBeVisible();
  await buyer.getByText('Existe excepción legal de ISR por adquisición', { exact: true }).click();
  await expect(buyer.getByLabel('Fundamento legal', { exact: true })).toBeVisible();
});

test('ISR v3 · muestra resultados humanos, trazabilidad legal y salida CFG-002', async ({ page }) => {
  await openFixture(page);
  await expect(page.getByRole('heading', { name: 'ISR enajenación', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ISR adquisición', exact: true })).toBeVisible();
  await expect(page.getByText('Gravado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No generado', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generar documento', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Fundamento de ISR enajenación/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Fundamento aplicado', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/LISR artículos 119, 120, 121 y 126/)).toBeVisible();
  await expect(dialog.getByText('Regla aplicada por PRAVIA', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Generar documento', exact: true }).click();
  await expect(page.getByText('Documento de validación preparado con el formato CFG-002 activo.', { exact: true })).toBeVisible();
  await expect(page.getByText(/GRAVADO|NO_GENERADO|PENDIENTE_INFORMACION/, { exact: true })).toHaveCount(0);
});

test('ISR v3 · responsive real sin overflow en seis resoluciones', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await openFixture(page);
    await expectNoPageOverflow(page);
    await expectAssistantLauncherClearOfContent(page);
    await expect(page.getByRole('heading', { name: 'Resultados', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/isr-v3-${viewport.width}.png`, fullPage: true });
  }
});
