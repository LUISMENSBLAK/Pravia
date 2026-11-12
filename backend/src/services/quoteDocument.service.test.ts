import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { quoteStructuredBudget, quoteTemplateData, renderQuoteTemplate, resolveQuoteEconomicMapping } from './quoteDocument.service';

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

const alternativeQuoteTemplate = () => {
  const zip = new PizZip(minimalDoubleBraceTemplate());
  const current = zip.file('word/document.xml')!.asText();
  const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  const row = (a: string, b: string) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
  zip.file('word/document.xml', current.replace('<w:sectPr/>', `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="3000"/></w:tblGrid>${row('Partida', 'Monto')}${row('DETALLE EDITABLE', '0.00')}${row('IMPORTE FINAL', '0.00')}</w:tbl><w:sectPr/>`));
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
};

const sectionedQuoteTemplate = () => {
  const zip = new PizZip(minimalDoubleBraceTemplate());
  const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  const row = (...values: string[]) => `<w:tr>${values.map(cell).join('')}</w:tr>`;
  const content = row('CLIENTE:', '[NOMBRE / RAZÓN SOCIAL]') + row('ACTO:', '[TIPO DE ACTO]')
    + row('ESTADO:', 'EJEMPLO ESTADO', 'MUNICIPIO', 'EJEMPLO MUNICIPIO')
    + row('ABOGADO', '[NOMBRE DEL ABOGADO]') + row('VALOR AVALÚO $[0.00]')
    + row('#', 'CONCEPTO', 'IMPORTE') + row('1', '[ESCRIBA EL IMPUESTO O DERECHO]', '$[0.00]')
    + row('SUBTOTAL IMPUESTOS Y DERECHOS', '$[0.00]') + row('1', '[ESCRIBA EL CONCEPTO DE HONORARIOS]', '$[0.00]')
    + row('IVA 16%', '$[0.00]') + row('SUBTOTAL HONORARIOS', '$[0.00]') + row('TOTAL GENERAL', '$[0.00]');
  zip.file('word/document.xml', zip.file('word/document.xml')!.asText().replace('<w:sectPr/>', `<w:tbl>${content}</w:tbl><w:p><w:r><w:t>CONDICIONES ORIGINALES QA</w:t></w:r></w:p><w:sectPr/>`));
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
};

