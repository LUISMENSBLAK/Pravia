import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, request as requestFactory, test } from '@playwright/test';

const caseId = '7a139000-0000-4000-8000-000000000001';
const organizationId = '30000000-0000-4000-8000-000000000001';
const container = 'pravia-new-lot-qa-20260926';

function localSql(sql: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'pravia', '-d', 'pravia_qa', '-v', 'ON_ERROR_STOP=1', '-t', '-A'], {
    input: sql, encoding: 'utf8', timeout: 15_000,
  }).trim();
}

test('X09/X10 · requisito faltante se resuelve al cargar su documento desde UI', async ({ page }) => {
  const base = new URL(process.env.PRAVIA_E2E_BASE_URL || 'http://invalid.invalid');
  const password = process.env.PRAVIA_E2E_PASSWORD || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176' || !password) throw new Error('MI_DIA_DOCUMENT_FLOW_LOCAL_ONLY');
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ database_mode: 'local', storage_mode: 'local' });
  expect(localSql(`select organization_id from pravia_os.expedientes where id='${caseId}';`)).toBe(organizationId);
  const requirementId = randomUUID();
  const requirementName = `QA X09 documento requerido ${requirementId.slice(0, 8)}`;
  const api = await requestFactory.newContext({ baseURL: base.origin });
  const login = await api.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { access_token: string }).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const getConfig = async () => {
    const response = await api.get('/api/mi-dia/config', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { data: any }).data;
  };
  const getMissing = async () => {
    const response = await api.get('/api/mi-dia', { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { operacion: { documento_cards: Record<string, {
      count: number; items: Array<{ id: string; href: string }>;
    }> } }).operacion.documento_cards.MISSING_DOCUMENTS;
  };
  const original = await getConfig();
  const tenant = original.tenantAdministration;
  let documentId: string | null = null;
  try {
    const updateTenant = await api.put('/api/mi-dia/tenant-config', { headers, data: {
      version: tenant.version,
      enabled_cards: [...new Set([...tenant.enabledCards, 'MISSING_DOCUMENTS'])],
      default_layout: tenant.defaultLayout,
      fixed_cards: tenant.defaultLayout.filter((item: any) => item.fixed).map((item: any) => item.key),
      recommended_cards: tenant.recommendedCards,
    } });
    expect(updateTenant.status()).toBe(200);
    const configured = await getConfig();
    const layoutUpdate = await api.put('/api/mi-dia/layout', { headers, data: {
      version: configured.layoutVersion,
      layout: configured.layout.some((item: any) => item.key === 'MISSING_DOCUMENTS')
        ? configured.layout : [...configured.layout, { key: 'MISSING_DOCUMENTS',
          size: configured.catalog.find((item: any) => item.key === 'MISSING_DOCUMENTS').defaultSize,
          scope: 'ORGANIZATION', parameters: {} }],
    } });
    expect(layoutUpdate.status()).toBe(200);
    const before = await getMissing();
    localSql(`insert into pravia_os.expediente_requisitos_doc (id,organization_id,expediente_id,nombre,categoria,obligatorio,estatus,created_at,updated_at)
      values ('${requirementId}','${organizationId}','${caseId}','${requirementName}','OTROS',true,'PENDIENTE',now(),now());`);
    const missing = await getMissing();
    expect(missing.count).toBe(before.count + 1);
    expect(missing.items.map((item) => item.id)).toContain(requirementId);

    await page.goto('/login');
    const emailInput = page.getByRole('textbox', { name: 'Correo electrónico' });
    const passwordInput = page.getByRole('textbox', { name: 'Contraseña' });
    const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await emailInput.fill('adrian.hernandez@pravia.test');
      await passwordInput.fill(password);
      await page.waitForTimeout(100);
      if (await submit.isEnabled()) break;
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/mi-dia$/);
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Documentos faltantes', exact: true }) }).first();
    const requirementLink = card.getByRole('link').filter({ hasText: requirementName });
    await expect(requirementLink).toHaveAttribute('href', `/expedientes/${caseId}#documentos`);
    await page.reload();
    await expect(requirementLink).toBeVisible();
    await requirementLink.click();
    await expect(page).toHaveURL(new RegExp(`/expedientes/${caseId}#documentos$`));
    const section = page.getByRole('region', { name: 'Requisitos documentales' });
    await expect(section.getByText(new RegExp(requirementName))).toContainText('Pendiente');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(async () => section.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(width + 1);
      const bounds = await section.boundingBox();
      const actionBounds = await section.getByRole('button', { name: `Cargar documento para ${requirementName}` }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(actionBounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(actionBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      expect(actionBounds!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await section.getByRole('button', { name: `Cargar documento para ${requirementName}` }).click();
    const upload = page.waitForResponse((response) => response.url().endsWith(`/api/expedientes/${caseId}/documentos`)
      && response.request().method() === 'POST');
    await section.locator('input[type="file"]').setInputFiles({
      name: `qa-x10-${requirementId}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nQA isolated document\n'),
    });
    const uploaded = await upload;
    expect(uploaded.status()).toBe(201);
    documentId = (await uploaded.json() as { documento: { id: string; requisito_id: string } }).documento.id;
    expect((await uploaded.json() as { documento: { requisito_id: string } }).documento.requisito_id).toBe(requirementId);
    await expect(section.getByText(new RegExp(requirementName))).toContainText('Recibido');
    const after = await getMissing();
    expect(after.count).toBe(before.count);
    expect(after.items.map((item) => item.id)).not.toContain(requirementId);
    await page.goto('/mi-dia');
    await expect(card.getByRole('link').filter({ hasText: requirementName })).toHaveCount(0);
    await page.reload();
    await expect(card.getByRole('link').filter({ hasText: requirementName })).toHaveCount(0);
    expect(localSql(`select count(*) from pravia_os.requisito_documento_vinculos where requisito_id='${requirementId}' and documento_id='${documentId}' and estatus='ACTIVO';`)).toBe('1');
  } finally {
    if (documentId) await api.delete(`/api/expedientes/${caseId}/documentos/${documentId}`, { headers });
    localSql(`delete from pravia_os.requisito_documento_vinculos where requisito_id='${requirementId}';
      delete from pravia_os.expediente_requisitos_doc where id='${requirementId}';`);
    const current = await getConfig();
    const restoreLayout = original.personalized ? api.put('/api/mi-dia/layout', { headers,
      data: { version: current.layoutVersion, layout: original.layout } })
      : api.delete('/api/mi-dia/layout', { headers });
    expect((await restoreLayout).status()).toBe(200);
    const afterLayout = await getConfig();
    const restoreTenant = await api.put('/api/mi-dia/tenant-config', { headers, data: {
      version: afterLayout.tenantAdministration.version,
      enabled_cards: tenant.enabledCards,
      default_layout: tenant.defaultLayout,
      fixed_cards: tenant.defaultLayout.filter((item: any) => item.fixed).map((item: any) => item.key),
      recommended_cards: tenant.recommendedCards,
    } });
    expect(restoreTenant.status()).toBe(200);
    await api.dispose();
  }
});
