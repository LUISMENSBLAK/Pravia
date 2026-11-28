import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { predioObjectWhere, canAccessDocumento } from './objectAccess.service';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { downloadFile } from './supabase.service';
import { extraerPredioDesdeDocumento } from './openaiDocument.service';
import { orderPropertyCandidates, propertyDocumentKind, propertyDocumentRules, propertyIdentityMismatch, propertyTargetFrom } from '../domain/propertyDocumentPolicy';
import { PlatformDomainError } from '../platform/platform.errors';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;

export class PredioError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type ColindanciaInput = {
  referencia?: unknown; medida?: unknown; unidad?: unknown; colindante?: unknown; descripcion?: unknown;
};

export type PredioInput = Record<string, unknown> & { colindancias?: ColindanciaInput[] };

const text = (value: unknown, max = 500) => {
  const cleaned = String(value ?? '').trim().slice(0, max);
  return cleaned || null;
};
const upperText = (value: unknown, max = 500) => {
  const cleaned = text(value, max);
  return cleaned ? cleaned.toLocaleUpperCase('es-MX') : null;
};
const decimal = (value: unknown, field: string, scale = 4) => {
  if (value === '' || value == null) return null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new PredioError(400, 'PREDIO_NUMERIC_INVALID', `${field} debe ser un número no negativo.`);
  const result = new Prisma.Decimal(normalized);
  if (result.isNegative()) throw new PredioError(400, 'PREDIO_NUMERIC_NEGATIVE', `${field} no puede ser negativo.`);
  return result.toDecimalPlaces(scale);
};

/** AI evidence may preserve harmless presentation tokens from the document.
 * Normalize only known numeric adornments; ordinary user-entered values keep
 * using the stricter decimal() parser above. */
export const normalizeAIProposalDecimal = (value: unknown) => {
  if (typeof value === 'number') return String(value);
  let normalized = String(value ?? '').trim().toUpperCase()
    .replace(/MXN/g, '')
    .replace(/\$/g, '')
    .replace(/(?:M2|M²)$/u, '')
    .replace(/\s+/g, '');
  if (!/^\d[\d.,]*$/.test(normalized)) throw new PredioError(400, 'PREDIO_AI_NUMERIC_INVALID', 'La propuesta numérica de IA no tiene un formato reconocible.');
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? /\./g : /,/g;
    normalized = normalized.replace(thousandsSeparator, '');
    if (decimalSeparator === ',') normalized = normalized.replace(',', '.');
  } else if (lastComma >= 0) {
    const commaCount = (normalized.match(/,/g) || []).length;
    const decimalDigits = normalized.length - lastComma - 1;
    normalized = commaCount === 1 && decimalDigits !== 3 ? normalized.replace(',', '.') : normalized.replace(/,/g, '');
  }
  return normalized;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const proposalValue = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const scalarFields = [
  'apodo', 'clave_catastral', 'cuenta_predial', 'folio_real', 'ubicacion_texto', 'calle', 'numero_exterior',
  'numero_interior', 'colonia', 'localidad', 'municipio', 'estado', 'codigo_postal', 'pais', 'regimen', 'descripcion',
] as const;
const decimalFields = [
  'superficie_terreno_m2', 'superficie_construccion_m2', 'superficie_construccion_comercial_m2',
  'valor_catastral', 'valor_avaluo', 'valor_operacion',
] as const;
const aiFields = new Set(Object.keys(propertyDocumentRules));
const propertyAiApplicableFields = [...aiFields];
const scalarLimits: Record<string, number> = { apodo: 160, ubicacion_texto: 500, numero_exterior: 80, numero_interior: 80, codigo_postal: 20, pais: 120, descripcion: 30_000, colindancias: 120_000, datos_registrales: 2_000 };
const currentDocumentStatuses = ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] as const;

