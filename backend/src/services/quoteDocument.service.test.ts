import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { quoteTemplateData, renderQuoteTemplate } from './quoteDocument.service';

const minimalDoubleBraceTemplate = () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{cotizacion.folio}}</w:t></w:r></w:p><w:p><w:r><w:t>{{cliente.nombre}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
};

describe('Corrección 002 · datos canónicos de la cotización generada', () => {
  it('combina las variables de doble llave usadas por la biblioteca CFG-002', () => {
    const rendered = renderQuoteTemplate(minimalDoubleBraceTemplate(), {
      'cotizacion.folio': 'COT-0042-2026',
      'cliente.nombre': 'Cliente QA',
    });
    const documentXml = new PizZip(rendered).file('word/document.xml')?.asText();

    expect(documentXml).toContain('COT-0042-2026');
    expect(documentXml).toContain('Cliente QA');
    expect(documentXml).not.toContain('{{cotizacion.folio}}');
  });

  it('mapea el presupuesto estructurado a ADM-001 sin sumar categorías distintas', () => {
    const data = quoteTemplateData({
      folio: 'COT-0042-2026',
      date: new Date('2026-09-12T12:00:00.000Z'),
      client: 'Cliente QA',
      act: 'Compraventa',
      notary: 'Notaría QA',
      concepts: [
        { concepto: 'Honorarios notariales', categoria: 'HONORARIOS', importeCents: 10_000n },
        { concepto: 'IVA de honorarios', categoria: 'IVA_HONORARIOS', importeCents: 1_600n },
        { concepto: 'Impuesto local', categoria: 'IMPUESTOS_DERECHOS', importeCents: 2_000n },
        { concepto: 'Derechos de Registro Público', categoria: 'IMPUESTOS_DERECHOS', importeCents: 300n },
      ],
      validatedAdvanceCents: 5_000n,
    });

    expect(data).toMatchObject({
      'cotizacion.folio': 'COT-0042-2026',
      'cliente.nombre': 'Cliente QA',
      'expediente.acto': 'Compraventa',
      'cotizacion.honorarios': '100.00',
      'cotizacion.iva': '16.00',
      'cotizacion.impuestos': '20.00',
      'cotizacion.derechos': '3.00',
      'cotizacion.total': '139.00',
      'cotizacion.anticipo': '50.00',
      'cotizacion.saldo': '89.00',
      'notaria.nombre': 'Notaría QA',
    });
  });

  it('no inventa vigencia, inmueble, terceros ni datos bancarios ausentes', () => {
    const data = quoteTemplateData({
      folio: 'COT-0001-2026', date: new Date('2026-09-12T12:00:00.000Z'),
      client: 'Cliente QA', act: 'Poder', notary: 'Notaría QA', concepts: [], validatedAdvanceCents: 0n,
    });

    expect(data['cotizacion.vigencia']).toBe('No configurada');
    expect(data['inmueble.referencia|[PENDIENTE/NO APLICA]']).toBe('Pendiente / no aplica');
    expect(data['cotizacion.terceros_detalle']).toBe('No identificado en el presupuesto estructurado');
    expect(data['notaria.datos_bancarios']).toBe('Pendiente de configuración');
  });
});
