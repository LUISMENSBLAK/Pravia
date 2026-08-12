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
});
