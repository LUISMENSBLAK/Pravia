import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { quoteStructuredBudget, quoteTemplateData, renderQuoteTemplate } from './quoteDocument.service';

const minimalDoubleBraceTemplate = () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{cotizacion.folio}}</w:t></w:r></w:p><w:p><w:r><w:t>{{cliente.nombre}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
};

const standardQuoteTemplate = () => {
  const library = new PizZip(readFileSync(fileURLToPath(new URL('../../resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip', import.meta.url))));
  const name = Object.keys(library.files).find((entry) => entry.endsWith('/ADM-001_Cotizacion_Servicios_Notariales.docx'));
  if (!name) throw new Error('ADM-001 original missing from CFG-002 library');
  return Buffer.from(library.file(name)!.asUint8Array());
};

describe('Corrección 002 · datos canónicos de la cotización generada', () => {
  it('combina las variables de doble llave usadas por la biblioteca CFG-002', () => {
    const rendered = renderQuoteTemplate(standardQuoteTemplate(), {
      'cotizacion.folio': 'COT-0042-2026',
      'cliente.nombre': 'Cliente QA',
    }, []);
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

  it('rellena la tabla económica del machote ADM-001 sin agregar un segundo presupuesto', () => {
    const concepts = [
      { concepto: 'Avalúo', categoria: 'IMPUESTOS_DERECHOS' as const, importeCents: 1_000_000n },
      { concepto: 'Registro Público', categoria: 'IMPUESTOS_DERECHOS' as const, importeCents: 1_500_000n },
      { concepto: 'Honorarios', categoria: 'HONORARIOS' as const, importeCents: 2_000_000n },
      { concepto: 'Misceláneos', categoria: 'HONORARIOS' as const, importeCents: 200_000n },
      { concepto: 'IVA', categoria: 'IVA_HONORARIOS' as const, importeCents: 400_000n },
    ];
    expect(quoteStructuredBudget(concepts)).toMatchObject({
      groups: [
        { label: 'IMPUESTOS Y DERECHOS', subtotalCents: 2_500_000n },
        { label: 'HONORARIOS', subtotalCents: 2_600_000n },
      ],
      totalCents: 5_100_000n,
    });

    const original = standardQuoteTemplate();
    const originalXml = new PizZip(original).file('word/document.xml')?.asText() ?? '';
    const rendered = renderQuoteTemplate(original, {
      'cotizacion.folio': 'COT-0042-2026',
      'cliente.nombre': 'CLIENTE QA',
    }, concepts);
    const documentXml = new PizZip(rendered).file('word/document.xml')?.asText() ?? '';
    const visibleText = documentXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(visibleText).toContain('COTIZACIÓN DE SERVICIOS NOTARIALES');
    expect(visibleText).toContain('Desglose económico');
    expect(visibleText).toContain('Avalúo');
    expect(visibleText).toContain('Registro Público');
    expect(visibleText).toContain('Misceláneos');
    expect(visibleText).toContain('IVA');
    expect(visibleText).toContain('51,000.00');
    expect(documentXml).not.toContain('PRESUPUESTO DE LA COTIZACIÓN');
    expect((documentXml.match(/<w:tbl>/g) ?? []).length).toBe((originalXml.match(/<w:tbl>/g) ?? []).length);
    expect((documentXml.match(/TOTAL ESTIMADO/g) ?? [])).toHaveLength(1);
    expect(new PizZip(rendered).file('word/styles.xml')?.asText()).toBe(new PizZip(original).file('word/styles.xml')?.asText());
  });

  it('representa honorarios, IVA derivado y otros gastos gravados en la tabla original con total exacto', () => {
    const concepts = [
      { concepto: 'Honorarios QA', categoria: 'HONORARIOS' as const, importeCents: 5_000_000n },
      { concepto: 'IVA de honorarios', categoria: 'IVA_HONORARIOS' as const, importeCents: 800_000n },
      { concepto: 'Impuestos QA', categoria: 'IMPUESTOS_DERECHOS' as const, importeCents: 2_000_000n },
      { concepto: 'Otro gasto QA', categoria: 'OTRO_GASTO' as const, importeCents: 150_000n, tratamiento_iva: 'GRAVADO' as const, iva_tasa: '0.16' },
    ];
    const original = standardQuoteTemplate();
    const originalXml = new PizZip(original).file('word/document.xml')?.asText() ?? '';
    const rendered = renderQuoteTemplate(original, { 'cotizacion.folio': 'COT-TEST-2026' }, concepts);
    const documentXml = new PizZip(rendered).file('word/document.xml')?.asText() ?? '';
    const visibleText = documentXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    expect(quoteStructuredBudget(concepts).totalCents).toBe(7_974_000n);
    expect(visibleText).toContain('Otro gasto QA');
    expect(visibleText).toContain('IVA de otros gastos configurados');
    expect(visibleText).toContain('240.00');
    expect(visibleText).toContain('79,740.00');
    expect(visibleText.match(/Otro gasto QA/g)).toHaveLength(1);
    expect(visibleText).not.toContain('Avalúos / certificados / gestoría / terceros');
    expect((documentXml.match(/<w:tbl>/g) ?? []).length).toBe((originalXml.match(/<w:tbl>/g) ?? []).length);
    expect((documentXml.match(/TOTAL ESTIMADO/g) ?? [])).toHaveLength(1);
  });

  it('rechaza un machote sin tabla económica en vez de añadir una cotización falsa al final', () => {
    expect(() => renderQuoteTemplate(minimalDoubleBraceTemplate(), { 'cotizacion.folio': 'COT-0042-2026' }, [
      { concepto: 'Honorarios', categoria: 'HONORARIOS', importeCents: 10000n },
    ])).toThrowError(expect.objectContaining({ code: 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING' }));
  });
});
