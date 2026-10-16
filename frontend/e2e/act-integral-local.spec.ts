import { expect, test } from '@playwright/test';

test('alta integral del acto persiste procesos y caracteres en Chrome local aislado', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || !['5175', '5176'].includes(base.port) || !password) throw new Error('ACT_INTEGRAL_LOCAL_E2E_SAFETY_GATE_FAILED');

  const name = `Acto integral QA ${Date.now()}`;
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  await email.fill('adrian.hernandez@pravia.test');
  await passwordInput.fill(password);
  // La comprobación inicial de sesión puede volver a montar el formulario.
  // Verificar ambos campos antes de enviar evita un falso fallo de la prueba.
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(email).toHaveValue('adrian.hernandez@pravia.test');
  await expect(passwordInput).toHaveValue(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: /Menú de usuario de Adrián Hernández/ })).toBeVisible();

  await page.goto('/configuracion/actos-tiempos');
  await expect(page.getByRole('button', { name: 'Nuevo acto' })).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo acto' }).click();
  await page.getByLabel('Nombre del acto').fill(name);
  await page.getByRole('combobox', { name: 'Familia', exact: true }).fill('QA integral');
  await page.getByLabel('Jurisdicción').fill('Jalisco');
  await page.getByRole('button', { name: /Procesos no registrables — aplicar default/i }).click();
  await page.getByLabel('Duración de Revisión de expediente').fill('4');
  await page.getByRole('checkbox', { name: 'VENDEDOR' }).check();
  await page.getByRole('checkbox', { name: 'COMPRADOR' }).check();
  await page.getByRole('checkbox', { name: 'APODERADO' }).check();
  await page.getByRole('button', { name: 'Guardar acto' }).click();
  await expect(page.getByText('Acto completo agregado al catálogo canónico.', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('textbox', { name: 'Buscar acto por nombre' }).fill(name);
  const act = page.getByRole('button', { name: new RegExp(name, 'i') }).first();
  await expect(act).toBeVisible();
  await act.click();
  await expect(page.getByText('CARACTERES DE COMPARECIENTES', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^vendedor$/i).first()).toBeVisible();
  await expect(page.getByText(/^comprador$/i).first()).toBeVisible();
  const extraRole = `ADQUIRENTE QA ${Date.now()}`;
  await page.getByLabel('Nuevo carácter de compareciente').fill(extraRole);
  await page.getByRole('button', { name: 'Agregar carácter' }).click();
  await expect(page.getByText(extraRole, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('textbox', { name: 'Buscar acto por nombre' }).fill(name);
  await page.getByRole('button', { name: new RegExp(name, 'i') }).first().click();
  await expect(page.getByText(extraRole, { exact: true })).toBeVisible();
});

test('alta contextual de acto regresa al prospecto con borrador y vínculo persistidos', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || !['5175', '5176'].includes(base.port) || !password) throw new Error('ACT_INTEGRAL_LOCAL_E2E_SAFETY_GATE_FAILED');
  test.setTimeout(180_000);

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: /Menú de usuario de Adrián Hernández/ })).toBeVisible();

  const suffix = Date.now();
  const prospectName = `QA ACTO CONTEXTUAL ${suffix}`;
  const editedName = `${prospectName} REVISADO`;
  const actName = `Acto contextual QA ${suffix}`;
  await page.goto('/prospectos');
  await page.getByRole('button', { name: 'Nuevo prospecto' }).click();
  await page.getByLabel('Nombre o razón social').fill(prospectName);
  await page.getByRole('button', { name: 'Crear prospecto' }).click();
  await page.waitForURL(/\/prospectos\/[0-9a-f-]+$/);
  const prospectUrl = page.url();
  const summary = page.getByRole('heading', { name: 'Resumen' }).locator('xpath=ancestor::section[1]');
  await summary.getByRole('button', { name: 'Editar datos' }).click();
  await summary.getByLabel('Nombre o razón social').fill(editedName);
  await summary.getByRole('link', { name: '+ Crear nuevo acto en Actos y tiempos' }).click();
  await expect(page).toHaveURL(/\/configuracion\/actos-tiempos/);
  await page.getByLabel('Nombre del acto').fill(actName);
  await page.getByRole('combobox', { name: 'Familia', exact: true }).fill('QA contextual');
  await page.getByLabel('Jurisdicción').fill('Jalisco');
  await page.getByRole('button', { name: /Procesos no registrables — aplicar default/i }).click();
  await page.getByRole('checkbox', { name: 'VENDEDOR' }).check();
  await page.getByRole('button', { name: 'Guardar acto' }).click();
  await expect(page).toHaveURL(prospectUrl);
  await expect(summary.getByLabel('Nombre o razón social')).toHaveValue(editedName);
  await expect(summary.getByRole('checkbox', { name: actName })).toBeChecked();
  await summary.getByRole('button', { name: 'Guardar' }).click();
  await expect(summary.getByText(actName)).toBeVisible();
  await expect(summary.getByText(editedName)).toBeVisible();
  await page.reload();
  await expect(summary.getByText(actName)).toBeVisible();
  await expect(summary.getByText(editedName)).toBeVisible();

  await page.getByRole('button', { name: 'Comenzar integración' }).click();
  await page.getByRole('group', { name: 'Confirmar acción' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Marcar listo para cotizar' })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar listo para cotizar' }).click();
  const readiness = page.getByRole('group', { name: 'Confirmar acción' });
  const assignee = readiness.getByRole('combobox', { name: /Quién continuará con la cotización/i });
  const assigneeLabel = (await assignee.locator('option').allTextContents()).find((label) => label.includes('Hernández'));
  expect(assigneeLabel).toBeTruthy();
  await assignee.selectOption({ label: assigneeLabel });
  await readiness.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Convertir en cotización' })).toBeVisible();
  await page.getByRole('button', { name: 'Convertir en cotización' }).click();
  await page.getByRole('group', { name: 'Confirmar acción' }).getByRole('button', { name: 'Confirmar' }).click();
  await page.waitForURL(/\/cotizaciones\/[0-9a-f-]+$/);
  await expect(page.getByText(new RegExp(actName, 'i')).first()).toBeVisible();
  const quoteUrl = page.url();
  const quoteActName = `Acto cotización QA ${suffix}`;
  await page.getByRole('link', { name: '+ Crear nuevo acto en Actos y tiempos' }).click();
  await page.getByLabel('Nombre del acto').fill(quoteActName);
  await page.getByRole('combobox', { name: 'Familia', exact: true }).fill('QA cotización');
  await page.getByLabel('Jurisdicción').fill('Jalisco');
  await page.getByRole('button', { name: /Procesos no registrables — aplicar default/i }).click();
  await page.getByRole('checkbox', { name: 'COMPRADOR' }).check();
  await page.getByRole('button', { name: 'Guardar acto' }).click();
  await expect(page).toHaveURL(quoteUrl);
  await expect(page.getByText(new RegExp(`^${quoteActName}$`, 'i'))).toBeVisible();
  await page.reload();
  await expect(page.getByText(new RegExp(`^${quoteActName}$`, 'i'))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comenzar elaboración' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Comenzar elaboración' }).first().click();
  await page.getByRole('dialog', { name: 'Comenzar elaboración' }).getByRole('button', { name: 'Comenzar elaboración' }).click();
  await expect(page.getByRole('button', { name: 'Registrar envío al cliente' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar envío al cliente' }).click();
  const delivery = page.getByRole('dialog', { name: 'Confirmar envío manual a cliente' });
  await expect(delivery.getByText(/Confirma sólo después de enviarlo por tu canal externo/)).toBeVisible();
  await expect(delivery.getByRole('button', { name: 'Confirmar envío manual' })).toBeVisible();
});

test('cotización QA con acto inactivo bloquea la conversión sin inventar caracteres', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || !['5175', '5176'].includes(base.port) || !password) throw new Error('ACT_INTEGRAL_LOCAL_E2E_SAFETY_GATE_FAILED');
  test.setTimeout(180_000);

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  await email.fill('adrian.hernandez@pravia.test');
  await passwordInput.fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  if (await passwordInput.inputValue() !== password) await passwordInput.fill(password);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: /Menú de usuario de Adrián Hernández/ })).toBeVisible();

  const detailRequest = page.waitForResponse((response) => response.url().endsWith('/api/cotizaciones/ffcc82f4-e576-4edd-af66-3209ae4d3185') && response.request().method() === 'GET');
  await page.goto('/cotizaciones/ffcc82f4-e576-4edd-af66-3209ae4d3185');
  const detailResponse = await detailRequest;
  const quote = await detailResponse.json();
  const authorization = (await detailResponse.request().allHeaders()).authorization;
  expect(authorization).toMatch(/^Bearer /);
  await expect(page.getByText('COT-0495-2026').first()).toBeVisible();
  await page.getByRole('button', { name: 'Convertir en expediente', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convertir a expediente' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Donación no está disponible en el catálogo activo');
  await expect(dialog.getByRole('button', { name: 'Convertir en expediente' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Ir al expediente' })).toHaveCount(0);
  const rejected = await page.request.post(`${base.origin}/api/cotizaciones/${quote.id}/convertir`, { headers: { authorization }, data: {
    tipo_acto_id: quote.actos[0].tipo_acto_id,
    expectedVersion: quote.workflow.version,
    idempotencyKey: crypto.randomUUID(),
    confirm: true,
    effectiveAt: new Date().toISOString(),
    solicitante_caracter_por_acto: Object.fromEntries(quote.actos.map((act: { id: string }) => [act.id, null])),
  } });
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: 'TIPO_ACTO_INACTIVE', error: expect.stringContaining('Donación') });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Ir al expediente' })).toHaveCount(0);
});

test('cotización QA ya convertida conserva su expediente tras recarga y navegación', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || !['5175', '5176'].includes(base.port) || !password) throw new Error('ACT_INTEGRAL_LOCAL_E2E_SAFETY_GATE_FAILED');

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
  await email.fill('adrian.hernandez@pravia.test');
  await passwordInput.fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  if (await passwordInput.inputValue() !== password) await passwordInput.fill(password);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: /Menú de usuario de Adrián Hernández/ })).toBeVisible();

  await page.goto('/cotizaciones/30000000-0000-4000-8000-000000000403');
  const caseLink = page.getByRole('link', { name: 'Ir al expediente' }).first();
  await expect(caseLink).toBeVisible();
  const caseHref = await caseLink.getAttribute('href');
  expect(caseHref).toMatch(/^\/expedientes\/[0-9a-f-]+$/);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Ir al expediente' }).first()).toHaveAttribute('href', caseHref!);
  await page.getByRole('link', { name: 'Ir al expediente' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${caseHref!.replaceAll('/', '\\/')}(?:#.*)?$`));
});
