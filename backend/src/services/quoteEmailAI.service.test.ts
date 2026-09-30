import { describe, expect, it, vi } from 'vitest';
import { QuoteEmailAIError, QuoteEmailAIService } from './quoteEmailAI.service';

const actor = {
  id: '10000000-0000-4000-8000-000000000002',
  organizationId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'session-qa',
  permissions: ['cotizaciones.write', 'ai.use'],
} as any;

const quote = {
  id: '20000000-0000-4000-8000-000000000001',
  organization_id: actor.organizationId,
  etapa_contractual: 'EN_ELABORACION',
  numero_cotizacion: 'COT-0042-2026', numero_solicitud: null,
  contexto_operacion: 'Compraventa de inmueble urbano',
  correo_asunto: null, cuerpo_correo_cliente: null, correo_cc: 'archivo@notaria.test',
  prospecto: { nombre: 'CLIENTE QA', email: 'cliente@example.test', tipo_acto: 'Compraventa', necesidad: 'Compraventa de inmueble urbano' },
  creada_por: { nombre: 'Andrea', apellido: 'Ruiz' },
  actos: [{ tipo_acto: { nombre: 'Compraventa' } }],
  conceptos: [
    { id: 'c1', concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '8000.00', orden: 0, origen: 'MANUAL' },
    { id: 'c2', concepto: 'IVA', categoria: 'IVA_HONORARIOS', importe: '1280.00', orden: 1, origen: 'MANUAL' },
    { id: 'c3', concepto: 'Registro', categoria: 'IMPUESTOS_DERECHOS', importe: '2000.00', orden: 2, origen: 'MANUAL' },
  ],
};

const providerResponse = () => new Response(JSON.stringify({
  id: 'resp-email-1', model: 'gpt-test', status: 'completed',
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ subject: 'Cotización COT-0042-2026', message_body: 'Le compartimos la cotización por $11,280.00 para su revisión.' }) }] }],
  usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const database = () => {
  const tx = { aIUsageLog: { upsert: vi.fn() }, auditLog: { create: vi.fn() } };
  return {
    cotizacion: { findFirst: vi.fn().mockResolvedValue(quote) },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    tx,
  };
};

describe('COT-EMAIL-IA-001', () => {
  it('devuelve propuesta editable sin persistirla ni afirmar envío', async () => {
    const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key-never-sent';
    try {
      const db = database(); const fetcher = vi.fn().mockResolvedValue(providerResponse());
      const result = await new QuoteEmailAIService(db as any, fetcher as any).draft(actor, quote.id);
      expect(result).toMatchObject({ recipient: 'cliente@example.test', cc: 'archivo@notaria.test', subject: 'Cotización COT-0042-2026', provider: 'OPENAI', promptVersion: 'COT-EMAIL-IA-001-v1' });
      expect(result.messageBody).toContain('$11,280.00');
      expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({ method: 'POST' }));
      const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
      expect(body.store).toBe(false);
      expect(body.input[0].content[0].text).toContain('no afirmes que el correo fue enviado');
      expect(db.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'GENERAR_BORRADOR_CORREO_COTIZACION_IA', organization_id: actor.organizationId, detalles: expect.objectContaining({ persisted_to_quote: false, sent: false }) }) }));
      expect(db.tx.aIUsageLog.upsert).toHaveBeenCalled();
    } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
  });

  it('falla cerrado sin proveedor configurado', async () => {
    const previous = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    try {
      await expect(new QuoteEmailAIService(database() as any, vi.fn() as any).draft(actor, quote.id))
        .rejects.toMatchObject<Partial<QuoteEmailAIError>>({ status: 503, code: 'QUOTE_EMAIL_AI_NOT_CONFIGURED' });
    } finally { if (previous !== undefined) process.env.OPENAI_API_KEY = previous; }
  });

  it('aplica permisos de cotización e IA antes de consultar datos', async () => {
    const db = database();
    await expect(new QuoteEmailAIService(db as any, vi.fn() as any).draft({ ...actor, permissions: ['cotizaciones.write'] }, quote.id))
      .rejects.toMatchObject<Partial<QuoteEmailAIError>>({ status: 403, code: 'QUOTE_EMAIL_AI_DENIED' });
    expect(db.cotizacion.findFirst).not.toHaveBeenCalled();
  });
});
