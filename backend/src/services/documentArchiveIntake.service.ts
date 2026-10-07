import { createHash } from 'crypto';
import path from 'path';
import JSZip from 'jszip';
import { createExtractorFromData } from 'node-unrar-js';
import { canonicalUploadedDocumentMime } from './documentUploadValidation';

export type IntakeFile = { relativePath: string; name: string; buffer: Buffer; mimeType: string; checksum: string };
export class DocumentArchiveIntakeError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const MAX_FILES = 300;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;

export function safeDocumentPath(input: string) {
  const normalized = input.normalize('NFC').replace(/\\/g, '/');
  if (!normalized || normalized.length > 1200 || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) {
    throw new DocumentArchiveIntakeError('DOCUMENT_PATH_INVALID', 'El archivo contiene una ruta absoluta o inválida.');
  }
  const segments = normalized.split('/');
  if (segments.length > 16 || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 180)) {
    throw new DocumentArchiveIntakeError('DOCUMENT_PATH_TRAVERSAL', 'El archivo contiene una ruta no permitida.');
  }
  return segments.join('/');
}

function checkPreflight(entries: Array<{ path: string; size: number; encrypted?: boolean }>) {
  if (!entries.length) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_EMPTY', 'El paquete no contiene documentos.');
  if (entries.length > MAX_FILES) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_TOO_MANY_FILES', 'El paquete supera 300 documentos.');
  let total = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    const name = safeDocumentPath(entry.path);
    if (names.has(name)) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_DUPLICATE_PATH', 'El paquete repite una ruta documental.');
    names.add(name);
    if (entry.encrypted) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_PASSWORD_REQUIRED', 'El paquete contiene archivos protegidos con contraseña y requiere revisión manual.');
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_FILE_TOO_LARGE', 'Un documento supera el límite de 25 MB.');
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_EXPANSION_LIMIT', 'El contenido descomprimido supera el límite de 200 MB.');
  }
}

function finalize(entries: Array<{ path: string; buffer: Buffer }>): IntakeFile[] {
  checkPreflight(entries.map((entry) => ({ path: entry.path, size: entry.buffer.length })));
  return entries.map((entry) => {
    const relativePath = safeDocumentPath(entry.path);
    const name = path.posix.basename(relativePath);
    let mimeType: string;
    try { mimeType = canonicalUploadedDocumentMime({ buffer: entry.buffer, originalname: name }); }
    catch (error) { throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_UNSUPPORTED_FILE', `${relativePath}: ${error instanceof Error ? error.message : 'Formato no permitido.'}`); }
    return { relativePath, name, buffer: entry.buffer, mimeType, checksum: createHash('sha256').update(entry.buffer).digest('hex') };
  });
}

export async function extractDocumentArchive(file: { originalname: string; buffer: Buffer }): Promise<IntakeFile[]> {
  if (!file.buffer.length || file.buffer.length > MAX_ARCHIVE_BYTES) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_SIZE_INVALID', 'El paquete debe tener contenido y no superar 75 MB.');
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.zip') {
    if (file.buffer.subarray(0, 2).toString('ascii') !== 'PK') throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_CORRUPT', 'El ZIP no tiene un encabezado válido.');
    try {
      const zip = await JSZip.loadAsync(file.buffer);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.includes('__MACOSX/') && !entry.name.endsWith('.DS_Store'));
      checkPreflight(entries.map((entry) => ({ path: (entry as any).unsafeOriginalName || entry.name, size: Number((entry as any)._data?.uncompressedSize ?? 0) })));
      const files: Array<{ path: string; buffer: Buffer }> = [];
      for (const entry of entries) {
        const buffer = await entry.async('nodebuffer');
        files.push({ path: (entry as any).unsafeOriginalName || entry.name, buffer });
        if (files.reduce((sum, current) => sum + current.buffer.length, 0) > MAX_TOTAL_BYTES) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_EXPANSION_LIMIT', 'El contenido descomprimido supera el límite de 200 MB.');
      }
      return finalize(files);
    } catch (error) {
      if (error instanceof DocumentArchiveIntakeError) throw error;
      throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_CORRUPT', 'El ZIP está corrupto o protegido; no se importó ningún documento.');
    }
  }
  if (extension === '.rar') {
    if (file.buffer.subarray(0, 7).toString('hex') !== '526172211a0700' && file.buffer.subarray(0, 8).toString('hex') !== '526172211a070100') {
      throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_CORRUPT', 'El RAR no tiene un encabezado válido.');
    }
    try {
      const extractor = await createExtractorFromData({ data: Uint8Array.from(file.buffer).buffer });
      const listed = extractor.getFileList();
      if (listed.arcHeader.flags.headerEncrypted) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_PASSWORD_REQUIRED', 'El RAR requiere contraseña; conserva el original para revisión manual.');
      const entries = [...listed.fileHeaders].filter((entry) => !entry.flags.directory);
      checkPreflight(entries.map((entry) => ({ path: entry.name, size: entry.unpSize, encrypted: entry.flags.encrypted })));
      const extracted = [...extractor.extract({ files: entries.map((entry) => entry.name) }).files];
      return finalize(extracted.filter((entry) => !entry.fileHeader.flags.directory).map((entry) => {
        if (!entry.extraction) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_CORRUPT', 'Un documento del RAR no pudo extraerse.');
        return { path: entry.fileHeader.name, buffer: Buffer.from(entry.extraction) };
      }));
    } catch (error) {
      if (error instanceof DocumentArchiveIntakeError) throw error;
      const reason = String((error as { reason?: string })?.reason || '');
      if (reason.includes('PASSWORD')) throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_PASSWORD_REQUIRED', 'El RAR requiere contraseña; conserva el original para revisión manual.');
      throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_CORRUPT', 'El RAR está corrupto o no puede extraerse; no se importó ningún documento.');
    }
  }
  throw new DocumentArchiveIntakeError('DOCUMENT_ARCHIVE_FORMAT_INVALID', 'Selecciona un archivo ZIP o RAR real.');
}

export function intakeLooseFiles(files: Array<{ originalname: string; buffer: Buffer }>, relativePaths: string[]): IntakeFile[] {
  if (files.length !== relativePaths.length) throw new DocumentArchiveIntakeError('DOCUMENT_BATCH_PATH_MISMATCH', 'Cada archivo debe tener una ruta relativa.');
  return finalize(files.map((file, index) => ({ path: relativePaths[index], buffer: file.buffer })));
}
