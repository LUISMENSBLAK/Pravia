import path from 'path';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

const startsWith = (buffer: Buffer, bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);

function detectedMime(buffer: Buffer, extension: string) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0]) && extension === '.doc') return 'application/msword';
  if (startsWith(buffer, [0x50, 0x4b]) && extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (startsWith(buffer, [0x50, 0x4b]) && extension === '.zip') return 'application/zip';
  if (extension === '.xml') {
    const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (prefix.startsWith('<')) return 'application/xml';
  }
  return null;
}

/** Validate actual bytes instead of trusting the browser-provided MIME. */
export function canonicalUploadedDocumentMime(file: { buffer: Buffer; originalname: string; mimetype?: string }) {
  if (!file.buffer?.length) throw new Error('El archivo está vacío o no pudo leerse.');
  const extension = path.extname(file.originalname || '').toLowerCase();
  const expected = MIME_BY_EXTENSION[extension];
  if (!expected) throw new Error('Tipo de archivo no permitido. Usa PDF, JPG/JPEG, PNG, WEBP, BMP, DOC, DOCX, XML o ZIP.');
  const detected = detectedMime(file.buffer, extension);
  if (!detected) throw new Error(`El archivo ${file.originalname || ''} está corrupto o su contenido no corresponde con la extensión ${extension}.`);
  if (detected !== expected) throw new Error(`El contenido de ${file.originalname || ''} no corresponde con su extensión ${extension}.`);
  return detected;
}
