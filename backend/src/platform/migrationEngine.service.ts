import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { DocCategoria, Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { getStorageProvider } from '../storage/storage.service';
import type { StorageProvider } from '../storage/storage.types';
import { extractDocumentArchive, safeDocumentPath, DocumentArchiveIntakeError } from '../services/documentArchiveIntake.service';
import { BackgroundJobsService } from './backgroundJobs.service';
import { PlatformDomainError, serializeBigInts } from './platform.errors';
import { TrackedStorageService } from './trackedStorage.service';
import { inspectCsvFile, inspectZipFile, readZipEntryBuffer, scanMigrationBuffer, scanMigrationSourceFile, streamCsvRecords,
  verifyMultipartSource, withVerifiedSourceFile, withZipEntryFile } from './migrationStreaming.service';

const MIGRATION_STATUSES = [
  'UPLOADING', 'SCANNING', 'ANALYZING', 'MAPPING_REQUIRED', 'PREVIEW_READY',
  'AWAITING_APPROVAL', 'MIGRATING', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const;

type MigrationStatus = typeof MIGRATION_STATUSES[number];
const PART_SIZE_MIN = 256 * 1024;
const PART_SIZE_MAX = 16 * 1024 * 1024;
// Individual provider objects remain below the 50 MB product upload ceiling.
// Small XLSX/RAR analysis still uses the established bounded-memory parser.
const BUFFERED_ASSEMBLY_MAX_BYTES = 50n * 1024n * 1024n;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const sessionPartKey = (organizationId: string, sessionId: string, part: number) =>
  `organizations/${organizationId}/migration-temp/${sessionId}/parts/${String(part).padStart(8, '0')}.bin`;
const sessionObjectKey = (organizationId: string, sessionId: string, filename: string) =>
  `organizations/${organizationId}/migration-temp/${sessionId}/${createHash('sha256').update(filename).digest('hex')}-${path.basename(filename)}`;

function assertStatus(actual: string, expected: MigrationStatus | MigrationStatus[]) {
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(actual as MigrationStatus)) {
    throw new PlatformDomainError('MIGRATION_STATE_CONFLICT', `La migración está en ${actual} y no admite esta operación.`, 409);
  }
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function parseCsv(buffer: Buffer): { headers: string[]; records: number } {
  const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new PlatformDomainError('MIGRATION_CSV_CORRUPT', 'El CSV termina dentro de un campo entrecomillado.', 422);
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const nonEmpty = rows.filter((candidate) => candidate.some((value) => value.trim()));
  if (!nonEmpty.length) throw new PlatformDomainError('MIGRATION_TABULAR_EMPTY', 'El archivo tabular no contiene filas.', 422);
  return { headers: nonEmpty[0].map((value) => value.trim()), records: Math.max(0, nonEmpty.length - 1) };
}

export async function parseXlsx(buffer: Buffer): Promise<{ headers: string[]; records: number }> {
  if (buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new PlatformDomainError('MIGRATION_XLSX_CORRUPT', 'El XLSX no tiene un encabezado ZIP válido.', 422);
  }
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { throw new PlatformDomainError('MIGRATION_XLSX_CORRUPT', 'El XLSX está corrupto o protegido.', 422); }
  const workbook = zip.file('xl/workbook.xml');
  const relationships = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) throw new PlatformDomainError('MIGRATION_XLSX_CORRUPT', 'El XLSX no contiene un libro válido.', 422);
  const workbookXml = await workbook.async('text');
  const relXml = await relationships.async('text');
  const firstSheetRel = workbookXml.match(/<sheet\b[^>]*(?:r:id|id)="([^"]+)"/i)?.[1];
  if (!firstSheetRel) throw new PlatformDomainError('MIGRATION_XLSX_EMPTY', 'El XLSX no contiene hojas analizables.', 422);
  const relPattern = new RegExp(`<Relationship\\b[^>]*Id="${firstSheetRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*Target="([^"]+)"`, 'i');
  const target = relXml.match(relPattern)?.[1];
  if (!target) throw new PlatformDomainError('MIGRATION_XLSX_CORRUPT', 'La hoja XLSX no puede resolverse.', 422);
  const worksheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const worksheet = zip.file(worksheetPath.replace(/\/[^/]+\/\.\.\//g, '/'));
  if (!worksheet) throw new PlatformDomainError('MIGRATION_XLSX_CORRUPT', 'La hoja XLSX no está disponible.', 422);
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsFile
    ? [...(await sharedStringsFile.async('text')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
      .map((match) => decodeXml([...(match[1] || '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((entry) => entry[1]).join('')))
    : [];
  const sheetXml = await worksheet.async('text');
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((match) => {
    return [...(match[1] || '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)].map((cell) => {
      const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
      const inline = cell[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/i)?.[1];
      const value = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || inline || '';
      return type === 's' ? (sharedStrings[Number(value)] || '') : decodeXml(value);
    });
  }).filter((candidate) => candidate.some((value) => value.trim()));
  if (!rows.length) throw new PlatformDomainError('MIGRATION_TABULAR_EMPTY', 'El XLSX no contiene filas.', 422);
  return { headers: rows[0].map((value) => value.trim()), records: Math.max(0, rows.length - 1) };
}

const canonicalFields: Record<string, string> = {
  id: 'source_id', folio: 'folio', nombre: 'nombre', apellido: 'apellido', email: 'email', correo: 'email',
  telefono: 'telefono', cliente: 'cliente', expediente: 'expediente', acto: 'acto', predio: 'predio',
  documento: 'documento', fecha: 'fecha', importe: 'importe', responsable: 'responsable',
};
const COMPARECIENTE_TARGETS = new Set(['source_id', 'nombre', 'apellido', 'email', 'telefono']);
const DOCUMENT_CATEGORIES = new Set(Object.values(DocCategoria));

type MigrationPackageRecord = {
  sourceRow: number;
  sourceRecordId: string;
  entityType: 'COMPARECIENTE';
  data: { nombre: string; apellido?: string; email?: string; telefono?: string };
};
type MigrationPackageDocument = {
  sourceRow: number;
  sourceRecordId: string;
  path: string;
  name: string;
  type: string;
  category: DocCategoria;
};
type MigrationPackageRelationship = {
  type: 'DOCUMENT_COMPARECIENTE';
  documentSourceRecordId: string;
  targetSourceRecordId: string;
};
type MigrationPackageV1 = {
  format: 'PRAVIA_MIGRATION_PACKAGE';
  version: 1;
  records: MigrationPackageRecord[];
  documents: MigrationPackageDocument[];
  relationships: MigrationPackageRelationship[];
};

function normalizedField(input: string) {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function requiredPackageString(value: unknown, field: string, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new PlatformDomainError('MIGRATION_PACKAGE_INVALID', `El manifiesto requiere ${field}.`, 422);
  }
  return value.trim();
}

function parseMigrationPackage(value: Buffer, assets: Array<{ sourcePath: string; size: number; sha256: string; mimeType: string }>): MigrationPackageV1 {
  let source: unknown;
  try { source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw new PlatformDomainError('MIGRATION_PACKAGE_INVALID', 'El manifiesto PRAVIA no es JSON UTF-8 válido.', 422); }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new PlatformDomainError('MIGRATION_PACKAGE_INVALID', 'El manifiesto PRAVIA no es un objeto válido.', 422);
  }
  const raw = source as Record<string, unknown>;
  if (raw.format !== 'PRAVIA_MIGRATION_PACKAGE' || raw.version !== 1
    || !Array.isArray(raw.records) || !Array.isArray(raw.documents) || !Array.isArray(raw.relationships)) {
    throw new PlatformDomainError('MIGRATION_PACKAGE_VERSION_UNSUPPORTED', 'El paquete debe declarar PRAVIA_MIGRATION_PACKAGE versión 1.', 422);
  }
  const records = raw.records.map((entry, index): MigrationPackageRecord => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new PlatformDomainError('MIGRATION_PACKAGE_INVALID', `El registro ${index + 1} es inválido.`, 422);
    const item = entry as Record<string, unknown>;
    if (item.entityType !== 'COMPARECIENTE' || !item.data || typeof item.data !== 'object' || Array.isArray(item.data)) {
      throw new PlatformDomainError('MIGRATION_PACKAGE_ENTITY_UNSUPPORTED', 'El paquete v1 sólo ejecuta registros COMPARECIENTE explícitos.', 422);
    }
    const data = item.data as Record<string, unknown>;
    const optional = (field: string) => data[field] === undefined || data[field] === null || data[field] === ''
      ? undefined : requiredPackageString(data[field], `records[${index}].data.${field}`, 320);
    return {
      sourceRow: index + 1,
      sourceRecordId: requiredPackageString(item.sourceRecordId, `records[${index}].sourceRecordId`, 240),
      entityType: 'COMPARECIENTE',
      data: { nombre: requiredPackageString(data.nombre, `records[${index}].data.nombre`, 255),
        apellido: optional('apellido'), email: optional('email'), telefono: optional('telefono') },
    };
  });
  const documents = raw.documents.map((entry, index): MigrationPackageDocument => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new PlatformDomainError('MIGRATION_PACKAGE_INVALID', `El documento ${index + 1} es inválido.`, 422);
    const item = entry as Record<string, unknown>;
    const category = requiredPackageString(item.category, `documents[${index}].category`, 40);
    if (!DOCUMENT_CATEGORIES.has(category as DocCategoria)) throw new PlatformDomainError('MIGRATION_PACKAGE_CATEGORY_INVALID', `La categoría ${category} no existe.`, 422);
    const sourcePath = safeDocumentPath(requiredPackageString(item.path, `documents[${index}].path`, 2048));
    if (sourcePath === 'pravia-migration.json' || !assets.some((asset) => asset.sourcePath === sourcePath)) {
      throw new PlatformDomainError('MIGRATION_PACKAGE_DOCUMENT_MISSING', `El archivo ${sourcePath} no existe en el paquete.`, 422);
    }
    return {
      sourceRow: index + 1,
      sourceRecordId: requiredPackageString(item.sourceRecordId, `documents[${index}].sourceRecordId`, 240),
      path: sourcePath, name: requiredPackageString(item.name, `documents[${index}].name`, 500),
      type: requiredPackageString(item.type, `documents[${index}].type`, 160), category: category as DocCategoria,
    };
  });
  const relationships = raw.relationships.map((entry, index): MigrationPackageRelationship => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new PlatformDomainError('MIGRATION_PACKAGE_INVALID', `La relación ${index + 1} es inválida.`, 422);
    const item = entry as Record<string, unknown>;
    if (item.type !== 'DOCUMENT_COMPARECIENTE') throw new PlatformDomainError('MIGRATION_PACKAGE_RELATION_UNSUPPORTED', 'El paquete v1 sólo admite DOCUMENT_COMPARECIENTE.', 422);
    return { type: 'DOCUMENT_COMPARECIENTE',
      documentSourceRecordId: requiredPackageString(item.documentSourceRecordId, `relationships[${index}].documentSourceRecordId`, 240),
      targetSourceRecordId: requiredPackageString(item.targetSourceRecordId, `relationships[${index}].targetSourceRecordId`, 240) };
  });
  const recordIds = new Set(records.map((entry) => entry.sourceRecordId));
  const documentIds = new Set(documents.map((entry) => entry.sourceRecordId));
  if (recordIds.size !== records.length || documentIds.size !== documents.length || new Set(documents.map((entry) => entry.path)).size !== documents.length) {
    throw new PlatformDomainError('MIGRATION_PACKAGE_DUPLICATE_IDENTITY', 'El paquete repite identidades o rutas fuente.', 422);
  }
  const declaredPaths = new Set(documents.map((entry) => entry.path));
  const undeclared = assets.find((asset) => asset.sourcePath !== 'pravia-migration.json' && !declaredPaths.has(asset.sourcePath));
  if (undeclared) {
    throw new PlatformDomainError('MIGRATION_PACKAGE_UNDECLARED_FILE', `El archivo ${undeclared.sourcePath} no figura en el manifiesto.`, 422);
  }
  const relatedDocuments = new Set<string>();
  for (const relationship of relationships) {
    if (!documentIds.has(relationship.documentSourceRecordId) || !recordIds.has(relationship.targetSourceRecordId)
      || relatedDocuments.has(relationship.documentSourceRecordId)) {
      throw new PlatformDomainError('MIGRATION_PACKAGE_RELATION_INVALID', 'Cada documento debe apuntar exactamente a un Compareciente fuente válido.', 422);
    }
    relatedDocuments.add(relationship.documentSourceRecordId);
  }
  if (relatedDocuments.size !== documents.length) {
    throw new PlatformDomainError('MIGRATION_PACKAGE_RELATION_INCOMPLETE', 'Cada documento del paquete requiere una relación explícita.', 422);
  }
  return { format: 'PRAVIA_MIGRATION_PACKAGE', version: 1, records, documents, relationships };
}

export class MigrationEngineService {
  private readonly tracked: TrackedStorageService;
  private readonly jobs: BackgroundJobsService;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly provider: StorageProvider = getStorageProvider(),
  ) {
    this.tracked = new TrackedStorageService(provider, db);
    this.jobs = new BackgroundJobsService(db);
  }

  async createJob(input: { organizationId: string; userId: string; sourceSystem: string; declaredBytes: bigint; idempotencyKey: string }) {
    if (!input.sourceSystem.trim() || input.declaredBytes <= 0n || !input.idempotencyKey.trim()) {
      throw new PlatformDomainError('MIGRATION_JOB_INVALID', 'Origen, tamaño e idempotencia son obligatorios.', 400);
    }
    const existing = await this.db.migrationJob.findUnique({
      where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
    });
    if (existing) {
      if (existing.source_system !== input.sourceSystem.trim() || existing.declared_bytes !== input.declaredBytes || existing.created_by !== input.userId) {
        throw new PlatformDomainError('MIGRATION_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya pertenece a otra importación.', 409);
      }
      return serializeBigInts(existing);
    }
    return serializeBigInts(await this.db.migrationJob.create({ data: {
      organization_id: input.organizationId,
      source_system: input.sourceSystem.trim(),
      declared_bytes: input.declaredBytes,
      created_by: input.userId,
      idempotency_key: input.idempotencyKey,
    } }));
  }

  async createUploadSession(input: {
    organizationId: string; migrationJobId: string; filename: string; declaredBytes: bigint;
    partSizeBytes: number; idempotencyKey: string;
  }) {
    const job = await this.db.migrationJob.findFirstOrThrow({ where: { id: input.migrationJobId, organization_id: input.organizationId } });
    assertStatus(job.status, 'UPLOADING');
    if (!input.idempotencyKey.trim()) {
      throw new PlatformDomainError('MIGRATION_UPLOAD_IDEMPOTENCY_REQUIRED', 'La clave de idempotencia de la carga es obligatoria.', 400);
    }
    if (input.filename.includes('/') || input.filename.includes('\\')) {
      throw new PlatformDomainError('MIGRATION_FILENAME_INVALID', 'El nombre del archivo no debe contener rutas.', 400);
    }
    const filename = safeDocumentPath(input.filename);
    if (input.declaredBytes <= 0n || input.declaredBytes !== job.declared_bytes) {
      throw new PlatformDomainError('MIGRATION_DECLARED_SIZE_MISMATCH', 'El tamaño declarado no coincide con el job.', 409);
    }
    if (!Number.isSafeInteger(input.partSizeBytes) || input.partSizeBytes < PART_SIZE_MIN || input.partSizeBytes > PART_SIZE_MAX) {
      throw new PlatformDomainError('MIGRATION_PART_SIZE_INVALID', 'El tamaño de parte debe estar entre 256 KB y 16 MB.', 400);
    }
    const partSize = input.partSizeBytes;
    const existing = await this.db.resumableUploadSession.findUnique({
      where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
    });
    if (existing) {
      if (existing.migration_job_id !== job.id || existing.declared_bytes !== input.declaredBytes
        || existing.part_size_bytes !== partSize
        || existing.object_key !== sessionObjectKey(input.organizationId, existing.id, filename)) {
        throw new PlatformDomainError('MIGRATION_IDEMPOTENCY_CONFLICT', 'La clave de carga ya pertenece a otra sesión.', 409);
      }
      return serializeBigInts(existing);
    }
    const id = crypto.randomUUID();
    return serializeBigInts(await this.db.resumableUploadSession.create({ data: {
      id,
      organization_id: input.organizationId,
      migration_job_id: job.id,
      object_key: sessionObjectKey(input.organizationId, id, filename),
      declared_bytes: input.declaredBytes,
      part_size_bytes: partSize,
      idempotency_key: input.idempotencyKey,
      status: 'CREATED',
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    } }));
  }

  async uploadProgress(organizationId: string, migrationJobId: string, uploadSessionId: string) {
    const session = await this.db.resumableUploadSession.findFirst({ where: {
      id: uploadSessionId, organization_id: organizationId, migration_job_id: migrationJobId,
    } });
    if (!session) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_NOT_FOUND', 'La sesión no pertenece a esta migración.', 404);
    const parts = await this.db.resumableUploadPart.findMany({
      where: { upload_session_id: uploadSessionId, organization_id: organizationId },
      orderBy: { part_number: 'asc' }, select: { part_number: true, size_bytes: true, checksum_sha256: true },
    });
    return serializeBigInts({ session, parts });
  }

  async pauseUpload(organizationId: string, migrationJobId: string, uploadSessionId: string) {
    const updated = await this.db.resumableUploadSession.updateMany({ where: {
      id: uploadSessionId, organization_id: organizationId, migration_job_id: migrationJobId,
      status: { in: ['CREATED', 'UPLOADING'] },
    }, data: { status: 'PAUSED' } });
    if (updated.count !== 1) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_CLOSED', 'La sesión no puede pausarse.', 409);
    return this.uploadProgress(organizationId, migrationJobId, uploadSessionId);
  }

  async resumeUpload(organizationId: string, migrationJobId: string, uploadSessionId: string) {
    const updated = await this.db.resumableUploadSession.updateMany({ where: {
      id: uploadSessionId, organization_id: organizationId, migration_job_id: migrationJobId,
      status: 'PAUSED', expires_at: { gt: new Date() },
    }, data: { status: 'UPLOADING' } });
    if (updated.count !== 1) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_CLOSED', 'La sesión no puede reanudarse.', 409);
    return this.uploadProgress(organizationId, migrationJobId, uploadSessionId);
  }

  async uploadPart(input: { organizationId: string; migrationJobId: string; uploadSessionId: string; partNumber: number; buffer: Buffer; checksumSha256: string }) {
    if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || !input.buffer.length) {
      throw new PlatformDomainError('MIGRATION_UPLOAD_PART_INVALID', 'La parte de upload no es válida.', 400);
    }
    const session = await this.db.resumableUploadSession.findFirst({ where: {
      id: input.uploadSessionId, organization_id: input.organizationId, migration_job_id: input.migrationJobId,
    } });
    if (!session) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_NOT_FOUND', 'La sesión no pertenece a esta migración.', 404);
    if (!['CREATED', 'UPLOADING'].includes(session.status) || session.expires_at <= new Date()) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_CLOSED', 'La sesión de carga ya no está abierta.', 409);
    if (input.buffer.byteLength > session.part_size_bytes) throw new PlatformDomainError('MIGRATION_UPLOAD_PART_TOO_LARGE', 'La parte supera el tamaño acordado.', 413);
    const checksum = hash(input.buffer);
    if (checksum !== input.checksumSha256.toLowerCase()) throw new PlatformDomainError('MIGRATION_UPLOAD_CHECKSUM_MISMATCH', 'La parte no coincide con su checksum.', 422);
    const existing = await this.db.resumableUploadPart.findUnique({ where: {
      upload_session_id_part_number: { upload_session_id: session.id, part_number: input.partNumber },
    } });
    if (existing) {
      if (existing.checksum_sha256 !== checksum || existing.size_bytes !== input.buffer.byteLength) {
        throw new PlatformDomainError('MIGRATION_UPLOAD_PART_CONFLICT', 'La parte ya existe con contenido distinto.', 409);
      }
      return serializeBigInts(existing);
    }
    const key = sessionPartKey(input.organizationId, session.id, input.partNumber);
    await this.tracked.upload(input.buffer, key, 'application/octet-stream', 'TEMPORARY');
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM resumable_upload_sessions WHERE id = ${session.id}::uuid FOR UPDATE`;
        const current = await tx.resumableUploadSession.findUniqueOrThrow({ where: { id: session.id } });
        const concurrent = await tx.resumableUploadPart.findUnique({ where: {
          upload_session_id_part_number: { upload_session_id: session.id, part_number: input.partNumber },
        } });
        if (concurrent) {
          if (concurrent.checksum_sha256 !== checksum || concurrent.size_bytes !== input.buffer.byteLength) {
            throw new PlatformDomainError('MIGRATION_UPLOAD_PART_CONFLICT', 'La parte ya existe con contenido distinto.', 409);
          }
          return serializeBigInts(concurrent);
        }
        if (!['CREATED', 'UPLOADING'].includes(current.status)) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_CLOSED', 'La sesión se cerró durante la carga.', 409);
        if (current.uploaded_bytes + BigInt(input.buffer.byteLength) > current.declared_bytes) {
          throw new PlatformDomainError('MIGRATION_UPLOAD_SIZE_EXCEEDED', 'Las partes exceden el tamaño declarado.', 409);
        }
        const created = await tx.resumableUploadPart.create({ data: {
          organization_id: input.organizationId, upload_session_id: session.id, part_number: input.partNumber,
          size_bytes: input.buffer.byteLength, checksum_sha256: checksum, provider_etag: key,
        } });
        await tx.resumableUploadSession.update({ where: { id: session.id }, data: {
          uploaded_bytes: { increment: input.buffer.byteLength }, status: 'UPLOADING',
        } });
        await tx.migrationJob.update({ where: { id: session.migration_job_id }, data: {
          temporary_bytes: { increment: input.buffer.byteLength },
          progress: Number(((current.uploaded_bytes + BigInt(input.buffer.byteLength)) * 20n) / current.declared_bytes),
        } });
        return serializeBigInts(created);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const committed = await this.db.resumableUploadPart.findUnique({ where: {
        upload_session_id_part_number: { upload_session_id: session.id, part_number: input.partNumber },
      } });
      if (committed?.checksum_sha256 === checksum && committed.size_bytes === input.buffer.byteLength) return serializeBigInts(committed);
      await this.tracked.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async completeUpload(input: { organizationId: string; migrationJobId: string; uploadSessionId: string; checksumSha256?: string }) {
    const session = await this.db.resumableUploadSession.findFirst({ where: {
      id: input.uploadSessionId, organization_id: input.organizationId, migration_job_id: input.migrationJobId,
    } });
    if (!session) throw new PlatformDomainError('MIGRATION_UPLOAD_SESSION_NOT_FOUND', 'La sesión no pertenece a esta migración.', 404);
    if (session.status === 'COMPLETED') {
      if (input.checksumSha256 && session.sha256 !== input.checksumSha256.toLowerCase()) throw new PlatformDomainError('MIGRATION_UPLOAD_CHECKSUM_MISMATCH', 'El upload completado tiene otro checksum.', 409);
      return serializeBigInts(session);
    }
    if (!['CREATED', 'UPLOADING'].includes(session.status) || session.uploaded_bytes !== session.declared_bytes) {
      throw new PlatformDomainError('MIGRATION_UPLOAD_INCOMPLETE', 'Aún faltan partes del archivo.', 409);
    }
    const parts = await this.db.resumableUploadPart.findMany({ where: { upload_session_id: session.id }, orderBy: { part_number: 'asc' } });
    const expectedParts = Number((session.declared_bytes + BigInt(session.part_size_bytes) - 1n) / BigInt(session.part_size_bytes));
    if (parts.length !== expectedParts || parts.some((part, index) => part.part_number !== index + 1)) {
      throw new PlatformDomainError('MIGRATION_UPLOAD_PARTS_NOT_CONTIGUOUS', 'Las partes no forman una secuencia completa.', 409);
    }
    const claimed = await this.db.resumableUploadSession.updateMany({ where: {
      id: session.id, status: session.status, uploaded_bytes: session.declared_bytes,
    }, data: { status: 'COMPLETING' } });
    if (claimed.count !== 1) throw new PlatformDomainError('MIGRATION_UPLOAD_COMPLETING', 'La carga ya está completándose.', 409);
    let checksum: string;
    try {
      const verified = await verifyMultipartSource(this.provider, parts,
        (part) => sessionPartKey(input.organizationId, session.id, part.part_number),
        session.declared_bytes, input.checksumSha256 || undefined);
      checksum = verified.sha256;
    } catch (error) {
      await this.db.resumableUploadSession.updateMany({ where: { id: session.id, status: 'COMPLETING' }, data: { status: 'FAILED' } });
      throw error;
    }
    const completed = await this.db.$transaction(async (tx) => {
      const current = await tx.resumableUploadSession.update({ where: { id: session.id }, data: {
        status: 'COMPLETED', sha256: checksum, completed_at: new Date(), uploaded_bytes: session.declared_bytes,
      } });
      await tx.migrationJob.update({ where: { id: session.migration_job_id }, data: {
        status: 'SCANNING', temporary_bytes: session.declared_bytes, progress: 25, started_at: new Date(),
      } });
      return current;
    });
    // Parts remain in temporary storage until inspection, promotion and the
    // required backup complete. Deleting them here made restart impossible.
    await this.jobs.enqueue({
      organizationId: input.organizationId, jobType: 'MIGRATION_ANALYZE',
      idempotencyKey: `migration-analyze:${session.migration_job_id}`,
      payload: { migrationJobId: session.migration_job_id, uploadSessionId: session.id },
    });
    return serializeBigInts(completed);
  }

  async analyze(input: { organizationId: string; migrationJobId: string; uploadSessionId: string }) {
    const [job, session] = await Promise.all([
      this.db.migrationJob.findFirstOrThrow({ where: { id: input.migrationJobId, organization_id: input.organizationId } }),
      this.db.resumableUploadSession.findFirstOrThrow({ where: { id: input.uploadSessionId, organization_id: input.organizationId, migration_job_id: input.migrationJobId } }),
    ]);
    if (session.status !== 'COMPLETED' || !session.sha256) throw new PlatformDomainError('MIGRATION_UPLOAD_INCOMPLETE', 'El upload no está verificado.', 409);
    // A queued analyze can be retried after another worker has already moved
    // the same immutable source forward. Do not fail or re-inventory it.
    if (['MAPPING_REQUIRED', 'PREVIEW_READY', 'AWAITING_APPROVAL', 'MIGRATING', 'VERIFYING', 'COMPLETED'].includes(job.status)) {
      return serializeBigInts(job);
    }
    assertStatus(job.status, ['SCANNING', 'ANALYZING', 'FAILED']);
    await this.db.migrationJob.update({ where: { id: job.id }, data: { status: 'ANALYZING', progress: 35 } });
    const filename = session.object_key.replace(/^.*\/[0-9a-f]{64}-/i, '');
    const extension = path.extname(filename).toLowerCase();
    let entries: Array<{ sourcePath: string; size: number; sha256: string; mimeType: string; headers?: string[]; records?: number }> = [];
    let sourceScan: Awaited<ReturnType<typeof scanMigrationSourceFile>> | null = null;
    let migrationPackage: MigrationPackageV1 | null = null;
    try {
      const parts = await this.db.resumableUploadPart.findMany({ where: { upload_session_id: session.id }, orderBy: { part_number: 'asc' } });
      entries = await withVerifiedSourceFile({
        provider: this.provider, parts,
        keyForPart: (part) => sessionPartKey(input.organizationId, session.id, part.part_number),
        expectedBytes: session.declared_bytes, expectedChecksum: session.sha256,
        inspect: async (sourceFile) => {
          sourceScan = await scanMigrationSourceFile(sourceFile);
          if (extension === '.csv') return [await inspectCsvFile(sourceFile, filename, session.sha256!, Number(session.declared_bytes))];
          if (extension === '.zip') {
            const inspected = await inspectZipFile(sourceFile, session.declared_bytes);
            if (inspected.some((entry) => entry.sourcePath === 'pravia-migration.json')) {
              migrationPackage = parseMigrationPackage(
                await readZipEntryBuffer(sourceFile, 'pravia-migration.json'),
                inspected,
              );
            }
            return inspected;
          }
          if (extension === '.rar' || extension === '.xlsx') {
            if (session.declared_bytes > BUFFERED_ASSEMBLY_MAX_BYTES) {
              throw new PlatformDomainError('MIGRATION_FORMAT_STREAMING_UNAVAILABLE', 'Este formato excede el analizador seguro de 50 MB; el archivo temporal se conserva para revisión.', 409);
            }
            const source = await readFile(sourceFile);
            if (extension === '.rar') {
              const extracted = await extractDocumentArchive({ originalname: filename, buffer: source });
              return extracted.map((item) => {
                scanMigrationBuffer(item.buffer, item.relativePath);
                return { sourcePath: item.relativePath, size: item.buffer.byteLength, sha256: item.checksum, mimeType: item.mimeType };
              });
            }
            const table = await parseXlsx(source);
            return [{ sourcePath: filename, size: source.byteLength, sha256: session.sha256!, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...table }];
          }
          throw new PlatformDomainError('MIGRATION_FORMAT_UNSUPPORTED', 'La migración admite CSV, XLSX, ZIP o RAR para análisis automático.', 415);
        },
      });
    } catch (error) {
      const code = error instanceof DocumentArchiveIntakeError ? error.code
        : error instanceof PlatformDomainError ? error.code : 'MIGRATION_ANALYSIS_FAILED';
      await this.db.migrationJob.update({ where: { id: job.id }, data: {
        status: 'FAILED', corrupt_files: { increment: 1 },
        dangerous_files: code.includes('PATH') || code.includes('TRAVERSAL') || code.includes('MALWARE') || code.includes('EXECUTABLE')
          ? { increment: 1 } : undefined,
        verification_json: { errorCode: code, message: error instanceof Error ? error.message : 'Error de análisis.' },
      } });
      throw error;
    }

    const seen = new Map<string, number>();
    const duplicateOf = new Map<number, number>();
    entries.forEach((entry, index) => {
      const previous = seen.get(entry.sha256);
      if (previous !== undefined) duplicateOf.set(index, previous);
      else seen.set(entry.sha256, index);
    });
    return this.db.$transaction(async (tx) => {
      await tx.migrationAsset.deleteMany({ where: { migration_job_id: job.id, organization_id: input.organizationId } });
      await tx.migrationMapping.deleteMany({ where: { migration_job_id: job.id, organization_id: input.organizationId } });
      const createdAssets: string[] = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const duplicateIndex = duplicateOf.get(index);
        const asset = await tx.migrationAsset.create({ data: {
          organization_id: input.organizationId, migration_job_id: job.id, entry_index: index,
          source_path: entry.sourcePath, size_bytes: entry.size, sha256: entry.sha256, mime_type: entry.mimeType,
          scan_status: 'STRUCTURE_VALIDATED', status: duplicateIndex === undefined ? 'INVENTORIED' : 'DUPLICATE',
          duplicate_of: duplicateIndex === undefined ? undefined : createdAssets[duplicateIndex],
        } });
        createdAssets.push(asset.id);
        for (const header of entry.headers || []) {
          const normalized = normalizedField(header);
          const target = canonicalFields[normalized] || null;
          await tx.migrationMapping.create({ data: {
            organization_id: input.organizationId, migration_job_id: job.id, entity_type: 'UNCLASSIFIED',
            source_field: header, target_field: target, confidence: target ? new Prisma.Decimal('1') : null,
            status: target ? 'MAPPED' : 'NEEDS_REVIEW', transform: {},
          } });
        }
      }
      if (migrationPackage) {
        await tx.migrationMapping.create({ data: {
          organization_id: input.organizationId, migration_job_id: job.id, entity_type: 'PRAVIA_PACKAGE_V1',
          source_field: 'pravia-migration.json', target_field: 'PRAVIA_PACKAGE_V1', confidence: new Prisma.Decimal('1'),
          status: 'NEEDS_REVIEW', transform: { version: 1 },
        } });
      }
      // Header similarity cannot determine the target entity or legal meaning.
      // Even perfect field-name matches require human entity classification.
      const unresolved = true;
      const detectedRecords = migrationPackage
        ? migrationPackage.records.length + migrationPackage.documents.length
        : entries.reduce((sum, entry) => sum + (entry.records || 0), 0);
      const estimatedBytes = entries.reduce((sum, entry, index) => sum + (duplicateOf.has(index) ? 0n : BigInt(entry.size)), 0n);
      const updated = await tx.migrationJob.update({ where: { id: job.id }, data: {
        status: unresolved ? 'MAPPING_REQUIRED' : 'PREVIEW_READY', progress: unresolved ? 60 : 75,
        detected_files: entries.length, detected_records: detectedRecords,
        duplicate_files: duplicateOf.size, corrupt_files: 0, dangerous_files: 0,
        estimated_production_bytes: estimatedBytes,
        verification_json: {
          securityValidation: 'STRUCTURAL_AND_LOCAL_SIGNATURES',
          maliciousFileCheck: sourceScan?.status || 'FAILED', signatureScanner: sourceScan?.scanner || null,
          universalCompatibilityClaimed: false, checksumVerified: true,
          entityClassification: 'HUMAN_MAPPING_REQUIRED', executionAvailable: false,
          packageFormat: migrationPackage?.format || null, packageVersion: migrationPackage?.version || null,
          packageRecords: migrationPackage?.records.length || 0, packageDocuments: migrationPackage?.documents.length || 0,
          packageRelationships: migrationPackage?.relationships.length || 0,
        },
      } });
      return serializeBigInts(updated);
    });
  }

  async submitMapping(input: {
    organizationId: string; migrationJobId: string; userId: string; entityType: string;
    fields: Array<{ sourceField: string; targetField: string | null }>;
  }) {
    if (!['COMPARECIENTE', 'PRAVIA_PACKAGE_V1'].includes(input.entityType)) {
      throw new PlatformDomainError('MIGRATION_ENTITY_NOT_IMPLEMENTED', 'La ejecución automática sólo admite Comparecientes inequívocos; conserva las demás entidades como UNMAPPED.', 422);
    }
    const job = await this.db.migrationJob.findFirstOrThrow({ where: { id: input.migrationJobId, organization_id: input.organizationId } });
    assertStatus(job.status, 'MAPPING_REQUIRED');
    const session = await this.db.resumableUploadSession.findFirstOrThrow({ where: {
      organization_id: input.organizationId, migration_job_id: job.id, status: 'COMPLETED',
    }, orderBy: { completed_at: 'desc' } });
    const filename = session.object_key.replace(/^.*\/[0-9a-f]{64}-/i, '');
    const executable = (path.extname(filename).toLowerCase() === '.csv' && input.entityType === 'COMPARECIENTE')
      || (path.extname(filename).toLowerCase() === '.zip' && input.entityType === 'PRAVIA_PACKAGE_V1');
    const mappings = await this.db.migrationMapping.findMany({ where: { organization_id: input.organizationId, migration_job_id: job.id } });
    if (!mappings.length || mappings.length !== input.fields.length) {
      throw new PlatformDomainError('MIGRATION_MAPPING_INCOMPLETE', 'Debes decidir todos los campos detectados.', 422);
    }
    const decisions = new Map(input.fields.map((field) => [field.sourceField, field.targetField]));
    if (decisions.size !== mappings.length || mappings.some((mapping) => !decisions.has(mapping.source_field))) {
      throw new PlatformDomainError('MIGRATION_MAPPING_INCOMPLETE', 'El mapeo no corresponde exactamente a los encabezados detectados.', 422);
    }
    const chosen = [...decisions.values()].filter((value): value is string => Boolean(value));
    if (input.entityType === 'COMPARECIENTE') {
      if (chosen.some((target) => !COMPARECIENTE_TARGETS.has(target)) || new Set(chosen).size !== chosen.length || !chosen.includes('nombre')) {
        throw new PlatformDomainError('MIGRATION_MAPPING_INVALID', 'Compareciente exige nombre y destinos canónicos sin duplicados.', 422);
      }
    } else if (mappings.length !== 1 || mappings[0].source_field !== 'pravia-migration.json'
      || decisions.get('pravia-migration.json') !== 'PRAVIA_PACKAGE_V1') {
      throw new PlatformDomainError('MIGRATION_MAPPING_INVALID', 'El paquete versionado debe aprobarse explícitamente sin alterar su destino.', 422);
    }
    await this.db.$transaction(async (tx) => {
      for (const mapping of mappings) {
        const target = decisions.get(mapping.source_field) || null;
        await tx.migrationMapping.update({ where: { id: mapping.id }, data: {
          entity_type: input.entityType, target_field: target, status: target ? 'APPROVED' : 'UNMAPPED',
          approved_by: input.userId, approved_at: new Date(),
        } });
      }
      await tx.migrationJob.update({ where: { id: job.id }, data: {
        status: 'PREVIEW_READY', progress: 75,
        verification_json: { ...(job.verification_json as object), mappingApproved: true,
          executionAvailable: executable, executionRestriction: executable ? null : 'REQUIRES_SOURCE_FORMAT_REVIEW' },
      } });
    });
    return this.preview(input.organizationId, job.id);
  }

  async approve(input: { organizationId: string; migrationJobId: string; userId: string }) {
    const preview = await this.preview(input.organizationId, input.migrationJobId) as any;
    if (!preview.approvalAllowed) throw new PlatformDomainError('MIGRATION_APPROVAL_BLOCKED', 'La capacidad, el mapeo o los conflictos aún impiden aprobar.', 409);
    return serializeBigInts(await this.db.migrationJob.update({ where: { id: input.migrationJobId }, data: {
      approved_by: input.userId, approved_at: new Date(), progress: 80,
    } }));
  }

  async queueExecution(input: { organizationId: string; migrationJobId: string; backupRunId: string }) {
    const job = await this.db.migrationJob.findFirstOrThrow({ where: {
      id: input.migrationJobId, organization_id: input.organizationId,
    } });
    assertStatus(job.status, ['PREVIEW_READY', 'FAILED']);
    if (!job.approved_by || !job.approved_at) {
      throw new PlatformDomainError('MIGRATION_APPROVAL_REQUIRED', 'La migración requiere aprobación humana persistida.', 409);
    }
    const backup = await this.db.backupRun.findFirst({ where: {
      id: input.backupRunId, organization_id: input.organizationId,
      scope: `MIGRATION_SOURCE:${job.id}`, status: 'COMPLETED',
    } });
    const restore = backup ? await this.db.restoreDrill.findFirst({ where: {
      backup_run_id: backup.id,
    }, orderBy: { tested_at: 'desc' } }) : null;
    if (!backup || restore?.result !== 'PASS') {
      throw new PlatformDomainError('MIGRATION_BACKUP_GATE', 'La ejecución exige backup y restore drill certificados del origen exacto de la migración.', 409);
    }
    const source = await this.db.resumableUploadSession.findFirst({ where: {
      organization_id: input.organizationId, migration_job_id: job.id, status: 'COMPLETED',
    }, orderBy: { completed_at: 'desc' } });
    if (!source?.sha256 || backup.checksum_sha256 !== source.sha256 || backup.bytes !== source.declared_bytes) {
      throw new PlatformDomainError('MIGRATION_BACKUP_SOURCE_MISMATCH', 'El backup no coincide con los bytes y SHA-256 de la fuente aprobada.', 409);
    }
    return this.jobs.enqueue({
      organizationId: input.organizationId,
      jobType: 'MIGRATION_EXECUTE',
      idempotencyKey: `migration-execute:${job.id}`,
      payload: { migrationJobId: job.id, backupRunId: backup.id },
      priority: 20,
      maxAttempts: 5,
    });
  }

  async execute(input: { organizationId: string; migrationJobId: string; backupRunId: string }) {
    const job = await this.db.migrationJob.findFirstOrThrow({ where: { id: input.migrationJobId, organization_id: input.organizationId } });
    if (job.status === 'COMPLETED') return serializeBigInts(job);
    assertStatus(job.status, ['PREVIEW_READY', 'FAILED']);
    if (!job.approved_by || !job.approved_at) throw new PlatformDomainError('MIGRATION_APPROVAL_REQUIRED', 'La migración requiere aprobación humana persistida.', 409);
    const backup = await this.db.backupRun.findFirst({ where: {
      id: input.backupRunId, organization_id: input.organizationId,
      scope: `MIGRATION_SOURCE:${job.id}`, status: 'COMPLETED',
    } });
    const restore = backup ? await this.db.restoreDrill.findFirst({ where: { backup_run_id: backup.id }, orderBy: { tested_at: 'desc' } }) : null;
    if (!backup || restore?.result !== 'PASS') throw new PlatformDomainError('MIGRATION_BACKUP_GATE', 'La ejecución exige backup y restore drill certificados del origen exacto de la migración.', 409);
    const session = await this.db.resumableUploadSession.findFirstOrThrow({ where: {
      organization_id: input.organizationId, migration_job_id: job.id, status: 'COMPLETED',
    }, orderBy: { completed_at: 'desc' } });
    if (!session.sha256 || backup.checksum_sha256 !== session.sha256 || backup.bytes !== session.declared_bytes) {
      throw new PlatformDomainError('MIGRATION_BACKUP_SOURCE_MISMATCH', 'El backup no coincide con los bytes y SHA-256 de la fuente aprobada.', 409);
    }
    const mappings = await this.db.migrationMapping.findMany({ where: { organization_id: input.organizationId, migration_job_id: job.id } });
    const filename = session.object_key.replace(/^.*\/[0-9a-f]{64}-/i, '');
    if (path.extname(filename).toLowerCase() === '.zip') {
      if (mappings.length !== 1 || mappings[0].entity_type !== 'PRAVIA_PACKAGE_V1'
        || mappings[0].target_field !== 'PRAVIA_PACKAGE_V1' || mappings[0].status !== 'APPROVED') {
        throw new PlatformDomainError('MIGRATION_MAPPING_INVALID', 'El paquete PRAVIA no tiene una aprobación ejecutable.', 409);
      }
      return this.executePackage({ ...input, filename, jobId: job.id, sessionId: session.id });
    }
    if (!mappings.length || mappings.some((mapping) => !['APPROVED', 'UNMAPPED'].includes(mapping.status)) || mappings.some((mapping) => mapping.entity_type !== 'COMPARECIENTE')) {
      throw new PlatformDomainError('MIGRATION_MAPPING_INVALID', 'El mapeo aprobado no es ejecutable.', 409);
    }
    if (path.extname(filename).toLowerCase() !== '.csv') throw new PlatformDomainError('MIGRATION_EXECUTION_FORMAT_UNSUPPORTED', 'La ejecución automática actual requiere CSV aprobado.', 415);
    const parts = await this.db.resumableUploadPart.findMany({ where: { upload_session_id: session.id }, orderBy: { part_number: 'asc' } });
    const previousVerification = job.verification_json && typeof job.verification_json === 'object'
      && !Array.isArray(job.verification_json) ? job.verification_json as Record<string, unknown> : {};
    if (job.status === 'FAILED' && previousVerification.cleanupPending === true
      && typeof previousVerification.manifestBlobId === 'string') {
      return this.finishMigrationCleanup({ organizationId: input.organizationId, jobId: job.id,
        sessionId: session.id, parts, verification: previousVerification });
    }
    await this.db.migrationJob.update({ where: { id: job.id }, data: { status: 'MIGRATING', progress: 82, started_at: job.started_at || new Date() } });
    let imported = 0;
    let skipped = 0;
    try {
      await withVerifiedSourceFile({
        provider: this.provider, parts,
        keyForPart: (part) => sessionPartKey(input.organizationId, session.id, part.part_number),
        expectedBytes: session.declared_bytes, expectedChecksum: session.sha256!,
        inspect: async (sourceFile) => {
          let headers: string[] | null = null;
          let sourceRow = 0;
          const seenSourceIds = new Set<string>();
          let batch: Array<{ sourceId: string; sourceRow: number; mapped: Record<string, string> }> = [];
          const flush = async () => {
            if (!batch.length) return;
            const existing = await this.db.migrationProvenance.findMany({ where: {
              organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
              target_type: 'COMPARECIENTE', source_record_id: { in: batch.map((record) => record.sourceId) },
            }, select: { source_record_id: true } });
            const alreadyImported = new Set(existing.map((record) => record.source_record_id));
            const pending = batch.filter((record) => !alreadyImported.has(record.sourceId));
            skipped += batch.length - pending.length;
            if (pending.length) {
              const prepared = pending.map((record) => {
                const nombre = String(record.mapped.nombre || '').trim();
                if (!nombre) throw new PlatformDomainError('MIGRATION_REQUIRED_VALUE_MISSING', `La fila ${record.sourceRow} no contiene nombre.`, 422);
                const apellido = String(record.mapped.apellido || '').trim();
                return { ...record, nombre, apellido, comparecienteId: crypto.randomUUID() };
              });
              await this.db.$transaction(async (tx) => {
                await tx.compareciente.createMany({ data: prepared.map((record) => ({
                  id: record.comparecienteId, organization_id: input.organizationId, tipo_persona: 'FISICA',
                  nombre_busqueda: [record.nombre, record.apellido].filter(Boolean).join(' '), creado_por_id: job.created_by,
                })) });
                await tx.personaFisica.createMany({ data: prepared.map((record) => ({
                  organization_id: input.organizationId, compareciente_id: record.comparecienteId,
                  nombre: record.nombre, apellido_paterno: record.apellido || null,
                  nombre_completo_calculado: [record.nombre, record.apellido].filter(Boolean).join(' '),
                })) });
                const contacts = prepared.flatMap((record) => ([
                  { target: 'email', tipo: 'CORREO' }, { target: 'telefono', tipo: 'TELEFONO' },
                ] as const).filter((contact) => String(record.mapped[contact.target] || '').trim()).map((contact) => ({
                  organization_id: input.organizationId, compareciente_id: record.comparecienteId, tipo: contact.tipo,
                  valor: String(record.mapped[contact.target]).trim(), creado_por_id: job.created_by,
                })));
                if (contacts.length) await tx.comparecienteContacto.createMany({ data: contacts });
                await tx.migrationProvenance.createMany({ data: prepared.map((record) => ({
                  organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
                  source_record_id: record.sourceId, source_file: filename, source_row: record.sourceRow,
                  target_type: 'COMPARECIENTE', target_id: record.comparecienteId,
                })) });
              });
              imported += pending.length;
            }
            batch = [];
          };
          for await (const row of streamCsvRecords(sourceFile)) {
            if (!headers) { headers = row.map((value) => value.trim()); continue; }
            sourceRow += 1;
            const values = Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() || '']));
            const mapped = Object.fromEntries(mappings.filter((mapping) => mapping.target_field).map((mapping) => [mapping.target_field!, values[mapping.source_field] || '']));
            const sourceId = String(mapped.source_id || sourceRow);
            if (seenSourceIds.has(sourceId)) throw new PlatformDomainError('MIGRATION_SOURCE_ID_DUPLICATE', `La fuente repite el identificador ${sourceId}.`, 422);
            seenSourceIds.add(sourceId);
            batch.push({ sourceId, sourceRow, mapped });
            if (batch.length >= 100) await flush();
          }
          await flush();
        },
      });
      await this.db.migrationJob.update({ where: { id: job.id }, data: { status: 'VERIFYING', progress: 95 } });
      const provenanceCount = await this.db.migrationProvenance.count({ where: {
        organization_id: input.organizationId, migration_job_id: job.id, target_type: 'COMPARECIENTE',
      } });
      if (provenanceCount !== imported + skipped || provenanceCount !== job.detected_records) {
        throw new PlatformDomainError('MIGRATION_VERIFICATION_MISMATCH', 'Los conteos importados no reconcilian con la fuente.', 409);
      }
      const [assets, provenance] = await Promise.all([
        this.db.migrationAsset.findMany({ where: {
          organization_id: input.organizationId, migration_job_id: job.id,
        }, orderBy: { entry_index: 'asc' }, select: {
          source_path: true, size_bytes: true, sha256: true, mime_type: true,
          status: true, duplicate_of: true, error_code: true,
        } }),
        this.db.migrationProvenance.findMany({ where: {
          organization_id: input.organizationId, migration_job_id: job.id,
        }, orderBy: [{ source_file: 'asc' }, { source_row: 'asc' }], select: {
          source_system: true, source_record_id: true, source_file: true, source_row: true,
          target_type: true, target_id: true, imported_at: true,
        } }),
      ]);
      const manifest = {
        version: 1, migrationJobId: job.id, organizationId: input.organizationId, sourceSystem: job.source_system,
        source: { filename, sha256: session.sha256, bytes: session.declared_bytes.toString() },
        inputFiles: assets.map((asset) => ({
          path: asset.source_path, sizeBytes: asset.size_bytes.toString(), sha256: asset.sha256,
          mimeType: asset.mime_type, status: asset.status, duplicateOf: asset.duplicate_of, errorCode: asset.error_code,
        })),
        mappings: mappings.map((mapping) => ({
          entityType: mapping.entity_type, sourceField: mapping.source_field, targetField: mapping.target_field,
          status: mapping.status, approvedBy: mapping.approved_by, approvedAt: mapping.approved_at?.toISOString() || null,
        })),
        detectedRecords: job.detected_records, importedRecords: imported, idempotentSkips: skipped,
        skippedReasons: skipped ? [{ code: 'ALREADY_IMPORTED_SAME_SOURCE_IDENTITY', count: skipped }] : [],
        provenanceRecords: provenance.map((entry) => ({
          sourceSystem: entry.source_system, sourceRecordId: entry.source_record_id,
          sourceFile: entry.source_file, sourceRow: entry.source_row,
          targetType: entry.target_type, targetId: entry.target_id, importedAt: entry.imported_at.toISOString(),
        })),
        relationshipsExpected: 0, relationshipsCreated: 0,
        orphanBlobs: 0, orphanReferences: 0, byteDiscrepancy: 0,
        backupRunId: backup.id, restoreDrillId: restore.id,
        approvedBy: job.approved_by, approvedAt: job.approved_at?.toISOString() || null,
        startedAt: job.started_at?.toISOString() || null,
        verifiedAt: new Date().toISOString(), criticalErrors: 0,
      };
      const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
      const manifestHash = hash(manifestBody);
      const manifestKey = `organizations/${input.organizationId}/migrations/${job.id}/manifest-${manifestHash}.json`;
      await this.tracked.upload(manifestBody, manifestKey, 'application/json', 'PRODUCTION');
      const manifestReference = await this.tracked.linkReference({ key: manifestKey, ownerType: 'MIGRATION_JOB', ownerId: job.id });
      const verification = { manifestHash, manifestBlobId: manifestReference.blob_id, detectedRecords: job.detected_records,
        importedRecords: imported, skippedRecords: skipped, provenanceRecords: provenanceCount, backupConfirmed: true,
        cleanupPending: true };
      await this.db.migrationJob.update({ where: { id: job.id }, data: {
        status: 'VERIFYING', progress: 99,
        verification_json: verification,
      } });
      return this.finishMigrationCleanup({ organizationId: input.organizationId, jobId: job.id,
        sessionId: session.id, parts, verification });
    } catch (error) {
      const latest = await this.db.migrationJob.findUnique({ where: { id: job.id }, select: { verification_json: true } }).catch(() => null);
      const verification = latest?.verification_json && typeof latest.verification_json === 'object'
        && !Array.isArray(latest.verification_json) ? latest.verification_json as Record<string, unknown> : {};
      await this.db.migrationJob.update({ where: { id: job.id }, data: {
        status: 'FAILED', verification_json: { ...verification,
          errorCode: verification.cleanupPending === true && typeof verification.errorCode === 'string'
            ? verification.errorCode : error instanceof PlatformDomainError ? error.code : 'MIGRATION_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Fallo de ejecución', importedRecords: imported, skippedRecords: skipped },
      } }).catch(() => undefined);
      throw error;
    }
  }

  private async executePackage(input: {
    organizationId: string; migrationJobId: string; backupRunId: string;
    filename: string; jobId: string; sessionId: string;
  }) {
    const [job, session, backup] = await Promise.all([
      this.db.migrationJob.findFirstOrThrow({ where: { id: input.jobId, organization_id: input.organizationId } }),
      this.db.resumableUploadSession.findFirstOrThrow({ where: {
        id: input.sessionId, organization_id: input.organizationId, migration_job_id: input.jobId, status: 'COMPLETED',
      } }),
      this.db.backupRun.findFirstOrThrow({ where: {
        id: input.backupRunId, organization_id: input.organizationId,
        scope: `MIGRATION_SOURCE:${input.jobId}`, status: 'COMPLETED',
      } }),
    ]);
    const restore = await this.db.restoreDrill.findFirstOrThrow({ where: { backup_run_id: backup.id }, orderBy: { tested_at: 'desc' } });
    if (restore.result !== 'PASS') throw new PlatformDomainError('MIGRATION_BACKUP_GATE', 'El restore drill más reciente del origen falló.', 409);
    if (!session.sha256 || backup.checksum_sha256 !== session.sha256 || backup.bytes !== session.declared_bytes) {
      throw new PlatformDomainError('MIGRATION_BACKUP_SOURCE_MISMATCH', 'El backup no coincide con los bytes y SHA-256 de la fuente aprobada.', 409);
    }
    const parts = await this.db.resumableUploadPart.findMany({ where: { upload_session_id: session.id }, orderBy: { part_number: 'asc' } });
    const previousVerification = job.verification_json && typeof job.verification_json === 'object'
      && !Array.isArray(job.verification_json) ? job.verification_json as Record<string, unknown> : {};
    if (job.status === 'FAILED' && previousVerification.cleanupPending === true
      && typeof previousVerification.manifestBlobId === 'string') {
      return this.finishMigrationCleanup({ organizationId: input.organizationId, jobId: job.id,
        sessionId: session.id, parts, verification: previousVerification });
    }
    const inventory = await this.db.migrationAsset.findMany({ where: {
      organization_id: input.organizationId, migration_job_id: job.id,
    }, orderBy: { entry_index: 'asc' } });
    const assetByPath = new Map(inventory.map((asset) => [asset.source_path, asset]));
    await this.db.migrationJob.update({ where: { id: job.id }, data: {
      status: 'MIGRATING', progress: 82, started_at: job.started_at || new Date(),
    } });
    let imported = 0;
    let skipped = 0;
    let relationshipsCreated = 0;
    try {
      await withVerifiedSourceFile({
        provider: this.provider, parts,
        keyForPart: (part) => sessionPartKey(input.organizationId, session.id, part.part_number),
        expectedBytes: session.declared_bytes, expectedChecksum: session.sha256!,
        inspect: async (sourceFile) => {
          const migrationPackage = parseMigrationPackage(
            await readZipEntryBuffer(sourceFile, 'pravia-migration.json'),
            inventory.map((asset) => ({ sourcePath: asset.source_path, size: Number(asset.size_bytes), sha256: asset.sha256!, mimeType: asset.mime_type! })),
          );
          for (const record of migrationPackage.records) {
            const existing = await this.db.migrationProvenance.findUnique({ where: {
              organization_id_migration_job_id_source_system_source_record_id_target_type: {
                organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
                source_record_id: record.sourceRecordId, target_type: 'COMPARECIENTE',
              },
            } });
            if (existing) { skipped += 1; continue; }
            const comparecienteId = crypto.randomUUID();
            await this.db.$transaction(async (tx) => {
              await tx.compareciente.create({ data: {
                id: comparecienteId, organization_id: input.organizationId, tipo_persona: 'FISICA',
                nombre_busqueda: [record.data.nombre, record.data.apellido].filter(Boolean).join(' '), creado_por_id: job.created_by,
              } });
              await tx.personaFisica.create({ data: {
                organization_id: input.organizationId, compareciente_id: comparecienteId,
                nombre: record.data.nombre, apellido_paterno: record.data.apellido || null,
                nombre_completo_calculado: [record.data.nombre, record.data.apellido].filter(Boolean).join(' '),
              } });
              const contacts = ([
                { value: record.data.email, type: 'CORREO' as const }, { value: record.data.telefono, type: 'TELEFONO' as const },
              ]).filter((contact) => contact.value).map((contact) => ({
                organization_id: input.organizationId, compareciente_id: comparecienteId,
                tipo: contact.type, valor: contact.value!, creado_por_id: job.created_by,
              }));
              if (contacts.length) await tx.comparecienteContacto.createMany({ data: contacts });
              await tx.migrationProvenance.create({ data: {
                organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
                source_record_id: record.sourceRecordId, source_file: 'pravia-migration.json',
                source_row: record.sourceRow,
                target_type: 'COMPARECIENTE', target_id: comparecienteId,
              } });
            });
            imported += 1;
          }

          for (const document of migrationPackage.documents) {
            const relationship = migrationPackage.relationships.find((candidate) => candidate.documentSourceRecordId === document.sourceRecordId)!;
            const owner = await this.db.migrationProvenance.findUniqueOrThrow({ where: {
              organization_id_migration_job_id_source_system_source_record_id_target_type: {
                organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
                source_record_id: relationship.targetSourceRecordId, target_type: 'COMPARECIENTE',
              },
            } });
            const existing = await this.db.migrationProvenance.findUnique({ where: {
              organization_id_migration_job_id_source_system_source_record_id_target_type: {
                organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
                source_record_id: document.sourceRecordId, target_type: 'DOCUMENTO',
              },
            } });
            const asset = assetByPath.get(document.path);
            if (!asset?.sha256 || !asset.mime_type) throw new PlatformDomainError('MIGRATION_PACKAGE_DOCUMENT_MISSING', `No existe inventario verificable para ${document.path}.`, 422);
            if (existing) {
              const existingDocument = await this.db.documento.findFirstOrThrow({ where: {
                id: existing.target_id, organization_id: input.organizationId, compareciente_id: owner.target_id,
                checksum_sha256: asset.sha256, size_bytes: Number(asset.size_bytes),
              } });
              await this.tracked.linkReference({ key: existingDocument.storage_key, ownerType: 'DOCUMENTO', ownerId: existingDocument.id });
              const existingReference = await this.db.storageBlobReference.findFirstOrThrow({ where: {
                organization_id: input.organizationId, owner_type: 'DOCUMENTO', owner_id: existingDocument.id,
              } });
              await this.db.migrationAsset.update({ where: { id: asset.id }, data: {
                final_blob_id: existingReference.blob_id, status: 'PROMOTED', scan_status: 'PASS',
              } });
              skipped += 1;
              relationshipsCreated += 1;
              continue;
            }
            const documentId = crypto.randomUUID();
            const safeName = path.basename(document.name).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180) || `${documentId}.bin`;
            const objectKey = `organizations/${input.organizationId}/migrations/${job.id}/documents/${createHash('sha256').update(document.sourceRecordId).digest('hex')}-${safeName}`;
            await withZipEntryFile({
              archiveFilename: sourceFile, entryPath: document.path, expectedSize: Number(asset.size_bytes), expectedSha256: asset.sha256,
              inspect: async (extractedFile) => {
                await this.tracked.uploadFile(extractedFile, objectKey, asset.mime_type!, 'PRODUCTION');
              },
            });
            try {
              await this.db.$transaction(async (tx) => {
                await tx.documento.create({ data: {
                  id: documentId, organization_id: input.organizationId, nombre_original: document.name,
                  nombre_interno: `migration-${job.id}-${document.sourceRecordId}-${safeName}`,
                  tipo: document.type, categoria: document.category, storage_key: objectKey,
                  mime_type: asset.mime_type!, size_bytes: Number(asset.size_bytes), checksum_sha256: asset.sha256,
                  subido_por_id: job.created_by, compareciente_id: owner.target_id, estatus: 'PENDIENTE',
                  observaciones: `Migrado desde ${job.source_system}; fuente ${document.path}.`,
                } });
                await tx.migrationProvenance.create({ data: {
                  organization_id: input.organizationId, migration_job_id: job.id, source_system: job.source_system,
                  source_record_id: document.sourceRecordId, source_file: document.path,
                  source_row: document.sourceRow,
                  target_type: 'DOCUMENTO', target_id: documentId,
                } });
                await tx.migrationAsset.update({ where: { id: asset.id }, data: {
                  final_blob_id: (await tx.storageBlobLocation.findUniqueOrThrow({ where: {
                    provider_id_object_key: { provider_id: (await tx.storageProviderRecord.findUniqueOrThrow({ where: { code: 'runtime-primary' } })).id, object_key: objectKey },
                  } })).blob_id,
                  status: 'PROMOTED', scan_status: 'PASS',
                } });
              });
              await this.tracked.linkReference({ key: objectKey, ownerType: 'DOCUMENTO', ownerId: documentId });
            } catch (error) {
              const documentExists = await this.db.documento.findUnique({ where: { storage_key: objectKey } }).catch(() => null);
              if (!documentExists) await this.tracked.delete(objectKey).catch(() => undefined);
              throw error;
            }
            imported += 1;
            relationshipsCreated += 1;
          }
        },
      });

      await this.db.migrationJob.update({ where: { id: job.id }, data: { status: 'VERIFYING', progress: 95 } });
      const [provenance, documentProvenance, mappings, verifiedInventory] = await Promise.all([
        this.db.migrationProvenance.findMany({ where: { organization_id: input.organizationId, migration_job_id: job.id },
          orderBy: [{ target_type: 'asc' }, { source_record_id: 'asc' }] }),
        this.db.migrationProvenance.findMany({ where: {
          organization_id: input.organizationId, migration_job_id: job.id, target_type: 'DOCUMENTO',
        } }),
        this.db.migrationMapping.findMany({ where: { organization_id: input.organizationId, migration_job_id: job.id } }),
        this.db.migrationAsset.findMany({ where: { organization_id: input.organizationId, migration_job_id: job.id },
          orderBy: { entry_index: 'asc' } }),
      ]);
      if (provenance.length !== job.detected_records) throw new PlatformDomainError('MIGRATION_VERIFICATION_MISMATCH', 'Los conteos del paquete no reconcilian con la fuente.', 409);
      const verifiedAssets = new Map(verifiedInventory.map((asset) => [asset.source_path, asset]));
      let orphanBlobs = 0;
      let orphanReferences = 0;
      let byteDiscrepancy = 0n;
      const verificationDirectory = await mkdtemp(path.join(os.tmpdir(), 'pravia-migration-verify-'));
      try {
        for (const entry of documentProvenance) {
          const document = await this.db.documento.findFirstOrThrow({ where: {
            id: entry.target_id, organization_id: input.organizationId, compareciente_id: { not: null },
          } });
          const asset = verifiedAssets.get(entry.source_file || '');
          const blobReference = await this.db.storageBlobReference.findFirst({ where: {
            organization_id: input.organizationId, owner_type: 'DOCUMENTO', owner_id: document.id,
          } });
          if (!blobReference) { orphanBlobs += 1; continue; }
          const [blob, location] = await Promise.all([
            this.db.storageBlob.findFirst({ where: {
              id: blobReference.blob_id, organization_id: input.organizationId,
            } }),
            this.db.storageBlobLocation.findFirst({ where: {
              blob_id: blobReference.blob_id, organization_id: input.organizationId,
              object_key: document.storage_key, status: 'AVAILABLE',
            } }),
          ]);
          if (!blob || !location || !asset || asset.final_blob_id !== blobReference.blob_id) {
            orphanReferences += 1;
            continue;
          }
          const filename = path.join(verificationDirectory, `${document.id}.bin`);
          if (this.provider.downloadFile) await this.provider.downloadFile(document.storage_key, filename);
          else await writeFile(filename, await this.provider.download(document.storage_key), { flag: 'wx', mode: 0o600 });
          const checksum = createHash('sha256');
          let storedBytes = 0n;
          for await (const chunk of createReadStream(filename)) {
            const bytes = chunk as Buffer;
            storedBytes += BigInt(bytes.byteLength);
            checksum.update(bytes);
          }
          byteDiscrepancy += storedBytes - asset.size_bytes;
          const actualHash = checksum.digest('hex');
          if (storedBytes !== blob.size_bytes || blob.size_bytes !== asset.size_bytes
            || document.size_bytes !== Number(asset.size_bytes) || document.checksum_sha256 !== asset.sha256
            || blob.sha256 !== asset.sha256 || actualHash !== asset.sha256) {
            throw new PlatformDomainError('MIGRATION_VERIFICATION_MISMATCH', `El documento ${document.id} no coincide con el origen verificado.`, 409);
          }
          await rm(filename);
        }
      } finally {
        await rm(verificationDirectory, { recursive: true, force: true });
      }
      if (orphanBlobs || orphanReferences || byteDiscrepancy) {
        throw new PlatformDomainError('MIGRATION_VERIFICATION_MISMATCH', 'El paquete conserva referencias huérfanas o diferencias de bytes.', 409);
      }
      const manifest = {
        version: 1, packageVersion: 1, migrationJobId: job.id, organizationId: input.organizationId,
        sourceSystem: job.source_system, source: { filename: input.filename, sha256: session.sha256, bytes: session.declared_bytes.toString() },
        inputFiles: verifiedInventory.map((asset) => ({ path: asset.source_path, sizeBytes: asset.size_bytes.toString(), sha256: asset.sha256,
          mimeType: asset.mime_type, status: asset.status, finalBlobId: asset.final_blob_id })),
        mappings: mappings.map((mapping) => ({ entityType: mapping.entity_type, sourceField: mapping.source_field,
          targetField: mapping.target_field, status: mapping.status, approvedBy: mapping.approved_by })),
        detectedRecords: job.detected_records, importedRecords: imported, idempotentSkips: skipped,
        documents: documentProvenance.length, logicalReferences: documentProvenance.length,
        relationshipsExpected: documentProvenance.length, relationshipsCreated,
        provenanceRecords: provenance.map((entry) => ({ sourceRecordId: entry.source_record_id, sourceFile: entry.source_file,
          sourceRow: entry.source_row, targetType: entry.target_type, targetId: entry.target_id, importedAt: entry.imported_at.toISOString() })),
        orphanBlobs, orphanReferences, byteDiscrepancy: byteDiscrepancy.toString(), criticalErrors: 0,
        backupRunId: backup.id, restoreDrillId: restore.id, approvedBy: job.approved_by,
        approvedAt: job.approved_at?.toISOString() || null, verifiedAt: new Date().toISOString(),
      };
      const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
      const manifestHash = hash(manifestBody);
      const manifestKey = `organizations/${input.organizationId}/migrations/${job.id}/manifest-${manifestHash}.json`;
      await this.tracked.upload(manifestBody, manifestKey, 'application/json', 'PRODUCTION');
      const manifestReference = await this.tracked.linkReference({ key: manifestKey, ownerType: 'MIGRATION_JOB', ownerId: job.id });
      await this.db.migrationJob.update({ where: { id: job.id }, data: {
        status: 'VERIFYING', progress: 99,
        verification_json: { manifestHash, manifestBlobId: manifestReference.blob_id, detectedRecords: job.detected_records,
          importedRecords: imported, skippedRecords: skipped, provenanceRecords: provenance.length,
          documents: documentProvenance.length, relationshipsCreated, backupConfirmed: true, cleanupPending: true },
      } });
      return this.finishMigrationCleanup({ organizationId: input.organizationId, jobId: job.id,
        sessionId: session.id, parts, verification: {
          manifestHash, manifestBlobId: manifestReference.blob_id, detectedRecords: job.detected_records,
          importedRecords: imported, skippedRecords: skipped, provenanceRecords: provenance.length,
          documents: documentProvenance.length, relationshipsCreated, backupConfirmed: true, cleanupPending: true,
        } });
    } catch (error) {
      const latest = await this.db.migrationJob.findUnique({ where: { id: job.id }, select: { verification_json: true } }).catch(() => null);
      const verification = latest?.verification_json && typeof latest.verification_json === 'object'
        && !Array.isArray(latest.verification_json) ? latest.verification_json as Record<string, unknown> : {};
      await this.db.migrationJob.update({ where: { id: job.id }, data: {
        status: 'FAILED', verification_json: { ...verification,
          errorCode: verification.cleanupPending === true && typeof verification.errorCode === 'string'
            ? verification.errorCode : error instanceof PlatformDomainError ? error.code : 'MIGRATION_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Fallo de ejecución del paquete', importedRecords: imported,
          skippedRecords: skipped, relationshipsCreated },
      } }).catch(() => undefined);
      throw error;
    }
  }

  private async finishMigrationCleanup(input: {
    organizationId: string; jobId: string; sessionId: string;
    parts: Array<{ part_number: number; provider_etag: string | null }>;
    verification: Record<string, unknown>;
  }) {
    const manifestReference = await this.db.storageBlobReference.findFirst({ where: {
      organization_id: input.organizationId, owner_type: 'MIGRATION_JOB', owner_id: input.jobId,
      blob_id: String(input.verification.manifestBlobId),
    } });
    if (!manifestReference) throw new PlatformDomainError('MIGRATION_MANIFEST_MISSING', 'El manifiesto verificado no está vinculado al job.', 409);
    const manifestLocation = await this.db.storageBlobLocation.findFirst({ where: {
      organization_id: input.organizationId, blob_id: manifestReference.blob_id, status: 'AVAILABLE',
    } });
    if (!manifestLocation || typeof input.verification.manifestHash !== 'string') {
      throw new PlatformDomainError('MIGRATION_MANIFEST_MISSING', 'El manifiesto verificado no tiene ubicación ni hash comprobable.', 409);
    }
    const manifestDigest = createHash('sha256');
    if (this.provider.downloadFile) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-migration-manifest-'));
      try {
        const filename = path.join(directory, 'manifest.json');
        await this.provider.downloadFile(manifestLocation.object_key, filename);
        for await (const chunk of createReadStream(filename)) manifestDigest.update(chunk as Buffer);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } else {
      const blob = await this.db.storageBlob.findFirstOrThrow({ where: {
        id: manifestReference.blob_id, organization_id: input.organizationId,
      } });
      if (blob.size_bytes > BUFFERED_ASSEMBLY_MAX_BYTES) {
        throw new PlatformDomainError('MIGRATION_MANIFEST_STREAM_UNAVAILABLE', 'El proveedor no permite verificar este manifiesto sin streaming.', 503);
      }
      manifestDigest.update(await this.provider.download(manifestLocation.object_key));
    }
    if (manifestDigest.digest('hex') !== input.verification.manifestHash) {
      throw new PlatformDomainError('MIGRATION_MANIFEST_HASH_MISMATCH', 'El manifiesto del job no coincide con su SHA verificado.', 409);
    }
    try {
      for (const part of input.parts) {
        await this.tracked.delete(part.provider_etag || sessionPartKey(input.organizationId, input.sessionId, part.part_number));
      }
    } catch (error) {
      await this.db.migrationJob.update({ where: { id: input.jobId }, data: {
        status: 'FAILED', verification_json: { ...input.verification, cleanupPending: true,
          errorCode: 'MIGRATION_TEMP_CLEANUP_FAILED',
          message: error instanceof Error ? error.message : 'No se pudo limpiar la fuente temporal.',
        },
      } });
      throw error;
    }
    const { errorCode: _errorCode, message: _message, ...verified } = input.verification;
    const completed = await this.db.migrationJob.update({ where: { id: input.jobId }, data: {
      status: 'COMPLETED', progress: 100, completed_at: new Date(), temporary_bytes: 0n,
      verification_json: { ...verified, cleanupPending: false },
    } });
    return serializeBigInts(completed);
  }

  async preview(organizationId: string, migrationJobId: string) {
    const job = await this.db.migrationJob.findFirstOrThrow({ where: { id: migrationJobId, organization_id: organizationId } });
    const [assets, mappings, conflicts, entitlement, usage, price] = await Promise.all([
      this.db.migrationAsset.findMany({ where: { migration_job_id: migrationJobId, organization_id: organizationId }, orderBy: { entry_index: 'asc' } }),
      this.db.migrationMapping.findMany({ where: { migration_job_id: migrationJobId, organization_id: organizationId }, orderBy: { source_field: 'asc' } }),
      this.db.migrationConflict.findMany({ where: { migration_job_id: migrationJobId, organization_id: organizationId, resolved_at: null } }),
      this.db.tenantEntitlement.findUnique({ where: { organization_id: organizationId } }),
      this.db.tenantStorageUsage.findUnique({ where: { organization_id: organizationId } }),
      this.db.migrationPricingRule.findFirst({ where: {
        active: true,
        AND: [
          { min_bytes: { lte: job.estimated_production_bytes } },
          { OR: [{ max_bytes: null }, { max_bytes: { gte: job.estimated_production_bytes } }] },
          { effective_from: { lte: new Date() } },
          { OR: [{ effective_to: null }, { effective_to: { gt: new Date() } }] },
        ],
      } }),
    ]);
    const capacityAvailable = Boolean(entitlement && usage
      && usage.production_bytes + usage.reserved_bytes + job.estimated_production_bytes <= entitlement.total_storage_capacity_bytes);
    return serializeBigInts({
      job, assets, mappings, conflicts,
      capacity: entitlement && usage ? {
        requiredBytes: job.estimated_production_bytes,
        availableBytes: entitlement.total_storage_capacity_bytes - usage.production_bytes - usage.reserved_bytes,
        sufficient: capacityAvailable,
      } : null,
      pricing: price ? { configured: price.base_price_minor !== null, rule: price } : { configured: false, rule: null },
      approvalAllowed: job.status === 'PREVIEW_READY' && mappings.length > 0
        && Boolean(job.verification_json && typeof job.verification_json === 'object'
          && !Array.isArray(job.verification_json)
          && (job.verification_json as Record<string, unknown>).executionAvailable === true)
        && mappings.every((mapping) => ['APPROVED', 'UNMAPPED'].includes(mapping.status) && mapping.entity_type !== 'UNCLASSIFIED')
        && conflicts.length === 0 && capacityAvailable,
    });
  }
}

export const migrationEngineService = new MigrationEngineService();
