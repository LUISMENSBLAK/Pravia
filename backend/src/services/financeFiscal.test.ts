import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { ContractTestCfdiProvider, DisabledCfdiProvider } from './cfdiProvider';
import { FinanceFiscalError, FinanceFiscalService, extractCsfFields, parseCfdi40Xml } from './financeFiscal.service';

const xml = (overrides = '') => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="QA" Folio="12" Fecha="2026-10-06T10:00:00" SubTotal="1000.00" Total="1160.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PPD" FormaPago="99" ${overrides}>
 <cfdi:Emisor Rfc="AAA010101AAA" Nombre="PROVEEDOR QA" RegimenFiscal="601"/>
 <cfdi:Receptor Rfc="BBB010101BBB" Nombre="NOTARIA QA" DomicilioFiscalReceptor="63735" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
 <cfdi:Impuestos TotalImpuestosTrasladados="160.00"/>
 <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="123E4567-E89B-42D3-A456-426614174000" FechaTimbrado="2026-10-06T10:01:00"/></cfdi:Complemento>
</cfdi:Comprobante>`);

describe('B3 · dominio fiscal local seguro', () => {
  it('parsea CFDI 4.0 de forma determinista sin usar IA para importes', () => {
    const result = parseCfdi40Xml(xml());
    expect(result).toMatchObject({ version: '4.0', uuid: '123E4567-E89B-42D3-A456-426614174000', metodoPago: 'PPD', emisor: { rfc: 'AAA010101AAA' }, receptor: { rfc: 'BBB010101BBB' } });
    expect(result.total.toFixed(2)).toBe('1160.00');
    expect(result.impuestosTrasladados.toFixed(2)).toBe('160.00');
  });

  it('rechaza entidades externas, DTD y versiones distintas de 4.0', () => {
    expect(() => parseCfdi40Xml(Buffer.from('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><cfdi:Comprobante/>'))).toThrowError(expect.objectContaining({ code: 'CFDI_XML_UNSAFE' }));
    expect(() => parseCfdi40Xml(Buffer.from(xml().toString().replace('Version="4.0"', 'Version="3.3"')))).toThrowError(expect.objectContaining({ code: 'CFDI_XML_VERSION_UNSUPPORTED' }));
  });

  it('extrae RFC, CP y varios regímenes de una CSF y exige revisión humana en el controlador', () => {
    expect(extractCsfFields('RFC: AAA010101AAA\nDenominación/Razón Social: PROVEEDOR QA\nCódigo Postal: 63735\nRégimen Fiscal: 601 General\nRégimen Fiscal: 612 Personas Físicas'))
      .toEqual({ rfc: 'AAA010101AAA', razon_social: 'PROVEEDOR QA', codigo_postal: '63735', regimenes_fiscales: [{ clave: '601', descripcion: 'General' }, { clave: '612', descripcion: 'Personas Físicas' }] });
  });

  it('mantiene PAC deshabilitado y nunca fabrica timbrado', async () => {
    const provider = new DisabledCfdiProvider();
    expect(provider.configured).toBe(false);
    await expect(provider.stamp({ version: '4.0', tipo: 'I', emisorRfc: 'AAA010101AAA', receptorRfc: 'BBB010101BBB', total: '1.00' })).rejects.toMatchObject({ code: 'CFDI_PROVIDER_NOT_CONFIGURED' });
  });

  it('permite probar el contrato del provider sin presentarlo como Facturama', async () => {
    const provider = new ContractTestCfdiProvider({ uuid: '123E4567-E89B-42D3-A456-426614174000', xml: xml(), providerReference: 'local-contract' });
    const result = await provider.stamp({ version: '4.0', tipo: 'I', emisorRfc: 'AAA010101AAA', receptorRfc: 'BBB010101BBB', total: '1160.00', metodoPago: 'PPD' });
    expect(provider.id).toBe('CONTRACT_TEST_ONLY');
    expect(result.uuid).toBe('123E4567-E89B-42D3-A456-426614174000');
  });

  it('genera un XLSX real, abrible y con filas de las fuentes canónicas', async () => {
    const db = {
      documentoCfdi: { findMany: vi.fn().mockResolvedValue([{ direccion: 'EMITIDO', estado: 'PREFACTURA', uuid_fiscal: null, receptor_rfc: 'BBB010101BBB', receptor_nombre: 'CLIENTE', emisor_rfc: 'AAA010101AAA', emisor_nombre: 'NOTARIA', total: 100, saldo: 100, created_at: new Date('2026-10-06T00:00:00Z') }]) },
      cuentaPorCobrarCfdi: { findMany: vi.fn().mockResolvedValue([]) }, cuentaPorPagarCfdi: { findMany: vi.fn().mockResolvedValue([]) }, transferenciaInterna: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await new FinanceFiscalService(db as any).exportXlsx({ id: 'user', organizationId: 'org', permissions: [] });
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.rowCount).toBe(1);
    const zip = await JSZip.loadAsync(result.buffer);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('PREFACTURA');
    expect(sheet).toContain('CLIENTE');
  });

  it('distingue errores fiscales de errores genéricos', () => {
    const error = new FinanceFiscalError(409, 'CFDI_TEST', 'conflicto');
    expect(error).toMatchObject({ status: 409, code: 'CFDI_TEST', message: 'conflicto' });
  });
});
