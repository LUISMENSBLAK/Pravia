import { describe, expect, it, vi } from 'vitest';
import { interpretISROperationWithAI } from './isrOperationInterpretation.service';

const actor = { id: 'user', organizationId: 'org', rol: 'ABOGADO', permissions: ['isr.write', 'ia.execute'] } as any;
const description = 'Persona sintética QA vende un terreno el 11 de noviembre de 2026 en $746,130.';
const response = (facts: any[]) => {
  const payload = Object.fromEntries(['operationDate', 'values.operation', 'values.appraisal', 'values.cadastral', 'values.landSale', 'values.constructionSale', 'property.type'].map((key) => [key, null])) as Record<string, any>;
  payload.parties = [];
  for (const { field, ...value } of facts) { if (field === 'party') payload.parties.push(value); else Object.defineProperty(payload, field, { value, enumerable: true, configurable: true, writable: true }); }
  return { output: [{ content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] };
};
describe('ISR · interpretación IA propone hechos, no calcula impuestos', () => {
  it('usa Gateway/wallet/clave estable, fuente literal y esquema cerrado sin modelo hardcodeado', async () => {
    const facts = [{ field: 'values.operation', value: '746130.00', excerpt: '$746,130' }];
    const gateway = { execute: vi.fn().mockResolvedValue(response(facts)) };
    expect(await interpretISROperationWithAI(actor, description, 'stable-key', gateway)).toEqual(facts);
    expect(gateway.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actor: expect.objectContaining({ userId: 'user', organizationId: 'org' }), operationCode: 'ISR_OPERATION_INTERPRETATION', billingClass: 'CUSTOMER_WALLET', traceId: 'stable-key', idempotencyKey: 'stable-key', payload: { body: expect.objectContaining({ store: false, text: { format: expect.objectContaining({ strict: true }) } }) } }));
    const body: any = gateway.execute.mock.calls[0][0].payload.body; expect(body.model).toBeUndefined(); expect(JSON.stringify(body)).toContain('NO calcules ISR');
  });
  it('ausencia de permiso rechaza antes de invocar proveedor', async () => {
    const gateway = { execute: vi.fn() };
    await expect(interpretISROperationWithAI({ ...actor, permissions: ['isr.write'] }, description, 'key', gateway)).rejects.toMatchObject({ status: 403 });
    expect(gateway.execute).not.toHaveBeenCalled();
  });
  it.each([
    { field: 'tax_due', value: '126288.13', excerpt: 'terreno' },
    { field: 'values.operation', value: '100', excerpt: 'dato que no existe' },
    { field: '__proto__', value: 'true', excerpt: 'terreno' },
  ])('rechaza campo fiscal calculado, path arbitrario o fuente inventada $field', async (fact) => {
    await expect(interpretISROperationWithAI(actor, description, 'key', { execute: vi.fn().mockResolvedValue(response([fact])) })).rejects.toMatchObject({ code: 'ISR_INTERPRETATION_UNSUPPORTED_FACT' });
  });
  it('rechazo del proveedor y JSON inválido no se presentan como éxito', async () => {
    await expect(interpretISROperationWithAI(actor, description, 'key', { execute: vi.fn().mockResolvedValue({ output: [{ content: [{ type: 'refusal' }] }] }) })).rejects.toMatchObject({ code: 'ISR_INTERPRETATION_REFUSED' });
    await expect(interpretISROperationWithAI(actor, description, 'key', { execute: vi.fn().mockResolvedValue({ output: [] }) })).rejects.toMatchObject({ code: 'ISR_INTERPRETATION_INVALID' });
  });
  it('no acepta una respuesta que simplemente omitió revisar el precio explícito', async () => {
    const payload = { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ parties: [] }) }] }] };
    await expect(interpretISROperationWithAI(actor, description, 'key', { execute: vi.fn().mockResolvedValue(payload) })).rejects.toMatchObject({ code: 'ISR_INTERPRETATION_INVALID' });
  });
});
