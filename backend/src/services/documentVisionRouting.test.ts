import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { consolidateExtractedFields } from '../domain/documentExtraction';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../auth/actorContext';
import type { AiGatewayRequest } from '../platform/aiGateway.service';
import { AI_OPERATION_CODES } from '../platform/aiBillingPolicy';
import { extraerFinanzasDesdeDocumento, extraerMultiplesDocumentos, extraerPredioDesdeDocumento } from './openaiDocument.service';
import { PlatformDomainError } from '../platform/platform.errors';

const actor: ActorContext = { userId:'qa', organizationId:'org-qa', membershipId:'member-qa',
  role:'DIRECCION', permissions:['ia.execute'], scope:'GLOBAL', sessionId:'session-qa' };
const photo = (id: string) => {
  const canvas = createCanvas(480, 300);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f1e8d5'; ctx.fillRect(0, 0, 480, 300);
  ctx.font = '22px sans-serif'; ctx.fillStyle = '#333'; ctx.fillText(`FOTO SINTÉTICA QA ${id}`, 20, 90);
  return { buffer:canvas.toBuffer('image/jpeg', 75), mimeType:'image/jpeg', tipoDocumento:'OTRO', documentoId:id, nombreOriginal:`${id}.jpg` };
};
const reply = (value: unknown) => ({ status:'completed', output:[{ content:[{ type:'output_text', text:JSON.stringify(value) }] }] });
const field = (id: string, campo: string, valor: string, confianza: string) => ({ documento_id:id, campo, valor, confianza, fragmento:valor });
afterEach(() => vi.unstubAllEnvs());

