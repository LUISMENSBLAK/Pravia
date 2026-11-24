import {test,expect} from '@playwright/test';
import {PrismaClient} from '../../backend/node_modules/@prisma/client/default.js';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

test('EXP008 y formatos: público, factura ida/vuelta, fichas privadas, instituciones y Archivo responsive',async({page,baseURL})=>{
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const target=new URL(process.env.QA_CLIENT_CASE_DATABASE_URL!);expect([target.hostname,target.port,target.pathname]).toEqual(['127.0.0.1','55521','/pravia_client_qa']);
  const db=new PrismaClient({datasourceUrl:target.href}),org='21110000-0000-4000-8000-000000000001',id='2d49eeef-6757-4c35-84f5-9a046b47b982';
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto('/login');await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');await page.getByLabel('Contraseña',{exact:true}).fill(process.env.QA_LOCAL_PASSWORD!);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL('**/mi-dia');
    await page.goto(`/expedientes/${id}#finanzas`);
    const proof=await readFile('public/icons/pravia-192.png');
    const report=async(publicRecipient:boolean)=>{
      const context=`SINTÉTICO QA navegación ${randomUUID()}`;
      await page.getByRole('button',{name:'Reportar ingreso',exact:true}).click();const panel=page.getByRole('dialog',{name:'Reportar ingreso',exact:true});
      await panel.getByLabel('Concepto o contexto').fill(context);await panel.getByLabel('Monto reportado (opcional)').fill('116.00');
      const recipient=panel.getByLabel('¿A quién se va a facturar?');
      const party=await db.expedienteCompareciente.findFirstOrThrow({where:{organization_id:org,expediente_id:id,estatus:'ACTIVO',archived_at:null}});
      await recipient.selectOption(publicRecipient?'PUBLICO_GENERAL':party.id);await panel.getByRole('combobox',{name:'Forma de pago',exact:true}).selectOption('EFECTIVO');
      await panel.getByLabel('Comprobante del ingreso',{exact:true}).setInputFiles({name:'SINTETICO-QA-SIN-VALIDEZ.png',mimeType:'image/png',buffer:proof});
      const saved=page.waitForResponse(response=>response.url().endsWith('/finanzas-operativas/ingresos')&&response.request().method()==='POST');
      await panel.getByRole('button',{name:'Registrar ingreso',exact:true}).click();expect((await saved).status()).toBe(201);await expect(panel).toHaveCount(0);
      return {context,row:page.locator('article').filter({has:page.getByText(context,{exact:true})})};
    };
    const movements=await db.movimientoFinanciero.count({where:{organization_id:org}});
    const publicIncome=await report(true);await expect(publicIncome.row.getByText(/Público en general/)).toBeVisible();
    const stored=await db.expedienteIngresoReportado.findFirstOrThrow({where:{organization_id:org,concepto_contexto:publicIncome.context}});expect(stored.facturar_publico_general).toBe(true);expect(stored.factura_estado).toBeNull();expect(stored.movimiento_id).toBeNull();
    await page.reload();await expect(publicIncome.row.getByText(/Público en general/)).toBeVisible();
    const individual=await report(false);await individual.row.getByRole('button',{name:'Agregar factura',exact:true}).click();
    await page.getByRole('link',{name:'Generar factura en Finanzas',exact:true}).click();await expect(page).toHaveURL(/\/finanzas\?view=facturacion&income_id=/);
    const generator=page.getByRole('dialog',{name:'Generar factura CFDI',exact:true});await expect(generator).toBeVisible();await generator.getByRole('button',{name:'Cerrar generador',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/expedientes/${id}#finanzas$`));
    await expect(individual.row.getByText('Factura pendiente',{exact:true})).toBeVisible();expect(await db.movimientoFinanciero.count({where:{organization_id:org}})).toBe(movements);
    await page.goto(`/expedientes/${id}#plantillas`);const sheets=page.getByRole('region',{name:'Ficha de expediente',exact:true});
    await sheets.getByRole('button',{name:/Ficha_.*\.docx/}).first().click();const viewer=page.getByRole('dialog',{name:/Ficha_.*\.docx/});await expect(viewer.getByText('FICHA SINTÉTICA SIN VALIDEZ',{exact:true})).toBeVisible();await viewer.getByRole('button',{name:'Cerrar vista previa',exact:true}).click();
    const institutions=page.getByRole('region',{name:'Bancos e instituciones del expediente',exact:true});await expect(institutions.getByLabel('Instituciones aplicables',{exact:true})).toBeVisible();
    for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0.5);}
    await page.goto('/archivo');await expect(page.getByRole('heading',{name:'Escrituras',exact:true})).toBeVisible();
    const found=page.waitForResponse(response=>response.url().includes('/archivo/escrituras?')&&response.url().includes('search=102'));
    await page.getByLabel('Buscar por número de escritura',{exact:true}).fill('102');const read=await found;expect(read.status()).toBe(200);const payload=await read.json();expect(payload.data.every((item:any)=>item.organization_id===org&&item.numero_escritura==='102')).toBe(true);
    expect(errors).toEqual([]);
  }finally{await db.$disconnect();}
});
