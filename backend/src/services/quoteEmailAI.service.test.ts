import { describe, expect, it, vi } from 'vitest';
import { QuoteEmailAIError, QuoteEmailAIService } from './quoteEmailAI.service';

const actor = {
  id: '10000000-0000-4000-8000-000000000002',
  organizationId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'session-qa',
  membershipId: 'membership-qa', rol: 'DIRECCION', scope: 'GLOBAL',
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

const providerPayload = {
  id: 'resp-email-1', model: 'gpt-test', status: 'completed',
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ subject: 'Cotización COT-0042-2026', message_body: 'Le compartimos la cotización por $11,280.00 para su revisión.' }) }] }],
  usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
};

const database = () => {
  return {
    cotizacion: { findFirst: vi.fn().mockResolvedValue(quote) },
    auditLog: { create: vi.fn() },
  };
};

const gateway = () => ({ execute: vi.fn().mockResolvedValue(providerPayload) });

describe('COT-EMAIL-IA-001', () => {
  it('devuelve propuesta editable sin persistirla ni afirmar envío', async () => {
    const db = database(); const economicGateway = gateway();
      const result = await new QuoteEmailAIService(db as any, economicGateway as any).draft(actor, quote.id, 'email-draft-qa');
      expect(result).toMatchObject({ recipient: 'cliente@example.test', cc: 'archivo@notaria.test', subject: 'Cotización COT-0042-2026', provider: 'OPENAI', promptVersion: 'COT-EMAIL-IA-001-v1' });
      expect(result.messageBody).toContain('$11,280.00');
      expect(economicGateway.execute).toHaveBeenCalledWith(expect.objectContaining({
        operationCode: 'QUOTE_EMAIL_DRAFT', billingClass: 'CUSTOMER_WALLET', idempotencyKey: 'email-draft-qa',
      }));
      const body = economicGateway.execute.mock.calls[0][0].payload.body;
      expect(body.store).toBe(false);
      expect(body.input[0].content[0].text).toContain('no afirmes que el correo fue enviado');
      expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'GENERAR_BORRADOR_CORREO_COTIZACION_IA', organization_id: actor.organizationId, detalles: expect.objectContaining({ persisted_to_quote: false, sent: false }) }) }));
  });

  it('falla cerrado sin clave de idempotencia antes de consultar datos', async () => {
      const db = database();
      await expect(new QuoteEmailAIService(db as any, gateway() as any).draft(actor, quote.id, ''))
        .rejects.toMatchObject<Partial<QuoteEmailAIError>>({ status: 400, code: 'AI_IDEMPOTENCY_CONTEXT_REQUIRED' });
      expect(db.cotizacion.findFirst).not.toHaveBeenCalled();
  });

  it('aplica permisos de cotización e IA antes de consultar datos', async () => {
    const db = database();
    await expect(new QuoteEmailAIService(db as any, gateway() as any).draft({ ...actor, permissions: ['cotizaciones.write'] }, quote.id, 'denied-key'))
      .rejects.toMatchObject<Partial<QuoteEmailAIError>>({ status: 403, code: 'QUOTE_EMAIL_AI_DENIED' });
    expect(db.cotizacion.findFirst).not.toHaveBeenCalled();
  });
});
