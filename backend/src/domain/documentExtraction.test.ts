import { describe, expect, it } from 'vitest';
import { consolidateExtractedFields } from './documentExtraction';

describe('consolidateExtractedFields', () => {
  it('no convierte N/A ni pendientes documentales en datos; conserva nombres reales como SIN NOMBRE y S/N', () => {
    for (const value of ['N/A','NO APLICA','NO_APLICA','PENDIENTE DE INFORMACIÓN','DATO NO ENCONTRADO','SIN DATOS']) {
      expect(consolidateExtractedFields([{campo:'regimen_matrimonial',valor:value,confianza:'LECTURA_CLARA'}]).values).toEqual({});
    }
    expect(consolidateExtractedFields([{campo:'calle',valor:'SIN NOMBRE',confianza:'LECTURA_CLARA'},{campo:'numero_exterior',valor:'S/N',confianza:'LECTURA_CLARA'}]).values).toEqual({calle:'SIN NOMBRE',numero_exterior:'S/N'});
  });
  it('unifica aliases de contacto antes de detectar discrepancias, sin elegir el último', () => {
    const result = consolidateExtractedFields([
      { campo: 'correo', valor: 'uno@example.test', confianza: 'LECTURA_DUDOSA', documento_id: 'a' },
      { campo: 'correo_electronico', valor: 'otro@example.test', confianza: 'LECTURA_CLARA', documento_id: 'a' },
      { campo: 'telefono', valor: '3111234567', confianza: 'LECTURA_CLARA', documento_id: 'a' },
      { campo: 'celular', valor: '3111234568', confianza: 'LECTURA_CLARA', documento_id: 'b' },
    ]);
    expect(result.values).toEqual({});
    expect(result.conflicts.map(c => c.campo)).toEqual(['correo', 'telefono']);
  });
  it('acepta fechas documentales completas con espacios o mes escrito sin fabricar componentes', () => {
    for (const literal of ['09 04 2021', '09   04\t2021', '9/4/2021', '09.04.2021', '09-04-2021', '9 DE ABRIL DE 2021', '09 abril 2021']) {
      const result = consolidateExtractedFields([{ campo: 'fecha_expedicion_identificacion', valor: literal, confianza: 'LECTURA_CLARA', documento_id: 'scan' }]);
      expect(result.values.fecha_expedicion_identificacion).toBe('2021-04-09');
      expect(result.proposals.fecha_expedicion_identificacion.fragmento).toBe(literal);
    }
    for (const literal of ['04 2021', '09 04 21', '31 04 2021', '29 DE FEBRERO DE 2021', '09 0A 2021', '09/04-2021', '2021', 'abril de 2021']) {
      const result = consolidateExtractedFields([{ campo: 'fecha_expedicion_identificacion', valor: literal, confianza: 'LECTURA_CLARA' }]);
      expect(result.values.fecha_expedicion_identificacion).toBeUndefined();
      expect(result.proposals.fecha_expedicion_identificacion.estado).toBe('EN_CONFLICTO');
    }
  });
  it('reconcilia la etiqueta pasaporte mexicano sin ocultar diferencias de número', () => {
    const result = consolidateExtractedFields([
      { campo: 'tipo_identificacion', valor: 'PASAPORTE MEXICANO', confianza: 'LECTURA_CLARA', documento_id: 'form' },
      { campo: 'tipo_identificacion', valor: 'PASAPORTE', confianza: 'LECTURA_CLARA', documento_id: 'scan' },
      { campo: 'folio_identificacion', valor: 'TEST1234', confianza: 'LECTURA_CLARA', documento_id: 'form' },
      { campo: 'folio_identificacion', valor: 'TEST12345', confianza: 'LECTURA_DUDOSA', documento_id: 'scan' },
    ]);
    expect(result.values.tipo_identificacion).toBe('PASAPORTE');
    expect(result.proposals.tipo_identificacion.fragmento).toBe('PASAPORTE MEXICANO');
    expect(result.values.folio_identificacion).toBeUndefined();
    expect(result.conflicts.map(c => c.campo)).toEqual(['folio_identificacion']);
  });
  it('no rellena un identificador imposible aunque ambas lecturas digan clara', () => {
    const result = consolidateExtractedFields([{ campo: 'curp', valor: 'GARA900101HDRFRBC78', confianza: 'LECTURA_CLARA', documento_id: 'photo' }]);
    expect(result.values.curp).toBeUndefined();
    expect(result.proposals.curp).toMatchObject({ estado: 'EN_CONFLICTO', alternativas: [{ valor: 'GARA900101HDRFRBC78' }] });
  });
  it('reconcilia nombre completo sólo contra nombres y apellidos separados acreditados, sin partir nombres a ciegas', () => {
    const fields = [
      { campo: 'nombre', valor: 'ELISA', confianza: 'LECTURA_CLARA' as const, documento_id: 'id' },
      { campo: 'apellido_paterno', valor: 'DOCUMENTAL', confianza: 'LECTURA_CLARA' as const, documento_id: 'id' },
      { campo: 'apellido_materno', valor: 'SINTETICA', confianza: 'LECTURA_CLARA' as const, documento_id: 'id' },
      { campo: 'nombre', valor: 'ELISA DOCUMENTAL SINTETICA', confianza: 'LECTURA_CLARA' as const, documento_id: 'csf' },
    ];
    const result = consolidateExtractedFields(fields);
    expect(result.values.nombre).toBe('ELISA'); expect(result.conflicts).toEqual([]);
    expect(consolidateExtractedFields(fields.filter(f => f.campo === 'nombre')).conflicts).toHaveLength(1);
    expect(consolidateExtractedFields([...fields, { campo: 'apellido_materno', valor: 'OTRA', confianza: 'LECTURA_CLARA', documento_id: 'other-person' }]).values.nombre).toBeUndefined();
  });
  it('adapta etiquetas documentales a los selects y fechas sin fabricar datos ni perder el literal', () => {
    const result = consolidateExtractedFields([
      { campo: 'estado_civil', valor: 'CASADA', confianza: 'LECTURA_CLARA' },
      { campo: 'regimen_matrimonial', valor: 'Separación de bienes', confianza: 'LECTURA_CLARA' },
      { campo: 'fecha_nacimiento', valor: '01/01/1990', confianza: 'LECTURA_CLARA' },
      { campo: 'sexo', valor: 'M', confianza: 'LECTURA_DUDOSA' },
      { campo: 'fecha_expedicion_identificacion', valor: '02/2024', confianza: 'LECTURA_DUDOSA' },
    ]);
    expect(result.values).toMatchObject({ estado_civil: 'CASADO', regimen_matrimonial: 'SEPARACION_DE_BIENES', fecha_nacimiento: '1990-01-01', sexo: 'M' });
    expect(result.values.fecha_expedicion_identificacion).toBeUndefined();
    expect(result.proposals.fecha_expedicion_identificacion.estado).toBe('EN_CONFLICTO');
    expect(result.proposals.regimen_matrimonial.fragmento).toBe('Separación de bienes');
  });
  it('normaliza sólo espacios/caso del identificador y conserva el literal, sin arreglar caracteres distintos', () => {
    const result = consolidateExtractedFields([
      { campo: 'curp', valor: 'GAR A900101HDFRBC78', confianza: 'LECTURA_DUDOSA', documento_id: 'photo' },
      { campo: 'curp', valor: 'GARA900101HDFRBC78', confianza: 'LECTURA_CLARA', documento_id: 'photo' },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.values.curp).toBe('GARA900101HDFRBC78');
    expect(result.proposals.curp.fragmento).toBe('GAR A900101HDFRBC78');
    const different = consolidateExtractedFields([
      { campo: 'curp', valor: 'GARA900101HDFRBC78', confianza: 'LECTURA_DUDOSA', documento_id: 'photo' },
      { campo: 'curp', valor: 'GARA900101HDFRBC73', confianza: 'LECTURA_CLARA', documento_id: 'photo' },
    ]);
    expect(different.values.curp).toBeUndefined(); expect(different.conflicts).toHaveLength(1);
  });
  it('conserva trazabilidad y marca confirmación humana', () => {
    const result = consolidateExtractedFields([{ campo: 'rfc', valor: 'ABC010203AA1', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-1', pagina: 2, fragmento: 'RFC: ABC010203AA1' }]);
    expect(result.values.rfc).toBe('ABC010203AA1');
    expect(result.proposals.rfc.estado).toBe('PENDIENTE_CONFIRMACION');
    expect(result.proposals.rfc.documento_id).toBe('doc-1');
    expect(result.proposals.rfc).toMatchObject({ pagina: 2, fragmento: 'RFC: ABC010203AA1' });
  });

  it('no elige silenciosamente entre fuentes contradictorias', () => {
    const result = consolidateExtractedFields([
      { campo: 'rfc', valor: 'ABC010203AA1', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-1', pagina: 1, fragmento: 'RFC A' },
      { campo: 'rfc', valor: 'XYZ010203BB2', confianza: 'LECTURA_CLARA', fuente: 'Ficha.docx', documento_id: 'doc-2', pagina: 3, fragmento: 'RFC B' },
    ]);
    expect(result.values.rfc).toBeUndefined();
    expect(result.conflicts).toHaveLength(1);
    expect(result.proposals.rfc.estado).toBe('EN_CONFLICTO');
    expect(result.proposals.rfc.alternativas).toMatchObject([{ pagina: 1, fragmento: 'RFC A' }, { pagina: 3, fragmento: 'RFC B' }]);
    expect(result.escalationDocumentIds).toEqual(['doc-1', 'doc-2']);
  });

  it('acepta el mismo valor repetido y respeta la fuente prioritaria', () => {
    const result = consolidateExtractedFields([
      { campo: 'rfc', valor: 'abc010203aa1', confianza: 'LECTURA_CLARA', fuente: 'Ficha.docx', documento_id: 'doc-2' },
      { campo: 'rfc', valor: 'ABC010203AA1', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-1' },
    ]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.proposals.rfc.documento_id).toBe('doc-1');
  });

  it('solicita escalamiento ante lectura dudosa', () => {
    const result = consolidateExtractedFields([{ campo: 'curp', valor: 'GODE561231HDFRRN09', confianza: 'LECTURA_DUDOSA', fuente: 'CURP.pdf', documento_id: 'doc-3' }]);
    expect(result.needsEscalation).toBe(true);
    expect(result.escalationDocumentIds).toEqual(['doc-3']);
  });

  it('combina campos sustentados por documentos distintos sin inventar ausentes', () => {
    const result = consolidateExtractedFields([
      { campo: 'nombre', valor: 'MARÍA LÓPEZ', confianza: 'LECTURA_CLARA', fuente: 'INE.pdf', documento_id: 'doc-ine' },
      { campo: 'rfc', valor: 'LOPM900101AA1', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-csf' },
      { campo: 'dom_fiscal_codigo_postal', valor: '63000', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-csf' },
    ]);
    expect(result.values).toMatchObject({ nombre: 'MARÍA LÓPEZ', rfc: 'LOPM900101AA1', dom_fiscal_codigo_postal: '63000' });
    expect(result.values).not.toHaveProperty('estado_civil');
    expect(result.values).not.toHaveProperty('pep_estado');
    expect(result.proposals.nombre.documento_id).toBe('doc-ine');
    expect(result.proposals.rfc.documento_id).toBe('doc-csf');
  });

  it('descarta campos vacíos de documentos ilegibles', () => {
    const result = consolidateExtractedFields([
      { campo: 'nombre', valor: '', confianza: 'LECTURA_DEFICIENTE', fuente: 'scan-ilegible.jpg', documento_id: 'doc-bad' },
      { campo: '', valor: 'valor sin campo', confianza: 'LECTURA_DEFICIENTE', fuente: 'scan-ilegible.jpg', documento_id: 'doc-bad' },
    ]);
    expect(result.values).toEqual({});
    expect(result.proposals).toEqual({});
    expect(result.conflicts).toEqual([]);
  });
});
