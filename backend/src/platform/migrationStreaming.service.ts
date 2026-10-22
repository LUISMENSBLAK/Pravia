import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import yauzl from 'yauzl';
import { canonicalUploadedDocumentMime } from '../services/documentUploadValidation';
import { safeDocumentPath } from '../services/documentArchiveIntake.service';
import type { StorageProvider } from '../storage/storage.types';
import { PlatformDomainError } from './platform.errors';

export type StoredPart = { part_number: number; size_bytes: number; checksum_sha256: string; provider_etag: string | null };
export type InspectedEntry = {
  sourcePath: string; size: number; sha256: string; mimeType: string;
  headers?: string[]; records?: number;
};

const LOCAL_SIGNATURE_SCANNER_VERSION = 'PRAVIA_LOCAL_SIGNATURES_V1';
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const EXECUTABLE_MAGICS = [
  Buffer.from([0x4d, 0x5a]),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
];

const containsEicar = (value: string) => value.includes(EICAR_SIGNATURE);

export function scanMigrationBuffer(buffer: Buffer, sourcePath: string) {
  if (containsEicar(buffer.toString('latin1'))) {
    throw new PlatformDomainError('MIGRATION_MALWARE_DETECTED', `La entrada ${sourcePath} coincide con una firma de archivo malicioso de prueba.`, 422);
  }
  if (EXECUTABLE_MAGICS.some((magic) => buffer.subarray(0, magic.length).equals(magic))) {
    throw new PlatformDomainError('MIGRATION_EXECUTABLE_BLOCKED', `La entrada ${sourcePath} contiene un binario ejecutable.`, 422);
  }
}

/**
 * Streaming baseline scanner for migration sources. It blocks the standard
 * EICAR test signature and executable payloads disguised as an accepted
 * migration container. Archive entry path, MIME and expansion validation is
 * performed separately by the ZIP/RAR inspectors.
 */
export async function scanMigrationSourceFile(filename: string) {
  let prefix = Buffer.alloc(0);
  let carry = '';
  let bytes = 0n;
  for await (const chunk of createReadStream(filename)) {
    const buffer = chunk as Buffer;
    bytes += BigInt(buffer.byteLength);
    if (prefix.length < 16) prefix = Buffer.concat([prefix, buffer.subarray(0, 16 - prefix.length)]);
    const text = carry + buffer.toString('latin1');
    if (containsEicar(text)) {
      throw new PlatformDomainError('MIGRATION_MALWARE_DETECTED', 'La fuente coincide con una firma de archivo malicioso de prueba.', 422);
    }
    carry = text.slice(-(EICAR_SIGNATURE.length - 1));
  }
  if (EXECUTABLE_MAGICS.some((magic) => prefix.subarray(0, magic.length).equals(magic))) {
    throw new PlatformDomainError('MIGRATION_EXECUTABLE_BLOCKED', 'No se admiten binarios ejecutables como fuente de migración.', 422);
  }
  return { scanner: LOCAL_SIGNATURE_SCANNER_VERSION, bytes, status: 'PASS' as const };
}

export async function* verifiedPartBuffers(
  provider: StorageProvider,
  parts: StoredPart[],
  keyForPart: (part: StoredPart) => string,
): AsyncGenerator<Buffer> {
  for (const part of parts) {
    const bytes = await provider.download(part.provider_etag || keyForPart(part));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== part.size_bytes || checksum !== part.checksum_sha256) {
      throw new PlatformDomainError('MIGRATION_UPLOAD_PART_CORRUPT', `La parte ${part.part_number} falló su verificación.`, 422);
    }
    yield bytes;
  }
}

export async function verifyMultipartSource(
  provider: StorageProvider,
  parts: StoredPart[],
  keyForPart: (part: StoredPart) => string,
  expectedBytes: bigint,
  expectedChecksum?: string,
) {
  const digest = createHash('sha256');
  let bytes = 0n;
  for await (const part of verifiedPartBuffers(provider, parts, keyForPart)) {
    bytes += BigInt(part.byteLength);
    digest.update(part);
  }
  const actualChecksum = digest.digest('hex');
  if (bytes !== expectedBytes || (expectedChecksum && actualChecksum !== expectedChecksum.toLowerCase())) {
    throw new PlatformDomainError('MIGRATION_UPLOAD_CHECKSUM_MISMATCH', 'El archivo no coincide con tamaño y SHA-256 declarados.', 422);
  }
  return { bytes, sha256: actualChecksum };
}

