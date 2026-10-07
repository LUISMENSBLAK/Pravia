import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// This is deliberately pinned to the isolated Docker QA database. It cannot
// discover or write to a cloud database, and runs only after the health gate.
const localSql = (sql: string) => execFileSync('docker', ['exec', 'pravia-new-lot-qa-20260926', 'psql', '-X', '-A', '-t', '-U', 'pravia', '-d', 'pravia_qa', '-c', sql], { encoding: 'utf8' }).trim();
const qaMembershipSql = `SELECT m.user_id, m.organization_id FROM pravia_os.organization_memberships m JOIN pravia_os.users u ON u.id=m.user_id WHERE u.email='adrian.hernandez@pravia.test' AND m.status='ACTIVE' LIMIT 1`;
const availableCasesSql = `SELECT e.id FROM pravia_os.expedientes e WHERE e.organization_id=(SELECT organization_id FROM (${qaMembershipSql}) qa) AND e.archived_at IS NULL AND e.numero_escritura IS NULL AND e.folio_desde IS NULL AND e.folio_hasta IS NULL AND e.fecha_escritura IS NULL AND NOT EXISTS (SELECT 1 FROM pravia_os.archivo_registros a WHERE a.expediente_id=e.id) ORDER BY e.created_at DESC LIMIT 20`;
function availableLocalCases() {
  let cases = localSql(availableCasesSql).split('\n').filter(Boolean);
  if (cases.length < 2) {
    localSql(`WITH principal AS (${qaMembershipSql}) INSERT INTO pravia_os.expedientes (id, organization_id, numero_pravia, abogado_id, creador_id, cliente_alias) SELECT gen_random_uuid(), principal.organization_id, 'EXP-QA-ARCH-' || substr(md5(random()::text || clock_timestamp()::text),1,10), principal.user_id, principal.user_id, 'Archivo QA sintético' FROM principal CROSS JOIN generate_series(1,3)`);
    cases = localSql(availableCasesSql).split('\n').filter(Boolean);
  }
  return cases;
}

