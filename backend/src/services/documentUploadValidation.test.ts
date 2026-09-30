import { describe, expect, it } from 'vitest';
import { canonicalUploadedDocumentMime } from './documentUploadValidation';

describe('validación canónica de documentos CMP-001 / PRD-001', () => {
  it.each([
    ['documento.pdf', Buffer.from('%PDF-1.7\n'), 'application/pdf'],
    ['imagen.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['imagen.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['captura.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'image/webp'],
    ['plantilla.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['factura.xml', Buffer.from('<?xml version="1.0"?><cfdi:Comprobante/>'), 'application/xml'],
    ['expediente.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/zip'],
  ])('acepta %s por sus bytes reales aunque el navegador omita el MIME', (originalname, buffer, expected) => {
    expect(canonicalUploadedDocumentMime({ originalname, buffer, mimetype: '' })).toBe(expected);
  });

  it('rechaza un archivo vacío con un mensaje útil', () => {
    expect(() => canonicalUploadedDocumentMime({ originalname: 'vacio.pdf', buffer: Buffer.alloc(0) })).toThrow(/vacío/);
  });

  it('rechaza contenido que no corresponde con la extensión', () => {
    expect(() => canonicalUploadedDocumentMime({ originalname: 'engaño.pdf', buffer: Buffer.from([0xff, 0xd8, 0xff]) })).toThrow(/no corresponde/);
  });
});