/** Bounded-memory worker spool. Temporary file is deleted even when inspection fails. */
export async function withVerifiedSourceFile<T>(input: {
  provider: StorageProvider;
  parts: StoredPart[];
  keyForPart: (part: StoredPart) => string;
  expectedBytes: bigint;
  expectedChecksum: string;
  inspect: (filename: string) => Promise<T>;
}): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-migration-'));
  const filename = path.join(directory, 'source.bin');
  try {
    const handle = await open(filename, 'wx', 0o600);
    const digest = createHash('sha256');
    let bytes = 0n;
    try {
      for await (const part of verifiedPartBuffers(input.provider, input.parts, input.keyForPart)) {
        await handle.writeFile(part);
        digest.update(part);
        bytes += BigInt(part.byteLength);
      }
    } finally {
      await handle.close();
    }
    if (bytes !== input.expectedBytes || digest.digest('hex') !== input.expectedChecksum) {
      throw new PlatformDomainError('MIGRATION_SOURCE_CORRUPT', 'La fuente cambió después de completar la carga.', 422);
    }
    return await input.inspect(filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Header/count parser with quoted multiline CSV support and constant row memory. */
export async function inspectCsvFile(filename: string, sourcePath: string, sha256: string, size: number): Promise<InspectedEntry> {
  const decoder = new StringDecoder('utf8');
  let headers: string[] | null = null;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let pendingQuote = false;
  let records = 0;
  let rowHasValue = false;
  const finishRow = () => {
    row.push(field.replace(/\r$/, ''));
    if (rowHasValue || row.some((value) => value.trim())) {
      if (!headers) headers = row.map((value) => value.trim());
      else records += 1;
    }
    row = [];
    field = '';
    rowHasValue = false;
  };
  const feed = (text: string) => {
    for (const char of text) {
      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') { field += '"'; continue; }
        quoted = false;
      }
      if (quoted) {
        if (char === '"') pendingQuote = true;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n') finishRow();
      else { field += char; if (char.trim()) rowHasValue = true; }
    }
  };
  for await (const chunk of createReadStream(filename)) feed(decoder.write(chunk as Buffer));
  feed(decoder.end());
  if (pendingQuote) { pendingQuote = false; quoted = false; }
  if (quoted) throw new PlatformDomainError('MIGRATION_CSV_CORRUPT', 'El CSV termina dentro de un campo entrecomillado.', 422);
  if (field || row.length || rowHasValue) finishRow();
  const finalHeaders = headers as string[] | null;
  if (!finalHeaders?.length) throw new PlatformDomainError('MIGRATION_TABULAR_EMPTY', 'El CSV no contiene encabezados.', 422);
  finalHeaders[0] = finalHeaders[0].replace(/^\uFEFF/, '');
  return { sourcePath, size, sha256, mimeType: 'text/csv', headers: finalHeaders, records };
}

/** Iterates decoded CSV records while retaining only the current transport chunk. */
export async function* streamCsvRecords(filename: string): AsyncGenerator<string[]> {
  const decoder = new StringDecoder('utf8');
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let pendingQuote = false;
  let firstRow = true;
  const feed = (text: string) => {
    const completed: string[][] = [];
    for (const char of text) {
      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') { field += '"'; continue; }
        quoted = false;
      }
      if (quoted) {
        if (char === '"') pendingQuote = true;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n') { row.push(field.replace(/\r$/, '')); completed.push(row); row = []; field = ''; }
      else field += char;
    }
    return completed;
  };
  for await (const chunk of createReadStream(filename)) {
    for (const candidate of feed(decoder.write(chunk as Buffer))) {
      if (firstRow) { candidate[0] = (candidate[0] || '').replace(/^\uFEFF/, ''); firstRow = false; }
      if (candidate.some((value) => value.trim())) yield candidate;
    }
  }
  for (const candidate of feed(decoder.end())) {
    if (firstRow) { candidate[0] = (candidate[0] || '').replace(/^\uFEFF/, ''); firstRow = false; }
    if (candidate.some((value) => value.trim())) yield candidate;
  }
  if (pendingQuote) { pendingQuote = false; quoted = false; }
  if (quoted) throw new PlatformDomainError('MIGRATION_CSV_CORRUPT', 'El CSV termina dentro de un campo entrecomillado.', 422);
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (firstRow) row[0] = (row[0] || '').replace(/^\uFEFF/, '');
    if (row.some((value) => value.trim())) yield row;
  }
}

const openZip = (filename: string) => new Promise<yauzl.ZipFile>((resolve, reject) => {
  yauzl.open(filename, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) reject(normalizeZipError(error));
    else resolve(zip);
  });
});

