import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DocumentArchiveIntakeError, extractDocumentArchive, intakeLooseFiles, safeDocumentPath } from './documentArchiveIntake.service';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

describe('document batch intake', () => {
  it('preserves nested ZIP paths and validates document bytes', async () => {
    const zip = new JSZip();
    zip.file('Personas/Identidad/prueba.pdf', pdf);
    const files = await extractDocumentArchive({ originalname: 'expediente.zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual(expect.objectContaining({ relativePath: 'Personas/Identidad/prueba.pdf', mimeType: 'application/pdf' }));
    expect(files[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects path traversal before importing any ZIP file', async () => {
    const zip = new JSZip();
    zip.file('../outside.pdf', pdf);
    await expect(extractDocumentArchive({ originalname: 'expediente.zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }))
      .rejects.toMatchObject({ code: 'DOCUMENT_PATH_TRAVERSAL' });
  });

  it('rejects a disguised document', () => {
    expect(() => intakeLooseFiles([{ originalname: 'falso.pdf', buffer: Buffer.from('not a PDF') }], ['Carpeta/falso.pdf']))
      .toThrow(DocumentArchiveIntakeError);
  });

  it('rejects duplicate logical paths', () => {
    expect(() => intakeLooseFiles([
      { originalname: 'a.pdf', buffer: pdf },
      { originalname: 'a.pdf', buffer: pdf },
    ], ['Carpeta/a.pdf', 'Carpeta/a.pdf'])).toThrowError(/repite una ruta/);
  });

  it('rejects absolute, nested traversal and Windows drive paths', () => {
    for (const value of ['/tmp/a.pdf', '../a.pdf', 'Carpeta/../../a.pdf', 'C:\\Users\\a.pdf']) {
      expect(() => safeDocumentPath(value)).toThrow(DocumentArchiveIntakeError);
    }
  });

  it('rejects a fake RAR rather than returning false success', async () => {
    await expect(extractDocumentArchive({ originalname: 'fake.rar', buffer: Buffer.from('not a rar') }))
      .rejects.toMatchObject({ code: 'DOCUMENT_ARCHIVE_CORRUPT' });
  });
});
