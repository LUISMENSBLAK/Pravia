import { createHash, randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { canonicalUploadedDocumentMime } from './documentUploadValidation';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { functionalDestinationService } from './functionalDestination.service';
import { CatalogConfigurationError } from './configurationCatalogError';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
type InstrumentInput = {
  expediente_id?: unknown;
  numero_escritura?: unknown;
  folio_inicio?: unknown;
  folio_fin?: unknown;
  fecha_instrumento?: unknown;
  libro_tomo?: unknown;
  no_paso?: unknown;
  motivo?: unknown;
};

export class ArchivoError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const positive = (value: unknown, label: string) => {
  const source = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(source)) throw new ArchivoError(400, 'ARCHIVO_NUMBER_INVALID', `${label} debe ser un entero positivo.`);
  const parsed = BigInt(source);
  if (parsed > BigInt('9223372036854775807')) throw new ArchivoError(400, 'ARCHIVO_NUMBER_INVALID', `${label} excede el rango permitido.`);
  return parsed;
};

const dateOnly = (value: unknown) => {
  const source = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) throw new ArchivoError(400, 'ARCHIVO_DATE_INVALID', 'Selecciona una fecha de instrumento válida.');
  const date = new Date(`${source}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== source) throw new ArchivoError(400, 'ARCHIVO_DATE_INVALID', 'Selecciona una fecha de instrumento válida.');
  return date;
};

const serialized = (record: any, canReadCompliance = false) => ({
  id: record.id,
  organization_id: record.organization_id,
  expediente_id: record.expediente_id,
  clase: record.clase,
  numero_escritura: record.numero_escritura?.toString() ?? null,
  folio_inicio: record.folio_inicio.toString(),
  folio_fin: record.folio_fin.toString(),
  numero_folios: (BigInt(record.folio_fin) - BigInt(record.folio_inicio) + BigInt(1)).toString(),
  fecha_instrumento: record.fecha_instrumento.toISOString().slice(0, 10),
  libro_tomo: record.libro_tomo,
  no_paso: record.no_paso,
  motivo: record.motivo,
  created_at: record.created_at,
  updated_at: record.updated_at,
  expediente: record.expediente ? {
    id: record.expediente.id,
    numero_pravia: record.expediente.numero_pravia,
    cliente_alias: record.expediente.cliente_alias,
    abogado: record.expediente.abogado,
    acto: record.expediente.actos?.find((item: any) => item.estatus === 'ACTIVO' && !item.removed_at)?.tipo_acto?.nombre ?? record.expediente.tipo_acto?.nombre ?? null,
    vulnerable: canReadCompliance
      ? record.expediente.complianceStates?.[0]
        ? (record.expediente.complianceStates[0].currentReview?.legalRuleResults?.length ? 'Sí' : 'No')
        : 'Sin evaluar'
      : 'Restringido',
  } : null,
});

const recordInclude = {
  expediente: {
    include: {
      abogado: { select: { id: true, nombre: true, apellido: true } },
      tipo_acto: { select: { nombre: true } },
      actos: { where: { estatus: 'ACTIVO' as const, removed_at: null }, include: { tipo_acto: { select: { nombre: true } } }, orderBy: { created_at: 'asc' as const } },
      complianceStates: { orderBy: { updated_at: 'desc' as const }, take: 1, select: { currentReview: { select: { legalRuleResults: { where: { vulnerable_activity: true }, take: 1, select: { id: true } } } } } },
    },
  },
};

export function renderArchivoDocx(templateBuffer: Buffer, fields: Record<string, string | null>) {
  try {
    const template = new Docxtemplater(new PizZip(templateBuffer), {
      paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' },
      nullGetter: (part) => { throw new ArchivoError(422, 'ARCHIVO_FORMAT_FIELD_MISSING', `La plantilla requiere un dato no disponible: ${part.value}.`); },
    });
    template.render(fields);
    return template.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  } catch (error) {
    if (error instanceof ArchivoError) throw error;
    throw new ArchivoError(422, 'ARCHIVO_FORMAT_RENDER_FAILED', 'No fue posible rellenar esta plantilla. Revisa sus variables en Configuración.');
  }
}

export class ArchivoService {
  constructor(private readonly prisma: PrismaClient) {}

  async overview(actor: Actor) {
    const [records, unused, latestNumber, latestFolio, legacy] = await Promise.all([
      this.prisma.archivoRegistro.findMany({ where: { organization_id: actor.organizationId, clase: 'INSTRUMENTO', expediente: { is: { archived_at: null, ...expedienteAccessWhere(actor) } } }, include: recordInclude, orderBy: [{ numero_escritura: 'desc' }, { created_at: 'desc' }], take: 200 }),
      this.prisma.archivoRegistro.findMany({ where: { organization_id: actor.organizationId, clase: 'INUTILIZADO' }, orderBy: { folio_inicio: 'desc' }, take: 100 }),
      this.prisma.archivoRegistro.findFirst({ where: { organization_id: actor.organizationId, clase: 'INSTRUMENTO' }, orderBy: { numero_escritura: 'desc' }, select: { numero_escritura: true, libro_tomo: true } }),
      this.prisma.archivoRegistro.findFirst({ where: { organization_id: actor.organizationId }, orderBy: { folio_fin: 'desc' }, select: { folio_fin: true } }),
      this.legacyCount(this.prisma, actor),
    ]);
    return {
      records: records.map((record) => serialized(record, actor.permissions.includes('compliance.read'))),
      unused_folios: unused.map((record) => serialized(record)),
      next_numero_escritura: latestNumber?.numero_escritura === null || latestNumber?.numero_escritura === undefined ? null : (latestNumber.numero_escritura + BigInt(1)).toString(),
      next_folio: latestFolio ? (latestFolio.folio_fin + BigInt(1)).toString() : null,
      libro_tomo: latestNumber?.libro_tomo ?? null,
      libro_tomo_configured: false,
      legacy_reconciliation_required: legacy > 0,
      legacy_count: legacy,
    };
  }

  async forExpediente(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const record = await this.prisma.archivoRegistro.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId }, include: recordInclude });
    const attachments = record ? await this.prisma.expedienteDocumento.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, source_entity_type: 'ArchivoRegistro', source_entity_id: record.id, source_context: { in: ['APENDICE_ARCHIVO', 'NOTA_ARCHIVO'] }, estatus: 'ACTIVO' },
      include: { documento: { select: { id: true, nombre_original: true, mime_type: true, size_bytes: true, fecha_carga: true } } },
      orderBy: { fecha_vinculo: 'desc' },
    }) : [];
    let format: { available: boolean; name: string | null; reason: string | null } = { available: false, name: null, reason: 'No hay un formato activo de Archivo en Configuración → Plantillas y formatos.' };
    if (record) {
      try {
        const resolved = await functionalDestinationService.resolve(actor, 'ARCHIVO_NOTA');
        format = { available: true, name: resolved.artifact.nombre, reason: null };
      } catch (error) {
        if (!(error instanceof CatalogConfigurationError)) throw error;
        format.reason = error.message;
      }
    }
    return {
      record: record ? serialized(record, actor.permissions.includes('compliance.read')) : null,
      appendix: attachments.filter((item) => item.source_context === 'APENDICE_ARCHIVO').map((item) => ({ id: item.id, documento: item.documento })),
      notes: attachments.filter((item) => item.source_context === 'NOTA_ARCHIVO').map((item) => ({ id: item.id, documento: item.documento })),
      format,
      overview: await this.overview(actor),
    };
  }

  async uploadAppendix(actor: Actor, expedienteId: string, file: Express.Multer.File, context: 'APENDICE_ARCHIVO' | 'NOTA_ARCHIVO' = 'APENDICE_ARCHIVO') {
    if (!file?.buffer?.length) throw new ArchivoError(400, 'ARCHIVO_APPENDIX_FILE_REQUIRED', 'Selecciona un archivo del apéndice.');
    if (file.size > 25 * 1024 * 1024) throw new ArchivoError(413, 'ARCHIVO_APPENDIX_FILE_TOO_LARGE', 'El archivo supera 25 MB.');
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const record = await this.prisma.archivoRegistro.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, clase: 'INSTRUMENTO' }, select: { id: true } });
    if (!record) throw new ArchivoError(409, 'ARCHIVO_INSTRUMENT_REQUIRED', 'Asigna la escritura antes de agregar documentos al apéndice.');
    let mime: string;
    try { mime = canonicalUploadedDocumentMime(file); }
    catch (error) { throw new ArchivoError(400, 'ARCHIVO_APPENDIX_FILE_INVALID', error instanceof Error ? error.message : 'Archivo inválido.'); }
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160) || 'documento';
    const storageKey = `organizations/${actor.organizationId}/documentos/archivo/${record.id}/${randomUUID()}_${safeName}`;
    await uploadFile(file.buffer, storageKey, mime);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.assertExpediente(tx, actor, expedienteId);
        const current = await tx.archivoRegistro.findFirst({ where: { id: record.id, organization_id: actor.organizationId, expediente_id: expedienteId }, select: { id: true } });
        if (!current) throw new ArchivoError(409, 'ARCHIVO_INSTRUMENT_CHANGED', 'El instrumento cambió durante la carga.');
        const doc = await tx.documento.create({ data: {
          organization_id: actor.organizationId, nombre_original: file.originalname, nombre_interno: storageKey, storage_key: storageKey,
          tipo: 'OTROS', categoria: 'OTROS', mime_type: mime, size_bytes: file.buffer.length,
          checksum_sha256: createHash('sha256').update(file.buffer).digest('hex'), subido_por_id: actor.id,
          expediente_id: expedienteId, estatus: 'VIGENTE', observaciones: context === 'NOTA_ARCHIVO' ? 'Nota de Archivo revisada' : 'Apéndice de Archivo',
        } });
        const item = await tx.expedienteDocumento.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: doc.id,
          tipo_vinculo: context, creado_por_id: actor.id, estatus: 'ACTIVO', origen: 'EXPEDIENTE',
          source_entity_type: 'ArchivoRegistro', source_entity_id: record.id, source_context: context,
          source_key: `ARCHIVO:${record.id}:${context}:${doc.id}`, document_version: doc.checksum_sha256,
          provenance: { origin: 'ARCHIVO', archivo_registro_id: record.id, context, blob_copies: 1 },
        } });
        await this.audit(tx, actor, context === 'NOTA_ARCHIVO' ? 'ARCHIVO_REVIEWED_NOTE_UPLOAD' : 'ARCHIVO_APPENDIX_UPLOAD', record.id, expedienteId, { documento_id: doc.id, expediente_documento_id: item.id, mime_type: mime, size_bytes: file.buffer.length });
        return { id: item.id, documento: { id: doc.id, nombre_original: doc.nombre_original, mime_type: doc.mime_type, size_bytes: doc.size_bytes, fecha_carga: doc.fecha_carga } };
      });
      return result;
    } catch (error) {
      await deleteFile(storageKey).catch(() => undefined);
      throw this.mapDbError(error);
    }
  }

  async generateNote(actor: Actor, expedienteId: string, input: { instruction?: unknown; idempotency_key?: unknown }) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const record = await this.prisma.archivoRegistro.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, clase: 'INSTRUMENTO' }, include: recordInclude });
    if (!record?.expediente) throw new ArchivoError(409, 'ARCHIVO_INSTRUMENT_REQUIRED', 'Asigna la escritura antes de generar una nota.');
    const key = String(input.idempotency_key ?? '').trim();
    if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(key)) throw new ArchivoError(400, 'ARCHIVO_IDEMPOTENCY_KEY_INVALID', 'La clave de operación no es válida.');
    const instruction = String(input.instruction ?? '').trim().slice(0, 2000);
    const prior = await this.prisma.expedienteDocumento.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key, source_entity_type: 'ArchivoRegistro', source_entity_id: record.id, source_context: 'NOTA_ARCHIVO' }, include: { documento: true } });
    if (prior) return { id: prior.id, documento: { id: prior.documento.id, nombre_original: prior.documento.nombre_original, mime_type: prior.documento.mime_type, size_bytes: prior.documento.size_bytes, fecha_carga: prior.documento.fecha_carga }, idempotent: true };
    let resolved: Awaited<ReturnType<typeof functionalDestinationService.resolve>>;
    try { resolved = await functionalDestinationService.resolve(actor, 'ARCHIVO_NOTA'); }
    catch (error) {
      if (error instanceof CatalogConfigurationError) throw new ArchivoError(error.status, error.code, error.message);
      throw error;
    }
    if (resolved.version.content_kind !== 'FILE' || !resolved.version.storage_key || resolved.version.mime_type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      throw new ArchivoError(409, 'ARCHIVO_FORMAT_DOCX_REQUIRED', 'La nota de Archivo requiere una versión maestra DOCX activa.');
    }
    const original = await downloadFile(resolved.version.storage_key);
    if (resolved.version.checksum_sha256 && createHash('sha256').update(original).digest('hex') !== resolved.version.checksum_sha256) throw new ArchivoError(409, 'ARCHIVO_FORMAT_CHECKSUM_MISMATCH', 'La plantilla de Archivo no coincide con su versión aprobada.');
    const fields: Record<string, string | null> = {
      'archivo.numero_escritura': record.numero_escritura?.toString() ?? null,
      'archivo.folio_inicio': record.folio_inicio.toString(),
      'archivo.folio_fin': record.folio_fin.toString(),
      'archivo.numero_folios': (record.folio_fin - record.folio_inicio + BigInt(1)).toString(),
      'archivo.fecha_instrumento': new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(record.fecha_instrumento),
      'archivo.libro_tomo': record.libro_tomo,
      'archivo.no_paso': record.no_paso ? 'No pasó' : 'Pasó',
      'archivo.instruccion': instruction,
      'expediente.folio': record.expediente.numero_pravia,
    };
    const rendered = renderArchivoDocx(original, fields);
    const fileName = `nota-archivo-${record.numero_escritura}.docx`;
    const storageKey = `organizations/${actor.organizationId}/documentos/archivo/${record.id}/${randomUUID()}_${fileName}`;
    await uploadFile(rendered, storageKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertExpediente(tx, actor, expedienteId);
        const current = await tx.archivoRegistro.findFirst({ where: { id: record.id, organization_id: actor.organizationId, expediente_id: expedienteId }, select: { updated_at: true } });
        if (!current || current.updated_at.getTime() !== record.updated_at.getTime()) throw new ArchivoError(409, 'ARCHIVO_NOTE_SOURCE_CHANGED', 'El instrumento cambió durante la generación. Recarga y vuelve a revisar.');
        const existing = await tx.expedienteDocumento.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: key, source_entity_type: 'ArchivoRegistro', source_entity_id: record.id, source_context: 'NOTA_ARCHIVO' }, include: { documento: true } });
        if (existing) return { id: existing.id, documento: { id: existing.documento.id, nombre_original: existing.documento.nombre_original, mime_type: existing.documento.mime_type, size_bytes: existing.documento.size_bytes, fecha_carga: existing.documento.fecha_carga }, idempotent: true };
        const doc = await tx.documento.create({ data: { organization_id: actor.organizationId, nombre_original: fileName, nombre_interno: storageKey, storage_key: storageKey, tipo: 'OTROS', categoria: 'OTROS', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: rendered.length, checksum_sha256: createHash('sha256').update(rendered).digest('hex'), subido_por_id: actor.id, expediente_id: expedienteId, estatus: 'PENDIENTE', observaciones: 'Nota generada desde formato CFG-002; requiere revisión humana.' } });
        const item = await tx.expedienteDocumento.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: doc.id, tipo_vinculo: 'NOTA_ARCHIVO', creado_por_id: actor.id, estatus: 'ACTIVO', origen: 'EXPEDIENTE', source_entity_type: 'ArchivoRegistro', source_entity_id: record.id, source_context: 'NOTA_ARCHIVO', source_key: `ARCHIVO:${record.id}:NOTA_ARCHIVO:${doc.id}`, document_version: doc.checksum_sha256, idempotency_key: key, provenance: { origin: 'CFG-002', artifact_id: resolved.artifact.id, version_id: resolved.version.id, archive_updated_at: record.updated_at.toISOString(), fields: Object.keys(fields).filter((name) => fields[name] !== null), instruction: instruction || null, human_review_required: true } } });
        await this.audit(tx, actor, 'ARCHIVO_NOTE_GENERATED', record.id, expedienteId, { documento_id: doc.id, expediente_documento_id: item.id, artifact_id: resolved.artifact.id, version_id: resolved.version.id, human_review_required: true });
        return { id: item.id, documento: { id: doc.id, nombre_original: doc.nombre_original, mime_type: doc.mime_type, size_bytes: doc.size_bytes, fecha_carga: doc.fecha_carga }, idempotent: false };
      });
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw this.mapDbError(error); }
  }

  async downloadAppendix(actor: Actor, expedienteId: string, itemId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const item = await this.prisma.expedienteDocumento.findFirst({ where: {
      id: itemId, organization_id: actor.organizationId, expediente_id: expedienteId, source_entity_type: 'ArchivoRegistro', source_context: { in: ['APENDICE_ARCHIVO', 'NOTA_ARCHIVO'] }, estatus: 'ACTIVO',
    }, include: { documento: true } });
    if (!item || !item.source_entity_id) throw new ArchivoError(404, 'ARCHIVO_APPENDIX_NOT_FOUND', 'No encontramos el documento en este apéndice.');
    const record = await this.prisma.archivoRegistro.findFirst({ where: { id: item.source_entity_id, organization_id: actor.organizationId, expediente_id: expedienteId }, select: { id: true } });
    if (!record) throw new ArchivoError(404, 'ARCHIVO_APPENDIX_NOT_FOUND', 'No encontramos el documento en este apéndice.');
    return { file: await downloadFile(item.documento.storage_key), name: item.documento.nombre_original, mime: item.documento.mime_type };
  }

  async assign(actor: Actor, input: InstrumentInput, fixedExpedienteId?: string) {
    const expedienteId = fixedExpedienteId ?? String(input.expediente_id ?? '').trim();
    if (!expedienteId) throw new ArchivoError(400, 'ARCHIVO_EXPEDIENTE_REQUIRED', 'Selecciona el expediente.');
    const numero = positive(input.numero_escritura, 'El número de escritura');
    const inicio = positive(input.folio_inicio, 'El folio inicial');
    const fin = positive(input.folio_fin, 'El folio final');
    if (fin < inicio) throw new ArchivoError(400, 'ARCHIVO_FOLIO_RANGE_INVALID', 'El folio final no puede ser anterior al inicial.');
    const fecha = dateOnly(input.fecha_instrumento);
    const libro = String(input.libro_tomo ?? '').trim().toUpperCase().slice(0, 80) || null;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const expediente = await this.assertExpediente(tx, actor, expedienteId);
      if (await this.legacyCount(tx, actor)) throw new ArchivoError(409, 'ARCHIVO_LEGACY_RECONCILIATION_REQUIRED', 'Existen instrumentos históricos sin conciliar. Revísalos antes de asignar nuevos números.');
      if (await tx.archivoRegistro.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId } })) throw new ArchivoError(409, 'ARCHIVO_EXPEDIENTE_ALREADY_ASSIGNED', 'Este expediente ya tiene escritura asignada.');
      if (expediente.numero_escritura || expediente.folio_desde || expediente.folio_hasta || expediente.fecha_escritura) throw new ArchivoError(409, 'ARCHIVO_LEGACY_EXPEDIENTE', 'Este expediente ya tiene datos históricos de protocolo. Requiere conciliación antes de asignar.');
      const created = await tx.archivoRegistro.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, clase: 'INSTRUMENTO', numero_escritura: numero, folio_inicio: inicio, folio_fin: fin, fecha_instrumento: fecha, libro_tomo: libro, created_by_id: actor.id, updated_by_id: actor.id }, include: recordInclude });
      await this.audit(tx, actor, 'ARCHIVO_ASSIGN_INSTRUMENT', created.id, expedienteId, { numero_escritura: numero.toString(), folio_inicio: inicio.toString(), folio_fin: fin.toString(), fecha_instrumento: fecha.toISOString().slice(0, 10) });
      return serialized(created);
    }, { timeout: 15_000 }).catch((error) => { throw this.mapDbError(error); });
  }

  async update(actor: Actor, recordId: string, input: InstrumentInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor);
      const existing = await tx.archivoRegistro.findFirst({ where: { id: recordId, organization_id: actor.organizationId, clase: 'INSTRUMENTO' } });
      if (!existing?.expediente_id) throw new ArchivoError(404, 'ARCHIVO_RECORD_NOT_FOUND', 'No encontramos la escritura.');
      await this.assertExpediente(tx, actor, existing.expediente_id);
      const numero = input.numero_escritura === undefined ? existing.numero_escritura : positive(input.numero_escritura, 'El número de escritura');
      const inicio = input.folio_inicio === undefined ? existing.folio_inicio : positive(input.folio_inicio, 'El folio inicial');
      const fin = input.folio_fin === undefined ? existing.folio_fin : positive(input.folio_fin, 'El folio final');
      if (!numero || fin < inicio) throw new ArchivoError(400, 'ARCHIVO_FOLIO_RANGE_INVALID', 'Revisa el número de escritura y el rango de folios.');
      const fecha = input.fecha_instrumento === undefined ? existing.fecha_instrumento : dateOnly(input.fecha_instrumento);
      const updated = await tx.archivoRegistro.update({ where: { id: recordId }, data: { numero_escritura: numero, folio_inicio: inicio, folio_fin: fin, fecha_instrumento: fecha, libro_tomo: input.libro_tomo === undefined ? undefined : (String(input.libro_tomo).trim().toUpperCase().slice(0, 80) || null), no_paso: input.no_paso === undefined ? undefined : input.no_paso === true, updated_by_id: actor.id }, include: recordInclude });
      await this.audit(tx, actor, 'ARCHIVO_UPDATE_INSTRUMENT', updated.id, existing.expediente_id, { previous: { numero_escritura: existing.numero_escritura?.toString(), folio_inicio: existing.folio_inicio.toString(), folio_fin: existing.folio_fin.toString(), fecha_instrumento: existing.fecha_instrumento.toISOString().slice(0, 10), no_paso: existing.no_paso }, next: { numero_escritura: numero.toString(), folio_inicio: inicio.toString(), folio_fin: fin.toString(), fecha_instrumento: fecha.toISOString().slice(0, 10), no_paso: updated.no_paso } });
      return serialized(updated);
    }, { timeout: 15_000 }).catch((error) => { throw this.mapDbError(error); });
  }

  async registerUnused(actor: Actor, input: InstrumentInput) {
    const inicio = positive(input.folio_inicio, 'El folio inicial');
    const fin = positive(input.folio_fin, 'El folio final');
    if (fin < inicio) throw new ArchivoError(400, 'ARCHIVO_FOLIO_RANGE_INVALID', 'El folio final no puede ser anterior al inicial.');
    const motivo = String(input.motivo ?? '').trim().slice(0, 500);
    if (!motivo) throw new ArchivoError(400, 'ARCHIVO_REASON_REQUIRED', 'Indica el motivo de inutilización.');
    const fecha = dateOnly(input.fecha_instrumento);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor);
      if (await this.legacyCount(tx, actor)) throw new ArchivoError(409, 'ARCHIVO_LEGACY_RECONCILIATION_REQUIRED', 'Existen instrumentos históricos sin conciliar.');
      const created = await tx.archivoRegistro.create({ data: { organization_id: actor.organizationId, clase: 'INUTILIZADO', folio_inicio: inicio, folio_fin: fin, fecha_instrumento: fecha, motivo, created_by_id: actor.id, updated_by_id: actor.id } });
      await this.audit(tx, actor, 'ARCHIVO_REGISTER_UNUSED_FOLIOS', created.id, null, { folio_inicio: inicio.toString(), folio_fin: fin.toString(), motivo });
      return serialized(created);
    }, { timeout: 15_000 }).catch((error) => { throw this.mapDbError(error); });
  }

  private async legacyCount(db: Db, actor: Actor) {
    return db.expediente.count({ where: { organization_id: actor.organizationId, archivoRegistro: { is: null }, OR: [{ numero_escritura: { not: null } }, { folio_desde: { not: null } }, { folio_hasta: { not: null } }, { fecha_escritura: { not: null } }] } });
  }

  private async assertExpediente(db: Db, actor: Actor, id: string) {
    const expediente = await db.expediente.findFirst({ where: { id, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true, numero_escritura: true, folio_desde: true, folio_hasta: true, fecha_escritura: true } });
    if (!expediente) throw new ArchivoError(403, 'ARCHIVO_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return expediente;
  }

  private async lock(tx: Prisma.TransactionClient, actor: Actor) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:archivo:${actor.organizationId}`}))`);
  }

  private async audit(tx: Prisma.TransactionClient, actor: Actor, action: string, recordId: string, expedienteId: string | null, details: Record<string, unknown>) {
    const correlationId = randomUUID();
    await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ArchivoRegistro', entidad_id: recordId, detalles: details as Prisma.InputJsonValue, correlation_id: correlationId, session_id: actor.sessionId } });
    if (expedienteId) await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA', titulo: action === 'ARCHIVO_ASSIGN_INSTRUMENT' ? 'Escritura y folios asignados' : 'Registro de archivo actualizado', descripcion: action === 'ARCHIVO_ASSIGN_INSTRUMENT' ? 'Se asignó el instrumento desde Archivo.' : 'Se actualizó el instrumento desde Archivo.', metadatos: { source: 'ARCHIVO', action, archivo_registro_id: recordId }, seccion_relacionada: 'archivo', entidad_relacionada: 'ArchivoRegistro', entidad_relacionada_id: recordId, correlation_id: correlationId } });
  }

  private mapDbError(error: unknown) {
    if (error instanceof ArchivoError) return error;
    const message = String((error as any)?.message ?? '');
    if (message.includes('ARCHIVO_FOLIOS_OVERLAP')) return new ArchivoError(409, 'ARCHIVO_FOLIOS_OVERLAP', 'Ese rango de folios se empalma con otro registro.');
    if (message.includes('ARCHIVO_FOLIO_SEQUENCE_GAP')) return new ArchivoError(409, 'ARCHIVO_FOLIO_SEQUENCE_GAP', 'El cambio dejaría un hueco en la secuencia de folios.');
    if (message.includes('ARCHIVO_ESCRITURA_SEQUENCE_GAP')) return new ArchivoError(409, 'ARCHIVO_ESCRITURA_SEQUENCE_GAP', 'El número no corresponde a la secuencia de escrituras.');
    if (message.includes('ARCHIVO_DATE_SEQUENCE_INVALID')) return new ArchivoError(409, 'ARCHIVO_DATE_SEQUENCE_INVALID', 'La fecha contradice la cronología de escrituras.');
    if (message.includes('ARCHIVO_SUMMARY_READ_ONLY')) return new ArchivoError(409, 'ARCHIVO_SUMMARY_READ_ONLY', 'El resumen del expediente se actualiza exclusivamente desde Archivo.');
    if ((error as any)?.code === 'P2002') return new ArchivoError(409, 'ARCHIVO_UNIQUE_CONFLICT', 'La escritura o el expediente ya están asignados. Recarga la propuesta.');
    return error;
  }
}
