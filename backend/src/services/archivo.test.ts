import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';
import { renderArchivoDocx } from './archivo.service';
import { extractDocxText } from './docxText';

const master = (text: string) => Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));

describe('Archivo: Word canónico CFG-002', () => {
  it('rellena sólo variables conocidas y conserva el Word editable', async () => {
    const source = await master('Escritura {{archivo.numero_escritura}} · Folios {{archivo.folio_inicio}} al {{archivo.folio_fin}} · {{archivo.numero_folios}} folios');
    const result = renderArchivoDocx(source, { 'archivo.numero_escritura': '23500', 'archivo.folio_inicio': '39511', 'archivo.folio_fin': '39520', 'archivo.numero_folios': '10' });
    expect(await extractDocxText(result)).toContain('Escritura 23500 · Folios 39511 al 39520 · 10 folios');
  });

  it('no inventa un dato faltante solicitado por el formato', async () => {
    const source = await master('Libro {{archivo.libro_tomo}}');
    expect(() => renderArchivoDocx(source, { 'archivo.libro_tomo': null })).toThrow();
  });

  it('no convierte un placeholder desconocido en texto vacío', async () => {
    const source = await master('Cliente {{cliente.nombre_fiscal}}');
    expect(() => renderArchivoDocx(source, { 'archivo.numero_escritura': '23500' })).toThrow();
  });
});
