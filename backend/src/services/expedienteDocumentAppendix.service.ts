import { createHash, randomUUID } from 'crypto';
import { ExpedienteDocumentoOrigen, Prisma, PrismaClient } from '@prisma/client';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { fileExists, getSignedUrl } from './supabase.service';

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
const notaryQuote = (document: CanonicalDocument, linkType = '') =>
  /PRESUPUESTO[_\s-]*NOTARIA|COTIZACI[ÓO]N[_\s-]*NOTARIA|NOTARIA[_\s-]*QUOTE/i.test(`${document.tipo} ${linkType}`);

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
    return this.liveResponse(candidates);
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
      return { ...(await this.liveResponse(candidates)), sync: { created, reactivated, inactivated, blob_copies: 0 } };
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
    const linkByKey = new Map((await tx.expedienteDocumento.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' },
      select: { id: true, source_key: true },
    })).map((item) => [item.source_key, item.id]));
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
        nombre_snapshot: candidate.document?.nombre_original || candidate.legacyName || 'Registro documental',
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
      const link = await this.prisma.expedienteDocumento.findFirst({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', OR: [{ id: itemId }, { documento_id: itemId }] },
        include: { documento: { select: documentSelect } },
      });
      if (!link) throw new ExpedienteDocumentAppendixError(403, 'EXP004_DOCUMENT_ACCESS_DENIED', 'No tienes acceso a este documento del expediente.');
      storageKey = link.documento.storage_key; fileName = link.documento.nombre_original; mimeType = link.documento.mime_type;
    }
    if (!storageKey || !(await fileExists(storageKey))) {
      throw new ExpedienteDocumentAppendixError(404, 'EXP004_FILE_UNAVAILABLE', 'El registro existe, pero el archivo no está disponible.');
    }
    return { url: await getSignedUrl(storageKey, 600), expires_in: 600, file_name: fileName, mime_type: mimeType };
  }

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
        comparecientes: { where: { archived_at: null, estatus: 'ACTIVO' }, select: {
          compareciente_id: true,
          compareciente: { select: { nombre_busqueda: true, documentos: { where: { archived_at: null, estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' } }, select: { categoria: true, subcategoria: true, documento: { select: documentSelect } } } } },
        } },
        predios: { where: { estatus: 'ACTIVO' }, select: { predio_id: true, predio: { select: {
          apodo: true, ubicacion_texto: true, clave_catastral: true, folio_real: true,
          documentos: { where: { estatus: 'ACTIVO', documento: { estatus: { in: ['VIGENTE', 'POR_VENCER'] } } }, select: { tipo_vinculo: true, documento: { select: documentSelect } } },
        } } } },
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

    const directLinks = await db.expedienteDocumento.findMany({
      where: {
        organization_id: actor.organizationId,
        expediente_id: expedienteId,
        estatus: 'ACTIVO',
        origen: 'EXPEDIENTE',
        documento: { estatus: { in: ['VIGENTE', 'POR_VENCER'] } },
      },
      include: { documento: { select: documentSelect } },
    });
    for (const link of directLinks) {
      const key = link.source_key || sourceKey('EXPEDIENTE', 'EXPEDIENTE', expedienteId, link.documento.id, link.tipo_vinculo);
      add({ sourceKey: key, origin: 'EXPEDIENTE', sourceEntityType: 'EXPEDIENTE', sourceEntityId: expedienteId, sourceContext: link.tipo_vinculo, sourceName: 'Carga del expediente', document: link.documento, documentVersion: link.document_version || versionOf(link.documento), incorporatedAt: link.fecha_vinculo, provenance: { origin: 'EXPEDIENTE', direct_upload: true }, expedienteDocumentoId: link.id });
    }
    const linkedDirectIds = new Set(directLinks.map((link) => link.documento_id));
    const directDocuments = await db.documento.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: { in: ['VIGENTE', 'POR_VENCER'] } },
      select: documentSelect,
    });
    for (const document of directDocuments) if (!linkedDirectIds.has(document.id)) addDocument('EXPEDIENTE', 'EXPEDIENTE', expedienteId, 'CARGA_DIRECTA', 'Carga del expediente', document, { direct_upload: true });

    if (expediente.cotizacion) {
      const quoteLinks = await db.cotizacionDocumento.findMany({
        where: {
          organization_id: actor.organizationId,
          cotizacion_id: expediente.cotizacion.id,
          estatus: 'ACTIVO',
          documento: { estatus: { in: ['VIGENTE', 'POR_VENCER'] } },
        },
        include: { documento: { select: documentSelect } },
      });
      for (const link of quoteLinks) {
        const origin = notaryQuote(link.documento, link.tipo_vinculo) ? 'COTIZACION_NOTARIA' : 'COTIZACION';
        addDocument(origin, 'COTIZACION', expediente.cotizacion.id, link.tipo_vinculo, origin === 'COTIZACION_NOTARIA' ? 'Cotización de Notaría' : 'Cotización', link.documento, { isolated_notary_quote: origin === 'COTIZACION_NOTARIA' });
      }
      const quoteLinkDocumentIds = new Set(quoteLinks.map((link) => link.documento_id));
      const quoteDirect = await db.documento.findMany({
        where: { organization_id: actor.organizationId, cotizacion_id: expediente.cotizacion.id, estatus: { in: ['VIGENTE', 'POR_VENCER'] } },
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
            documento: { estatus: { in: ['VIGENTE', 'POR_VENCER'] } },
          },
          include: { documento: { select: documentSelect } },
        });
        for (const link of prospectLinks) addDocument('PROSPECTO', 'PROSPECTO', expediente.cotizacion.prospecto_id, link.tipo_vinculo, 'Prospecto', link.documento);
      }
    }
    for (const relation of expediente.comparecientes) for (const link of relation.compareciente.documentos) {
      addDocument('COMPARECIENTE', 'COMPARECIENTE', relation.compareciente_id, link.subcategoria || link.categoria, relation.compareciente.nombre_busqueda, link.documento, { current_only: true });
    }
    for (const relation of expediente.predios) for (const link of relation.predio.documentos) {
      addDocument('PREDIO', 'PREDIO', relation.predio_id, link.tipo_vinculo, relation.predio.apodo || relation.predio.ubicacion_texto || relation.predio.clave_catastral || relation.predio.folio_real || 'Inmueble', link.documento);
    }
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
    // CFG-002 sólo aporta archivos cuando exista una ejecución documental real.
    // EXP-006 aún no existe: no convertimos plantillas maestras en documentos de operación.
    return [...candidates.values()].sort((a, b) => `${a.origin}:${a.sourceName}:${a.document?.nombre_original || a.legacyName}`.localeCompare(`${b.origin}:${b.sourceName}:${b.document?.nombre_original || b.legacyName}`, 'es'));
  }

  private revision(candidates: Candidate[]) {
    return digest(candidates.map((item) => [item.sourceKey, item.documentVersion, item.document?.estatus || 'MISSING']).sort());
  }

  private async liveResponse(candidates: Candidate[]) {
    const availability = await Promise.all(candidates.map(async (candidate) => candidate.document?.storage_key ? fileExists(candidate.document.storage_key).catch(() => false) : false));
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
        name: candidate.document?.nombre_original || candidate.legacyName || 'Registro documental',
        type: candidate.document?.tipo || candidate.legacyType || 'DOCUMENTO',
        status: candidate.document?.estatus || 'REGISTRO_EXISTENTE',
        incorporated_at: candidate.incorporatedAt,
        file_available: availability[index],
        snapshot: false,
      }))),
    };
  }

  private async snapshotResponse(snapshot: any) {
    const availability = await Promise.all(snapshot.items.map((item: any) => item.storage_key_snapshot ? fileExists(item.storage_key_snapshot).catch(() => false) : false));
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
      }))),
    };
  }

  private group(items: any[]) {
    const order: ExpedienteDocumentoOrigen[] = ['PROSPECTO', 'COTIZACION', 'COTIZACION_NOTARIA', 'COMPARECIENTE', 'PREDIO', 'CFG002', 'ISR', 'FINANZAS', 'EXPEDIENTE'];
    const labels: Record<ExpedienteDocumentoOrigen, string> = {
      PROSPECTO: 'Generales de operación', COTIZACION: 'Cotización', COTIZACION_NOTARIA: 'Cotización de Notaría',
      COMPARECIENTE: 'Comparecientes', PREDIO: 'Predios / Inmuebles', CFG002: 'Plantillas / Formatos', ISR: 'Cálculo ISR',
      FINANZAS: 'Finanzas', EXPEDIENTE: 'Carga del expediente',
    };
    return order.map((origin) => ({ origin, label: labels[origin], items: items.filter((item) => item.origin === origin) })).filter((group) => group.items.length);
  }
}