function normalizeInput(input: PredioInput) {
  const data: Record<string, unknown> = {};
  for (const field of scalarFields) data[field] = field === 'descripcion' ? text(input[field], scalarLimits[field]) : upperText(input[field], scalarLimits[field] || 180);
  for (const field of decimalFields) data[field] = decimal(input[field], field.replace(/_/g, ' '), field.startsWith('valor_') ? 2 : 4);
  if (input.datos_registrales === null || input.datos_registrales === undefined || input.datos_registrales === '') data.datos_registrales = Prisma.JsonNull;
  else if (typeof input.datos_registrales === 'object') data.datos_registrales = json(input.datos_registrales);
  else data.datos_registrales = json({ referencia: upperText(input.datos_registrales, 2_000) });
  const identifiable = ['apodo', 'clave_catastral', 'cuenta_predial', 'folio_real', 'ubicacion_texto', 'calle'].some((field) => Boolean(data[field]));
  if (!identifiable) throw new PredioError(400, 'PREDIO_IDENTITY_REQUIRED', 'Captura al menos un identificador, apodo o ubicación del inmueble.');
  const boundaries = Array.isArray(input.colindancias) ? input.colindancias.map((item, index) => ({
    orden: index,
    referencia: upperText(item.referencia, 180),
    medida: decimal(item.medida, `medida de colindancia ${index + 1}`),
    unidad: upperText(item.unidad, 40),
    colindante: upperText(item.colindante, 500),
    descripcion: upperText(item.descripcion, 2_000),
  })).filter((item) => item.referencia || item.medida || item.unidad || item.colindante || item.descripcion) : [];
  return { data, boundaries };
}

const propertyInclude = {
  colindancias: { orderBy: { orden: 'asc' as const } },
  documentos: { where: { estatus: 'ACTIVO' as const }, orderBy: { fecha_vinculo: 'desc' as const }, include: { documento: true } },
  expedientes: {
    where: { estatus: 'ACTIVO' as const },
    include: {
      expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } },
      actos: { where: { estatus: 'ACTIVO' as const }, include: { expedienteActo: { include: { tipo_acto: { select: { id: true, nombre: true } } } } } },
    },
  },
} as const;

