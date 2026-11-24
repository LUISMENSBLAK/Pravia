import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

async function pdf(lines: string[]) {
  const doc = await PDFDocument.create(); const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  ['SINTETICO / SIN VALIDEZ OFICIAL', ...lines].forEach((line, index) => page.drawText(line, { x: 30, y: 750-index*24, size: 12, font }));
  return Buffer.from(await doc.save());
}

test('alta: extracción parcial real conserva errores, fuentes retryables y datos sin confirmar', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const target = new URL(process.env.DATABASE_URL || '');
  expect(target.hostname).toBe('127.0.0.1'); expect(target.port).toBe('55521');
  const password = process.env.QA_LOCAL_PASSWORD;
  if (!password) throw new Error('QA_LOCAL_PASSWORD required');
  const db = new PrismaClient();
  try {
    const countBefore = await db.compareciente.count();
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL('**/mi-dia');
    await page.goto('/comparecientes/nuevo');
    const sources = [
      { kind: 'CONSTANCIA_FISCAL', name: 'CSF_SINTETICA.pdf', bytes: await pdf(['CONSTANCIA DE SITUACION FISCAL', 'RFC: QAFA010101QA1', 'Nombre(s): PERSONA', 'Primer Apellido: PRUEBA', 'Segundo Apellido: SINTETICA', 'Codigo Postal: 63735']) },
      { kind: 'CURP', name: 'NO_ES_CURP_SINTETICO.pdf', bytes: await pdf(['NO ES UN DOCUMENTO DE IDENTIDAD']) },
    ];
    const uploaded: string[] = []; let sessionId = '';
    for (const source of sources) {
      await page.getByLabel('Tipo de documento').selectOption(source.kind);
      const sent = page.waitForResponse(r=>r.url().includes('/comparecientes/altas/') && r.url().endsWith('/documentos') && r.request().method()==='POST');
      await page.locator('input[type=file]').setInputFiles({ name:source.name,mimeType:'application/pdf',buffer:source.bytes });
      const response=await sent; expect(response.status()).toBe(201);
      uploaded.push((await response.json()).documento.id);
      sessionId=new URL(response.url()).pathname.split('/')[4];
    }
    const extraction=page.waitForResponse(r=>r.url().endsWith(`/altas/${sessionId}/extraer`));
    await page.getByRole('button',{name:'Extraer información con IA'}).click();
    const response=await extraction; expect(response.status()).toBe(200);
    const result=await response.json(); expect(result.procesados).toBe(1);
    expect(result.errores).toEqual([expect.objectContaining({documento_id:uploaded[1],code:'CURP_DOCUMENT_NOT_RECOGNIZED'})]);
    const review=page.getByRole('region',{name:'Resultado de extracción documental'});
    await expect(review.getByText('Extracción parcial: hay documentos sin analizar')).toBeVisible();
    await expect(review.getByText(/NO_ES_CURP_SINTETICO.pdf:/)).toBeVisible();
    await expect(review.getByText(/No se puede concluir que estos datos falten/)).toBeVisible();
    const summary=review.locator('summary'); await expect(summary).toHaveText(/Campos aún sin propuesta/);
    await summary.focus(); await page.keyboard.press('Enter'); await expect(review.getByText(/SIN PROPUESTA/).first()).toBeVisible();
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      // Sidebar collapse is animated. Wait for the actual layout to fit, not
      // merely for setViewportSize to dispatch the resize event. Persistent
      // overflow still fails; check visible bounds as well as document width.
      await expect.poll(() => page.evaluate(() => Math.max(
        document.documentElement.scrollWidth - innerWidth,
        ...[...document.querySelectorAll<HTMLElement>('#main-content, [role=banner], main form')].map(element => element.getBoundingClientRect().right-innerWidth),
      )), { message: `El contenido debe caber a ${width}px tras la transición responsive.` }).toBeLessThanOrEqual(0.5);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    const session=await db.comparecienteAltaSession.findUniqueOrThrow({where:{id:sessionId}});
    expect((session.borrador_json as any)._ia_errores).toEqual(result.errores);
    const statuses=await db.cargaTemporalDocumento.findMany({where:{id:{in:uploaded}},select:{id:true,estado:true}});
    expect(statuses.find(d=>d.id===uploaded[0])?.estado).toBe('PROCESADO');
    expect(statuses.find(d=>d.id===uploaded[1])?.estado).toBe('TEMPORAL');
    expect(await db.compareciente.count()).toBe(countBefore);
  } finally { await db.$disconnect(); }
});
