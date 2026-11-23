import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import { completeLiteralProjectPatchPlan, docxVisibleText, renderLiteralProjectTemplate, buildLiteralProjectSources, validateLiteralProjectPatches, resolveProjectTemplateUse, reviewProjectAgainstTemplate } from './projectGeneration.service';
import { planLiteralProjectPatchesWithOpenAI } from './openaiDocument.service';
import { highlightProjectReviewText } from './projectDocxHighlight.service';
import { buildProjectionReviewReport, normalizeProjectionObservations } from './projectReviewReport.service';
import { applyDirectedDocxPatches } from './projectInstruction.service';

describe('Proyección · contrato de conservación y revisión 21-11-2026', () => {
  it('no exige letra ni alerta sobre un importe acreditado cuando el machote sólo usa guarismo', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Precio: $999,999.00')] }] }));
    const output = await renderLiteralProjectTemplate(source, { patches: [{ find: '$999,999.00', replace: '$80,000.00', source_references: ['CANONICAL_FACTS'], reason: 'Precio acreditado', confidence: 'ALTA' }], missing_fields: [], conflicts: [], possible_residues: [], model: 'qa', usage: {} as any }, []);
    expect((await reviewProjectAgainstTemplate(output.buffer, source, '80000', 'QA', ['$999,999.00'])).filter((item) => item.tipo_discrepancia === 'CANTIDAD_FORMAL')).toEqual([]);
    expect(await (await JSZip.loadAsync(output.buffer)).file('word/document.xml')!.async('string')).not.toContain('w:highlight');
  });
  it('el modo ordinario permanece conservador; otro acto exige declaración explícita válida', () => {
    expect(resolveProjectTemplateUse({}, 'COMPRAVENTA')).toEqual({ purpose: 'SAME_ACT', source_act: 'COMPRAVENTA', target_act: 'COMPRAVENTA' });
    expect(() => resolveProjectTemplateUse({ template_purpose: 'AUTO' }, 'REAL')).toThrow(/Indica si/);
    for (const template_source_act of ['', ' '.repeat(3), 'x'.repeat(201)]) expect(() => resolveProjectTemplateUse({ template_purpose: 'STYLE_REFERENCE', template_source_act }, 'REAL')).toThrow(/acto de origen/);
    expect(resolveProjectTemplateUse({ template_purpose: 'STYLE_REFERENCE', template_source_act: ' COMPRAVENTA INMOBILIARIA ' }, 'COMPRAVENTA DE EMBARCACIÓN')).toMatchObject({ source_act: 'COMPRAVENTA INMOBILIARIA', target_act: 'COMPRAVENTA DE EMBARCACIÓN' });
  });

  it('otro acto conserva el paquete Word pero no traslada ISABI/predial ni inventa fundamentos ausentes', async () => {
    const old = 'PRIMERA. La casa ejemplo se vende con ISABI y predial.';
    const replacement = 'PRIMERA. Se transmite la embarcación QA-BOAT-001. [PENDIENTE: FUNDAMENTO DEL ACTO REAL A REVISAR POR EL ABOGADO]';
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: old, font: 'Times New Roman', size: 24 })] })] }] }));
    let request: any;
    const plan = await planLiteralProjectPatchesWithOpenAI({ templateName: 'Referencia inmobiliaria sintética',
      templateUse: resolveProjectTemplateUse({ template_purpose: 'STYLE_REFERENCE', template_source_act: 'Compraventa de inmueble' }, 'Compraventa de embarcación'),
      templateSegments: [{ id: 'p-1', paragraph_index: 0, text: old }], canonicalFacts: { 'expediente.acto': 'Compraventa de embarcación' }, sourceDocuments: [{ id: 'title-qa', name: 'Título sintético', text: 'Embarcación QA-BOAT-001.', extracted: {} }],
      economicContext: { actor: { userId: 'qa', organizationId: 'qa', role: 'DIRECCION', permissions: ['ia.execute'], scope: 'GLOBAL' } as any, idempotencyKey: 'style-qa', traceId: 'style-qa', gateway: { execute: async (value) => { request = value; return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ patches: [{ target_id: 'p-1', replace: replacement, source_references: ['title-qa', 'TEMPLATE_MISSING'], reason: 'Objeto acreditado; no se trasladan impuestos inmobiliarios.', confidence: 'ALTA' }], missing_fields: ['Fundamento del acto real'], conflicts: [], possible_residues: [] }) }] }], usage: { input_tokens: 1, output_tokens: 1 } } as any; } } },
    });
    const prompt = request.payload.body.input[0].content[0].text;
    expect(prompt).toContain('MODO EXPLÍCITO REFERENCIA DE ESTILO'); expect(prompt).toContain('Compraventa de embarcación');
    expect(prompt).toContain('No uses la cláusula sustantiva incompatible');
    const rendered = await renderLiteralProjectTemplate(source, plan, ['title-qa']);
    expect(await docxVisibleText(rendered.buffer)).toBe(replacement); expect(await docxVisibleText(rendered.buffer)).not.toMatch(/ISABI|predial|casa ejemplo/);
    const a = await JSZip.loadAsync(source), b = await JSZip.loadAsync(rendered.buffer);
    for (const name of Object.keys(a.files).filter((name) => !a.files[name].dir && name !== 'word/document.xml')) expect(await b.file(name)!.async('nodebuffer')).toEqual(await a.file(name)!.async('nodebuffer'));
    const xml = await b.file('word/document.xml')!.async('string'); expect(xml).toContain('Times New Roman'); expect(xml).toContain('w:highlight'); expect(rendered.pendingCount).toBe(1);
  });
  it('no entrega pendientes que repiten la instrucción genérica sin identificar el campo', () => {
    expect(() => validateLiteralProjectPatches('RFC: EJEMPLO', { patches: [{ find: 'RFC: EJEMPLO', replace: 'RFC: [PENDIENTE: DESCRIPCIÓN CLARA]', source_references: ['TEMPLATE_MISSING'], reason: 'No consta', confidence: 'ALTA' }] }, []))
      .toThrow(/dato concreto faltante/);
  });
  it('conserva texto dudoso y cláusulas, en lugar de borrar un posible residuo', async () => {
    const value = 'CLÁUSULA LEGAL DUDOSA DEL MACHOTE';
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(value)] }] }));
    const plan = completeLiteralProjectPatchPlan({ patches: [], missing_fields: [], conflicts: [],
      possible_residues: [{ value, location: 'Cláusula primera', detail: 'REVISAR POSIBLE ELIMINACIÓN/MODIFICACIÓN: falta fuente vigente.' }], model: 'qa', usage: {} as any }, [{ text: value, paragraph_index: 0 }]);
    expect(plan.patches).toEqual([]);
    const rendered = await renderLiteralProjectTemplate(source, plan, []);
    expect(await docxVisibleText(rendered.buffer)).toBe(value);
    const xml = await (await JSZip.loadAsync(rendered.buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect(rendered.pendingCount).toBe(0);
  });

  it('amarillo preciso en fragmentos divididos entre runs sin colorear variables acreditadas', () => {
    const xml = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Cliente acreditado. Artí</w:t></w:r><w:r><w:t>culo dudoso. Cierre fijo.</w:t></w:r></w:p>';
    const result = highlightProjectReviewText(xml, ['Artículo dudoso']);
    expect(result).toContain('<w:t xml:space="preserve">Cliente acreditado. </w:t>');
    expect(result).toContain('<w:highlight w:val="yellow"/>');
    const runs = [...result.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map((item) => item[1]);
    expect(runs.filter((run) => run.includes('Cliente acreditado') || run.includes('Cierre fijo')).every((run) => !run.includes('w:highlight'))).toBe(true);
    expect(runs.filter((run) => run.includes('Artí') || run.includes('culo dudoso')).every((run) => run.includes('w:highlight'))).toBe(true);
  });

  it('sustituye un párrafo completo conservando negritas/itálicas de textos no modificados', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [
      new TextRun({ text: 'CLIENTE: ', bold: true }), new TextRun('EJEMPLO'), new TextRun({ text: ' CLÁUSULA FIJA ', italics: true }),
      new TextRun('IMPORTE: 10.00'), new TextRun({ text: ' CIERRE', bold: true }),
    ] })] }] }));
    const result = await applyDirectedDocxPatches(source, [{ find: 'CLIENTE: EJEMPLO CLÁUSULA FIJA IMPORTE: 10.00 CIERRE', replace: 'CLIENTE: ACTUAL CLÁUSULA FIJA IMPORTE: 20.00 CIERRE' }]);
    const xml = await (await JSZip.loadAsync(result.buffer)).file('word/document.xml')!.async('string');
    const runs = [...xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map((item) => item[1]);
    expect(runs.find((run) => run.includes('CLIENTE: '))).toContain('<w:b');
    expect(runs.find((run) => run.includes('CLÁUSULA FIJA'))).toContain('<w:i');
    expect(runs.find((run) => run.includes(' CIERRE'))).toContain('<w:b');
    expect(await docxVisibleText(result.buffer)).toBe('CLIENTE: ACTUAL CLÁUSULA FIJA IMPORTE: 20.00 CIERRE');
  });

  it('lee toda la fuente textual y falla explícitamente antes de truncar', async () => {
    const source = { documento_id: 'qa-doc', documento: { nombre_original: 'Fuente QA.docx', datos_extraidos: {}, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } };
    const body = 'Dato documental acreditado. '.repeat(200);
    expect((await buildLiteralProjectSources([source], async () => body)).sources[0].text).toBe(body);
    await expect(buildLiteralProjectSources([source], async () => 'x'.repeat(80_001))).rejects.toMatchObject({ code: 'PROJECT_SOURCE_CONTEXT_TOO_LARGE' });
  });

  it('reporte independiente con cuatro categorías y ubicaciones/fuentes/recomendaciones, incluso vacías', async () => {
    const observations = normalizeProjectionObservations([{ nivel_riesgo: 'MEDIO', dato_proyecto: '[PENDIENTE: RFC]', dato_fuente: 'No disponible', documento_fuente: 'Fuente QA', ubicacion: 'Generales', tipo_discrepancia: 'FALTANTE', recomendacion: 'Aportar dato acreditado.' }]);
    expect(observations[0].categoria).toBe('PENDIENTES');
    const buffer = await buildProjectionReviewReport({ folio: 'EXP-QA', projectName: 'QA sin validez jurídica', requestedBy: 'QA', summary: 'Falta RFC', observations, areas: [], unread: [], sourceCount: 1, totalSourceCount: 1, legalFoundation: 'No verificado' });
    const output = await docxVisibleText(buffer);
    for (const label of ['OBSERVACIONES DE PROYECCIÓN', 'CRÍTICAS', 'REVISAR', 'PENDIENTES', 'INFORMATIVAS', 'Generales', 'Fuente QA', 'Aportar dato acreditado.']) expect(output).toContain(label);
    expect(output.match(/SIN OBSERVACIONES\./g)).toHaveLength(3);
  });
});
