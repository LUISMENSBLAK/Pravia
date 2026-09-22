import { createHash, randomUUID } from 'crypto';
import path from 'path';
import JSZip from 'jszip';
import { ExpedienteDocumentoOrigen, Prisma, PrismaClient } from '@prisma/client';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { downloadFile, fileExists, getSignedUrl } from './supabase.service';

export type AppendixActor = {
  id: string;
  organizationId: string;
  sessionId: string;
  rol: any;
  permissions: any[];
};
type Actor = AppendixActor;
type Db = PrismaClient | Prisma.TransactionClient;

export class ExpedienteDocumentAppendixError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type CanonicalDocument = {
  id: string;
  nombre_original: string;
  tipo: string;
  categoria: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  fecha_carga: Date;
  estatus: string;
  checksum_sha256?: string | null;
};

type Candidate = {
  sourceKey: string;
  origin: ExpedienteDocumentoOrigen;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceContext: string;
  sourceName: string;
  document: CanonicalDocument | null;
  documentVersion: string;
  incorporatedAt: Date;
  provenance: Record<string, unknown>;
  expedienteDocumentoId?: string | null;
  folderId?: string | null;
  visualName?: string | null;
  legacyName?: string;
  legacyType?: string;
  legacyStorageKey?: string | null;
};

const frozenStatuses = new Set(['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO']);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const versionOf = (document: CanonicalDocument) => document.checksum_sha256 || digest([
  document.id, document.storage_key, document.size_bytes, document.fecha_carga.toISOString(), document.mime_type,
]);
const sourceKey = (origin: ExpedienteDocumentoOrigen, entityType: string, entityId: string, documentId: string, context: string) =>
  `${origin}:${entityType}:${entityId}:${documentId}:${context}`.slice(0, 320);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const notaryQuote = (document: CanonicalDocument, linkType = '') =>
  /PRESUPUESTO[_\s-]*NOTARIA|COTIZACI[ÓO]N[_\s-]*NOTARIA|NOTARIA[_\s-]*QUOTE/i.test(`${document.tipo} ${linkType}`);
const snapshotFolderId = (folderPath: string) => `snapshot-${digest(folderPath).slice(0, 32)}`;

const snapshotFolders = (items: Array<{ folder_path_snapshot?: string | null }>) => {
  const folders = new Map<string, { id: string; parent_id: string | null; nombre: string; orden: number; path: string }>();
  for (const item of items) {
    const segments = (item.folder_path_snapshot || '').split('/').map((segment) => segment.trim()).filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const currentPath = segments.slice(0, index + 1).join('/');
      const parentPath = index ? segments.slice(0, index).join('/') : null;
      if (!folders.has(currentPath)) folders.set(currentPath, {
        id: snapshotFolderId(currentPath),
        parent_id: parentPath ? snapshotFolderId(parentPath) : null,
        nombre: segments[index],
        orden: folders.size,
        path: currentPath,
      });
    }
  }
  return [...folders.values()];
};

const documentSelect = {
  id: true, nombre_original: true, tipo: true, categoria: true, storage_key: true,
  mime_type: true, size_bytes: true, fecha_carga: true, estatus: true, checksum_sha256: true,
} as const;