describe('Contrato de visión documental · Gateway simulado, no proveedor real', () => {
  it('no envía una escritura de condominio sin identificador guardado y aísla las páginas de la unidad al analizar', async () => {
    const pdf = await PDFDocument.create();
    for (let i=0;i<8;i+=1) pdf.addPage();
    const doc = { buffer: Buffer.from(await pdf.save()), mimeType: 'application/pdf', nombreOriginal:'Escritura de condominio QA.pdf', tipoDocumento:'ANTECEDENTE', documentoId:'unit-qa' };
    const execute = vi.fn().mockResolvedValue(reply({tipo_documental:'ANTECEDENTE',objeto:{alcance:'MULTIPLE',campo:'folio_real',valor:'QA123',fragmento:'Folio real: QA-123',pagina:4,paginas_unidad:[4,5]},
      campos:[{campo:'folio_real',valor:'QA-123',pagina:4,fragmento:'Folio real: QA-123',confianza:'LECTURA_CLARA'},{campo:'regimen',valor:'Unidad ajena',pagina:8,fragmento:'Otra unidad',confianza:'LECTURA_CLARA'}],
      colindancias:[{referencia:'Norte',pagina:5,fragmento:'Norte con pasillo'},{referencia:'Sur',pagina:8,fragmento:'En otra unidad'}],alertas:[]}));
    const context={actor,idempotencyKey:'property-unit',traceId:'property-unit',gateway:{execute}};
    const blocked=await extraerPredioDesdeDocumento(doc,context);
    expect(execute).not.toHaveBeenCalled();
    expect(blocked).toMatchObject({proveedor:'LOCAL',campos:[],colindancias:[]});
    const scoped=await extraerPredioDesdeDocumento(doc,{...context,propertyTarget:{folio_real:'QA-123'}});
    expect(scoped.campos).toEqual([expect.objectContaining({campo:'folio_real',confianza:'LECTURA_DUDOSA'})]);
    expect(scoped.colindancias).toEqual([expect.objectContaining({referencia:'Norte'})]);
    const outOfScope=await extraerPredioDesdeDocumento(doc,{...context,propertyTarget:{folio_real:'QA-999'}});
    expect(outOfScope).toMatchObject({campos:[],colindancias:[]});
  });
  it.each([
    [{ status:'incomplete', incomplete_details:{reason:'max_output_tokens'}, output:[] }, 'DOCUMENT_RESPONSE_INCOMPLETE'],
    [{ output:[{content:[{type:'refusal',refusal:'private provider details'}]}] }, 'DOCUMENT_RESPONSE_REFUSED'],
    [{ output:[] }, 'DOCUMENT_RESPONSE_EMPTY'],
    [{ output:[{content:[{type:'output_text',text:'invalid private text'}]}] }, 'DOCUMENT_RESPONSE_INVALID'],
  ])('conserva la primera lectura y comunica un código seguro ante fallo de revisión', async (response, code) => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY','false'); vi.stubEnv('AI_ESCALATION_ENABLED','true');
    const execute=vi.fn().mockResolvedValueOnce(reply({campos:[field('source','nombre','ELISA','LECTURA_DUDOSA')],alertas:[]})).mockResolvedValueOnce(response);
    const result=await extraerMultiplesDocumentos([photo('source')],{actor,idempotencyKey:'partial',traceId:'partial',gateway:{execute}});
    expect(result.campos[0].valor).toBe('ELISA');
    expect(result.errores?.[0].code).toBe(code);
    expect(JSON.stringify(result.errores)).not.toContain('private');
  });
  it('conserva el correo literal etiquetado de Word si la IA lo omite y no oculta otra lectura distinta', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY','false'); vi.stubEnv('AI_ESCALATION_ENABLED','false');
    const zip = new JSZip(); zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Correo electrónico (Email address): qa_contact@example.test</w:t></w:r></w:p></w:body></w:document>');
    const doc={buffer:await zip.generateAsync({type:'nodebuffer'}),mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',nombreOriginal:'ficha.docx',documentoId:'word',tipoDocumento:'OTRO'};
    const execute=vi.fn().mockResolvedValueOnce(reply({campos:[],alertas:[]})).mockResolvedValueOnce(reply({campos:[field('word','correo_electronico','otro@example.test','LECTURA_CLARA')],alertas:[]}));
    const first=await extraerMultiplesDocumentos([doc],{actor,idempotencyKey:'email',traceId:'email',gateway:{execute}});
    expect(first.campos).toContainEqual(expect.objectContaining({campo:'correo',valor:'qa_contact@example.test',documento_id:'word',fragmento:'Correo electrónico (Email address): qa_contact@example.test'}));
    const second=await extraerMultiplesDocumentos([doc],{actor,idempotencyKey:'email-conflict',traceId:'email-conflict',gateway:{execute}});
    expect(consolidateExtractedFields(second.campos).values.correo).toBeUndefined();
    expect(consolidateExtractedFields(second.campos).proposals.correo.estado).toBe('EN_CONFLICTO');
  });
  it('contrasta la foto del chat aunque diga CLARA y conserva referencias discrepantes para revisión', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY','false'); vi.stubEnv('AI_ESCALATION_ENABLED','true');
    const execute=vi.fn().mockResolvedValueOnce(reply({campos:[],alertas:[],contenido_documental:[{documento_id:'receipt',texto:'Referencia QA-QRD-73',confianza:'LECTURA_CLARA'}]}))
      .mockResolvedValueOnce(reply({campos:[],alertas:[],contenido_documental:[{documento_id:'receipt',texto:'Referencia QA-ORD-73',confianza:'LECTURA_CLARA'}]}));
    const result=await extraerMultiplesDocumentos([photo('receipt')],{actor,idempotencyKey:'photo-check',traceId:'photo-check',purpose:'CHAT',gateway:{execute}});
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.contenido_documental).toEqual([{documento_id:'receipt',texto:'Referencia QA-QRD-73',confianza:'LECTURA_DUDOSA'},{documento_id:'receipt',texto:'Referencia QA-ORD-73',confianza:'LECTURA_DUDOSA'}]);
    expect(result.alertas.join(' ')).toContain('transcripciones difieren');
  });
  it.skipIf(!process.env.QA_SYNTHETIC_HEIC)('convierte HEIC físico para Predios/Finanzas sin tocar los bytes originales', async () => {
    const buffer = readFileSync(process.env.QA_SYNTHETIC_HEIC!), before = Buffer.from(buffer);
    const doc = { buffer, mimeType: 'image/heic', nombreOriginal: 'SINTETICO.heic', tipoDocumento: 'OTRO', documentoId: 'heic' };
    for (const kind of ['predio','finanzas']) {
      const execute = vi.fn().mockResolvedValue(reply({ campos: [], colindancias: [], alertas: [], faltantes: [], conflictos: [] }));
      const context = { actor, idempotencyKey: kind, traceId: kind, gateway: { execute } };
      if (kind === 'predio') await extraerPredioDesdeDocumento(doc, context);
      else await extraerFinanzasDesdeDocumento(doc, 'H5_OPERATION_PAYMENT', 'GENERAL', context);
      expect(execute.mock.calls[0][0].payload.body.input[0].content[1]).toMatchObject({ type: 'input_image', image_url: expect.stringMatching(/^data:image\/jpeg;base64,/) });
      expect(doc.buffer.equals(before)).toBe(true); expect(doc.mimeType).toBe('image/heic');
    }
  }, 60000);
  it.each(['image/webp', 'image/gif'])('Predios y Finanzas no rechazan una imagen común %s aceptada por el archivo documental', async mime => {
    const doc = { ...photo('source'), mimeType: mime, nombreOriginal: mime === 'image/webp' ? 'source.webp' : 'source.gif' };
    for (const kind of ['predio', 'finanzas']) {
      const execute = vi.fn().mockResolvedValue(reply({ campos: [], colindancias: [], alertas: [], faltantes: [], conflictos: [] }));
      const context = { actor, idempotencyKey: kind, traceId: kind, gateway: { execute } };
      if (kind === 'predio') await extraerPredioDesdeDocumento(doc, context);
      else await extraerFinanzasDesdeDocumento(doc, 'H5_OPERATION_PAYMENT', 'GENERAL', context);
      expect(execute.mock.calls[0][0].payload.body.input[0].content).toContainEqual({ type: 'input_image', detail: 'high', image_url: `data:${mime};base64,${doc.buffer.toString('base64')}` });
    }
  });
  it.each(['predio', 'finanzas'])('informa el modelo real del Gateway en %s y no el nombre solicitado', async kind => {
    const execute = vi.fn().mockResolvedValue({ ...reply({ campos: [], colindancias: [], alertas: [], faltantes: [], conflictos: [] }), model: 'actual-approved-model' });
    const context = { actor, idempotencyKey: 'actual-model', traceId: 'actual-model', gateway: { execute } };
    const result = kind === 'predio' ? await extraerPredioDesdeDocumento(photo('source'), context) : await extraerFinanzasDesdeDocumento(photo('source'), 'EXP008', 'GENERAL', context);
    expect(result.modelo).toBe('actual-approved-model'); expect(result.uso?.modelo).toBe('actual-approved-model');
  });
  it('relee una ficha omitida sin volver a pedirle al modelo elegir entre dos personas', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const execute = vi.fn().mockResolvedValueOnce(reply({ campos: [field('one', 'nombre', 'ELISA', 'LECTURA_DUDOSA')], alertas: [] }))
      .mockResolvedValueOnce(reply({ campos: [field('two', 'nombre', 'BRUNO', 'LECTURA_CLARA')], alertas: [] }));
    const result = await extraerMultiplesDocumentos([photo('one'), photo('two')], { actor, idempotencyKey: 'people', traceId: 'people', gateway: { execute } });
    const prompt = execute.mock.calls[1][0].payload.body.input[0].content[0].text;
    expect(prompt).toContain('ID: two'); expect(prompt).not.toContain('ID: one');
    expect(result.campos.map(f => f.valor)).toEqual(['ELISA','BRUNO']);
  });
  it('ISR conserva valores documentales aprobados sin ampliar el esquema de Comparecientes', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'false');
    const execute = vi.fn().mockResolvedValue(reply({ campos: [
      field('source', 'valor_operacion', '250000.00', 'LECTURA_CLARA'),
      field('source', 'fecha_enajenacion', '2026-11-26', 'LECTURA_CLARA'),
      field('source', 'valor_catastral', '190000.00', 'LECTURA_CLARA'),
      field('source', 'taxpayer.verified', 'true', 'LECTURA_CLARA'),
      field('foreign', 'valor_avaluo', '999999.00', 'LECTURA_CLARA'),
    ], alertas: [] }));
    const result = await extraerMultiplesDocumentos([photo('source')], { actor, idempotencyKey: 'isr', traceId: 'isr', purpose: 'ISR', gateway: { execute } } as any);
    expect(result.campos.map(f => f.campo)).toEqual(['valor_operacion', 'fecha_enajenacion', 'valor_catastral']);
    const identityOnly = await extraerMultiplesDocumentos([photo('source')], { actor, idempotencyKey: 'party', traceId: 'party', gateway: { execute } });
    expect(identityOnly.campos).toEqual([]);
  });
  it('propone la actividad de la tabla CSF con fuente sin inventarla ni confundirla con ocupación', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'false');
    const execute = vi.fn().mockResolvedValue(reply({ campos: [], alertas: [], actividades_economicas: [
      { actividad: 'Actividad QA uno', documento_id: 'csf', confianza: 'LECTURA_CLARA' },
      { actividad: 'Actividad QA dos', documento_id: 'csf', confianza: 'LECTURA_CLARA' },
      { actividad: 'Emisor ajeno', documento_id: 'other-tenant', confianza: 'LECTURA_CLARA' },
      { actividad: 'Sin fuente' },
    ] }));
    const result = await extraerMultiplesDocumentos([photo('csf')], { actor, idempotencyKey: 'activity', traceId: 'activity', gateway: { execute } });
    expect(result.campos).toEqual([{ campo: 'actividad_economica', valor: 'Actividad QA uno; Actividad QA dos', fuente: 'csf.jpg', documento_id: 'csf', fragmento: 'Actividad QA uno; Actividad QA dos', confianza: 'LECTURA_CLARA' }]);
    expect(result.campos.some(f => f.campo === 'ocupacion' || f.campo === 'giro')).toBe(false);
  });
  it('no confía en LECTURA_CLARA si el identificador tiene longitud inválida', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const execute = vi.fn().mockResolvedValueOnce(reply({ campos: [field('photo', 'curp', 'GARA900101HDRFRBC78', 'LECTURA_CLARA')], alertas: [] }))
      .mockResolvedValueOnce(reply({ campos: [field('photo', 'curp', 'GARA900101HDFRBC78', 'LECTURA_CLARA')], alertas: [] }));
    const result = await extraerMultiplesDocumentos([photo('photo')], { actor, idempotencyKey: 'bad-clear', traceId: 'bad-clear', gateway: { execute } });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.campos).toEqual([field('photo', 'curp', 'GARA900101HDFRBC78', 'LECTURA_CLARA')]);
    expect(result.lecturas_descartadas).toHaveLength(1);
  });
  it.each([false, true])('no sustituye una lectura de CURP estructuralmente válida por una inválida (orden invertido=%s)', async reversed => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const valid = field('photo', 'curp', 'GARA900101HDFRBC78', 'LECTURA_DUDOSA');
    const invalid = field('photo', 'curp', 'GARA900101HDRFBC78', 'LECTURA_DUDOSA');
    const execute = vi.fn().mockResolvedValueOnce(reply({ campos: [reversed ? valid : invalid], alertas: [] }))
      .mockResolvedValueOnce(reply({ campos: [reversed ? invalid : valid], alertas: [] }));
    const result = await extraerMultiplesDocumentos([photo('photo')], { actor, idempotencyKey: 'closed-format', traceId: 'closed-format', gateway: { execute } });
    expect(result.campos).toEqual([valid]);
    expect(result.lecturas_descartadas).toEqual([invalid]);
    expect(result.alertas.join(' ')).toContain('no implica validación ante RENAPO');
  });
  it('el chat conserva texto documental no personal y rechaza fuentes ajenas', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'false');
    const execute = vi.fn().mockResolvedValue(reply({ model: 'ignored', campos: [], alertas: [], contenido_documental: [
      { documento_id: 'receipt', texto: 'Anticipo 12500 MXN. Referencia QA-ORD-73.', confianza: 'LECTURA_CLARA' },
      { documento_id: 'other-tenant', texto: 'No usar', confianza: 'LECTURA_CLARA' },
    ] }));
    const result = await extraerMultiplesDocumentos([photo('receipt')], { actor, idempotencyKey: 'general', traceId: 'general', purpose: 'CHAT', gateway: { execute } });
    expect(result.campos).toEqual([]);
    expect(result.contenido_documental).toEqual([{ documento_id: 'receipt', texto: 'Anticipo 12500 MXN. Referencia QA-ORD-73.', confianza: 'LECTURA_CLARA' }]);
    expect(execute.mock.calls[0][0].payload.body.text.format.schema.required).toContain('contenido_documental');
  });

  it('una foto sin campos provoca una segunda lectura high y no inventa datos si sigue ilegible', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const execute = vi.fn().mockResolvedValue(reply({ campos: [], alertas: ['Texto ilegible'] }));
    const result = await extraerMultiplesDocumentos([photo('illegible')], { actor, idempotencyKey: 'blank', traceId: 'blank', gateway: { execute } });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].payload.body.reasoning.effort).toBe('high');
    expect(result.campos).toEqual([]);
    expect(result.alertas).toContain('Texto ilegible');
  });
  it('ocho fuentes y revisiones tienen trazas únicas, como exige PostgreSQL', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false');
    vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const traces = new Set<string>();
    const execute = vi.fn(async (request: AiGatewayRequest) => {
      if (traces.has(request.traceId)) throw new Error('uq_ai_usage_events_trace');
      traces.add(request.traceId);
      const content = (request.payload as any).body.input[0].content;
      const ids = [...String(content[0].text).matchAll(/ID: ([^)]+)\)/g)].map(match => match[1]);
      return reply({ campos: ids.map(id => field(id, 'nombre', `PERSONA ${id}`, 'LECTURA_DUDOSA')), alertas: [] });
    });
    const result = await extraerMultiplesDocumentos(Array.from({ length: 8 }, (_, i) => photo(`qa-${i}`)),
      { actor, idempotencyKey: 'eight-sources', traceId: 'eight-sources', gateway: { execute } });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(traces.size).toBe(4);
    expect(new Set(result.campos.map(f => f.documento_id)).size).toBe(8);
    expect(result.errores || []).toEqual([]);
  });

  it('si falla la revisión ampliada conserva la primera lectura como parcial, sin ocultar el fallo', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const execute = vi.fn().mockResolvedValueOnce(reply({ campos: [field('photo', 'nombre', 'ELISA', 'LECTURA_DUDOSA')], alertas: [] }))
      .mockRejectedValueOnce(new PlatformDomainError('AI_PROVIDER_TIMEOUT', 'Tiempo agotado', 504));
    const result = await extraerMultiplesDocumentos([photo('photo')], { actor, idempotencyKey: 'reread-fails', traceId: 'reread-fails', gateway: { execute } });
    expect(result.campos).toEqual([field('photo', 'nombre', 'ELISA', 'LECTURA_DUDOSA')]);
    expect(result.errores).toEqual([expect.objectContaining({ documento_id: 'photo', code: 'AI_PROVIDER_TIMEOUT' })]);
    expect(result.alertas.join(' ')).toContain('primera lectura');
    expect((execute.mock.calls[1][0].payload as any).body.reasoning.effort).toBe('high');
  });

  it.each(['image/webp', 'image/gif', 'text/plain'])('pasa contenido real compatible de %s, no octet-stream', async mimeType => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false'); vi.stubEnv('AI_ESCALATION_ENABLED', 'false');
    const buffer = Buffer.from(mimeType === 'text/plain' ? 'SINTETICO QA - Nombre: ELISA' : 'synthetic encoded image bytes');
    const execute = vi.fn().mockResolvedValue(reply({ campos: [], alertas: [] }));
    await extraerMultiplesDocumentos([{ buffer, mimeType, tipoDocumento: 'ADJUNTO_CONVERSACION', documentoId: 'source', nombreOriginal: mimeType === 'text/plain' ? 'qa.txt' : mimeType === 'image/gif' ? 'qa.gif' : 'qa.webp' }], { actor, idempotencyKey: 'formats', traceId: 'formats', gateway: { execute } });
    const content = execute.mock.calls[0][0].payload.body.input[0].content;
    expect(content).toContainEqual(mimeType === 'text/plain' ? expect.objectContaining({ type: 'input_text', text: expect.stringContaining('Nombre: ELISA') }) : { type: 'input_image', detail: 'high', image_url: `data:${mimeType};base64,${buffer.toString('base64')}` });
    expect(execute.mock.calls[0][0].payload.fitOutputToOperationLimit).toBe(true);
  });
  it('envía bytes de la foto; una segunda lectura conserva las otras fuentes y declara discrepancias', async () => {
    vi.stubEnv('AI_IDENTITY_LOCAL_ONLY', 'false');
    vi.stubEnv('AI_ESCALATION_ENABLED', 'true');
    const first = photo('ficha'); const second = { ...photo('foto'), tipoDocumento:'IDENTIFICACION' };
    const execute = vi.fn().mockResolvedValueOnce(reply({ campos:[
      field('ficha','nombre','PERSONA QA','LECTURA_CLARA'),
      field('foto','vigencia_ine','2023–2033','LECTURA_DUDOSA'),
      field('ajeno','rfc','NO USAR','LECTURA_CLARA'),
    ], identificadores_ine:{ cic:'123456789' } })).mockResolvedValueOnce(reply({ campos:[
      field('foto','vigencia_ine','2023–2038','LECTURA_CLARA'),
    ], identificadores_ine:{ cic:'987654321' } }));
    const result = await extraerMultiplesDocumentos([first, second], { actor, idempotencyKey:'qa-vision', traceId:'qa-vision', gateway:{ execute } });
    expect(execute).toHaveBeenCalledTimes(2);
    const [primary, escalated] = execute.mock.calls.map(([call]) => call as AiGatewayRequest);
    expect(primary).toMatchObject({ operationCode:AI_OPERATION_CODES.documentExtraction, billingClass:'CUSTOMER_WALLET', idempotencyKey:'qa-vision:batch:0:primary' });
    expect(escalated).toMatchObject({ operationCode:AI_OPERATION_CODES.documentExtraction, idempotencyKey:'qa-vision:batch:0:escalated' });
    const input = (request: AiGatewayRequest) => (request.payload as any).body.input[0].content;
    expect(input(escalated).filter((item: { type:string }) => item.type === 'input_image')).toEqual([
      { type:'input_image', detail:'high', image_url:`data:image/jpeg;base64,${second.buffer.toString('base64')}` },
    ]);
    expect(JSON.stringify(input(primary)[0])).toContain('Nunca completes día o mes por defecto');
    expect(result.campos).toEqual([
      field('ficha','nombre','PERSONA QA','LECTURA_CLARA'),
      field('foto','vigencia_ine','2023–2033','LECTURA_DUDOSA'),
      field('foto','vigencia_ine','2023–2038','LECTURA_DUDOSA'),
    ]);
    expect(result.identificadores_ine?.cic).toBeUndefined();
    expect(result.alertas).toEqual(expect.arrayContaining([expect.stringContaining('Lecturas CIC contradictorias')]));
  });

  it.each(['predio','finanzas','cumplimiento'] as const)('%s pasa los píxeles originales y respeta una respuesta sin datos', async (kind) => {
    const document = photo(kind);
    const execute = vi.fn().mockResolvedValue(reply({ campos:[], colindancias:[], faltantes:['monto'], conflictos:[] }));
    const context = { actor, idempotencyKey:`qa-${kind}`, traceId:`qa-${kind}`, gateway:{ execute } };
    const result = kind === 'predio' ? await extraerPredioDesdeDocumento(document, context)
      : await extraerFinanzasDesdeDocumento(document, kind === 'finanzas' ? 'EXP008' : 'H5_OPERATION_PAYMENT', 'AMOUNT', context);
    expect(result.campos).toEqual([]);
    const request = execute.mock.calls[0][0];
    expect(request).toMatchObject({ operationCode:kind === 'predio' ? AI_OPERATION_CODES.propertyExtraction : AI_OPERATION_CODES.financialExtraction, billingClass:'CUSTOMER_WALLET' });
    expect(request.payload.body.input[0].content).toContainEqual({ type:'input_image', detail:'high', image_url:`data:image/jpeg;base64,${document.buffer.toString('base64')}` });
  });
});
