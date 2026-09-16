import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { predioObjectWhere, canAccessDocumento } from './objectAccess.service';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { downloadFile } from './supabase.service';
import { extraerPredioDesdeDocumento, getOpenAIModelName } from './openaiDocument.service';
import { recordAIFailure, recordAIUsage } from './aiUsage.service';

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
const aiFields = new Set<string>([...scalarFields, ...decimalFields, 'datos_registrales', 'colindancias']);
const currentDocumentStatuses = ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] as const;

function normalizeInput(input: PredioInput) {
  const data: Record<string, unknown> = {};
  for (const field of scalarFields) data[field] = text(input[field], field === 'descripcion' ? 5_000 : 500);
  for (const field of decimalFields) data[field] = decimal(input[field], field.replace(/_/g, ' '), field.startsWith('valor_') ? 2 : 4);
  if (input.datos_registrales === null || input.datos_registrales === undefined || input.datos_registrales === '') data.datos_registrales = Prisma.JsonNull;
  else if (typeof input.datos_registrales === 'object') data.datos_registrales = json(input.datos_registrales);
  else data.datos_registrales = json({ referencia: text(input.datos_registrales, 2_000) });
  const identifiable = ['apodo', 'clave_catastral', 'cuenta_predial', 'folio_real', 'ubicacion_texto', 'calle'].some((field) => Boolean(data[field]));
  if (!identifiable) throw new PredioError(400, 'PREDIO_IDENTITY_REQUIRED', 'Captura al menos un identificador, apodo o ubicación del inmueble.');
  const boundaries = Array.isArray(input.colindancias) ? input.colindancias.map((item, index) => ({
    orden: index,
    referencia: text(item.referencia, 180),
    medida: decimal(item.medida, `medida de colindancia ${index + 1}`),
    unidad: text(item.unidad, 40),
    colindante: text(item.colindante, 500),
    descripcion: text(item.descripcion, 2_000),
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
    return record;
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

  async proposeFromDocument(actor: Actor, predioId: string, documentoIds: string[]) {
    const started = Date.now();
    const current = await this.get(actor, predioId);
    const ids = [...new Set(documentoIds.filter(Boolean))];
    if (!ids.length) throw new PredioError(400, 'PREDIO_AI_SOURCE_REQUIRED', 'Selecciona al menos un documento vigente.');
    const links = current.documentos.filter((item) => ids.includes(item.documento_id) && item.estatus === 'ACTIVO' && item.vigencia === 'VIGENTE');
    if (links.length !== ids.length || !(await Promise.all(ids.map((id) => canAccessDocumento(actor, id)))).every(Boolean)) throw new PredioError(403, 'PREDIO_AI_SOURCE_DENIED', 'Selecciona únicamente documentos vigentes, autorizados y vinculados a este inmueble.');
    try {
      const results = await Promise.all(links.map(async (link) => extraerPredioDesdeDocumento({ buffer: await downloadFile(link.documento.storage_key), mimeType: link.documento.mime_type, tipoDocumento: link.tipo_vinculo, documentoId: link.documento_id, nombreOriginal: link.documento.nombre_original })));
      const extractionId = crypto.randomUUID();
      const currentData = current as unknown as Record<string, unknown>;
      const candidates = results.flatMap((result, index) => result.campos.filter((field) => aiFields.has(field.campo) && text(field.valor, 5_000)).map((field) => ({ ...field, documento_id: links[index].documento_id, documento_nombre: links[index].documento.nombre_original })));
      const proposals = [...new Set(candidates.map((field) => field.campo))].map((campo) => {
        const values = candidates.filter((field) => field.campo === campo); const unique = [...new Set(values.map((field) => text(field.valor, 5_000)).filter(Boolean))]; const chosen = values[0];
        return { campo, valor_actual: proposalValue(currentData[campo]), valor_propuesto: unique.length === 1 ? unique[0] : null, pagina: chosen.pagina || null, seccion: text(chosen.seccion, 180), fragmento_fuente: text(chosen.fragmento, 800), confianza: chosen.confianza, fuentes: values.map((field) => ({ documento_id: field.documento_id, nombre: field.documento_nombre, valor: text(field.valor, 5_000) })), conflicto: unique.length > 1 };
      });
      const boundaries = results.flatMap((result, index) => result.colindancias.map((item) => ({ ...item, documento_id: links[index].documento_id })));
      if (boundaries.length) proposals.push({ campo: 'colindancias', valor_actual: JSON.stringify(current.colindancias), valor_propuesto: JSON.stringify(boundaries), pagina: null, seccion: null, fragmento_fuente: null, confianza: 'LECTURA_DUDOSA', fuentes: links.map((link) => ({ documento_id: link.documento_id, nombre: link.documento.nombre_original, valor: 'Colindancias propuestas' })), conflicto: false });
      await this.prisma.$transaction(async (tx) => {
        for (const proposal of proposals) await tx.predioDatoFuente.create({ data: {
          organization_id: actor.organizationId, predio_id: predioId, extraccion_id: extractionId, documento_id: proposal.fuentes[0].documento_id, source_document_ids: json(proposal.fuentes.map((source) => source.documento_id)),
          proveedor_ia: results[0].proveedor, modelo_ia: results[0].modelo,
          estado: proposal.conflicto || (proposal.valor_actual && proposal.valor_actual !== proposal.valor_propuesto) ? 'EN_CONFLICTO' : 'PENDIENTE_CONFIRMACION',
          campo: proposal.campo, valor_actual: proposal.valor_actual, valor_propuesto: proposal.valor_propuesto,
          pagina: proposal.pagina, seccion: proposal.seccion, fragmento_fuente: proposal.fragmento_fuente, confianza: proposal.confianza,
        } });
        await tx.auditLog.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id, accion: 'PROPOSE_PROPERTY_FIELDS_AI', entidad: 'Predio', entidad_id: predioId,
          valores_nuevos: json({ extraccion_id: extractionId, documento_ids: ids, campos: proposals.map((item) => item.campo), conflictos: proposals.filter((item) => item.conflicto).map((item) => item.campo), persistencia_maestra: false }),
          correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
        } });
      });
      for (const result of results) await recordAIUsage(result.uso, { operacion: 'PROPERTY_DOCUMENT_EXTRACTION', usuarioId: actor.id, metadata: { predio_id: predioId, documento_ids: ids, source_count: ids.length } });
      return { extraccion_id: extractionId, documentos: links.map((link) => ({ id: link.documento_id, nombre: link.documento.nombre_original })), propuestas: proposals, alertas: [...new Set(results.flatMap((result) => result.alertas))], conflictos: proposals.filter((item) => item.conflicto).map((item) => ({ campo: item.campo, fuentes: item.fuentes })), persisted_master: false };
    } catch (error) {
      await recordAIFailure({ operacion: 'PROPERTY_DOCUMENT_EXTRACTION', usuarioId: actor.id, modelo: getOpenAIModelName(), durationMs: Date.now() - started, metadata: { predio_id: predioId, documento_ids: ids } });
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
        if (decision === 'ACCEPT' && proposal.valor_propuesto != null) {
          if (proposal.campo === 'colindancias') boundaries = JSON.parse(proposal.valor_propuesto);
          else if (decimalFields.includes(proposal.campo as typeof decimalFields[number])) updates[proposal.campo] = decimal(normalizeAIProposalDecimal(proposal.valor_propuesto), proposal.campo, proposal.campo.startsWith('valor_') ? 2 : 4);
          else if (proposal.campo === 'datos_registrales') updates[proposal.campo] = json({ referencia: proposal.valor_propuesto });
          else if (aiFields.has(proposal.campo)) updates[proposal.campo] = text(proposal.valor_propuesto, proposal.campo === 'descripcion' ? 5_000 : 500);
        }
        await tx.predioDatoFuente.update({ where: { id: proposal.id }, data: { estado: decision === 'ACCEPT' ? 'CONFIRMADO' : 'DESCARTADO', decidido_por_id: actor.id, decidido_at: new Date() } });
      }
      if (boundaries) {
        await tx.predioColindancia.deleteMany({ where: { organization_id: actor.organizationId, predio_id: predioId } });
        await tx.predioColindancia.createMany({ data: boundaries.map((item, index) => ({
          organization_id: actor.organizationId, predio_id: predioId, orden: index, referencia: text(item.referencia, 180),
          medida: decimal(item.medida, `medida ${index + 1}`), unidad: text(item.unidad, 40), colindante: text(item.colindante, 500), descripcion: text(item.descripcion, 2_000),
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
