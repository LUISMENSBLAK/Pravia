import { Document, Packer, Paragraph } from 'docx';
import { describe, expect, it } from 'vitest';
import { extractDocxText } from './docxText';

describe('extractDocxText', () => {
  it('extrae texto real de un DOCX con el xmldom fijado por el proyecto', async () => {
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('Formato maestro CFG-002'),
      new Paragraph('Segunda línea con acentos'),
    ] }] }));

    await expect(extractDocxText(buffer)).resolves.toBe('Formato maestro CFG-002\nSegunda línea con acentos');
  });
});
