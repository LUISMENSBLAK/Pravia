import { describe, expect, it } from 'vitest';
import { consolidateExtractedFields } from './documentExtraction';

describe('consolidateExtractedFields', () => {
  it('conserva trazabilidad y marca confirmación humana', () => {
    const result = consolidateExtractedFields([{ campo: 'rfc', valor: 'ABC010203AA1', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-1' }]);
    expect(result.values.rfc).toBe('ABC010203AA1');
    expect(result.proposals.rfc.estado).toBe('PENDIENTE_CONFIRMACION');
    expect(result.proposals.rfc.documento_id).toBe('doc-1');
  });

  it('no elige silenciosamente entre fuentes contradictorias', () => {
    const result = consolidateExtractedFields([
      { campo: 'rfc', valor: 'ABC010203AA1', confianza: 'LECTURA_CLARA', fuente: 'Constancia Fiscal.pdf', documento_id: 'doc-1' },
      { campo: 'rfc', valor: 'XYZ010203BB2', confianza: 'LECTURA_CLARA', fuente: 'Ficha.docx', documento_id: 'doc-2' },
    ]);
    expect(result.values.rfc).toBeUndefined();
    expect(result.conflicts).toHaveLength(1);
    expect(result.proposals.rfc.estado).toBe('EN_CONFLICTO');
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
