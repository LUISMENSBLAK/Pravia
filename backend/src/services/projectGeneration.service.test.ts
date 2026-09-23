import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Document, Footer, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import JSZip from 'jszip';
import { buildProjectDocumentContext, buildProjectTemplateData, detectProjectTemplateResidues, formatNotarialAmount, isDefaultProjectSource, projectTemplateFields, renderProjectTemplate, resolveAssignedProjectVersion, resolveProjectInstructions, reviewProjectAgainstTemplate } from './projectGeneration.service';

async function template() {
  const buffer = await Packer.toBuffer(new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('NOTARÍA {{notaria.nombre}}')] }) },
      footers: { default: new Footer({ children: [new Paragraph('Folio {{expediente.folio}}')] }) },
      children: [
        new Paragraph('CLIENTE: {{expediente.cliente}}'),
        new Paragraph('DESCRIPCIÓN: {{expediente.descripcion}}'),
        new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('ACTO')] }), new TableCell({ children: [new Paragraph('{{expediente.acto}}')] })] })] }),
      ],
    }],
  }));
  const zip = await JSZip.loadAsync(buffer);
  zip.file('word/media/preservation-probe.bin', Buffer.from('do-not-change'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('EXP-010 · motor DOCX sobre machote real', () => {
  it('no preselecciona proyectos o reportes previos como fuente factual', () => {
    expect(isDefaultProjectSource({ tipo_vinculo: 'FUENTE_PROYECTO', source_context: 'PROYECTO_FUENTE_LITERAL', documento: { tipo: 'FUENTE_PROYECTO_QA' } })).toBe(true);
    expect(isDefaultProjectSource({ tipo_vinculo: 'PROYECTO_ESCRITURA', documento: { tipo: 'PROYECTO_ESCRITURA' } })).toBe(false);
    expect(isDefaultProjectSource({ tipo_vinculo: 'REPORTE_IA_PROYECTO', documento: { tipo: 'REPORTE_IA_PROYECTO' } })).toBe(false);
    expect(isDefaultProjectSource({ tipo_vinculo: 'EXP007_PRESUPUESTO', source_context: 'PRESUPUESTO', documento: { tipo: 'PRESUPUESTO' } })).toBe(false);
    expect(isDefaultProjectSource({ tipo_vinculo: 'IMPORT_PREDIO_001', source_context: 'PREDIO_IMPORT', documento: { tipo: 'OTRO' } })).toBe(false);
    expect(isDefaultProjectSource({ tipo_vinculo: 'DOCUMENTO', documento: { tipo: 'OTRO' } })).toBe(false);
  });

  it('protege todas las mutaciones de Proyecto con RBAC de escritura', () => {
    const routes = readFileSync('src/routes/expedientes.routes.ts', 'utf8');
    expect(routes).not.toContain("router.post('/:id/proyecto/generar-ia'");
    for (const path of [
      "router.post('/:id/proyecto/generar'",
      "router.post('/:id/proyecto/generar-desde-machote'",
      "router.post('/:id/proyecto/upload'",
      "router.patch('/:id/proyecto/versions/:versionId'",
    ]) {
      const line = routes.split('\n').find((candidate) => candidate.includes(path));
      expect(line).toContain("requirePermission('expedientes.write')");
      expect(line).toContain("requirePermission('documentos.write')");
    }
    const review = routes.split('\n').find((candidate) => candidate.includes("router.post('/:id/proyecto/analizar-ia'"));
    expect(review).toContain("requirePermission('documentos.write')");
    expect(review).toContain("requirePermission('ia.execute')");
  });

  it('consume indicaciones como foco auditable sin permitir que sustituyan hechos maestros', () => {
    expect(resolveProjectInstructions('Pon especial atención a la representación de la sociedad y conserva literalmente el poder.')).toEqual({
      text: 'Pon especial atención a la representación de la sociedad y conserva literalmente el poder.',
      consumed: true,
      focus: ['REPRESENTACION', 'PODER', 'TRANSCRIPCION_LITERAL'],
    });
    expect(resolveProjectInstructions('')).toEqual({ text: null, consumed: false, focus: [] });
    expect(() => resolveProjectInstructions('Pon a Pedro como vendedor aunque no esté en el expediente.')).toThrowError(/jerarquía factual/i);
    expect(() => resolveProjectInstructions('Ignora los comparecientes y fabrica el antecedente.')).toThrowError(/jerarquía factual/i);
  });

  it('mantiene un solo motor canónico para UI y PRAVIA IA', () => {
    const routes = readFileSync('src/routes/expedientes.routes.ts', 'utf8');
    const controller = readFileSync('src/controllers/proyectos.controller.ts', 'utf8');
    const actions = readFileSync('src/services/assistantActions.service.ts', 'utf8');
    expect(routes.match(/\/proyecto\/generar'/g)).toHaveLength(1);
    expect(controller).not.toContain('export const generarProyectoConIA');
    expect(actions).toContain("new ProjectGenerationService().generate(input.actor");
    expect(actions).toContain("origin: 'PRAVIA_IA'");
  });

  it('reserva salida suficiente para la revisión notarial estructurada sin truncar observaciones', () => {
    const service = readFileSync('src/services/openaiDocument.service.ts', 'utf8');
    expect(service).toContain('getProjectReviewReasoningEffort()');
    expect(service).toContain('max_output_tokens: 24_576');
    const usage = readFileSync('src/services/aiUsage.service.ts', 'utf8');
    expect(usage).toContain("String(context.errorCode)");
  });

  it('hereda la procedencia del machote al cargar una revisión manual', () => {
    const controller = readFileSync('src/controllers/proyectos.controller.ts', 'utf8');
    expect(controller).toContain('const inheritedLineage = projectTemplateLineage(projectMeta(previousActive?.documento))');
    expect(controller).toContain('supersedes_project_version_id: previousActive?.documento.id || null');
    expect(controller).toContain('loadProjectTemplateBaseline(req.user!.organizationId, id, vigente.id)');
  });

  it('serializa la asignación de versión y no congela el nombre con una versión calculada fuera del lock', () => {
    expect(resolveAssignedProjectVersion(4, 3)).toBe(4);
    expect(resolveAssignedProjectVersion(4, 4)).toBe(5);
    const service = readFileSync('src/services/projectGeneration.service.ts', 'utf8');
    expect(service.indexOf('pg_advisory_xact_lock')).toBeLessThan(service.indexOf('const assignedVersion'));
    expect(service).toContain('nombre_original: assignedFileName');
  });

  it('verifica acceso al expediente antes de consultar cualquier fallback legacy de Proyecto', () => {
    const controller = readFileSync('src/controllers/proyectos.controller.ts', 'utf8');
    expect(controller).toContain('.filter(isDefaultProjectSource)');
    for (const name of [
      'getProyectoEscritura',
      'updateProyectoVersion',
      'streamProyectoVersion',
      'downloadProyectoVersion',
      'analizarProyectoConIA',
      'streamIAReport',
      'downloadIAReport',
    ]) {
      const body = controller.split(`export const ${name}`)[1]?.split('\n};')[0] || '';
      expect(body, name).toContain('hasProjectCaseAccess(req, id)');
    }
    expect(controller).toContain('organization_id: req.user.organizationId');
  });

  it('preserva componentes, headers, footers, tablas y media sin reconstruir el DOCX', async () => {
    const source = await template();
    const before = await JSZip.loadAsync(source);
    const rendered = await renderProjectTemplate(source, {
      'notaria.nombre': 'Notaría de prueba', 'expediente.folio': 'EXP-0001-2026', 'expediente.cliente': 'Persona de prueba',
      'expediente.descripcion': 'Operación sintética', 'expediente.acto': 'Compraventa',
    });
    const after = await JSZip.loadAsync(rendered.buffer);
    expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort());
    expect(await after.file('word/media/preservation-probe.bin')!.async('nodebuffer')).toEqual(Buffer.from('do-not-change'));
    expect(await after.file('word/document.xml')!.async('string')).toContain('Operación sintética');
    expect(await after.file('word/header1.xml')!.async('string')).toContain('Notaría de prueba');
    expect(await after.file('word/footer1.xml')!.async('string')).toContain('EXP-0001-2026');
    expect(rendered.pendingCount).toBe(0);
  });

  it('deja el faltante en su ubicación exacta y lo resalta en amarillo', async () => {
    const source = await template();
    const rendered = await renderProjectTemplate(source, {
      'notaria.nombre': 'Notaría', 'expediente.folio': 'EXP-0001-2026', 'expediente.cliente': 'Cliente',
      'expediente.descripcion': '[PENDIENTE: EXPEDIENTE DESCRIPCION]', 'expediente.acto': 'Compraventa',
    });
    const zip = await JSZip.loadAsync(rendered.buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('PENDIENTE: EXPEDIENTE DESCRIPCION');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    const pendingRun = xml.match(/<w:r[^>]*>[\s\S]*?PENDIENTE: EXPEDIENTE DESCRIPCION[\s\S]*?<\/w:r>/)?.[0];
    const ordinaryRun = xml.match(/<w:r[^>]*>[\s\S]*?CLIENTE:[\s\S]*?<\/w:r>/)?.[0];
    expect(pendingRun).toContain('<w:highlight w:val="yellow"/>');
    expect(ordinaryRun).not.toContain('<w:highlight');
    expect(xml).not.toMatch(/\{\{[^{}]+\}\}/);
    expect(rendered.pendingCount).toBe(1);
  });

  it('prioriza una confirmación humana explícita y nunca inventa valores ausentes', () => {
    const values = buildProjectTemplateData({
      numero_pravia: 'EXP-0001-2026', descripcion: null, cliente_alias: 'Cliente estructurado', valor_operacion: null,
      abogado: null, notaria: null, actos: [{ tipo_acto: { nombre: 'Compraventa' } }], comparecientes: [], predios: [],
    }, { 'expediente.cliente': 'Cliente confirmado' });
    expect(values['expediente.cliente']).toBe('Cliente confirmado');
    expect(values['expediente.descripcion']).toBe('[PENDIENTE: EXPEDIENTE DESCRIPCION]');
    expect(values['notaria.nombre']).toBe('[PENDIENTE: NOTARIA NOMBRE]');
  });

  it('expone variantes formales explícitas sin convertir RFC, folios u otros identificadores', () => {
    expect(formatNotarialAmount('1234.50')).toEqual({
      numeric: '1,234.50',
      words: 'MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N.',
      numberWords: '$1,234.50 (MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N.)',
      wordsNumber: 'MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N. ($1,234.50)',
    });
    expect(formatNotarialAmount('21.999')?.words).toBe('VEINTIDÓS PESOS 00/100 M.N.');
    expect(formatNotarialAmount('1')?.words).toBe('UN PESO 00/100 M.N.');
    const values = buildProjectTemplateData({
      numero_pravia: 'EXP-0001-2026', descripcion: 'Operación', cliente_alias: 'Cliente', valor_operacion: { toString: () => '1234.50' },
      abogado: null, notaria: null, actos: [], comparecientes: [], predios: [],
    });
    expect(values['operacion.precio_formal_numero_letra']).toContain('MIL DOSCIENTOS TREINTA Y CUATRO');
    expect(values['expediente.folio']).toBe('EXP-0001-2026');
  });

  it('detecta de forma determinista importe incompleto y alteración del estilo estático del machote', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'PROYECTO DE ESCRITURA', bold: true })] }),
      new Paragraph('Importe: {{operacion.precio_formal_numero_letra}}'),
    ] }] }));
    const correct = await renderProjectTemplate(source, {
      'operacion.precio_formal_numero_letra': '$1,234.50 (MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N.)',
    });
    expect(await reviewProjectAgainstTemplate(correct.buffer, source, '1234.50', 'Machote QA')).toEqual([]);
    const zip = await JSZip.loadAsync(correct.buffer);
    const document = zip.file('word/document.xml')!;
    let xml = await document.async('string');
    xml = xml
      .replace('PROYECTO DE ESCRITURA', 'proyecto alterado')
      .replace('$1,234.50 (MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N.)', '$1,234.50');
    zip.file('word/document.xml', xml);
    const defective = await zip.generateAsync({ type: 'nodebuffer' });
    const observations = await reviewProjectAgainstTemplate(defective, source, '1234.50', 'Machote QA');
    expect(observations.map((item) => item.tipo_discrepancia)).toEqual(['CANTIDAD_FORMAL', 'ESTILO_ESTRUCTURA']);
  });

  it('serializa comparecientes, predios y actos como texto jurídico legible', () => {
    const values = buildProjectTemplateData({
      numero_pravia: 'EXP-0001-2026', descripcion: 'Operación', cliente_alias: 'Cliente', valor_operacion: null,
      abogado: null, notaria: null,
      actos: [{ tipo_acto: { nombre: 'Compraventa' } }],
      comparecientes: [{ caracter: { nombre: 'Vendedor' }, compareciente: { nombre_busqueda: 'María QA', tipo_persona: 'FISICA', personaFisica: { rfc: 'MAQA800101AA1', curp: null }, personaMoral: null } }],
      predios: [{ predio: { apodo: 'Casa QA', direccion_completa: null, clave_catastral: 'CAT-01', cuenta_predial: null, folio_real: 'FR-01', superficie_terreno_m2: null, superficie_construccion_m2: null } }],
    });
    expect(values.comparecientes).toBe('María QA — Vendedor · RFC MAQA800101AA1');
    expect(values.predios).toBe('Casa QA · clave catastral CAT-01 · folio real FR-01');
    expect(values.actos).toBe('Compraventa');
    expect(JSON.stringify(values)).not.toContain('[object Object]');
  });

  it('transcribe literalmente desde la fuente seleccionada y conserva su grafía exacta', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('Que a la letra dice:'),
      new Paragraph('{{transcripcion.certificado}}'),
      new Paragraph('Cliente: {{expediente.cliente}}'),
    ] }] }));
    expect(await projectTemplateFields(source)).toEqual(expect.arrayContaining(['transcripcion.certificado', 'expediente.cliente']));
    const context = await buildProjectDocumentContext(source, [{
      documento_id: 'doc-1',
      documento: { nombre_original: 'certificado.docx', storage_key: 'unused', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', datos_extraidos: { proyecto: { literal_transcriptions: { 'transcripcion.certificado': 'TEXTO Exacto; Núm. 01/ABC.\nSEGUNDA LÍNEA.' } } } },
    }], { 'expediente.cliente': 'Cliente maestro' });
    expect(context.values['transcripcion.certificado']).toBe('TEXTO Exacto; Núm. 01/ABC.\nSEGUNDA LÍNEA.');
    const rendered = await renderProjectTemplate(source, context.values);
    const xml = await (await JSZip.loadAsync(rendered.buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('TEXTO Exacto; Núm. 01/ABC.');
    expect(xml).toContain('SEGUNDA LÍNEA.');
  });

  it('no elige silenciosamente entre fuentes y registra contradicciones contra el maestro', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('{{transcripcion.antecedente}}'),
      new Paragraph('{{expediente.cliente}}'),
    ] }] }));
    const context = await buildProjectDocumentContext(source, [
      { documento_id: 'doc-1', documento: { nombre_original: 'a.docx', datos_extraidos: { proyecto: { template_values: { 'expediente.cliente': 'Cliente documental' } } } } },
      { documento_id: 'doc-2', documento: { nombre_original: 'b.docx', datos_extraidos: {} } },
    ], { 'expediente.cliente': 'Cliente maestro' });
    expect(context.values['transcripcion.antecedente']).toBe('[PENDIENTE: FUENTE LITERAL PARA TRANSCRIPCION ANTECEDENTE]');
    expect(context.values['expediente.cliente']).toBe('Cliente maestro');
    expect(context.observations).toEqual([{ field: 'expediente.cliente', master_value: 'Cliente maestro', document_value: 'Cliente documental', document_id: 'doc-1', kind: 'CONTRADICTION' }]);
  });

  it('describe elementos gráficos sólo desde metadatos sustentados y marca lo ilegible', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('{{elemento_grafico.sello}}'),
      new Paragraph('{{elemento_grafico.qr}}'),
    ] }] }));
    const context = await buildProjectDocumentContext(source, [{
      documento_id: 'doc-graphic',
      documento: { nombre_original: 'certificado.pdf', datos_extraidos: { proyecto: { graphic_elements: [
        { key: 'sello', description: 'SELLO CIRCULAR DE LA AUTORIDAD EMISORA' },
        { key: 'qr', type: 'CÓDIGO QR', legible: false },
      ] } } },
    }], {});
    expect(context.values['elemento_grafico.sello']).toBe('SELLO CIRCULAR DE LA AUTORIDAD EMISORA');
    expect(context.values['elemento_grafico.qr']).toBe('CÓDIGO QR ILEGIBLE');
  });

  it('registra antecedentes sin fecha o fuera de secuencia sin inventar cronología', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('{{expediente.folio}}')] }] }));
    const context = await buildProjectDocumentContext(source, [{
      documento_id: 'doc-antecedents',
      documento: { datos_extraidos: { proyecto: { antecedents: [
        { fecha: '2026-05-01', text: 'Segundo' },
        { fecha: '2025-01-01', text: 'Primero' },
      ] } } },
    }], { 'expediente.folio': 'EXP-0001-2026' });
    expect(context.observations).toContainEqual(expect.objectContaining({ kind: 'CONTEXT_CHRONOLOGY' }));
  });

  it('marca residuos declarados y datos variables antiguos que sobreviven sin fuente actual', async () => {
    const source = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('CLIENTE: Persona Anterior'),
      new Paragraph('RFC: ABCD800101AA1'),
      new Paragraph('Cliente vigente: {{expediente.cliente}}'),
    ] }] }));
    const generated = await renderProjectTemplate(source, { 'expediente.cliente': 'Persona Vigente' });
    const observations = await detectProjectTemplateResidues(source, generated.buffer, { 'expediente.cliente': 'Persona Vigente' }, ['Persona Anterior']);
    expect(observations.map((item) => item.value)).toEqual(expect.arrayContaining(['Persona Anterior', 'ABCD800101AA1']));
    expect(observations.every((item) => item.kind === 'POSSIBLE_TEMPLATE_RESIDUE')).toBe(true);
  });
});