export class PrediosService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, search = '', limit = 30) {
    const q = text(search, 120);
    const data = await this.prisma.predio.findMany({
      where: {
        organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor),
        ...(q ? { OR: [
          { apodo: { contains: q, mode: 'insensitive' } }, { clave_catastral: { contains: q, mode: 'insensitive' } },
          { cuenta_predial: { contains: q, mode: 'insensitive' } }, { folio_real: { contains: q, mode: 'insensitive' } },
          { ubicacion_texto: { contains: q, mode: 'insensitive' } }, { calle: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ updated_at: 'desc' }], take: Math.min(Math.max(limit, 1), 50),
      select: { id: true, apodo: true, clave_catastral: true, cuenta_predial: true, folio_real: true, ubicacion_texto: true, calle: true, numero_exterior: true, colonia: true, municipio: true, estado: true, updated_at: true },
    });
    return { data };
  }

  async get(actor: Actor, id: string) {
    const record = await this.prisma.predio.findFirst({
      where: { id, organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor) },
      include: propertyInclude,
    });
    if (!record) throw new PredioError(403, 'PREDIO_ACCESS_DENIED', 'No tienes acceso a este inmueble.');
    const [documentLinks, expedienteLinks] = await Promise.all([
      this.prisma.predioDocumento.findMany({ where: { organization_id: actor.organizationId, predio_id: id }, select: { id: true } }),
      this.prisma.expedientePredio.findMany({ where: { organization_id: actor.organizationId, predio_id: id }, select: { id: true } }),
    ]);
    const relatedIds = [...documentLinks.map((item) => item.id), ...expedienteLinks.map((item) => item.id)];
    const activity = await this.prisma.auditLog.findMany({
      where: {
        organization_id: actor.organizationId,
        OR: [
          { entidad: 'Predio', entidad_id: id },
          { entidad: { in: ['PredioDocumento', 'ExpedientePredio'] }, entidad_id: { in: relatedIds } },
        ],
      },
      include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return { ...record, actividad: activity };
  }

  async create(actor: Actor, input: PredioInput) {
    const normalized = normalizeInput(input);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.predio.create({ data: {
        ...normalized.data,
        organization_id: actor.organizationId,
        created_by: actor.id,
        updated_by: actor.id,
        colindancias: { create: normalized.boundaries.map((item) => ({ ...item, organization_id: actor.organizationId })) },
      } as Prisma.PredioUncheckedCreateInput, include: propertyInclude });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'CREATE_PROPERTY_MASTER', entidad: 'Predio', entidad_id: created.id,
        valores_nuevos: json({ fields: Object.keys(normalized.data).filter((key) => normalized.data[key] != null), colindancias: normalized.boundaries.length }),
        correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
      } });
      return created;
    });
  }

  async update(actor: Actor, id: string, input: PredioInput, expectedVersion?: number) {
    const normalized = normalizeInput(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:predio-master:${actor.organizationId}:${id}`}))`);
      const current = await this.assertAccess(tx, actor, id);
      if (expectedVersion != null && expectedVersion !== current.version) throw new PredioError(409, 'PREDIO_VERSION_STALE', 'La ficha cambió. Recarga antes de guardar.');
      await tx.predioColindancia.deleteMany({ where: { organization_id: actor.organizationId, predio_id: id } });
      const updated = await tx.predio.update({ where: { id }, data: {
        ...normalized.data, updated_by: actor.id, version: { increment: 1 },
        colindancias: { create: normalized.boundaries.map((item) => ({ ...item, organization_id: actor.organizationId })) },
      } as Prisma.PredioUncheckedUpdateInput, include: propertyInclude });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'UPDATE_PROPERTY_MASTER', entidad: 'Predio', entidad_id: id,
        valores_anteriores: json({ version: current.version }), valores_nuevos: json({ version: updated.version, fields: Object.keys(normalized.data), colindancias: normalized.boundaries.length }),
        correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
      } });
      return updated;
    });
  }

  async addDocument(actor: Actor, predioId: string, documentoId: string, tipo: string, observaciones?: string | null, options: { vigencia?: 'VIGENTE' | 'HISTORICO'; principal?: boolean; origen?: string; sourceExpedienteDocumentoId?: string | null } = {}) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccess(tx, actor, predioId);
      const document = await tx.documento.findFirst({ where: { id: documentoId, organization_id: actor.organizationId }, select: { id: true, nombre_original: true } });
      if (!document) throw new PredioError(403, 'PREDIO_DOCUMENT_ACCESS_DENIED', 'El documento no pertenece a la organización activa.');
      if (options.principal && options.vigencia !== 'HISTORICO') await tx.predioDocumento.updateMany({ where: { organization_id: actor.organizationId, predio_id: predioId, estatus: 'ACTIVO', es_antecedente_principal: true }, data: { es_antecedente_principal: false, updated_at: new Date() } });
      const link = await tx.predioDocumento.create({ data: {
        organization_id: actor.organizationId, predio_id: predioId, documento_id: documentoId,
        tipo_vinculo: text(tipo, 120) || 'OTRO', observaciones: text(observaciones, 1_000), creado_por_id: actor.id,
        vigencia: options.vigencia || 'VIGENTE', es_antecedente_principal: Boolean(options.principal && options.vigencia !== 'HISTORICO'),
        origen: text(options.origen, 60) || 'CARGA_DIRECTA', source_expediente_documento_id: options.sourceExpedienteDocumentoId || null,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'LINK_PROPERTY_DOCUMENT', entidad: 'PredioDocumento', entidad_id: link.id,
        valores_nuevos: json({ predio_id: predioId, documento_id: documentoId, tipo: link.tipo_vinculo }), correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
      } });
      return link;
    });
  }

  async updateDocument(actor: Actor, predioId: string, linkId: string, input: { vigencia?: 'VIGENTE' | 'HISTORICO'; es_antecedente_principal?: boolean; tipo_vinculo?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccess(tx, actor, predioId);
      const link = await tx.predioDocumento.findFirst({ where: { id: linkId, organization_id: actor.organizationId, predio_id: predioId, estatus: 'ACTIVO' } });
      if (!link) throw new PredioError(404, 'PREDIO_DOCUMENT_NOT_FOUND', 'El vínculo documental ya no está disponible.');
      const vigencia = input.vigencia || link.vigencia; const principal = vigencia === 'VIGENTE' ? Boolean(input.es_antecedente_principal ?? link.es_antecedente_principal) : false;
      if (principal) await tx.predioDocumento.updateMany({ where: { organization_id: actor.organizationId, predio_id: predioId, estatus: 'ACTIVO', es_antecedente_principal: true, id: { not: linkId } }, data: { es_antecedente_principal: false, updated_at: new Date() } });
      const updated = await tx.predioDocumento.update({ where: { id: linkId }, data: { vigencia, es_antecedente_principal: principal, tipo_vinculo: text(input.tipo_vinculo ?? link.tipo_vinculo, 120) || link.tipo_vinculo, version: { increment: 1 }, updated_at: new Date() } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'CLASSIFY_PROPERTY_DOCUMENT', entidad: 'PredioDocumento', entidad_id: linkId, valores_anteriores: json({ vigencia: link.vigencia, principal: link.es_antecedente_principal, tipo: link.tipo_vinculo }), valores_nuevos: json({ vigencia, principal, tipo: updated.tipo_vinculo }), correlation_id: crypto.randomUUID(), session_id: actor.sessionId } });
      return updated;
    });
  }

  async listExpedienteDocuments(actor: Actor, predioId: string, expedienteId: string) {
    await this.assertAccess(this.prisma, actor, predioId);
    const expediente = await this.prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor as any) }, select: { id: true } });
    if (!expediente) throw new PredioError(403, 'PREDIO_EXPEDIENT_ACCESS_DENIED', 'No tienes acceso al expediente de origen.');
    const links = await this.prisma.expedienteDocumento.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', documento: { estatus: { in: [...currentDocumentStatuses] } } }, include: { documento: { select: { id: true, nombre_original: true, mime_type: true, size_bytes: true, fecha_carga: true } } }, orderBy: { fecha_vinculo: 'desc' } });
    return links.map((link) => ({ id: link.id, origin: link.origen, source_name: (link.provenance as any)?.source_name || link.source_context || link.tipo_vinculo, document: link.documento }));
  }

  async importExpedienteDocument(actor: Actor, predioId: string, expedienteId: string, expedienteDocumentoId: string, tipo: string, principal = false) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:predio-document-import:${predioId}:${expedienteDocumentoId}`}))`);
      await this.assertAccess(tx, actor, predioId);
      const expediente = await tx.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor as any) }, select: { id: true } });
      if (!expediente) throw new PredioError(403, 'PREDIO_EXPEDIENT_ACCESS_DENIED', 'No tienes acceso al expediente de origen.');
      const source = await tx.expedienteDocumento.findFirst({ where: { id: expedienteDocumentoId, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', documento: { estatus: { in: [...currentDocumentStatuses] } } }, select: { id: true, documento_id: true } });
      if (!source) throw new PredioError(404, 'PREDIO_IMPORT_SOURCE_NOT_FOUND', 'El documento específico ya no está vigente en el expediente.');
      const existing = await tx.predioDocumento.findFirst({ where: { organization_id: actor.organizationId, predio_id: predioId, documento_id: source.documento_id, estatus: 'ACTIVO' } });
      if (existing) return { link: existing, idempotent: true, blob_copies: 0 };
      if (principal) await tx.predioDocumento.updateMany({ where: { organization_id: actor.organizationId, predio_id: predioId, estatus: 'ACTIVO', es_antecedente_principal: true }, data: { es_antecedente_principal: false, updated_at: new Date() } });
      const link = await tx.predioDocumento.create({ data: {
        organization_id: actor.organizationId, predio_id: predioId, documento_id: source.documento_id,
        tipo_vinculo: text(tipo, 120) || 'ANTECEDENTE', creado_por_id: actor.id, vigencia: 'VIGENTE', es_antecedente_principal: principal,
        origen: 'IMPORT_EXPEDIENTE', source_expediente_documento_id: source.id,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'IMPORT_PROPERTY_DOCUMENT_FROM_EXPEDIENT', entidad: 'PredioDocumento', entidad_id: link.id,
        valores_nuevos: json({ predio_id: predioId, expediente_id: expedienteId, expediente_documento_id: source.id, documento_id: source.documento_id, blob_copies: 0 }),
        correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
      } });
      return { link, idempotent: false, blob_copies: 0 };
    }, { timeout: 20_000 });
  }

  async proposeFromDocument(actor: Actor, predioId: string, documentoIds: string[], idempotencyKey: string) {
    const current = await this.get(actor, predioId);
    const ids = [...new Set(documentoIds.filter(Boolean))];
    if (!ids.length) throw new PredioError(400, 'PREDIO_AI_SOURCE_REQUIRED', 'Selecciona al menos un documento vigente.');
    if (!idempotencyKey) throw new PredioError(400, 'PREDIO_AI_IDEMPOTENCY_REQUIRED', 'La extracción requiere una clave de idempotencia.');
    const links = current.documentos.filter((item) => ids.includes(item.documento_id) && item.estatus === 'ACTIVO' && item.vigencia === 'VIGENTE');
    if (links.length !== ids.length || !(await Promise.all(ids.map((id) => canAccessDocumento(actor, id)))).every(Boolean)) throw new PredioError(403, 'PREDIO_AI_SOURCE_DENIED', 'Selecciona únicamente documentos vigentes, autorizados y vinculados a este inmueble.');
    try {
      const attempted = await Promise.allSettled(links.map(async (link) => ({
        link,
        result: await extraerPredioDesdeDocumento(
          { buffer: await downloadFile(link.documento.storage_key), mimeType: link.documento.mime_type, tipoDocumento: link.tipo_vinculo, documentoId: link.documento_id, nombreOriginal: link.documento.nombre_original },
          {
            actor: { userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId,
              role: actor.rol, permissions: actor.permissions, scope: actor.scope, sessionId: actor.sessionId },
            idempotencyKey: `${idempotencyKey}:document:${link.documento_id}`,
            traceId: `${idempotencyKey}:document:${link.documento_id}`,
            propertyTarget: propertyTargetFrom(current as unknown as Record<string, unknown>),
          },
        ),
      })));
      const succeeded = attempted.filter((entry): entry is PromiseFulfilledResult<{ link: typeof links[number]; result: Awaited<ReturnType<typeof extraerPredioDesdeDocumento>> }> => entry.status === 'fulfilled').map((entry) => entry.value);
      const extractionErrors = attempted.flatMap((entry, index) => entry.status === 'rejected' ? [{ documento_id: links[index].documento_id, nombre: links[index].documento.nombre_original, error: entry.reason instanceof Error ? entry.reason.message : 'No fue posible procesar el documento.' }] : []);
      if (!succeeded.length) {
        // A configuration, balance or provider gate is not a corrupt document.
        const gatewayFailure = attempted.find((entry) => entry.status === 'rejected' && entry.reason instanceof PlatformDomainError);
        if (gatewayFailure?.status === 'rejected') throw gatewayFailure.reason;
        throw new PredioError(422, 'PREDIO_AI_NO_READABLE_SOURCE', 'No fue posible interpretar ninguno de los documentos seleccionados. Revisa el formato y la disponibilidad de los archivos y vuelve a intentar.');
      }
      const results = succeeded.map((entry) => entry.result);
      const extractionId = crypto.randomUUID();
      const currentData = current as unknown as Record<string, unknown>;
      const rankAlerts: string[] = [];
      const candidates = succeeded.flatMap(({ link, result }) => {
        const tipo = propertyDocumentKind(result.tipo_documental || link.documento.nombre_original) || (!result.tipo_documental ? propertyDocumentKind(link.tipo_vinculo) : undefined);
        if (!tipo) { rankAlerts.push(`${link.documento.nombre_original}: no se acreditó un tipo de fuente admitido para llenar la ficha.`); return []; }
        const identifiers = Object.fromEntries(result.campos.filter(field => ['clave_catastral', 'cuenta_predial', 'folio_real'].includes(field.campo) && propertyDocumentRules[field.campo].includes(tipo) && field.confianza === 'LECTURA_CLARA').map(field => [field.campo, field.valor]));
        if (propertyIdentityMismatch(currentData, identifiers)) { rankAlerts.push(`${link.documento.nombre_original}: un identificador no coincide con la ficha; verifica que sea el mismo inmueble antes de reutilizar esos datos.`); return []; }
        const fields = result.campos.filter(field => field.campo !== 'colindancias' && aiFields.has(field.campo));
        if (tipo === 'ANTECEDENTE' && result.colindancias.length) {
          const boundaries = result.colindancias.map(({ pagina, fragmento, ...item }) => {
            if (!item.medida) return { ...item, medida: null };
            try { return { ...item, medida: decimal(normalizeAIProposalDecimal(item.medida), 'medida propuesta')?.toString() }; }
            catch { rankAlerts.push(`${link.documento.nombre_original}: una medida de colindancia requiere revisión manual.`); return { ...item, medida: null, descripcion: [item.descripcion, fragmento || item.medida].filter(Boolean).join('\n') }; }
          });
          fields.push({ campo: 'colindancias', valor: JSON.stringify(boundaries), pagina: result.colindancias[0]?.pagina, fragmento: result.colindancias.map(item => item.fragmento).filter(Boolean).join('\n'), confianza: 'LECTURA_DUDOSA' });
        }
        return fields.map(field => ({ ...field, tipo, principal: link.es_antecedente_principal, documento_id: link.documento_id, documento_nombre: link.documento.nombre_original, fecha: link.fecha_vinculo, modelo: result.modelo }));
      });
      const mixedProperty = ['clave_catastral','cuenta_predial','folio_real'].some(campo => new Set(candidates.filter(item => item.campo === campo && item.confianza === 'LECTURA_CLARA' && propertyDocumentRules[campo]?.includes(item.tipo)).map(item => item.valor.toUpperCase().replace(/[^0-9A-Z]/g, ''))).size > 1);
      if (mixedProperty) rankAlerts.push('Los documentos no coinciden en sus identificadores. Revisa y vuelve a seleccionar únicamente fuentes del mismo inmueble.');
      const proposals = propertyAiApplicableFields.flatMap(campo => {
        const { ordered, selected, conflict, unresolved } = orderPropertyCandidates(campo, candidates, value => { try { return new Prisma.Decimal(normalizeAIProposalDecimal(value)).toString(); } catch { return value; } });
        if (!selected) return [];
        const raw = selected.valor.trim();
        const cap = scalarLimits[campo] || 180;
        const parseInvalid = /^(?:superficie_|valor_)/.test(campo) && !(() => { try { return /^\d+(?:\.\d+)?$/.test(normalizeAIProposalDecimal(raw)); } catch { return false; } })();
        const unavailable = mixedProperty || unresolved || parseInvalid || raw.length > cap;
        if (!unavailable && conflict) rankAlerts.push(`${campo.replace(/_/g, ' ')}: discrepancia documental; se propone la fuente prioritaria para tu revisión.`);
        if (raw.length > cap || parseInvalid) rankAlerts.push(`${campo.replace(/_/g, ' ')}: revisa y captura manualmente la lectura; no se truncó ni corrigió.`);
        return [{ campo, valor_actual: proposalValue(currentData[campo]), valor_propuesto: unavailable ? null : raw, pagina: selected.pagina || null, seccion: text(selected.seccion, 180), fragmento_fuente: text(selected.fragmento, 800), confianza: selected.confianza, fuentes: ordered.map(field => ({ documento_id: field.documento_id, nombre: field.documento_nombre, valor: campo === 'colindancias' ? 'Segmentos transcritos del antecedente' : text(field.valor, cap), tipo: field.tipo, pagina: field.pagina || null, fecha_vinculo: field.fecha, confianza: field.confianza })), conflicto: unavailable, discrepancia: conflict, modelo: selected.modelo }];
      });
      const found = new Set(proposals.map((item) => item.campo));
      const faltantes = propertyAiApplicableFields.filter((field) => !found.has(field));
      await this.prisma.$transaction(async (tx) => {
        for (const proposal of proposals) await tx.predioDatoFuente.create({ data: {
          organization_id: actor.organizationId, predio_id: predioId, extraccion_id: extractionId, documento_id: proposal.fuentes[0].documento_id, source_document_ids: json(proposal.fuentes.map((source) => source.documento_id)),
          proveedor_ia: results[0].proveedor, modelo_ia: proposal.modelo,
          estado: proposal.conflicto || (proposal.valor_actual && proposal.valor_actual !== proposal.valor_propuesto) ? 'EN_CONFLICTO' : 'PENDIENTE_CONFIRMACION',
          campo: proposal.campo, valor_actual: proposal.valor_actual, valor_propuesto: proposal.valor_propuesto,
          pagina: proposal.pagina, seccion: proposal.seccion, fragmento_fuente: proposal.fragmento_fuente, confianza: proposal.confianza,
        } });
        await tx.auditLog.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id, accion: 'PROPOSE_PROPERTY_FIELDS_AI', entidad: 'Predio', entidad_id: predioId,
          valores_nuevos: json({ extraccion_id: extractionId, documento_ids: ids, campos: proposals.map((item) => item.campo), conflictos: proposals.filter((item) => item.conflicto).map((item) => item.campo), faltantes, errores: extractionErrors.map((item) => ({ documento_id: item.documento_id, error: item.error })), persistencia_maestra: false }),
          detalles: json({ fuentes_por_campo: proposals.map(item => ({ campo: item.campo, discrepancia: item.discrepancia, fuentes: item.fuentes.map(({ valor: _valor, nombre: _nombre, ...fuente }) => fuente) })) }),
          correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
        } });
      });
      return { extraccion_id: extractionId, documentos: links.map((link) => ({ id: link.documento_id, nombre: link.documento.nombre_original })), propuestas: proposals, faltantes, errores: extractionErrors, alertas: [...new Set([...rankAlerts, ...results.flatMap((result) => result.alertas)])], conflictos: proposals.filter((item) => item.conflicto).map((item) => ({ campo: item.campo, fuentes: item.fuentes })), persisted_master: false };
    } catch (error) {
      if (error instanceof PlatformDomainError) throw new PredioError(error.status, error.code, error.message);
      throw error;
    }
  }

  async applyProposal(actor: Actor, predioId: string, extractionId: string, input: { expected_version?: number; decisions?: Record<string, 'ACCEPT' | 'KEEP'> }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.assertAccess(tx, actor, predioId);
      if (input.expected_version != null && input.expected_version !== current.version) throw new PredioError(409, 'PREDIO_AI_PROPOSAL_STALE', 'La ficha cambió desde el análisis. Genera una nueva propuesta.');
      const proposals = await tx.predioDatoFuente.findMany({ where: { organization_id: actor.organizationId, predio_id: predioId, extraccion_id: extractionId, estado: { in: ['PENDIENTE_CONFIRMACION', 'EN_CONFLICTO'] } } });
      if (!proposals.length) throw new PredioError(404, 'PREDIO_AI_PROPOSAL_NOT_FOUND', 'La propuesta ya no está disponible.');
      const updates: Record<string, unknown> = {};
      let boundaries: ColindanciaInput[] | null = null;
      for (const proposal of proposals) {
        const decision = input.decisions?.[proposal.campo];
        if (!decision) throw new PredioError(400, 'PREDIO_AI_DECISION_REQUIRED', 'Decide aceptar o conservar cada campo propuesto.');
        if (decision === 'ACCEPT' && (!aiFields.has(proposal.campo) || proposal.valor_propuesto == null)) throw new PredioError(400, 'PREDIO_AI_DECISION_INVALID', 'No hay un valor aplicable para este campo. Conserva el actual o captura el valor manualmente.');
        if (decision === 'ACCEPT' && proposal.valor_propuesto != null) {
          if (proposal.campo === 'colindancias') boundaries = JSON.parse(proposal.valor_propuesto);
          else if (decimalFields.includes(proposal.campo as typeof decimalFields[number])) updates[proposal.campo] = decimal(normalizeAIProposalDecimal(proposal.valor_propuesto), proposal.campo, proposal.campo.startsWith('valor_') ? 2 : 4);
          else if (proposal.campo === 'datos_registrales') updates[proposal.campo] = json({ referencia: upperText(proposal.valor_propuesto, 2_000) });
          else if (proposal.campo === 'descripcion') updates[proposal.campo] = text(proposal.valor_propuesto, scalarLimits.descripcion);
          else if (aiFields.has(proposal.campo)) updates[proposal.campo] = upperText(proposal.valor_propuesto, scalarLimits[proposal.campo] || 180);
        }
        await tx.predioDatoFuente.update({ where: { id: proposal.id }, data: { estado: decision === 'ACCEPT' ? 'CONFIRMADO' : 'DESCARTADO', decidido_por_id: actor.id, decidido_at: new Date() } });
      }
      if (boundaries) {
        await tx.predioColindancia.deleteMany({ where: { organization_id: actor.organizationId, predio_id: predioId } });
        await tx.predioColindancia.createMany({ data: boundaries.map((item, index) => ({
          organization_id: actor.organizationId, predio_id: predioId, orden: index, referencia: upperText(item.referencia, 180),
          medida: decimal(item.medida, `medida ${index + 1}`), unidad: upperText(item.unidad, 40), colindante: upperText(item.colindante, 500), descripcion: upperText(item.descripcion, 2_000),
        })) });
      }
      const updated = await tx.predio.update({ where: { id: predioId }, data: { ...updates, updated_by: actor.id, version: { increment: 1 } }, include: propertyInclude });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'ACCEPT_PROPERTY_AI_PROPOSAL', entidad: 'Predio', entidad_id: predioId,
        valores_anteriores: json({ version: current.version }), valores_nuevos: json({ version: updated.version, extraccion_id: extractionId, decisions: input.decisions }),
        correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
      } });
      return updated;
    });
  }

  private async assertAccess(db: Db, actor: Actor, id: string) {
    const record = await db.predio.findFirst({ where: { id, organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor) }, select: { id: true, version: true } });
    if (!record) throw new PredioError(403, 'PREDIO_ACCESS_DENIED', 'No tienes acceso a este inmueble.');
    return record;
  }
}