function normalizeZipError(error: unknown): PlatformDomainError {
  if (error instanceof PlatformDomainError) return error;
  const detail = error instanceof Error ? error.message : '';
  if (/invalid relative path|absolute path|path traversal/i.test(detail)) {
    return new PlatformDomainError('MIGRATION_ARCHIVE_PATH_TRAVERSAL', 'El ZIP contiene una ruta no permitida.', 422);
  }
  return new PlatformDomainError('MIGRATION_ARCHIVE_CORRUPT', 'El ZIP no puede abrirse de forma segura.', 422);
}

export async function inspectZipFile(filename: string, declaredBytes: bigint): Promise<InspectedEntry[]> {
  const zip = await openZip(filename);
  const entries: InspectedEntry[] = [];
  const seen = new Set<string>();
  const maxExpanded = declaredBytes * 20n;
  let expanded = 0n;
  try {
    return await new Promise<InspectedEntry[]>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(normalizeZipError(error));
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (!entries.length) reject(new PlatformDomainError('MIGRATION_ARCHIVE_EMPTY', 'El ZIP no contiene archivos.', 422));
        else resolve(entries);
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
          if (entries.length >= 10_000) throw new PlatformDomainError('MIGRATION_ARCHIVE_TOO_MANY_FILES', 'El ZIP excede el límite de entradas.', 422);
          const sourcePath = safeDocumentPath(entry.fileName);
          if (seen.has(sourcePath)) throw new PlatformDomainError('MIGRATION_ARCHIVE_DUPLICATE_PATH', 'El ZIP repite una ruta.', 422);
          seen.add(sourcePath);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode === 0o120000) throw new PlatformDomainError('MIGRATION_ARCHIVE_SYMLINK', 'El ZIP contiene un enlace simbólico.', 422);
          if (entry.isEncrypted()) throw new PlatformDomainError('MIGRATION_ARCHIVE_ENCRYPTED', 'El ZIP está cifrado.', 422);
          if (/\.(zip|rar|7z|tar|gz)$/i.test(sourcePath)) throw new PlatformDomainError('MIGRATION_ARCHIVE_NESTED', 'No se admiten archivos comprimidos anidados.', 422);
          expanded += BigInt(entry.uncompressedSize);
          if (expanded > maxExpanded || expanded > 1_099_511_627_776n) {
            throw new PlatformDomainError('MIGRATION_ARCHIVE_EXPANSION_LIMIT', 'El ZIP supera el límite de expansión segura.', 422);
          }
          const stream = await new Promise<NodeJS.ReadableStream>((streamResolve, streamReject) => {
            zip.openReadStream(entry, (error, opened) => error || !opened ? streamReject(error || new Error('ZIP_STREAM_MISSING')) : streamResolve(opened));
          });
          const digest = createHash('sha256');
          let size = 0;
          let prefix = Buffer.alloc(0);
          let signatureCarry = '';
          for await (const chunk of stream) {
            const bytes = chunk as Buffer;
            digest.update(bytes);
            size += bytes.byteLength;
            if (prefix.length < 512) prefix = Buffer.concat([prefix, bytes.subarray(0, 512 - prefix.length)]);
            const signatureText = signatureCarry + bytes.toString('latin1');
            if (containsEicar(signatureText)) {
              throw new PlatformDomainError('MIGRATION_MALWARE_DETECTED', `La entrada ${sourcePath} coincide con una firma de archivo malicioso de prueba.`, 422);
            }
            signatureCarry = signatureText.slice(-(EICAR_SIGNATURE.length - 1));
            if (size > entry.uncompressedSize) throw new PlatformDomainError('MIGRATION_ARCHIVE_ENTRY_SIZE', 'Una entrada excedió el tamaño declarado.', 422);
          }
          if (size !== entry.uncompressedSize) throw new PlatformDomainError('MIGRATION_ARCHIVE_ENTRY_SIZE', 'Una entrada tiene un tamaño inconsistente.', 422);
          if (EXECUTABLE_MAGICS.some((magic) => prefix.subarray(0, magic.length).equals(magic))) {
            throw new PlatformDomainError('MIGRATION_EXECUTABLE_BLOCKED', `La entrada ${sourcePath} contiene un binario ejecutable.`, 422);
          }
          let mimeType: string;
          if (sourcePath === 'pravia-migration.json') {
            mimeType = 'application/json';
          } else {
            try { mimeType = canonicalUploadedDocumentMime({ buffer: prefix, originalname: path.posix.basename(sourcePath) }); }
            catch { throw new PlatformDomainError('MIGRATION_MIME_MISMATCH', `El formato de ${sourcePath} no corresponde a su extensión.`, 422); }
          }
          entries.push({ sourcePath, size, sha256: digest.digest('hex'), mimeType });
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function findZipEntry(filename: string, requestedPath: string) {
  const safeRequested = safeDocumentPath(requestedPath);
  const zip = await openZip(filename);
  return new Promise<{ zip: yauzl.ZipFile; entry: yauzl.Entry }>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(normalizeZipError(error));
    };
    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(new PlatformDomainError('MIGRATION_ARCHIVE_ENTRY_MISSING', `El ZIP no contiene ${safeRequested}.`, 422));
    });
    zip.on('entry', (entry: yauzl.Entry) => {
      try {
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        const sourcePath = safeDocumentPath(entry.fileName);
        if (sourcePath === safeRequested) {
          settled = true;
          resolve({ zip, entry });
          return;
        }
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}

/** Reads only one bounded metadata entry; document bytes stay streaming. */
export async function readZipEntryBuffer(filename: string, requestedPath: string, maxBytes = 1024 * 1024) {
  const { zip, entry } = await findZipEntry(filename, requestedPath);
  try {
    if (entry.uncompressedSize > maxBytes) {
      throw new PlatformDomainError('MIGRATION_PACKAGE_MANIFEST_TOO_LARGE', 'El manifiesto de migración excede el límite permitido.', 422);
    }
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      zip.openReadStream(entry, (error, opened) => error || !opened ? reject(error || new Error('ZIP_STREAM_MISSING')) : resolve(opened));
    });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      size += bytes.byteLength;
      if (size > maxBytes) throw new PlatformDomainError('MIGRATION_PACKAGE_MANIFEST_TOO_LARGE', 'El manifiesto de migración excede el límite permitido.', 422);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    zip.close();
  }
}

