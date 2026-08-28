import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { predioObjectWhere, canAccessDocumento } from './objectAccess.service';
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
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const scalarFields = [
  'apodo', 'clave_catastral', 'cuenta_predial', 'folio_real', 'ubicacion_texto', 'calle', 'numero_exterior',
  'numero_interior', 'colonia', 'localidad', 'municipio', 'estado', 'codigo_postal', 'pais', 'regimen', 'descripcion',
] as const;
const decimalFields = [
  'superficie_terreno_m2', 'superficie_construccion_m2', 'superficie_construccion_comercial_m2',
  'valor_catastral', 'valor_avaluo', 'valor_operacion',
] as const;
const aiFields = new Set<string>([...scalarFields, ...decimalFields, 'datos_registrales', 'colindancias']);

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

  async addDocument(actor: Actor, predioId: string, documentoId: string, tipo: string, observaciones?: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccess(tx, actor, predioId);
      const document = await tx.documento.findFirst({ where: { id: documentoId, organization_id: actor.organizationId }, select: { id: true, nombre_original: true } });
      if (!document) throw new PredioError(403, 'PREDIO_DOCUMENT_ACCESS_DENIED', 'El documento no pertenece a la organización activa.');
      const link = await tx.predioDocumento.create({ data: {
        organization_id: actor.organizationId, predio_id: predioId, documento_id: documentoId,
        tipo_vinculo: text(tipo, 120) || 'OTRO', observaciones: text(observaciones, 1_000), creado_por_id: actor.id,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: 'LINK_PROPERTY_DOCUMENT', entidad: 'PredioDocumento', entidad_id: link.id,
        valores_nuevos: json({ predio_id: predioId, documento_id: documentoId, tipo: link.tipo_vinculo }), correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
      } });
      return link;
    });
  }

  async proposeFromDocument(actor: Actor, predioId: string, documentoId: string) {
    const started = Date.now();
    const current = await this.get(actor, predioId);
    const link = current.documentos.find((item) => item.documento_id === documentoId && item.estatus === 'ACTIVO');
    if (!link || !(await canAccessDocumento(actor, documentoId))) throw new PredioError(403, 'PREDIO_AI_SOURCE_DENIED', 'Selecciona un documento autorizado y vinculado a este inmueble.');
    try {
      const buffer = await downloadFile(link.documento.storage_key);
      const result = await extraerPredioDesdeDocumento({
        buffer, mimeType: link.documento.mime_type, tipoDocumento: link.tipo_vinculo,
        documentoId, nombreOriginal: link.documento.nombre_original,
      });
      const extractionId = crypto.randomUUID();
      const currentData = current as unknown as Record<string, unknown>;
      const proposals = result.campos.filter((field) => aiFields.has(field.campo) && text(field.valor, 5_000)).map((field) => ({
        campo: field.campo, valor_actual: currentData[field.campo] == null ? null : String(currentData[field.campo]), valor_propuesto: text(field.valor, 5_000),
        pagina: field.pagina || null, seccion: text(field.seccion, 180), fragmento_fuente: text(field.fragmento, 800), confianza: field.confianza,
      }));
      if (result.colindancias.length) proposals.push({
        campo: 'colindancias', valor_actual: JSON.stringify(current.colindancias), valor_propuesto: JSON.stringify(result.colindancias),
        pagina: null, seccion: null, fragmento_fuente: null, confianza: 'LECTURA_DUDOSA',
      });
      await this.prisma.$transaction(async (tx) => {
        for (const proposal of proposals) await tx.predioDatoFuente.create({ data: {
          organization_id: actor.organizationId, predio_id: predioId, extraccion_id: extractionId, documento_id: documentoId,
          proveedor_ia: result.proveedor, modelo_ia: result.modelo, estado: proposal.valor_actual && proposal.valor_actual !== proposal.valor_propuesto ? 'EN_CONFLICTO' : 'PENDIENTE_CONFIRMACION', ...proposal,
        } });
        await tx.auditLog.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id, accion: 'PROPOSE_PROPERTY_FIELDS_AI', entidad: 'Predio', entidad_id: predioId,
          valores_nuevos: json({ extraccion_id: extractionId, documento_id: documentoId, campos: proposals.map((item) => item.campo), persistencia_maestra: false }),
          correlation_id: crypto.randomUUID(), session_id: actor.sessionId,
        } });
      });
      await recordAIUsage(result.uso, { operacion: 'PROPERTY_DOCUMENT_EXTRACTION', usuarioId: actor.id, metadata: { predio_id: predioId, documento_id: documentoId, source_count: 1 } });
      return { extraccion_id: extractionId, documento: { id: documentoId, nombre: link.documento.nombre_original }, propuestas: proposals, alertas: result.alertas, persisted_master: false };
    } catch (error) {
      await recordAIFailure({ operacion: 'PROPERTY_DOCUMENT_EXTRACTION', usuarioId: actor.id, modelo: getOpenAIModelName(), durationMs: Date.now() - started, metadata: { predio_id: predioId, documento_id: documentoId } });
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
          else if (decimalFields.includes(proposal.campo as typeof decimalFields[number])) updates[proposal.campo] = decimal(proposal.valor_propuesto, proposal.campo, proposal.campo.startsWith('valor_') ? 2 : 4);
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
