import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

test('Agenda: indicadores mensuales reales, privacidad, expiración; Cumplimiento sin etiquetas fuera de lugar', async ({ page, baseURL, request }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const url = new URL(process.env.QA_CLIENT_CASE_DATABASE_URL!);
  expect([url.hostname,url.port,url.pathname]).toEqual(['127.0.0.1','55521','/pravia_client_qa']);
  const db = new PrismaClient({ datasourceUrl: url.href }); const ids: string[] = []; const run = randomUUID().slice(0,8);
  let token = ''; const org='21110000-0000-4000-8000-000000000001';
  page.on('request', request => { if (request.url().startsWith(`${baseURL}/api/`) && request.headers().authorization) token=request.headers().authorization.replace(/^Bearer /,''); });
  try {
    await page.goto('/login'); await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test'); await page.getByLabel('Contraseña', { exact: true }).fill(process.env.QA_LOCAL_PASSWORD!);
    const login = page.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); const logged = await login; expect(logged.status()).toBe(200); token=(await logged.json()).access_token;
    await page.waitForURL('**/mi-dia'); const headers={ Authorization:`Bearer ${token}` };
    const actor = await db.user.findUniqueOrThrow({ where:{email:'documentos.qa@pravia.test'},select:{id:true} });
    const start='2030-12-15T17:00:00.000Z', end='2030-12-15T18:00:00.000Z', hiddenStart='2030-12-16T17:13:00.000Z';
    for (const [visibilidad,fecha_inicio,fecha_fin] of [['ORGANIZATION',start,end],['PRIVATE',hiddenStart,'2030-12-16T18:00:00.000Z']]) {
      const response=await page.request.post('/api/agenda',{headers,data:{titulo:`SINTÉTICO QA indicador ${run} ${visibilidad}`,tipo:'CITA',fecha_inicio,fecha_fin,visibilidad,responsable_id:actor.id}});
      expect(response.status()).toBe(201); ids.push((await response.json()).evento.id);
    }
    const reader=await request.post(`${baseURL}/api/auth/login`,{data:{email:'lectura.qa@pravia.test',password:process.env.QA_LOCAL_PASSWORD}}); expect(reader.status()).toBe(200); const readerToken=(await reader.json()).access_token;
    const query='/api/agenda?desde=2030-12-01T00%3A00%3A00Z&hasta=2031-01-12T00%3A00%3A00Z&mode=markers';
    const readerMarkers=await page.request.get(query,{headers:{Authorization:`Bearer ${readerToken}`}}); expect(readerMarkers.status()).toBe(200);
    const readerData=await readerMarkers.json(); expect(JSON.stringify(readerData)).toContain(start); expect(JSON.stringify(readerData)).not.toContain(hiddenStart);
    const ownMarkers=await page.request.get(query,{headers}); expect(ownMarkers.status()).toBe(200); expect(JSON.stringify(await ownMarkers.json())).toContain(hiddenStart);
    const foreign=await request.post(`${baseURL}/api/auth/login`,{data:{email:'otrotenant.qa@pravia.test',password:process.env.QA_LOCAL_PASSWORD}}); expect(foreign.status()).toBe(200);
    const foreignMarkers=await page.request.get(query,{headers:{Authorization:`Bearer ${(await foreign.json()).access_token}`}}); expect(foreignMarkers.status()).toBe(200); expect(JSON.stringify(await foreignMarkers.json())).not.toContain(start);
    await page.clock.install({ time: new Date('2030-12-15T16:00:00Z') });
    await page.goto('/agenda?date=2030-12-15');
    const calendar=page.getByRole('region',{name:'Calendario mensual',exact:true});
    await expect(calendar.getByRole('button',{name:/15 de diciembre.*Con pendientes/})).toBeVisible();
    await page.clock.setSystemTime(new Date('2030-12-15T18:01:00Z')); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(calendar.getByRole('button',{name:/15 de diciembre.*Con pendientes/})).toHaveCount(0);
    await expect(calendar.getByRole('button',{name:/16 de diciembre.*Con pendientes/})).toBeVisible();
    await page.goto('/cumplimiento');
    const search=page.getByRole('textbox',{name:'Buscar por expediente, escritura o compareciente'}); await expect(search).toBeVisible();
    for(const width of [1440,1366,1024,768,390,320]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      expect((await search.boundingBox())!.height).toBeLessThanOrEqual(50);
      expect(await page.getByText('Buscar por expediente, escritura o compareciente',{exact:true}).count()).toBe(0);
    }
    await page.screenshot({path:test.info().outputPath('cumplimiento-320.png')});
    expect(await db.eventoAgenda.count({where:{id:{in:ids},organization_id:org}})).toBe(2);
  } finally {
    for(const id of ids) { const response=await page.request.post(`/api/agenda/${id}/cancelar`,{headers:{Authorization:`Bearer ${token}`},data:{motivo_cancelacion:'Cierre QA sintético de indicadores NOV25'}}); expect(response.status()).toBe(200); }
    await db.$disconnect();
  }
});