test('Archivo local: concurrencia, solape, cronología, no pasó y folio inutilizado', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_ARCHIVO_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local' });
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  const login = page.waitForResponse((response) => response.url().endsWith('/api/auth/login'), { timeout: 60_000 });
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const token = (await (await login).json()).access_token;
  expect(token).toBeTruthy();
  let auth = { Authorization: `Bearer ${token}` };
  const overview = await page.request.get('/api/archivo', { headers: auth });
  expect(overview.status(), JSON.stringify(await overview.json())).toBe(200);
  const before = await overview.json();
  const assigned = new Set(before.records.map((record: { expediente_id: string }) => record.expediente_id));
  const available = availableLocalCases().filter((id) => !assigned.has(id));
  expect(available.length).toBeGreaterThanOrEqual(2);
  const number = before.next_numero_escritura || '23501';
  const folio = before.next_folio || '39521';
  const latestDate = before.records[0]?.fecha_instrumento || '2026-10-05';
  const previousDay = new Date(Date.parse(`${latestDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const body = { numero_escritura: number, folio_inicio: folio, folio_fin: folio, fecha_instrumento: latestDate };

  const [first, second] = await Promise.all(available.slice(0, 2).map((id) => page.request.post(`/api/expedientes/${id}/archivo`, { headers: auth, data: body })));
  expect([first.status(), second.status()].sort((a, b) => a - b), `${await first.text()} | ${await second.text()}`).toEqual([201, 409]);
  const afterRace = await (await page.request.get('/api/archivo', { headers: auth })).json();
  expect(afterRace.records.filter((record: { numero_escritura: string }) => record.numero_escritura === number)).toHaveLength(1);
  const winner = first.status() === 201 ? await first.json() : await second.json();
  const loserId = first.status() === 201 ? available[1] : available[0];
  await page.goto(`/expedientes/${winner.expediente_id}#archivo`);
  const form = page.getByRole('region', { name: 'Datos del instrumento' });
  await expect(form.getByRole('heading', { name: `Escritura ${number}` })).toBeVisible();
  await expect(form.getByLabel('Folio inicial')).toHaveValue(folio);
  const expandedFinal = (BigInt(folio) + BigInt(9)).toString();
  await form.getByLabel('Folio final').fill(expandedFinal);
  await expect(form.getByLabel('Número de folios')).toHaveValue('10');
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(form.getByRole('status')).toContainText('Registro actualizado');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Datos del instrumento' }).getByLabel('Folio final')).toHaveValue(expandedFinal);
  const apiLogin = await request.post('/api/auth/login', { data: { email: 'adrian.hernandez@pravia.test', password } });
  expect(apiLogin.status()).toBe(200);
  auth = { Authorization: `Bearer ${(await apiLogin.json()).access_token}` };
  const freshAuth = () => auth;
  const afterInline = await (await request.get('/api/archivo', { headers: auth })).json();
  const nextNumber = afterInline.next_numero_escritura;
  const nextFolio = afterInline.next_folio;

  const overlap = await request.post(`/api/expedientes/${loserId}/archivo`, { headers: freshAuth(), data: { numero_escritura: nextNumber, folio_inicio: folio, folio_fin: folio, fecha_instrumento: latestDate } });
  expect(overlap.status(), JSON.stringify(await overlap.json())).toBe(409);

  const priorDate = await request.post(`/api/expedientes/${loserId}/archivo`, { headers: freshAuth(), data: { numero_escritura: nextNumber, folio_inicio: nextFolio, folio_fin: nextFolio, fecha_instrumento: previousDay } });
  expect(priorDate.status(), JSON.stringify(await priorDate.json())).toBe(409);

  const sameDate = await request.post(`/api/expedientes/${loserId}/archivo`, { headers: freshAuth(), data: { numero_escritura: nextNumber, folio_inicio: nextFolio, folio_fin: nextFolio, fecha_instrumento: latestDate } });
  expect(sameDate.status(), JSON.stringify(await sameDate.json())).toBe(201);

  const noPaso = await request.patch(`/api/archivo/${winner.id}`, { headers: freshAuth(), data: { no_paso: true } });
  expect(noPaso.status(), JSON.stringify(await noPaso.json())).toBe(200);
  expect((await noPaso.json()).no_paso).toBe(true);

  const afterTwo = await (await request.get('/api/archivo', { headers: freshAuth() })).json();
  const unused = await request.post('/api/archivo/folios-inutilizados', { headers: freshAuth(), data: { folio_inicio: afterTwo.next_folio, folio_fin: afterTwo.next_folio, fecha_instrumento: latestDate, motivo: 'Prueba local de secuencia' } });
  expect(unused.status(), JSON.stringify(await unused.json())).toBe(201);
  const afterUnused = await (await request.get('/api/archivo', { headers: freshAuth() })).json();
  expect(BigInt(afterUnused.next_folio)).toBe(BigInt(afterTwo.next_folio) + BigInt(1));
  expect(afterUnused.next_numero_escritura).toBe(afterTwo.next_numero_escritura);
});

test('Archivo local: alta desde el módulo principal usa el mismo registro del expediente', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_ARCHIVO_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local' });
  const seeded = localSql(`WITH principal AS (${qaMembershipSql}) INSERT INTO pravia_os.expedientes (id, organization_id, numero_pravia, abogado_id, creador_id, cliente_alias) SELECT gen_random_uuid(), principal.organization_id, 'EXP-QA-ARCH-' || substr(md5(random()::text || clock_timestamp()::text),1,10), principal.user_id, principal.user_id, 'Alta Archivo desde módulo' FROM principal RETURNING id, numero_pravia`);
  const [caseId, caseFolio] = seeded.split('\n')[0].split('|');
  expect(caseId).toMatch(/^[a-f0-9-]{36}$/);
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  const login = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  let token = (await (await login).json()).access_token as string;
  expect(token).toBeTruthy();
  await page.waitForURL('**/mi-dia');
  await page.goto('/archivo');
  await expect(page.getByRole('heading', { name: 'Archivo', exact: true })).toBeVisible();
  await page.getByLabel('Buscar expediente').fill(caseFolio);
  await expect(page.locator('select').filter({ has: page.locator(`option[value="${caseId}"]`) })).toBeVisible();
  await page.getByRole('combobox', { name: 'Expediente' }).selectOption(caseId);
  const form = page.getByRole('region', { name: 'Datos del instrumento' });
  await expect(form.getByLabel('Número de escritura')).toHaveValue(/^\d+$/);
  await expect(form.getByLabel('Folio inicial')).toHaveValue(/^\d+$/);
  const number = await form.getByLabel('Número de escritura').inputValue();
  const folio = await form.getByLabel('Folio inicial').inputValue();
  await form.getByLabel('Fecha de firma / instrumento').fill(localSql("SELECT fecha_instrumento FROM pravia_os.archivo_registros WHERE organization_id='30000000-0000-4000-8000-000000000001' AND clase='INSTRUMENTO' ORDER BY numero_escritura DESC LIMIT 1"));
  const save = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${caseId}/archivo`) && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Asignar escritura y folios' }).click();
  const saved = await save;
  expect(saved.status(), await saved.text()).toBe(201);
  const record = await saved.json();
  expect(record).toMatchObject({ expediente_id: caseId, numero_escritura: number, folio_inicio: folio, folio_fin: folio });
  await page.goto(`/expedientes/${caseId}#archivo`);
  await expect(page.getByRole('heading', { name: `Escritura ${number}` })).toBeVisible();
  const refreshed = await page.request.post('/api/auth/refresh');
  expect(refreshed.status()).toBe(200);
  token = (await refreshed.json()).access_token;
  const response = await page.request.get(`/api/expedientes/${caseId}/archivo`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  expect((await response.json()).record.id).toBe(record.id);
  expect(localSql(`SELECT id FROM pravia_os.archivo_registros WHERE expediente_id='${caseId}'`)).toBe(record.id);
});

test('Archivo local: alta desde Expediente aparece en módulo principal sin duplicado', async ({ page }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_ARCHIVO_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local' });
  const seeded = localSql(`WITH principal AS (${qaMembershipSql}) INSERT INTO pravia_os.expedientes (id, organization_id, numero_pravia, abogado_id, creador_id, cliente_alias) SELECT gen_random_uuid(), principal.organization_id, 'EXP-QA-ARCH-' || substr(md5(random()::text || clock_timestamp()::text),1,10), principal.user_id, principal.user_id, 'Alta Archivo desde expediente' FROM principal RETURNING id, numero_pravia`);
  const [caseId] = seeded.split('\n')[0].split('|');
  expect(caseId).toMatch(/^[a-f0-9-]{36}$/);
  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/mi-dia');
  await page.goto(`/expedientes/${caseId}#archivo`);
  const archiveTab = page.getByRole('tab', { name: 'Archivo' });
  const activityTab = page.getByRole('tab', { name: 'Actividad' });
  await expect(archiveTab).toBeVisible();
  await expect(activityTab).toBeVisible();
  const tabNames = (await page.getByRole('tab').allTextContents()).map((name) => name.trim());
  expect(tabNames.indexOf('Archivo')).toBeLessThan(tabNames.indexOf('Actividad'));
  const form = page.getByRole('region', { name: 'Datos del instrumento' });
  await expect(form.getByRole('button', { name: 'Asignar escritura y folios' })).toBeVisible();
  const number = await form.getByLabel('Número de escritura').inputValue();
  const folio = await form.getByLabel('Folio inicial').inputValue();
  expect(number).toMatch(/^\d+$/);
  expect(folio).toMatch(/^\d+$/);
  await form.getByLabel('Fecha de firma / instrumento').fill(localSql("SELECT fecha_instrumento FROM pravia_os.archivo_registros WHERE organization_id='30000000-0000-4000-8000-000000000001' AND clase='INSTRUMENTO' ORDER BY numero_escritura DESC LIMIT 1"));
  const save = page.waitForResponse((response) => response.url().endsWith(`/expedientes/${caseId}/archivo`) && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Asignar escritura y folios' }).click();
  const saved = await save;
  expect(saved.status(), await saved.text()).toBe(201);
  const record = await saved.json();
  await page.reload();
  await expect(page.getByRole('heading', { name: `Escritura ${number}` })).toBeVisible();
  await page.goto('/archivo');
  await expect(page.getByRole('button', { name: new RegExp(`${number}.*${folio}`) })).toBeVisible();
  expect(localSql(`SELECT COUNT(*),MIN(id::text) FROM pravia_os.archivo_registros WHERE expediente_id='${caseId}'`)).toBe(`1|${record.id}`);
});

test('Archivo local: ningún tenant lee ni asigna el protocolo de otra notaría', async ({ page, request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL || ''));
  const password = process.env.PRAVIA_E2E_PASSWORD;
  if (base.hostname !== '127.0.0.1' || !password) throw new Error('LOCAL_ARCHIVO_QA_SAFETY_GATE_FAILED');
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({ database_mode: 'local', database_primary: 'local', storage_mode: 'local' });
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const bEmail = `archive-tenant-b-${suffix}@pravia.test`;
  const bPassword = `Synthetic-Archive-B-${suffix}!`;
  localSql(`WITH organization AS (SELECT id FROM pravia_os.organizations WHERE id='30000000-0000-4000-8000-0000000000b1'), actor AS (INSERT INTO pravia_os.users (id,email,password_hash,nombre,apellido,rol,activo,requires_password_change,password_changed_at,updated_at) SELECT gen_random_uuid(),'${bEmail}',pravia_os.crypt('${bPassword}',pravia_os.gen_salt('bf',12)),'QA','Archivo B','DIRECCION',true,false,now(),now() FROM organization RETURNING id) INSERT INTO pravia_os.organization_memberships (id,organization_id,user_id,rol,status,updated_at) SELECT gen_random_uuid(),organization.id,actor.id,'DIRECCION','ACTIVE',now() FROM organization CROSS JOIN actor`);
  const bCaseId = localSql(`WITH actor AS (SELECT m.user_id,m.organization_id FROM pravia_os.organization_memberships m JOIN pravia_os.users u ON u.id=m.user_id WHERE u.email='${bEmail}') INSERT INTO pravia_os.expedientes (id,organization_id,numero_pravia,abogado_id,creador_id,cliente_alias) SELECT gen_random_uuid(),actor.organization_id,'EXP-QA-B-${suffix}',actor.user_id,actor.user_id,'Expediente privado de notaría B' FROM actor RETURNING id`).split('\n')[0];
  expect(bCaseId).toMatch(/^[a-f0-9-]{36}$/);

  await page.goto('/login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico' });
  await email.fill('adrian.hernandez@pravia.test');
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  if (await email.inputValue() !== 'adrian.hernandez@pravia.test') await email.fill('adrian.hernandez@pravia.test');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  const loginA = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const aToken = (await (await loginA).json()).access_token as string;
  expect(aToken).toBeTruthy();
  await page.waitForURL('**/mi-dia');
  const aOverview = await page.request.get('/api/archivo', { headers: { Authorization: `Bearer ${aToken}` } });
  expect(aOverview.status()).toBe(200);
  const aRecord = (await aOverview.json()).records.find((item: { expediente_id: string }) => item.expediente_id === '7a139000-0000-4000-8000-000000000001');
  expect(aRecord?.id).toBeTruthy();

  const bLogin = await request.post('/api/auth/login', { data: { email: bEmail, password: bPassword } });
  expect(bLogin.status(), await bLogin.text()).toBe(200);
  const bToken = (await bLogin.json()).access_token as string;
  const bAuth = { Authorization: `Bearer ${bToken}` };
  const bBefore = await request.get('/api/archivo', { headers: bAuth });
  expect(bBefore.status()).toBe(200);
  const bSequence = await bBefore.json();
  const bCreated = await request.post(`/api/expedientes/${bCaseId}/archivo`, { headers: bAuth, data: { numero_escritura: bSequence.next_numero_escritura, folio_inicio: bSequence.next_folio, folio_fin: bSequence.next_folio, fecha_instrumento: bSequence.records[0]?.fecha_instrumento || '2026-10-06' } });
  expect(bCreated.status(), await bCreated.text()).toBe(201);
  const bRecord = await bCreated.json();
  const aAuth = { Authorization: `Bearer ${aToken}` };
  const [aReadsB, aWritesB, bReadsA, bOverview] = await Promise.all([
    page.request.get(`/api/expedientes/${bCaseId}/archivo`, { headers: aAuth }),
    page.request.post(`/api/expedientes/${bCaseId}/archivo`, { headers: aAuth, data: { numero_escritura: '99999', folio_inicio: '99999', folio_fin: '99999', fecha_instrumento: '2026-10-06' } }),
    request.get(`/api/expedientes/${aRecord.expediente_id}/archivo`, { headers: bAuth }),
    request.get('/api/archivo', { headers: bAuth }),
  ]);
  expect(aReadsB.status()).toBe(403);
  expect(aWritesB.status()).toBe(403);
  expect(bReadsA.status()).toBe(403);
  expect(bOverview.status()).toBe(200);
  expect((await bOverview.json()).records.map((item: { id: string }) => item.id)).toContain(bRecord.id);
  expect((await bOverview.json()).records.map((item: { id: string }) => item.id)).not.toContain(aRecord.id);
});
