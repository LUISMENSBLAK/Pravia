import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { hasCompleteCfdiDraftData } from './cfdiDraftReadiness';

const complete = () => ({ direccion: 'EMITIDO', tipo: 'I', estado: 'PREFACTURA', entidad_fiscal_id: 'entity',
  entidadFiscal: { activa: true }, emisor_rfc: 'AAA010101AAA', receptor_rfc: 'XAXX010101000',
  receptor_nombre: 'Cliente QA', receptor_regimen: '616', receptor_codigo_postal: '12345',
  uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN',
  subtotal: new Prisma.Decimal('100.00'), impuestos_trasladados: new Prisma.Decimal('16.00'),
  impuestos_retenidos: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('116.00'),
  draft_payload: { concepts: [{ clave_prod_serv: '84111506', clave_unidad: 'E48', objeto_impuesto: '02',
    descripcion: 'Servicio QA', cantidad: '1', valor_unitario: '100.00' }] },
});

describe('CFDI data-only readiness preflight', () => {
  it('accepts a complete fiscal snapshot without claiming PAC readiness', () => {
    expect(hasCompleteCfdiDraftData(complete())).toBe(true);
  });
  it('rejects an unconfigured entity, absent concepts, a mismatched total and a stamped state', () => {
    expect(hasCompleteCfdiDraftData({ ...complete(), entidadFiscal: { activa: false } })).toBe(false);
    expect(hasCompleteCfdiDraftData({ ...complete(), draft_payload: { concepts: [] } })).toBe(false);
    expect(hasCompleteCfdiDraftData({ ...complete(), total: new Prisma.Decimal('115.00') })).toBe(false);
    expect(hasCompleteCfdiDraftData({ ...complete(), estado: 'TIMBRADO' })).toBe(false);
  });
});