export class ExpedienteDocumentAppendixService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const snapshot = await this.prisma.expedienteDocumentoSnapshot.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId },
      include: { items: { orderBy: [{ origen: 'asc' }, { nombre_snapshot: 'asc' }] } },
    });
    if (snapshot) return this.snapshotResponse(snapshot);
    const candidates = await this.buildCandidates(this.prisma, actor, expedienteId);
    return this.liveResponse(candidates, actor, expedienteId);
  }

  async importCurrent(actor: Actor, expedienteId: string, origin: 'COMPARECIENTE' | 'PREDIO') {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp004-import:${expedienteId}:${origin}`}))`);
      const expediente = await this.assertExpediente(tx, actor, expedienteId);
      if (frozenStatuses.has(expediente.estatus)) throw new ExpedienteDocumentAppendixError(409, 'EXP004_APPENDIX_FROZEN', 'El apéndice quedó congelado al firmar y ya no admite importaciones.');
      const sources = await this.discoverCurrentSources(tx, actor, expedienteId, origin);
      let created = 0; let updated = 0; let unchanged = 0;
      for (const source of sources) {
        if (!source.document) continue;
        const existing = await tx.expedienteDocumento.findFirst({ where: {
          organization_id: actor.organizationId, expediente_id: expedienteId, source_key: source.sourceKey,
        } });
        if (!existing) {
          await tx.expedienteDocumento.create({ data: {
            organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: source.document.id,
            tipo_vinculo: `IMPORT_${origin}_${source.sourceEntityId}`.slice(0, 180), creado_por_id: actor.id,
            origen: origin, source_entity_type: source.sourceEntityType, source_entity_id: source.sourceEntityId,
            source_context: source.sourceContext, source_key: source.sourceKey, document_version: source.documentVersion,
            provenance: json(source.provenance),
          } });
          created += 1;
          continue;
        }
        if (existing.documento_id !== source.document.id || existing.document_version !== source.documentVersion || existing.estatus !== 'ACTIVO') {
          await tx.expedienteDocumento.update({ where: { id: existing.id }, data: {
            documento_id: source.document.id, document_version: source.documentVersion, source_context: source.sourceContext,
            provenance: json({ ...source.provenance, previous_document_id: existing.documento_id, source_changed: existing.documento_id !== source.document.id }),
            estatus: 'ACTIVO', inactivado_at: null, inactivado_por_id: null, motivo_inactivacion: null,
          } });
          updated += 1;
        } else unchanged += 1;
      }
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: `IMPORT_EXPEDIENT_${origin}_DOCUMENTS`, entidad: 'Expediente', entidad_id: expedienteId,
        valores_nuevos: json({ origin, new: created, updated, unchanged, duplicates_created: 0, historical_imported: 0, blob_copies: 0 }),
        correlation_id: randomUUID(), session_id: actor.sessionId,
      } });
      const candidates = await this.buildCandidates(tx, actor, expedienteId);
      return { ...(await this.liveResponse(candidates, actor, expedienteId, tx)), import: { origin, new: created, updated, unchanged, duplicates_created: 0, historical_imported: 0, blob_copies: 0 } };
    }, { timeout: 20_000 });
  }

  async createFolder(actor: Actor, expedienteId: string, name: string, parentId?: string | null) {
    const clean = name.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 180);
    if (!clean) throw new ExpedienteDocumentAppendixError(400, 'EXP004_FOLDER_NAME_REQUIRED', 'Escribe un nombre para la carpeta.');
    return this.prisma.$transaction(async (tx) => {
      const expediente = await this.assertMutable(tx, actor, expedienteId);
      if (parentId) await this.assertFolder(tx, actor, expedienteId, parentId);
      const folder = await tx.expedienteDocumentoCarpeta.create({ data: { organization_id: actor.organizationId, expediente_id: expediente.id, parent_id: parentId || null, nombre: clean, created_by_id: actor.id } });
      await this.audit(tx, actor, expedienteId, 'CREATE_EXPEDIENT_DOCUMENT_FOLDER', folder.id, { name: clean, parent_id: parentId || null });
      return folder;
    });
  }

  async renameFolder(actor: Actor, expedienteId: string, folderId: string, name: string) {
    const clean = name.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 180);
    if (!clean) throw new ExpedienteDocumentAppendixError(400, 'EXP004_FOLDER_NAME_REQUIRED', 'Escribe un nombre para la carpeta.');
    return this.prisma.$transaction(async (tx) => {
      await this.assertMutable(tx, actor, expedienteId); await this.assertFolder(tx, actor, expedienteId, folderId);
      const folder = await tx.expedienteDocumentoCarpeta.update({ where: { id: folderId }, data: { nombre: clean } });
      await this.audit(tx, actor, expedienteId, 'RENAME_EXPEDIENT_DOCUMENT_FOLDER', folderId, { name: clean });
      return folder;
    });
  }

  async archiveFolder(actor: Actor, expedienteId: string, folderId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertMutable(tx, actor, expedienteId);
      const folder = await this.assertFolder(tx, actor, expedienteId, folderId);
      const [childCount, documentCount] = await Promise.all([
        tx.expedienteDocumentoCarpeta.count({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, parent_id: folderId, archived_at: null } }),
        tx.expedienteDocumento.count({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, carpeta_id: folderId, estatus: 'ACTIVO' } }),
      ]);
      if (childCount || documentCount) throw new ExpedienteDocumentAppendixError(409, 'EXP004_FOLDER_NOT_EMPTY', 'La carpeta debe estar vacía antes de eliminarla.');
      await tx.expedienteDocumentoCarpeta.update({ where: { id: folder.id }, data: { archived_at: new Date() } });
      await this.audit(tx, actor, expedienteId, 'ARCHIVE_EXPEDIENT_DOCUMENT_FOLDER', folder.id, { name: folder.nombre, soft_delete: true });
      return { id: folder.id, archived: true };
    });
  }

  async move(actor: Actor, expedienteId: string, input: { document_ids?: string[]; folder_ids?: string[]; target_folder_id?: string | null }) {
    const documentIds = [...new Set(input.document_ids || [])]; const folderIds = [...new Set(input.folder_ids || [])];
    if (!documentIds.length && !folderIds.length) throw new ExpedienteDocumentAppendixError(400, 'EXP004_MOVE_SELECTION_REQUIRED', 'Selecciona archivos o carpetas para mover.');
    return this.prisma.$transaction(async (tx) => {
      await this.assertMutable(tx, actor, expedienteId);
      if (input.target_folder_id) await this.assertFolder(tx, actor, expedienteId, input.target_folder_id);
      if (documentIds.length) {
        const count = await tx.expedienteDocumento.count({ where: { id: { in: documentIds }, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' } });
        if (count !== documentIds.length) throw new ExpedienteDocumentAppendixError(403, 'EXP004_MOVE_DOCUMENT_ACCESS_DENIED', 'La selección contiene archivos fuera del expediente.');
        await tx.expedienteDocumento.updateMany({ where: { id: { in: documentIds } }, data: { carpeta_id: input.target_folder_id || null, moved_at: new Date(), moved_by_id: actor.id } });
      }
      for (const folderId of folderIds) {
        await this.assertFolder(tx, actor, expedienteId, folderId);
        if (folderId === input.target_folder_id || await this.isDescendant(tx, folderId, input.target_folder_id || null)) throw new ExpedienteDocumentAppendixError(409, 'EXP004_FOLDER_CYCLE', 'Una carpeta no puede moverse dentro de sí misma ni de una descendiente.');
        await tx.expedienteDocumentoCarpeta.update({ where: { id: folderId }, data: { parent_id: input.target_folder_id || null } });
      }
      await this.audit(tx, actor, expedienteId, 'MOVE_EXPEDIENT_DOCUMENT_ITEMS', expedienteId, { document_ids: documentIds, folder_ids: folderIds, target_folder_id: input.target_folder_id || null });
      return { moved_documents: documentIds.length, moved_folders: folderIds.length };
    });
  }

  async sync(actor: Actor, expedienteId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp004-sync:${expedienteId}`}))`);
      const expediente = await this.assertExpediente(tx, actor, expedienteId);
      if (frozenStatuses.has(expediente.estatus)) {
        throw new ExpedienteDocumentAppendixError(409, 'EXP004_APPENDIX_FROZEN', 'El apéndice quedó congelado al firmar y ya no se sincroniza con los maestros.');
      }
      const candidates = await this.buildCandidates(tx, actor, expedienteId);
      const activeKeys: string[] = [];
      let created = 0; let reactivated = 0; let inactivated = 0;
      for (const candidate of candidates) {
        if (!candidate.document) continue;
        activeKeys.push(candidate.sourceKey);
        let existing = await tx.expedienteDocumento.findFirst({
          where: { organization_id: actor.organizationId, expediente_id: expedienteId, source_key: candidate.sourceKey },
        });
        if (!existing) {
          const deterministicLegacy = await tx.expedienteDocumento.findFirst({ where: {
            organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: candidate.document.id,
            OR: [
              { origen: 'EXPEDIENTE', source_context: 'LEGACY_EXISTING_LINK' },
              { origen: { not: 'EXPEDIENTE' } },
            ],
          } });
          if (deterministicLegacy) existing = await tx.expedienteDocumento.update({ where: { id: deterministicLegacy.id }, data: {
            origen: candidate.origin, source_entity_type: candidate.sourceEntityType, source_entity_id: candidate.sourceEntityId,
            source_context: candidate.sourceContext, source_key: candidate.sourceKey, document_version: candidate.documentVersion,
            provenance: json(candidate.provenance),
          } });
        }
        if (!existing) {
          const link = await tx.expedienteDocumento.create({ data: {
            organization_id: actor.organizationId,
            expediente_id: expedienteId,
            documento_id: candidate.document.id,
            tipo_vinculo: candidate.sourceContext,
            creado_por_id: actor.id,
            origen: candidate.origin,
            source_entity_type: candidate.sourceEntityType,
            source_entity_id: candidate.sourceEntityId,
            source_context: candidate.sourceContext,
            source_key: candidate.sourceKey,
            document_version: candidate.documentVersion,
            provenance: json(candidate.provenance),
          } });
          candidate.expedienteDocumentoId = link.id;
          created += 1;
        } else {
          candidate.expedienteDocumentoId = existing.id;
          if (existing.estatus !== 'ACTIVO') {
            await tx.expedienteDocumento.update({ where: { id: existing.id }, data: {
              estatus: 'ACTIVO', inactivado_at: null, inactivado_por_id: null, motivo_inactivacion: null,
              document_version: candidate.documentVersion,
            } });
            reactivated += 1;
          }
        }
      }
      const obsolete = await tx.expedienteDocumento.findMany({ where: {
        organization_id: actor.organizationId,
        expediente_id: expedienteId,
        estatus: 'ACTIVO',
        origen: { not: 'EXPEDIENTE' },
        ...(activeKeys.length ? { source_key: { notIn: activeKeys } } : {}),
      }, select: { id: true } });
      if (obsolete.length) {
        const result = await tx.expedienteDocumento.updateMany({
          where: { id: { in: obsolete.map((item) => item.id) } },
          data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: 'SOURCE_NO_LONGER_CURRENT' },
        });
        inactivated = result.count;
      }
      const revision = this.revision(candidates);
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'SYNC_EXPEDIENT_DOCUMENT_APPENDIX',
        entidad: 'Expediente', entidad_id: expedienteId,
        valores_nuevos: json({ revision, created, reactivated, inactivated, candidate_count: candidates.length, blob_copies: 0 }),
        correlation_id: randomUUID(), session_id: actor.sessionId,
      } });
      return { ...(await this.liveResponse(candidates, actor, expedienteId, tx)), sync: { created, reactivated, inactivated, blob_copies: 0 } };
    }, { timeout: 20_000 });
  }

  async freeze(
    tx: Prisma.TransactionClient,
    actor: Actor,
    expedienteId: string,
    expectedRevision: string,
    correlationId: string,
    expedienteVersion: number,
  ) {
    const existing = await tx.expedienteDocumentoSnapshot.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId }, select: { id: true, document_revision: true },
    });
    if (existing) return { ...existing, idempotent: true };
    const candidates = await this.buildCandidates(tx, actor, expedienteId);
    const actualRevision = this.revision(candidates);
    if (!expectedRevision) {
      throw new ExpedienteDocumentAppendixError(409, 'EXP004_DOCUMENT_REVISION_REQUIRED', 'Revisa el apéndice documental antes de confirmar la firma.');
    }
    if (expectedRevision !== actualRevision) {
      throw new ExpedienteDocumentAppendixError(409, 'EXP004_DOCUMENT_REVISION_STALE', 'La documentación cambió desde la última revisión. Vuelve a revisar el apéndice antes de firmar.');
    }
    const fileAvailability = await Promise.all(candidates.map(async (candidate) => (
      candidate.document?.storage_key
        ? fileExists(candidate.document.storage_key).catch(() => false)
        : false
    )));
    const activeLinks = await tx.expedienteDocumento.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' },
      select: { id: true, source_key: true, carpeta_id: true },
    });
    const linkByKey = new Map(activeLinks.map((item) => [item.source_key, item.id]));
    const folderPaths = await this.folderPaths(tx, actor, expedienteId);
    const linkFolders = new Map(activeLinks.map((item) => [item.source_key, item.carpeta_id ? folderPaths.get(item.carpeta_id) || null : null]));
    const snapshot = await tx.expedienteDocumentoSnapshot.create({ data: {
      organization_id: actor.organizationId,
      expediente_id: expedienteId,
      expediente_version: expedienteVersion,
      document_revision: actualRevision,
      frozen_by_id: actor.id,
      correlation_id: correlationId,
      metadata: json({ candidate_count: candidates.length, blob_copies: 0, source_of_truth: 'Documento+context-links' }),
      items: { create: candidates.map((candidate, index) => ({
        organization_id: actor.organizationId,
        expediente_documento_id: candidate.expedienteDocumentoId || linkByKey.get(candidate.sourceKey) || null,
        documento_id: candidate.document?.id || null,
        source_key: candidate.sourceKey,
        origen: candidate.origin,
        source_entity_type: candidate.sourceEntityType,
        source_entity_id: candidate.sourceEntityId,
        source_context: candidate.sourceContext,
        document_version: candidate.documentVersion,
        nombre_snapshot: candidate.visualName || candidate.document?.nombre_original || candidate.legacyName || 'Registro documental',
        tipo_snapshot: candidate.document?.tipo || candidate.legacyType || 'DOCUMENTO',
        categoria_snapshot: candidate.document?.categoria || null,
        estado_snapshot: candidate.document?.estatus || 'REGISTRO_EXISTENTE_ARCHIVO_NO_DISPONIBLE',
        mime_type_snapshot: candidate.document?.mime_type || null,
        size_bytes_snapshot: candidate.document?.size_bytes || null,
        storage_key_snapshot: candidate.document?.storage_key || candidate.legacyStorageKey || null,
        checksum_sha256_snapshot: candidate.document?.checksum_sha256 || null,
        file_availability_snapshot: fileAvailability[index] ? 'DISPONIBLE' : 'NO_DISPONIBLE',
        incorporated_at_snapshot: candidate.incorporatedAt,
        provenance_snapshot: json(candidate.provenance),
        folder_path_snapshot: candidate.expedienteDocumentoId ? (candidate.folderId ? folderPaths.get(candidate.folderId) || null : null) : linkFolders.get(candidate.sourceKey) || null,
        metadata_snapshot: json({ source_name: candidate.sourceName, canonical_blob_reused: Boolean(candidate.document), blob_copied: false }),
      })) },
    }, include: { items: true } });
    await tx.auditLog.create({ data: {
      organization_id: actor.organizationId, user_id: actor.id, accion: 'FREEZE_EXPEDIENT_DOCUMENT_SNAPSHOT',
      entidad: 'ExpedienteDocumentoSnapshot', entidad_id: snapshot.id,
      valores_nuevos: json({ expediente_id: expedienteId, revision: actualRevision, item_count: snapshot.items.length, blob_copies: 0 }),
      correlation_id: correlationId, session_id: actor.sessionId,
    } });
    return { id: snapshot.id, document_revision: snapshot.document_revision, idempotent: false };
  }

  async signedUrl(actor: Actor, expedienteId: string, itemId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const snapshot = await this.prisma.expedienteDocumentoSnapshot.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId }, select: { id: true },
    });
    let storageKey = ''; let fileName = ''; let mimeType = '';
    if (snapshot) {
      const item = await this.prisma.expedienteDocumentoSnapshotItem.findFirst({
        where: { id: itemId, organization_id: actor.organizationId, snapshot_id: snapshot.id },
        select: { storage_key_snapshot: true, nombre_snapshot: true, mime_type_snapshot: true, documento_id: true },
      });
      if (!item) throw new ExpedienteDocumentAppendixError(403, 'EXP004_SNAPSHOT_ITEM_ACCESS_DENIED', 'No tienes acceso a este elemento del snapshot.');
      storageKey = item.storage_key_snapshot || ''; fileName = item.nombre_snapshot; mimeType = item.mime_type_snapshot || 'application/octet-stream';
    } else {
      const item = await this.resolveLiveFile(actor, expedienteId, itemId);
      storageKey = item.storageKey; fileName = item.fileName; mimeType = item.mimeType;
    }
    if (!storageKey || !(await fileExists(storageKey))) {
      throw new ExpedienteDocumentAppendixError(404, 'EXP004_FILE_UNAVAILABLE', 'El registro existe, pero el archivo no está disponible.');
    }
    return { url: await getSignedUrl(storageKey, 600), expires_in: 600, file_name: fileName, mime_type: mimeType };
  }

  async file(actor: Actor, expedienteId: string, itemId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const snapshot = await this.prisma.expedienteDocumentoSnapshot.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId } });
    const item = snapshot
      ? await this.prisma.expedienteDocumentoSnapshotItem.findFirst({ where: { id: itemId, organization_id: actor.organizationId, snapshot_id: snapshot.id }, select: { storage_key_snapshot: true, nombre_snapshot: true, mime_type_snapshot: true } })
      : null;
    if (snapshot && !item) throw new ExpedienteDocumentAppendixError(403, 'EXP004_DOCUMENT_ACCESS_DENIED', 'No tienes acceso a este documento del expediente.');
    const liveItem = snapshot ? null : await this.resolveLiveFile(actor, expedienteId, itemId);
    const storageKey = liveItem?.storageKey || item?.storage_key_snapshot;
    const name = liveItem?.fileName || item?.nombre_snapshot || 'documento';
    const mime = liveItem?.mimeType || item?.mime_type_snapshot || 'application/octet-stream';
    if (!storageKey || !(await fileExists(storageKey))) throw new ExpedienteDocumentAppendixError(404, 'EXP004_FILE_UNAVAILABLE', 'El registro existe, pero el archivo no está disponible.');
    return { buffer: await downloadFile(storageKey), name, mime };
  }

  async archive(actor: Actor, expedienteId: string, input: { folder_id?: string | null; folder_ids?: string[]; item_ids?: string[] }) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const snapshot = await this.prisma.expedienteDocumentoSnapshot.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId }, include: { items: true } });
    const requested = new Set(input.item_ids || []);
    const requestedFolders = new Set(input.folder_ids || []);
    const zip = new JSZip(); const used = new Map<string, number>();
    let files: Array<{ id: string; name: string; storage: string | null; folder: string | null }> = [];
    if (snapshot) {
      files = snapshot.items.map((item) => ({ id: item.id, name: item.nombre_snapshot, storage: item.storage_key_snapshot, folder: item.folder_path_snapshot }));
      const folders = snapshotFolders(snapshot.items);
      const paths = new Map(folders.map((folder) => [folder.id, folder.path]));
      const targetPath = input.folder_id ? paths.get(input.folder_id) : null;
      if (input.folder_id && !targetPath) throw new ExpedienteDocumentAppendixError(404, 'EXP004_FOLDER_NOT_FOUND', 'La carpeta congelada ya no existe.');
      const selectedFolderPaths = [...requestedFolders].map((id) => paths.get(id)).filter((value): value is string => Boolean(value));
      if (selectedFolderPaths.length !== requestedFolders.size) throw new ExpedienteDocumentAppendixError(404, 'EXP004_FOLDER_NOT_FOUND', 'La selección contiene una carpeta congelada inexistente.');
      if (targetPath) files = files.filter((item) => item.folder === targetPath || item.folder?.startsWith(`${targetPath}/`));
      if (requested.size || requestedFolders.size) files = files.filter((item) => requested.has(item.id) || selectedFolderPaths.some((folderPath) => item.folder === folderPath || item.folder?.startsWith(`${folderPath}/`)));
    } else {
      const paths = await this.folderPaths(this.prisma, actor, expedienteId);
      const candidates = await this.buildCandidates(this.prisma, actor, expedienteId);
      const targetPath = input.folder_id ? paths.get(input.folder_id) : null;
      if (input.folder_id && !targetPath) throw new ExpedienteDocumentAppendixError(404, 'EXP004_FOLDER_NOT_FOUND', 'La carpeta ya no existe.');
      const selectedFolderPaths = [...requestedFolders].map((id) => paths.get(id)).filter((value): value is string => Boolean(value));
      if (selectedFolderPaths.length !== requestedFolders.size) throw new ExpedienteDocumentAppendixError(404, 'EXP004_FOLDER_NOT_FOUND', 'La selección contiene una carpeta que ya no existe.');
      files = candidates
        .map((candidate) => ({
          id: candidate.expedienteDocumentoId || candidate.sourceKey,
          name: candidate.visualName || candidate.document?.nombre_original || candidate.legacyName || 'Registro documental',
          storage: candidate.document?.storage_key || candidate.legacyStorageKey || null,
          folder: candidate.folderId ? paths.get(candidate.folderId) || null : null,
        }))
        .filter((item) => !targetPath || (item.folder && (item.folder === targetPath || item.folder.startsWith(`${targetPath}/`))));
      if (requested.size || requestedFolders.size) files = files.filter((item) => requested.has(item.id) || selectedFolderPaths.some((folderPath) => item.folder === folderPath || item.folder?.startsWith(`${folderPath}/`)));
    }
    if (!files.length) throw new ExpedienteDocumentAppendixError(400, 'EXP004_ARCHIVE_EMPTY', 'La selección no contiene archivos descargables.');
    for (const file of files) {
      if (!file.storage || !(await fileExists(file.storage))) throw new ExpedienteDocumentAppendixError(409, 'EXP004_ARCHIVE_FILE_UNAVAILABLE', `El archivo ${file.name} no está disponible.`);
      const safeFolder = (file.folder || 'Sin carpeta').split('/').map(this.safeName).join('/');
      const original = this.safeName(path.basename(file.name || `documento-${file.id}`));
      const logical = `${safeFolder}/${original}`;
      const count = (used.get(logical) || 0) + 1; used.set(logical, count);
      const extension = path.extname(original); const base = path.basename(original, extension);
      const unique = count === 1 ? logical : `${safeFolder}/${base} (${count})${extension}`;
      zip.file(unique, await downloadFile(file.storage));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await this.prisma.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'DOWNLOAD_EXPEDIENT_DOCUMENT_ZIP', entidad: 'Expediente', entidad_id: expedienteId, valores_nuevos: json({ count: files.length, folder_id: input.folder_id || null, selected_files: requested.size, selected_folders: requestedFolders.size }), correlation_id: randomUUID(), session_id: actor.sessionId } });
    return { buffer, name: input.folder_id ? 'carpeta-documental.zip' : requested.size || requestedFolders.size ? 'seleccion-documental.zip' : 'expediente-documental.zip' };
  }

  private async discoverCurrentSources(db: Db, actor: Actor, expedienteId: string, origin: 'COMPARECIENTE' | 'PREDIO'): Promise<Candidate[]> {
    if (origin === 'COMPARECIENTE') {
      const relations = await db.expedienteCompareciente.findMany({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId, archived_at: null, estatus: 'ACTIVO' },
        select: {
          compareciente_id: true,
          compareciente: {
            select: {
              nombre_busqueda: true,
              documentos: {
                where: { archived_at: null, estatus: 'ACTIVO', vigencia: 'VIGENTE', documento: { estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } } },
                select: { id: true, categoria: true, subcategoria: true, documento: { select: documentSelect } },
              },
            },
          },
        },
      });
      return relations.flatMap((relation) => relation.compareciente.documentos.map((link) => ({
        sourceKey: `IMPORT:COMPARECIENTE:${link.id}`, origin, sourceEntityType: 'COMPARECIENTE', sourceEntityId: relation.compareciente_id,
        sourceContext: link.subcategoria || link.categoria, sourceName: relation.compareciente.nombre_busqueda, document: link.documento,
        documentVersion: versionOf(link.documento), incorporatedAt: link.documento.fecha_carga,
        provenance: { origin, source_link_id: link.id, source_name: relation.compareciente.nombre_busqueda, current_only: true, explicit_import: true },
      })));
    }
    const relations = await db.expedientePredio.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' },
      select: {
        predio_id: true,
        predio: {
          select: {
            apodo: true, ubicacion_texto: true, clave_catastral: true, folio_real: true,
            documentos: {
              where: { estatus: 'ACTIVO', vigencia: 'VIGENTE', documento: { estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } } },
              select: { id: true, tipo_vinculo: true, documento: { select: documentSelect } },
            },
          },
        },
      },
    });
    return relations.flatMap((relation) => {
      const name = relation.predio.apodo || relation.predio.ubicacion_texto || relation.predio.clave_catastral || relation.predio.folio_real || 'Inmueble';
      return relation.predio.documentos.map((link) => ({
        sourceKey: `IMPORT:PREDIO:${link.id}`, origin, sourceEntityType: 'PREDIO', sourceEntityId: relation.predio_id,
        sourceContext: link.tipo_vinculo, sourceName: name, document: link.documento, documentVersion: versionOf(link.documento), incorporatedAt: link.documento.fecha_carga,
        provenance: { origin, source_link_id: link.id, source_name: name, current_only: true, explicit_import: true },
      }));
    });
  }

  private async assertMutable(db: Db, actor: Actor, expedienteId: string) {
    const expediente = await this.assertExpediente(db, actor, expedienteId);
    if (frozenStatuses.has(expediente.estatus)) throw new ExpedienteDocumentAppendixError(409, 'EXP004_APPENDIX_FROZEN', 'El apéndice quedó congelado al firmar.');
    return expediente;
  }

  private async assertFolder(db: Db, actor: Actor, expedienteId: string, folderId: string) {
    const folder = await db.expedienteDocumentoCarpeta.findFirst({ where: { id: folderId, organization_id: actor.organizationId, expediente_id: expedienteId, archived_at: null } });
    if (!folder) throw new ExpedienteDocumentAppendixError(403, 'EXP004_FOLDER_ACCESS_DENIED', 'La carpeta no pertenece al expediente activo.');
    return folder;
  }

  private async isDescendant(db: Db, folderId: string, targetId: string | null) {
    let cursor = targetId;
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      if (cursor === folderId) return true;
      cursor = (await db.expedienteDocumentoCarpeta.findUnique({ where: { id: cursor }, select: { parent_id: true } }))?.parent_id || null;
    }
    return false;
  }

  private async folderPaths(db: Db, actor: Actor, expedienteId: string) {
    const folders = await db.expedienteDocumentoCarpeta.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, archived_at: null }, select: { id: true, parent_id: true, nombre: true } });
    const byId = new Map(folders.map((folder) => [folder.id, folder])); const result = new Map<string, string>();
    const resolve = (id: string, seen = new Set<string>()): string => {
      if (result.has(id)) return result.get(id)!; if (seen.has(id)) return 'Carpeta inválida'; seen.add(id);
      const folder = byId.get(id); if (!folder) return '';
      const parent = folder.parent_id ? resolve(folder.parent_id, seen) : '';
      const value = parent ? `${parent}/${folder.nombre}` : folder.nombre; result.set(id, value); return value;
    };
    for (const folder of folders) resolve(folder.id);
    return result;
  }

  private async audit(db: Db, actor: Actor, expedienteId: string, action: string, entityId: string, values: Record<string, unknown>) {
    await db.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ExpedienteDocumento', entidad_id: entityId, valores_nuevos: json({ expediente_id: expedienteId, ...values }), correlation_id: randomUUID(), session_id: actor.sessionId } });
  }

  private safeName(value: string) { return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\.\./g, '-').trim() || 'sin-nombre'; }

  private async assertExpediente(db: Db, actor: Actor, expedienteId: string) {
    const expediente = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor as any) },
      select: { id: true, estatus: true, version: true },
    });
    if (!expediente) throw new ExpedienteDocumentAppendixError(403, 'EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return expediente;
  }

  private async buildCandidates(db: Db, actor: Actor, expedienteId: string): Promise<Candidate[]> {
    const expediente = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor as any) },
      select: {
        id: true, cotizacion_id: true,
        cotizacion: { select: { id: true, prospecto_id: true } },
        calculosISR: { where: { archived_at: null }, select: { id: true, folio: true, documentos: { where: { estatus: 'ACTIVO' }, select: { documento: { select: documentSelect } } } } },
        movimientosFinancieros: { where: { estatus: { notIn: ['CANCELADO', 'REVERTIDO'] } }, select: {
          id: true, folio: true, fecha_movimiento: true, comprobante_url: true, factura_url: true,
          movimientoDocumentos: { where: { estatus: 'ACTIVO' }, select: { tipo_vinculo: true, documento: { select: documentSelect } } },
        } },
      },
    });
    if (!expediente) throw new ExpedienteDocumentAppendixError(403, 'EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    const candidates = new Map<string, Candidate>();
    const add = (candidate: Candidate) => { if (!candidates.has(candidate.sourceKey)) candidates.set(candidate.sourceKey, candidate); };
    const addDocument = (origin: ExpedienteDocumentoOrigen, entityType: string, entityId: string, context: string, sourceName: string, document: CanonicalDocument, extra: Record<string, unknown> = {}) => {
      const key = sourceKey(origin, entityType, entityId, document.id, context);
      add({ sourceKey: key, origin, sourceEntityType: entityType, sourceEntityId: entityId, sourceContext: context, sourceName, document, documentVersion: versionOf(document), incorporatedAt: document.fecha_carga, provenance: { origin, source_entity_type: entityType, source_entity_id: entityId, source_name: sourceName, ...extra } });
    };

    const existingLinks = await db.expedienteDocumento.findMany({
      where: {
        organization_id: actor.organizationId,
        expediente_id: expedienteId,
        estatus: 'ACTIVO',
        documento: { estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } },
      },
      include: { documento: { select: documentSelect } },
    });
    for (const link of existingLinks) {
      const key = link.source_key || sourceKey('EXPEDIENTE', 'EXPEDIENTE', expedienteId, link.documento.id, link.tipo_vinculo);
      const provenance = (link.provenance && typeof link.provenance === 'object' ? link.provenance : {}) as Record<string, unknown>;
      add({ sourceKey: key, origin: link.origen, sourceEntityType: link.source_entity_type || 'EXPEDIENTE', sourceEntityId: link.source_entity_id || expedienteId, sourceContext: link.source_context || link.tipo_vinculo, sourceName: String(provenance.source_name || (link.origen === 'EXPEDIENTE' ? 'Carga del expediente' : link.origen === 'COMPARECIENTE' ? 'Compareciente importado' : link.origen === 'PREDIO' ? 'Inmueble importado' : link.origen)), document: link.documento, documentVersion: link.document_version || versionOf(link.documento), incorporatedAt: link.fecha_vinculo, provenance, expedienteDocumentoId: link.id, folderId: link.carpeta_id, visualName: link.nombre_visual });
    }
    const linkedDirectIds = new Set(existingLinks.filter((link) => link.origen === 'EXPEDIENTE').map((link) => link.documento_id));
    const directDocuments = await db.documento.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } },
      select: documentSelect,
    });
    for (const document of directDocuments) if (!linkedDirectIds.has(document.id)) addDocument('EXPEDIENTE', 'EXPEDIENTE', expedienteId, 'CARGA_DIRECTA', 'Carga del expediente', document, { direct_upload: true });

    if (expediente.cotizacion) {
      const quoteLinks = await db.cotizacionDocumento.findMany({
        where: {
          organization_id: actor.organizationId,
          cotizacion_id: expediente.cotizacion.id,
          estatus: 'ACTIVO',
          documento: { estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } },
        },
        include: { documento: { select: documentSelect } },
      });
      for (const link of quoteLinks) {
        const origin = notaryQuote(link.documento, link.tipo_vinculo) ? 'COTIZACION_NOTARIA' : 'COTIZACION';
        addDocument(origin, 'COTIZACION', expediente.cotizacion.id, link.tipo_vinculo, origin === 'COTIZACION_NOTARIA' ? 'Cotización de Notaría' : 'Cotización', link.documento, { isolated_notary_quote: origin === 'COTIZACION_NOTARIA' });
      }
      const quoteLinkDocumentIds = new Set(quoteLinks.map((link) => link.documento_id));
      const quoteDirect = await db.documento.findMany({
        where: { organization_id: actor.organizationId, cotizacion_id: expediente.cotizacion.id, estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } },
        select: documentSelect,
      });
      for (const document of quoteDirect) if (!quoteLinkDocumentIds.has(document.id)) {
        const origin = notaryQuote(document) ? 'COTIZACION_NOTARIA' : 'COTIZACION';
        addDocument(origin, 'COTIZACION', expediente.cotizacion.id, document.tipo, origin === 'COTIZACION_NOTARIA' ? 'Cotización de Notaría' : 'Cotización', document, { isolated_notary_quote: origin === 'COTIZACION_NOTARIA' });
      }
      if (expediente.cotizacion.prospecto_id) {
        const prospectLinks = await db.prospectoDocumento.findMany({
          where: {
            organization_id: actor.organizationId,
            prospecto_id: expediente.cotizacion.prospecto_id,
            estatus: 'ACTIVO',
            documento: { estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] } },
          },
          include: { documento: { select: documentSelect } },
        });
        for (const link of prospectLinks) addDocument('PROSPECTO', 'PROSPECTO', expediente.cotizacion.prospecto_id, link.tipo_vinculo, 'Prospecto', link.documento);
      }
    }
    // Corrección 006: vincular comparecientes o predios nunca importa sus archivos.
    // Esos documentos sólo entran mediante importCurrent(), acción explícita y auditable.
    for (const calculation of expediente.calculosISR) for (const link of calculation.documentos) {
      addDocument('ISR', 'CALCULO_ISR', calculation.id, 'CALCULO_ISR', calculation.folio, link.documento);
    }
    for (const movement of expediente.movimientosFinancieros) {
      const canonicalTypes = new Set<string>();
      for (const link of movement.movimientoDocumentos) {
        canonicalTypes.add(link.tipo_vinculo);
        addDocument('FINANZAS', 'MOVIMIENTO_FINANCIERO', movement.id, link.tipo_vinculo, movement.folio || 'Movimiento financiero', link.documento);
      }
      for (const legacy of [{ type: 'COMPROBANTE', ref: movement.comprobante_url }, { type: 'FACTURA_PDF', ref: movement.factura_url }]) {
        if (!legacy.ref || canonicalTypes.has(legacy.type)) continue;
        const key = `FINANZAS:MOVIMIENTO_FINANCIERO:${movement.id}:LEGACY:${legacy.type}`;
        add({ sourceKey: key, origin: 'FINANZAS', sourceEntityType: 'MOVIMIENTO_FINANCIERO', sourceEntityId: movement.id, sourceContext: legacy.type, sourceName: movement.folio || 'Movimiento financiero', document: null, documentVersion: digest([key, legacy.ref]), incorporatedAt: movement.fecha_movimiento, provenance: { origin: 'FINANZAS', legacy_reference: true, file_available: false }, legacyName: legacy.type === 'COMPROBANTE' ? 'Comprobante registrado' : 'Factura registrada', legacyType: legacy.type, legacyStorageKey: legacy.ref });
      }
    }
    // CFG-002 sólo aporta archivos cuando exista una ejecución documental real;
    // las plantillas maestras nunca se presentan como documentos de operación.
    return [...candidates.values()].sort((a, b) => `${a.origin}:${a.sourceName}:${a.document?.nombre_original || a.legacyName}`.localeCompare(`${b.origin}:${b.sourceName}:${b.document?.nombre_original || b.legacyName}`, 'es'));
  }

  private async resolveLiveFile(actor: Actor, expedienteId: string, itemId: string) {
    const link = isUuid(itemId) ? await this.prisma.expedienteDocumento.findFirst({
      where: {
        organization_id: actor.organizationId,
        expediente_id: expedienteId,
        estatus: 'ACTIVO',
        OR: [{ id: itemId }, { documento_id: itemId }],
      },
      include: { documento: { select: documentSelect } },
    }) : null;
    if (link) return {
      storageKey: link.documento.storage_key,
      fileName: link.nombre_visual || link.documento.nombre_original,
      mimeType: link.documento.mime_type,
    };

    const candidate = (await this.buildCandidates(this.prisma, actor, expedienteId)).find((item) =>
      item.sourceKey === itemId || item.expedienteDocumentoId === itemId || item.document?.id === itemId,
    );
    if (!candidate) {
      throw new ExpedienteDocumentAppendixError(403, 'EXP004_DOCUMENT_ACCESS_DENIED', 'No tienes acceso a este documento del expediente.');
    }
    return {
      storageKey: candidate.document?.storage_key || candidate.legacyStorageKey || '',
      fileName: candidate.visualName || candidate.document?.nombre_original || candidate.legacyName || 'documento',
      mimeType: candidate.document?.mime_type || 'application/octet-stream',
    };
  }

  private revision(candidates: Candidate[]) {
    return digest(candidates.map((item) => [
      item.sourceKey, item.documentVersion, item.document?.estatus || 'MISSING', item.folderId || null, item.visualName || null,
    ]).sort());
  }

  private async liveResponse(candidates: Candidate[], actor: Actor, expedienteId: string, db: Db = this.prisma) {
    const availability = await Promise.all(candidates.map(async (candidate) => candidate.document?.storage_key ? fileExists(candidate.document.storage_key).catch(() => false) : false));
    const folders = await db.expedienteDocumentoCarpeta.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, archived_at: null },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], select: { id: true, parent_id: true, nombre: true, orden: true },
    });
    return {
      state: 'SINCRONIZADO_PREFIRMA' as const,
      frozen_at: null,
      revision: this.revision(candidates),
      groups: this.group(candidates.map((candidate, index) => ({
        id: candidate.expedienteDocumentoId || candidate.sourceKey,
        documento_id: candidate.document?.id || null,
        origin: candidate.origin,
        source_name: candidate.sourceName,
        source_entity_type: candidate.sourceEntityType,
        source_entity_id: candidate.sourceEntityId,
        source_context: candidate.sourceContext,
        document_version: candidate.documentVersion,
        name: candidate.visualName || candidate.document?.nombre_original || candidate.legacyName || 'Registro documental',
        type: candidate.document?.tipo || candidate.legacyType || 'DOCUMENTO',
        status: candidate.document?.estatus || 'REGISTRO_EXISTENTE',
        incorporated_at: candidate.incorporatedAt,
        file_available: availability[index],
        snapshot: false,
        folder_id: candidate.folderId || null,
      }))),
      folders,
    };
  }

  private async snapshotResponse(snapshot: any) {
    const availability = await Promise.all(snapshot.items.map((item: any) => item.storage_key_snapshot ? fileExists(item.storage_key_snapshot).catch(() => false) : false));
    const folders = snapshotFolders(snapshot.items);
    return {
      state: 'CONGELADO_AL_FIRMAR' as const,
      frozen_at: snapshot.frozen_at,
      revision: snapshot.document_revision,
      groups: this.group(snapshot.items.map((item: any, index: number) => ({
        id: item.id, documento_id: item.documento_id, origin: item.origen,
        source_name: item.metadata_snapshot?.source_name || item.source_entity_type || 'Fuente registrada',
        source_entity_type: item.source_entity_type, source_entity_id: item.source_entity_id,
        source_context: item.source_context, document_version: item.document_version,
        name: item.nombre_snapshot, type: item.tipo_snapshot, status: item.estado_snapshot,
        incorporated_at: item.incorporated_at_snapshot, file_available: availability[index], snapshot: true,
        folder_path: item.folder_path_snapshot || null,
        folder_id: item.folder_path_snapshot ? snapshotFolderId(item.folder_path_snapshot) : null,
      }))),
      folders,
    };
  }

  private group(items: any[]) {
    const order: ExpedienteDocumentoOrigen[] = ['PROSPECTO', 'COTIZACION', 'COTIZACION_NOTARIA', 'COMPARECIENTE', 'PREDIO', 'CFG002', 'ISR', 'FINANZAS', 'EXPEDIENTE'];
    const labels: Record<ExpedienteDocumentoOrigen, string> = {
      PROSPECTO: 'Generales de operación', COTIZACION: 'Cotización', COTIZACION_NOTARIA: 'Cotización de Notaría',
      COMPARECIENTE: 'Comparecientes', PREDIO: 'Predios / Inmuebles', CFG002: 'Plantillas / Formatos', ISR: 'Cálculo ISR',
      FINANZAS: 'Finanzas', EXPEDIENTE: 'Carga del expediente',
    };
    return order.flatMap<{ origin: ExpedienteDocumentoOrigen; label: string; items: any[] }>((origin) => {
      const originItems = items.filter((item) => item.origin === origin);
      if (origin !== 'PREDIO') return originItems.length ? [{ origin, label: labels[origin], items: originItems }] : [];
      const sources = new Map<string, any[]>();
      for (const item of originItems) {
        const name = item.source_name || 'Inmueble sin nombre';
        sources.set(name, [...(sources.get(name) || []), item]);
      }
      return [...sources.entries()].map(([name, sourceItems]) => ({ origin, label: `${labels[origin]} · ${name}`, items: sourceItems }));
    });
  }
}
