import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../auth/actorContext';
import type { AiGatewayRequest } from '../platform/aiGateway.service';
import { AI_OPERATION_CODES } from '../platform/aiBillingPolicy';
import { extraerFinanzasDesdeDocumento, extraerMultiplesDocumentos, extraerPredioDesdeDocumento } from './openaiDocument.service';

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