/** Extracts one verified entry to a private temporary file and removes it afterwards. */
export async function withZipEntryFile<T>(input: {
  archiveFilename: string;
  entryPath: string;
  expectedSize: number;
  expectedSha256: string;
  inspect: (filename: string) => Promise<T>;
}) {
  const { zip, entry } = await findZipEntry(input.archiveFilename, input.entryPath);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-migration-entry-'));
  const filename = path.join(directory, 'entry.bin');
  try {
    if (entry.uncompressedSize !== input.expectedSize) {
      throw new PlatformDomainError('MIGRATION_ARCHIVE_ENTRY_SIZE', `La entrada ${input.entryPath} no coincide con el tamaño inventariado.`, 422);
    }
    const source = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      zip.openReadStream(entry, (error, opened) => error || !opened ? reject(error || new Error('ZIP_STREAM_MISSING')) : resolve(opened));
    });
    const output = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
    const digest = createHash('sha256');
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      source.on('data', (chunk: Buffer) => { size += chunk.byteLength; digest.update(chunk); });
      source.once('error', reject);
      output.once('error', reject);
      output.once('finish', resolve);
      source.pipe(output);
    });
    if (size !== input.expectedSize || digest.digest('hex') !== input.expectedSha256) {
      throw new PlatformDomainError('MIGRATION_ARCHIVE_ENTRY_HASH_MISMATCH', `La entrada ${input.entryPath} cambió después del inventario.`, 422);
    }
    return await input.inspect(filename);
  } finally {
    zip.close();
    await rm(directory, { recursive: true, force: true });
  }
}
