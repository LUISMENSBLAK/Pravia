import { describe, expect, it } from 'vitest';
import { ASSISTANT_ATTACHMENT_CONTEXT_MAX_CHARS, serializeAssistantDocumentContext } from './assistantDocumentContext';

describe('Contexto documental del chat con múltiples fuentes', () => {
  it('conserva JSON válido y campos del último adjunto aunque los primeros sean extensos', () => {
    const contexts = Array.from({ length: 6 }, (_, index) => ({
      archivo: `documento-${index + 1}.pdf`, resumen: 'Resumen extenso. '.repeat(300),
      campos: Array.from({ length: 26 }, (_, field) => ({ campo: `campo_${field}`, valor: field === 0 ? `REFERENCIA-QA-${index}` : 'Dato sintético extenso '.repeat(15), confianza: 'LECTURA_CLARA', pagina: 1, fragmento: 'Evidencia '.repeat(60) })),
      contenido_documental: [{ documento_id: `doc-${index}`, texto: 'Contenido documental '.repeat(400) }],
      domicilios_detectados: [{ tipo_sugerido: 'FISCAL', calle: `CALLE QA ${index}`, codigo_postal: '63000' }],
    }));
    const serialized = serializeAssistantDocumentContext(contexts);
    expect(serialized.length).toBeLessThanOrEqual(ASSISTANT_ATTACHMENT_CONTEXT_MAX_CHARS);
    const result = JSON.parse(serialized);
    expect(result.adjuntos).toHaveLength(6);
    for (const [index, item] of result.adjuntos.entries()) {
      expect(item.archivo).toBe(`documento-${index + 1}.pdf`);
      expect(item.campos).toHaveLength(26);
      expect(item.campos[0].valor).toBe(`REFERENCIA-QA-${index}`);
      expect(item.domicilios_detectados[0].codigo_postal).toBe('63000');
      expect(item.contexto_recortado).toBe(true);
    }
  });
  it('no recorta una fuente pequeña ni confunde ausencia de campo en un archivo con ausencia global', () => {
    const source = { archivo: 'foto.jpg', campos: [{ campo: 'curp', valor: 'LECTURA PARCIAL', confianza: 'LECTURA_DUDOSA' }] };
    const result = JSON.parse(serializeAssistantDocumentContext([source]));
    expect(result.adjuntos).toEqual([source]);
    expect(result.aviso).toContain('sólo a ese archivo');
  });
});
