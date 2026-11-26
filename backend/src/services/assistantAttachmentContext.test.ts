import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ buffer: vi.fn(), extract: vi.fn(), update: vi.fn() }));
vi.mock('../config/prisma', () => ({ default: { assistantAttachment: { update: mocks.update } } }));
vi.mock('./assistantConversation.service', () => ({ assistantConversationService: { attachmentBuffer: mocks.buffer } }));
vi.mock('./openaiDocument.service', () => ({ extraerMultiplesDocumentos: mocks.extract }));
import { prepareAssistantAttachmentContext } from './assistantAttachmentContext.service';

describe('Adjuntos del chat: trazas, contenido general y conservación', () => {
  it('incorpora domicilios, actividad y regímenes de los seis adjuntos sin perder los últimos', async () => {
    mocks.buffer.mockImplementation(async (_u, _c, id) => ({ attachment: { id, mime_type: 'text/plain', original_name: `${id}.txt`, extraction: {
      schema_version: 'PRAVIA_CHAT_DOCUMENT_V3', resumen_ejecutivo: 'Resumen '.repeat(250), campos: [],
      contenido_documental: [{ texto: 'Texto '.repeat(1200) }], domicilios_detectados: [{ tipo_sugerido: 'FISCAL', calle: 'CALLE ' + id }],
      actividades_economicas: [{ actividad: 'Actividad ' + id }], regimenes: [{ regimen: 'Régimen documental ' + id }],
    } }, buffer: Buffer.from('QA') }));
    const result = await prepareAssistantAttachmentContext({ id: 'qa', organizationId: 'org' } as any, 'chat', ['a','b','c','d','e','f'], 'op');
    const context = JSON.parse(result.context!);
    expect(context.adjuntos).toHaveLength(6);
    expect(context.adjuntos[5].domicilios_detectados[0].calle).toBe('CALLE f');
    expect(context.adjuntos[5].actividades_economicas[0].actividad).toBe('Actividad f');
    expect(context.adjuntos[5].regimenes[0].regimen).toBe('Régimen documental f');
  });
  it('separa cada adjunto y conserva los importes aunque no haya datos de identidad', async () => {
    mocks.buffer.mockImplementation(async (_u, _c, id) => ({ attachment: { id, mime_type: 'text/plain', original_name: `${id}.txt`, extraction: { campos: [], resumen_ejecutivo: 'Resultado anterior sin contenido' } }, buffer: Buffer.from('Sintético QA') }));
    mocks.extract.mockImplementation(async (docs) => ({ proveedor: 'OpenAI', modelo: 'qa', campos: [], alertas: [],
      contenido_documental: [{ documento_id: docs[0].documentoId, texto: 'Referencia QA-ORD-73; anticipo 12500 MXN.', confianza: 'LECTURA_CLARA' }],
      usos: [{ modelo: 'qa' }],
    }));
    const result = await prepareAssistantAttachmentContext({ id: 'qa', organizationId: 'org', permissions: ['ia.execute'] } as any, 'conversation', ['one', 'two'], 'message');
    expect(mocks.extract.mock.calls.map(call => call[1].traceId)).toEqual(['message:attachment:one', 'message:attachment:two']);
    expect(mocks.extract.mock.calls.every(call => call[1].purpose === 'CHAT')).toBe(true);
    expect(result.context).toContain('12500 MXN'); expect(result.context).toContain('QA-ORD-73');
    expect(result.usages).toHaveLength(2);
    expect(result.facts).toEqual([]); // Text is not authorization or a write proposal.
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