describe('Corrección 002 · datos canónicos de la cotización generada', () => {
  it('conserva saltos y formato entre variables fragmentadas y rellena referencia e importe del bloque bancario', () => {
    const source = new PizZip(sectionedQuoteTemplate());
    source.file('word/document.xml', source.file('word/document.xml')!.asText().replace('<w:sectPr/>', '<w:p><w:r><w:t>PRESUPUESTO [0</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>00]</w:t><w:br/><w:t>[DD/MM/AAAA]</w:t></w:r></w:p><w:p><w:r><w:t>REFERENCIA/CONCEPTO:</w:t><w:br/><w:t>CANTIDAD: $</w:t><w:br/><w:t>TITULAR: ORIGINAL QA</w:t></w:r></w:p><w:sectPr/>'));
    const xml = new PizZip(renderQuoteTemplate(source.generate({ type: 'nodebuffer' }), { 'cotizacion.folio': 'COT-QA', 'cotizacion.fecha': '12/11/2026' }, [{ concepto: 'Honorarios', categoria: 'HONORARIOS', importeCents: 10000n }])).file('word/document.xml')!.asText();
    expect((xml.match(/<w:br\s*\/>/g) || [])).toHaveLength(3);
    expect(xml).toContain('PRESUPUESTO COT-QA'); expect(xml).toContain('12/11/2026');
    expect(xml).toContain('REFERENCIA/CONCEPTO: COT-QA'); expect(xml).toContain('CANTIDAD: $100.00');
    expect(xml).toContain('<w:b/>'); expect(xml).toContain('TITULAR: ORIGINAL QA');
  });
  it('rellena el presupuesto seccionado sin sustituir el machote ni conservar cifras de ejemplo', () => {
    const source = sectionedQuoteTemplate();
    const before = Buffer.from(source);
    const concepts = [
      { concepto: 'Honorario QA', categoria: 'HONORARIOS' as const, importeCents: 10000n },
      { concepto: 'IVA QA', categoria: 'IVA_HONORARIOS' as const, importeCents: 1600n },
      { concepto: 'Derecho QA', categoria: 'IMPUESTOS_DERECHOS' as const, importeCents: 2300n },
      { concepto: 'Otro gasto QA', categoria: 'OTRO_GASTO' as const, importeCents: 500n, tratamiento_iva: 'GRAVADO' as const, iva_tasa: '0.16' },
    ];
    const data = quoteTemplateData({ folio: 'COT-QA', date: new Date('2026-11-12T12:00:00Z'), client: 'Cliente sintético', act: 'Acto QA', notary: 'Notaría QA', responsible: 'Responsable QA', concepts, validatedAdvanceCents: 0n });
    const xml = new PizZip(renderQuoteTemplate(source, data, concepts)).file('word/document.xml')!.asText();
    for (const text of ['Cliente sintético', 'Responsable QA', 'Honorario QA', 'Derecho QA', 'Otro gasto QA', '144.80', 'IVA DE OTROS GASTOS', 'CONDICIONES ORIGINALES QA', 'POR CONFIRMAR']) expect(xml).toContain(text);
    expect(xml).not.toContain('EJEMPLO ESTADO'); expect(xml).not.toContain('IVA 16%'); expect(xml).not.toContain('[ESCRIBA');
    expect((xml.match(/TOTAL GENERAL/g) || [])).toHaveLength(1);
    expect((xml.match(/<w:tbl>/g) || [])).toHaveLength(1); expect(source.equals(before)).toBe(true);
  });

  it('mantiene cero real sólo en secciones económicas sin partidas y no inventa avalúos', () => {
    const source = sectionedQuoteTemplate();
    const xml = new PizZip(renderQuoteTemplate(source, {}, [{ concepto: 'Único honorario', categoria: 'HONORARIOS', importeCents: 100n }])).file('word/document.xml')!.asText();
    expect(xml).toContain('Sin impuestos ni derechos'); expect(xml).toContain('POR CONFIRMAR'); expect(xml).toContain('1.00');
    expect(xml).not.toContain('$[0.00]');
  });
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

  it('configura una tabla alternativa de dos columnas por versión, sin alterar el machote original ni duplicar el total', () => {
    const original = alternativeQuoteTemplate();
    const versionId = 'e1695831-f112-4d94-a39d-080593a0e8d0';
    const mapping = resolveQuoteEconomicMapping({ quote_economic: { schema_version: 1, versions: { [versionId]: {
      table_index: 0, detail_row_index: 1, total_row_index: 2, label_column: 0, amount_column: 1,
    } } } }, versionId);
    expect(mapping).toBeTruthy();
    const rendered = renderQuoteTemplate(original, { 'cotizacion.folio': 'COT-0088-2026', 'cliente.nombre': 'Cliente QA' }, [
      { concepto: 'Honorarios A', categoria: 'HONORARIOS', importeCents: 10000n },
      { concepto: 'Honorarios B', categoria: 'HONORARIOS', importeCents: 20000n },
      { concepto: 'IVA derivado', categoria: 'IVA_HONORARIOS', importeCents: 4800n },
      { concepto: 'Impuesto QA', categoria: 'IMPUESTOS_DERECHOS', importeCents: 3000n },
    ], mapping);
    const originalZip = new PizZip(original);
    const outputZip = new PizZip(rendered);
    const documentXml = outputZip.file('word/document.xml')!.asText();
    expect(documentXml).toContain('Honorarios A');
    expect(documentXml).toContain('Honorarios B');
    expect(documentXml).toContain('Impuesto QA');
    expect(documentXml).toContain('IVA sobre honorarios');
    expect(documentXml).toContain('378.00');
    expect((documentXml.match(/IMPORTE FINAL/g) ?? [])).toHaveLength(1);
    expect((documentXml.match(/<w:tbl>/g) ?? [])).toHaveLength(1);
    expect(outputZip.file('[Content_Types].xml')!.asText()).toBe(originalZip.file('[Content_Types].xml')!.asText());
    expect(originalZip.file('word/document.xml')!.asText()).toContain('DETALLE EDITABLE');
  });

  it('no reutiliza un mapeo de otra versión ni permite índices inválidos', () => {
    const versionId = 'e1695831-f112-4d94-a39d-080593a0e8d0';
    const config = { quote_economic: { schema_version: 1, versions: { [versionId]: {
      table_index: 0, detail_row_index: 1, total_row_index: 2, label_column: 0, amount_column: 1,
    } } } };
    expect(() => resolveQuoteEconomicMapping(config, '9d433d56-422a-48d6-a02e-9773a9720c97')).toThrowError(expect.objectContaining({ code: 'QUOTE_TEMPLATE_MAPPING_VERSION_MISSING' }));
    expect(() => renderQuoteTemplate(alternativeQuoteTemplate(), {}, [], { table_index: 2, detail_row_index: 1, total_row_index: 2, label_column: 0, amount_column: 1 })).toThrowError(expect.objectContaining({ code: 'QUOTE_TEMPLATE_MAPPING_STRUCTURE_INVALID' }));
  });
});
