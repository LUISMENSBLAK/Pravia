import crypto from 'crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { extraerMultiplesDocumentos, getOpenAIModelName, type DocumentoParaExtraccion } from './openaiDocument.service';
import { calculateISR, ISRCalculationInput, ISRRateBracket, ISRRuleSetSnapshot, ISRValidationError } from '../domain/isrTaxEngine';
import { comparecienteObjectWhere } from './objectAccess.service';
import { renderISRDeterminationPdf } from '../domain/isrDeterminationPdf';
import { recordAIUsageInDb } from './aiUsage.service';

type AuthUser = NonNullable<Request['user']>;
type Db = typeof prisma;

const elevated = (user: AuthUser) => ['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(user.rol);
export const isrObjectWhere = (user: AuthUser) => elevated(user) ? {} : {
  OR: [
    { creado_por_id: user.id },
    { expediente: expedienteAccessWhere(user) },
  ],
};

const json = (value: unknown) => value as Prisma.InputJsonValue;
const moneyString = (value: unknown) => value == null ? '' : typeof (value as any)?.toFixed === 'function' ? (value as any).toFixed(2) : String(value);
const safeInput = (value: unknown): ISRCalculationInput => {
  const raw = (value || {}) as Partial<ISRCalculationInput>;
  const exercise = Number(raw.taxYear) || new Date().getFullYear();
  const operationType = raw.operationType || 'ENAJENACION_INMUEBLE';
  const base = defaultInput(exercise, operationType);
  return {
    ...base, ...raw,
    taxpayer: { ...base.taxpayer, ...(raw.taxpayer || {}) },
    property: { ...base.property, ...(raw.property || {}) },
    sourceContext: raw.sourceContext ? {
      capturedAt: raw.sourceContext.capturedAt || new Date().toISOString(),
      expediente: raw.sourceContext.expediente,
      acts: Array.isArray(raw.sourceContext.acts) ? raw.sourceContext.acts : [],
      properties: Array.isArray(raw.sourceContext.properties) ? raw.sourceContext.properties : [],
      parties: Array.isArray(raw.sourceContext.parties) ? raw.sourceContext.parties : [],
    } : base.sourceContext,
    iva: { ...base.iva!, ...(raw.iva || {}) },
    deductions: Array.isArray(raw.deductions) ? raw.deductions : [],
    specialCases: Array.isArray(raw.specialCases) ? raw.specialCases : [],
  };
};

const defaultInput = (exercise: number, operationType: ISRCalculationInput['operationType']): ISRCalculationInput => ({
  operationType, taxYear: exercise,
  taxpayer: { fullName: '', rfc: '', curp: '', personType: 'FISICA', fiscalResidence: 'NO_CONFIRMADA', confirmed: false },
  property: { description: '', landAndConstructionSameAcquisitionDate: true },
  sourceContext: { capturedAt: new Date().toISOString(), acts: [], properties: [], parties: [] },
  iva: { applies: false, suggestedFromProperty: false, reviewNote: '' },
  acquisitionDate: '', saleDate: '', yearsElapsed: 1, salePrice: '', deductions: [],
  exemptionTreatment: 'PENDIENTE_REVISION', ordinaryCaseConfirmed: false, specialCases: [],
});

const statusFrom = (input: ISRCalculationInput, hadVersion: boolean) => {
  if (input.operationType !== 'ENAJENACION_INMUEBLE' || input.specialCases.length || input.exemptionTreatment === 'SOLICITADA' || input.iva?.applies) return 'REQUIERE_REVISION' as const;
  const complete = Boolean(input.taxpayer.fullName && input.taxpayer.rfc && input.taxpayer.confirmed && input.taxpayer.fiscalResidence === 'MEXICO' && input.property.description && input.acquisitionDate && input.saleDate && input.salePrice && input.ordinaryCaseConfirmed && input.exemptionTreatment === 'NO_APLICA_CONFIRMADO' && input.deductions.every((item) => !item.included || item.confirmed));
  if (hadVersion) return 'CALCULADO' as const;
  return complete ? 'LISTO_PARA_CALCULAR' as const : 'BORRADOR' as const;
};

const mapRuleSet = (record: any): ISRRuleSetSnapshot => ({
  id: record.id, key: record.clave, version: record.version, taxYear: record.ejercicio,
  operationType: record.tipo_operacion, jurisdiction: record.jurisdiccion,
  validFrom: record.vigencia_desde.toISOString().slice(0, 10), validTo: record.vigencia_hasta.toISOString().slice(0, 10),
  normativeSource: record.fuente_normativa, sourceUrl: record.fuente_url,
  yearsCap: Number(record.parametros?.years_cap || 20), rounding: 'HALF_UP_CENT',
  brackets: record.rate_tables[0].brackets.map((bracket: any): ISRRateBracket => ({
    order: bracket.orden, lower: bracket.limite_inferior.toFixed(2), upper: bracket.limite_superior?.toFixed(2) ?? null,
    fixedFee: bracket.cuota_fija.toFixed(2), percentage: bracket.porcentaje.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
  })),
});

const inputSummary = (input: ISRCalculationInput) => ({
  contribuyente_nombre: input.taxpayer.fullName.trim() || null,
  contribuyente_rfc: input.taxpayer.rfc.trim().toUpperCase() || null,
  inmueble_descripcion: input.property.description.trim() || null,
});

export class ISRService {
  constructor(private readonly db: Db = prisma) {}

  private async expedienteInput(db: any, user: AuthUser, expedienteId: string) {
    const expediente = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) },
      include: {
        actos: { where: { estatus: 'ACTIVO' }, include: { tipo_acto: { select: { id: true, nombre: true } } }, orderBy: { created_at: 'asc' } },
        predios: { where: { estatus: 'ACTIVO' }, include: { predio: true, actos: { where: { estatus: 'ACTIVO' }, select: { expediente_acto_id: true } } }, orderBy: { created_at: 'asc' } },
        comparecientes: { where: { estatus: 'ACTIVO', archived_at: null }, include: { caracter: { select: { nombre: true } }, expedienteActo: { select: { id: true } }, compareciente: { include: { personaFisica: true, personaMoral: true } } }, orderBy: [{ orden_comparecencia: 'asc' }, { created_at: 'asc' }] },
      },
    });
    if (!expediente) throw new ISRValidationError('EXPEDIENT_ACCESS_DENIED', 'No tienes acceso al expediente seleccionado.', undefined, 403);
    const capturedAt = new Date().toISOString();
    const properties = expediente.predios.map((link: any) => ({
      relationId: link.id, predioId: link.predio_id, actIds: link.actos.map((item: any) => item.expediente_acto_id),
      version: link.predio.version, label: link.predio.apodo || link.predio.ubicacion_texto || link.predio.clave_catastral || 'Inmueble',
      description: link.predio.descripcion || link.predio.ubicacion_texto || '',
      landSurfaceM2: moneyString(link.predio.superficie_terreno_m2), constructionSurfaceM2: moneyString(link.predio.superficie_construccion_m2),
      commercialConstructionSurfaceM2: moneyString(link.predio.superficie_construccion_comercial_m2),
      cadastralValue: moneyString(link.predio.valor_catastral), appraisalValue: moneyString(link.predio.valor_avaluo),
      operationValue: moneyString(link.predio.valor_operacion),
      ivaSuggested: Boolean(link.predio.superficie_construccion_comercial_m2 && Number(link.predio.superficie_construccion_comercial_m2) > 0),
    }));
    const parties = expediente.comparecientes.map((link: any) => {
      const physical = link.compareciente.personaFisica; const moral = link.compareciente.personaMoral;
      return {
        relationId: link.id, comparecienteId: link.compareciente_id, actId: link.expediente_acto_id || null,
        role: link.caracter?.nombre || 'Compareciente', name: physical?.nombre_completo_calculado || moral?.razon_social || link.compareciente.nombre_busqueda,
        personType: link.compareciente.tipo_persona, rfc: physical?.rfc || moral?.rfc || '', curp: physical?.curp || '',
        nationality: physical?.nacionalidad || moral?.nacionalidad || '', fiscalResidence: 'NO_CONFIRMADA' as const,
        participationPercentage: moneyString(link.participacion_porcentaje), validated: Boolean(link.datos_validados),
      };
    });
    const firstProperty = properties[0]; const firstParty = parties.find((item: any) => item.personType === 'FISICA') || parties[0];
    const input = defaultInput(new Date().getFullYear(), 'ENAJENACION_INMUEBLE');
    input.sourceContext = {
      capturedAt, expediente: { id: expediente.id, number: expediente.numero_pravia, version: expediente.version },
      acts: expediente.actos.map((item: any) => ({ id: item.id, typeId: item.tipo_acto_id, name: item.tipo_acto.nombre })), properties, parties,
    };
    input.property = {
      ...input.property, sourcePredioId: firstProperty?.predioId, description: firstProperty?.description || String((expediente.datos_operacion as any)?.inmueble || ''),
      landSurfaceM2: firstProperty?.landSurfaceM2, constructionSurfaceM2: firstProperty?.constructionSurfaceM2,
      commercialConstructionSurfaceM2: firstProperty?.commercialConstructionSurfaceM2, cadastralValue: firstProperty?.cadastralValue,
      appraisalValue: firstProperty?.appraisalValue, operationValue: firstProperty?.operationValue,
    };
    input.salePrice = moneyString(expediente.valor_operacion) || firstProperty?.operationValue || '';
    input.iva = { applies: false, suggestedFromProperty: properties.some((item: any) => item.ivaSuggested), reviewNote: '' };
    if (firstParty) input.taxpayer = { fullName: firstParty.name, rfc: firstParty.rfc, curp: firstParty.curp, personType: firstParty.personType, fiscalResidence: firstParty.fiscalResidence, confirmed: false };
    return { expediente, input };
  }

  async list(user: AuthUser, query: Record<string, unknown>) {
    const search = String(query.search || '').trim();
    const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where: any = {
      organization_id: user.organizationId, archived_at: null, ...isrObjectWhere(user),
      ...(query.expediente_id ? { expediente_id: String(query.expediente_id) } : {}),
      ...(query.tipo_operacion ? { tipo_operacion: query.tipo_operacion } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.ejercicio ? { ejercicio: Number(query.ejercicio) } : {}),
      ...(search ? { OR: [
        { folio: { contains: search, mode: 'insensitive' } }, { contribuyente_nombre: { contains: search, mode: 'insensitive' } },
        { contribuyente_rfc: { contains: search, mode: 'insensitive' } }, { inmueble_descripcion: { contains: search, mode: 'insensitive' } },
        { expediente: { numero_pravia: { contains: search, mode: 'insensitive' } } },
      ] } : {}),
    };
    const [items, total, calculated, pending] = await Promise.all([
      this.db.calculoISR.findMany({ where, orderBy: { created_at: query.order === 'oldest' ? 'asc' : 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { expediente: { select: { id: true, numero_pravia: true } }, versiones: { orderBy: { version: 'desc' }, take: 1, select: { result: true } } } }),
      this.db.calculoISR.count({ where }), this.db.calculoISR.count({ where: { ...where, estado: 'CALCULADO' } }),
      this.db.calculoISR.count({ where: { ...where, estado: { in: ['BORRADOR', 'REQUIERE_REVISION'] } } }),
    ]);
    return { data: items, meta: { page, pageSize, total }, kpis: { total, calculated, pending } };
  }

  async get(user: AuthUser, id: string) {
    const record = await this.db.calculoISR.findFirst({
      where: { id, organization_id: user.organizationId, archived_at: null, ...isrObjectWhere(user) },
      include: {
        expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } },
        compareciente: { select: { id: true, nombre_busqueda: true } },
        versiones: { orderBy: { version: 'desc' } },
        documentos: { where: { estatus: 'ACTIVO' }, orderBy: { fecha_vinculo: 'desc' }, include: { documento: true } },
        propuestas: { orderBy: { extracted_at: 'desc' } },
      },
    });
    if (!record) throw new ISRValidationError('ISR_NOT_FOUND', 'El cálculo no existe o no está dentro de tu alcance.', undefined, 404);
    return record;
  }

  async create(user: AuthUser, body: Record<string, unknown>) {
    const exercise = Number(body.ejercicio) || new Date().getFullYear();
    const operationType = (body.tipo_operacion || 'ENAJENACION_INMUEBLE') as ISRCalculationInput['operationType'];
    const expedienteId = body.expediente_id ? String(body.expediente_id) : null;
    if (expedienteId) return (await this.openForExpediente(user, expedienteId, String(body.idempotency_key || ''))).data;
    const comparecienteId = body.compareciente_id ? String(body.compareciente_id) : null;
    let contribuyenteSnapshot: Prisma.InputJsonValue | undefined;
    let proposedInput = defaultInput(exercise, operationType);
    if (comparecienteId) {
      const compareciente = await this.db.compareciente.findFirst({ where: { id: comparecienteId, organization_id: user.organizationId, archived_at: null, ...comparecienteObjectWhere(user) }, include: { personaFisica: true, personaMoral: true } });
      if (!compareciente) throw new ISRValidationError('COMPARECIENTE_ACCESS_DENIED', 'No tienes acceso al compareciente seleccionado.', undefined, 403);
      const person = compareciente.personaFisica; const organization = compareciente.personaMoral;
      const taxpayer = { fullName: person?.nombre_completo_calculado || organization?.razon_social || compareciente.nombre_busqueda, rfc: person?.rfc || organization?.rfc || '', curp: person?.curp || '', personType: compareciente.tipo_persona, fiscalResidence: 'NO_CONFIRMADA', confirmed: false } as ISRCalculationInput['taxpayer'];
      proposedInput = { ...proposedInput, taxpayer };
      contribuyenteSnapshot = json({ compareciente_id: compareciente.id, captured_at: new Date().toISOString(), nombre: taxpayer.fullName, rfc: taxpayer.rfc, curp: taxpayer.curp, tipo_persona: taxpayer.personType });
    }
    const folio = `ISR-${exercise}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const idempotencyKey = String(body.idempotency_key || '').trim() || null;
    const record = await this.db.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.calculoISR.findFirst({ where: { organization_id: user.organizationId, idempotency_key: idempotencyKey, archived_at: null } });
        if (existing) return existing;
      }
      const created = await tx.calculoISR.create({ data: { organization_id: user.organizationId, folio, tipo_operacion: operationType, estado: 'BORRADOR', ejercicio: exercise, expediente_id: null, compareciente_id: comparecienteId, contribuyente_snapshot: contribuyenteSnapshot, input_data: json(proposedInput), ...inputSummary(proposedInput), idempotency_key: idempotencyKey, creado_por_id: user.id, actualizado_por_id: user.id } });
      await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'CREAR_CALCULO_ISR', entidad: 'CalculoISR', entidad_id: created.id, detalles: json({ folio, expediente_id: expedienteId }) } });
      return created;
    });
    return record;
  }

  async openForExpediente(user: AuthUser, expedienteId: string, idempotencyKey = '') {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:isr001-open:${user.organizationId}:${expedienteId}`}))`);
      const { expediente, input } = await this.expedienteInput(tx, user, expedienteId);
      const existing = await tx.calculoISR.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId, archived_at: null }, orderBy: { created_at: 'asc' } });
      if (existing) return { data: existing, created: false, idempotent: true };
      const folio = `ISR-${input.taxYear}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await tx.calculoISR.create({ data: {
        organization_id: user.organizationId, folio, tipo_operacion: input.operationType, estado: 'BORRADOR', ejercicio: input.taxYear,
        expediente_id: expedienteId, compareciente_id: null, input_data: json(input), ...inputSummary(input),
        idempotency_key: idempotencyKey.trim() || null, creado_por_id: user.id, actualizado_por_id: user.id,
      } });
      await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'CREAR_CALCULO_ISR', entidad: 'CalculoISR', entidad_id: created.id, detalles: json({ folio, expediente_id: expedienteId, source: 'ISR-001', prefilled: true }) } });
      await tx.expedienteActividad.create({ data: { organization_id: user.organizationId, expediente_id: expediente.id, usuario_id: user.id, tipo: 'AUDITORIA', categoria: 'OPERACION', titulo: 'Cálculo ISR vinculado', descripcion: `Se creó y vinculó el cálculo ${folio}.`, metadatos: json({ source: 'ISR-001', action: 'OPEN_ISR', calculo_isr_id: created.id }), seccion_relacionada: 'isr', entidad_relacionada: 'CalculoISR', entidad_relacionada_id: created.id } });
      return { data: created, created: true, idempotent: false };
    });
  }

  async update(user: AuthUser, id: string, body: Record<string, unknown>) {
    const current = await this.get(user, id);
    const input = safeInput(body.input_data || current.input_data);
    if (input.taxYear !== current.ejercicio || input.operationType !== current.tipo_operacion) throw new ISRValidationError('IMMUTABLE_DISCRIMINATOR', 'El tipo de operación y el ejercicio no pueden cambiarse en este cálculo.');
    if (body.expected_updated_at && new Date(String(body.expected_updated_at)).getTime() !== new Date(current.updated_at).getTime()) {
      throw new ISRValidationError('ISR_STALE_STATE', 'El cálculo cambió en otra sesión. Recarga antes de guardar.', undefined, 409);
    }
    if (body.expediente_id && String(body.expediente_id) !== current.expediente_id) {
      const allowed = await this.db.expediente.findFirst({ where: { id: String(body.expediente_id), organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } });
      if (!allowed) throw new ISRValidationError('EXPEDIENT_ACCESS_DENIED', 'No tienes acceso al expediente seleccionado.', undefined, 403);
    }
    if (body.compareciente_id && String(body.compareciente_id) !== current.compareciente_id) {
      const allowed = await this.db.compareciente.findFirst({ where: { id: String(body.compareciente_id), organization_id: user.organizationId, archived_at: null, ...comparecienteObjectWhere(user) }, select: { id: true } });
      if (!allowed) throw new ISRValidationError('COMPARECIENTE_ACCESS_DENIED', 'No tienes acceso al compareciente seleccionado.', undefined, 403);
    }
    const changed = JSON.stringify(current.input_data) !== JSON.stringify(input);
    const nextStatus = statusFrom(input, current.ultima_version > 0 && !changed);
    return this.db.$transaction(async (tx) => {
      const nextExpedienteId = Object.prototype.hasOwnProperty.call(body, 'expediente_id') ? (body.expediente_id ? String(body.expediente_id) : null) : current.expediente_id;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:isr001-link:${user.organizationId}:${nextExpedienteId || id}`}))`);
      const lockedCurrent = await tx.calculoISR.findFirst({ where: { id, organization_id: user.organizationId, archived_at: null, ...isrObjectWhere(user) }, select: { updated_at: true } });
      if (!lockedCurrent || new Date(lockedCurrent.updated_at).getTime() !== new Date(current.updated_at).getTime()) throw new ISRValidationError('ISR_STALE_STATE', 'El cálculo cambió en otra sesión. Recarga antes de guardar.', undefined, 409);
      if (nextExpedienteId && nextExpedienteId !== current.expediente_id) {
        const occupied = await tx.calculoISR.findFirst({ where: { organization_id: user.organizationId, expediente_id: nextExpedienteId, archived_at: null, id: { not: id } }, select: { id: true, folio: true } });
        if (occupied && body.replace_existing !== true) throw new ISRValidationError('ISR_EXPEDIENT_OCCUPIED', `El expediente ya tiene vinculado el cálculo ${occupied.folio}. Elige Reemplazar o Cancelar.`, undefined, 409);
        if (occupied) {
          await tx.calculoISR.update({ where: { id: occupied.id }, data: { expediente_id: null, actualizado_por_id: user.id } });
          await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'REEMPLAZAR_VINCULO_EXPEDIENTE_ISR', entidad: 'CalculoISR', entidad_id: occupied.id, detalles: json({ expediente_id: nextExpedienteId, reemplazado_por_calculo_id: id }) } });
          await tx.expedienteActividad.create({ data: { organization_id: user.organizationId, expediente_id: nextExpedienteId, usuario_id: user.id, tipo: 'AUDITORIA', categoria: 'OPERACION', titulo: 'Cálculo ISR reemplazado', descripcion: `${occupied.folio} quedó desvinculado y se conserva en el módulo global.`, metadatos: json({ source: 'ISR-001', action: 'REPLACE_ISR', previous_calculo_isr_id: occupied.id, next_calculo_isr_id: id }), seccion_relacionada: 'isr', entidad_relacionada: 'CalculoISR', entidad_relacionada_id: id } });
        }
      }
      const updated = await tx.calculoISR.update({ where: { id }, data: { input_data: json(input), contribuyente_snapshot: body.contribuyente_snapshot ? json(body.contribuyente_snapshot) : undefined, compareciente_id: body.compareciente_id === null ? null : body.compareciente_id ? String(body.compareciente_id) : undefined, expediente_id: body.expediente_id === null ? null : body.expediente_id ? String(body.expediente_id) : undefined, ...inputSummary(input), estado: nextStatus, datos_modificados: current.ultima_version > 0 && changed, actualizado_por_id: user.id } });
      await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'EDITAR_CALCULO_ISR', entidad: 'CalculoISR', entidad_id: id, valores_anteriores: json({ input_data: current.input_data }), valores_nuevos: json({ input_data: input }), detalles: json({ datos_modificados: changed }) } });
      if (Object.prototype.hasOwnProperty.call(body, 'expediente_id') && (body.expediente_id || null) !== current.expediente_id) {
        const nextExpedienteId = body.expediente_id ? String(body.expediente_id) : null;
        await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'VINCULAR_EXPEDIENTE_ISR', entidad: 'CalculoISR', entidad_id: id, detalles: json({ expediente_anterior_id: current.expediente_id, expediente_nuevo_id: nextExpedienteId }) } });
        if (current.expediente_id) await tx.expedienteActividad.create({ data: { organization_id: user.organizationId, expediente_id: current.expediente_id, usuario_id: user.id, tipo: 'AUDITORIA', categoria: 'OPERACION', titulo: 'Cálculo ISR desvinculado', descripcion: `El cálculo ${current.folio} dejó de estar vinculado a este expediente.`, metadatos: json({ source: 'EXP-009', action: 'UNLINK_ISR', calculo_isr_id: id }), seccion_relacionada: 'isr', entidad_relacionada: 'CalculoISR', entidad_relacionada_id: id } });
        if (nextExpedienteId) await tx.expedienteActividad.create({ data: { organization_id: user.organizationId, expediente_id: nextExpedienteId, usuario_id: user.id, tipo: 'AUDITORIA', categoria: 'OPERACION', titulo: 'Cálculo ISR vinculado', descripcion: `Se vinculó el cálculo ${current.folio} al expediente.`, metadatos: json({ source: 'EXP-009', action: 'LINK_ISR', calculo_isr_id: id }), seccion_relacionada: 'isr', entidad_relacionada: 'CalculoISR', entidad_relacionada_id: id } });
      }
      return updated;
    });
  }

  async unlinkFromExpediente(user: AuthUser, id: string) {
    const current = await this.get(user, id);
    if (!current.expediente_id) return { data: current, idempotent: true };
    const updated = await this.update(user, id, { input_data: current.input_data, expediente_id: null, expected_updated_at: current.updated_at.toISOString() });
    return { data: updated, idempotent: false };
  }

  async calculate(user: AuthUser, id: string, options: { expectedVersion?: number; requestKey?: string } = {}) {
    await this.get(user, id);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:isr001-calculate:${user.organizationId}:${id}`}))`);
      const current = await tx.calculoISR.findFirst({ where: { id, organization_id: user.organizationId, archived_at: null, ...isrObjectWhere(user) }, include: { versiones: { orderBy: { version: 'desc' } }, documentos: { where: { estatus: 'ACTIVO' }, select: { documento_id: true } } } });
      if (!current) throw new ISRValidationError('ISR_NOT_FOUND', 'El cálculo no existe o no está dentro de tu alcance.', undefined, 404);
      const requestKey = String(options.requestKey || '').trim();
      if (requestKey) {
        const prior = await tx.calculoISRVersion.findFirst({ where: { organization_id: user.organizationId, calculo_id: id, request_key: requestKey } });
        if (prior) return prior;
      }
      if (options.expectedVersion !== undefined && options.expectedVersion !== current.ultima_version) throw new ISRValidationError('ISR_STALE_VERSION', 'El cálculo cambió en otra sesión. Recarga antes de recalcular.', undefined, 409);
      const input = safeInput(current.input_data);
      const linkedDocumentIds = new Set(current.documentos.map((item) => item.documento_id));
      const missingSupport = input.deductions.find((item) => item.included && (!item.supportDocumentId || !linkedDocumentIds.has(item.supportDocumentId)));
      if (missingSupport) throw new ISRValidationError('ISR_SUPPORT_DOCUMENT_INVALID', `El soporte de “${missingSupport.concept || 'la deducción'}” no está vinculado a este cálculo.`, `deductions.${missingSupport.id}`);
      const ruleRecord = await tx.fiscalRuleSet.findFirst({ where: { ejercicio: current.ejercicio, tipo_operacion: current.tipo_operacion, activo: true, vigencia_desde: { lte: new Date(`${input.saleDate}T00:00:00Z`) }, OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: new Date(`${input.saleDate}T00:00:00Z`) } }] }, include: { rate_tables: { include: { brackets: { orderBy: { orden: 'asc' } } } } } });
      if (!ruleRecord?.rate_tables[0]) throw new ISRValidationError('RULESET_NOT_FOUND', `No existe una tarifa confirmada para el ejercicio ${current.ejercicio}.`);
      const rules = mapRuleSet(ruleRecord); const result = calculateISR(input, rules); const version = current.ultima_version + 1;
      const created = await tx.calculoISRVersion.create({ data: { organization_id: user.organizationId, calculo_id: id, version, request_key: requestKey || null, rule_set_id: ruleRecord.id, input_snapshot: json(input), ruleset_snapshot: json(rules), breakdown: json(result.breakdown), result: json(result), calculado_por_id: user.id } });
      await tx.calculoISR.update({ where: { id }, data: { estado: 'CALCULADO', ultima_version: version, datos_modificados: false, actualizado_por_id: user.id } });
      await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: version === 1 ? 'GENERAR_CALCULO_ISR' : 'RECALCULAR_ISR', entidad: 'CalculoISR', entidad_id: id, detalles: json({ version, request_key: requestKey || null, ruleset: rules.version, scope: result.scope, provisionalFederalISR: result.provisionalFederalISR }) } });
      return created;
    });
  }

  async generatePdf(user: AuthUser, id: string, options: { expectedVersion?: number; idempotencyKey?: string } = {}) {
    if (!user.permissions.includes('isr.calculate') || !user.permissions.includes('documentos.write')) {
      throw new ISRValidationError('ISR_PDF_PERMISSION_DENIED', 'No tienes permiso para generar la determinación fiscal.', undefined, 403);
    }
    const current = await this.get(user, id);
    const idempotencyKey = String(options.idempotencyKey || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new ISRValidationError('ISR_PDF_IDEMPOTENCY_REQUIRED', 'No fue posible identificar de forma segura esta generación.');
    const existing = current.documentos.find((item) => item.idempotency_key === idempotencyKey && item.estatus === 'ACTIVO');
    if (existing) return { data: existing.documento, idempotent: true };
    const latest = current.versiones[0];
    if (!latest || current.ultima_version < 1 || current.datos_modificados) throw new ISRValidationError('ISR_PDF_CALCULATION_REQUIRED', 'Calcula la versión vigente antes de generar el PDF.', undefined, 409);
    if (options.expectedVersion !== undefined && options.expectedVersion !== current.ultima_version) throw new ISRValidationError('ISR_STALE_VERSION', 'El cálculo cambió en otra sesión. Recarga antes de generar el PDF.', undefined, 409);
    const artifact = await this.db.catalogoArtefacto.findFirst({
      where: { organization_id: user.organizationId, activo: true, OR: [{ nombre: { contains: 'ISR', mode: 'insensitive' } }, { nombre: { contains: 'determinación fiscal', mode: 'insensitive' } }] },
      include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updated_at: 'desc' },
    });
    const format = artifact?.versiones[0];
    if (!format) throw new ISRValidationError('ISR_PDF_FORMAT_REQUIRED', 'Configura y activa el formato de determinación ISR antes de generar el PDF.', undefined, 409);
    const formatSource = `CONFIGURACION:${artifact!.id}:V${format.version}`;
    const generatedAt = new Date();
    const input = safeInput(latest.input_snapshot);
    const result = latest.result as unknown as ReturnType<typeof calculateISR>;
    const buffer = renderISRDeterminationPdf({ folio: current.folio, version: current.ultima_version, generatedDate: generatedAt.toISOString().slice(0, 10), input, result, formatSource });
    const safeFolio = current.folio.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileName = `Determinacion_ISR_${safeFolio}_V${current.ultima_version}.pdf`;
    const storageKey = `organizations/${user.organizationId}/isr/${id}/determinaciones/${crypto.randomUUID()}_${fileName}`;
    await uploadFile(buffer, storageKey, 'application/pdf');
    try {
      const created = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:isr001-pdf:${user.organizationId}:${id}`}))`);
        const concurrent = await tx.calculoISRDocumento.findFirst({ where: { organization_id: user.organizationId, calculo_id: id, idempotency_key: idempotencyKey, estatus: 'ACTIVO' }, include: { documento: true } });
        if (concurrent) return { data: concurrent.documento, idempotent: true, discardUpload: true };
        const locked = await tx.calculoISR.findFirst({ where: { id, organization_id: user.organizationId, archived_at: null, ...isrObjectWhere(user) }, select: { ultima_version: true, datos_modificados: true, expediente_id: true } });
        if (!locked || locked.ultima_version !== current.ultima_version || locked.datos_modificados) throw new ISRValidationError('ISR_STALE_VERSION', 'El cálculo cambió durante la generación. Recarga e intenta nuevamente.', undefined, 409);
        const document = await tx.documento.create({ data: {
          organization_id: user.organizationId, nombre_original: fileName, nombre_interno: `${crypto.randomUUID()}-${fileName}`,
          tipo: 'ISR_DETERMINACION', categoria: 'OTROS', storage_key: storageKey, mime_type: 'application/pdf', size_bytes: buffer.length,
          checksum_sha256: crypto.createHash('sha256').update(buffer).digest('hex'), estatus: 'VIGENTE', subido_por_id: user.id,
          expediente_id: locked.expediente_id, datos_extraidos: json({ isr001: { calculo_id: id, version: current.ultima_version, format_source: formatSource, format_version_id: format.id, generated_at: generatedAt.toISOString() } }),
        } });
        await tx.calculoISRDocumento.create({ data: { organization_id: user.organizationId, calculo_id: id, documento_id: document.id, creado_por_id: user.id, idempotency_key: idempotencyKey, generated_from_version: current.ultima_version, format_source: formatSource } });
        if (locked.expediente_id) await tx.expedienteDocumento.create({ data: {
          organization_id: user.organizationId, expediente_id: locked.expediente_id, documento_id: document.id, tipo_vinculo: 'ISR_DETERMINACION', creado_por_id: user.id,
          origen: 'EXPEDIENTE', source_entity_type: 'CalculoISR', source_entity_id: id, source_context: 'DETERMINACION_ISR',
          source_key: `EXPEDIENTE:CalculoISR:${id}:${document.id}:ISR_DETERMINACION`, document_version: `ISR-${current.ultima_version}`,
          provenance: json({ source: 'ISR-001', calculo_isr_id: id, calculation_version: current.ultima_version, format_source: formatSource }),
        } });
        await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'GENERAR_PDF_ISR', entidad: 'CalculoISR', entidad_id: id, detalles: json({ documento_id: document.id, version: current.ultima_version, format_source: formatSource }) } });
        if (locked.expediente_id) await tx.expedienteActividad.create({ data: { organization_id: user.organizationId, expediente_id: locked.expediente_id, usuario_id: user.id, tipo: 'AUDITORIA', categoria: 'DOCUMENTOS', titulo: 'Determinación ISR generada', descripcion: `Se generó la versión ${current.ultima_version} del cálculo ${current.folio}.`, metadatos: json({ source: 'ISR-001', action: 'GENERATE_ISR_PDF', calculo_isr_id: id, documento_id: document.id }), seccion_relacionada: 'documentos', entidad_relacionada: 'Documento', entidad_relacionada_id: document.id } });
        return { data: document, idempotent: false, discardUpload: false };
      });
      if (created.discardUpload) await deleteFile(storageKey).catch(() => undefined);
      return { data: created.data, idempotent: created.idempotent };
    } catch (error) {
      await deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async extract(user: AuthUser, id: string, options: { requestKey?: string } = {}) {
    const current = await this.get(user, id);
    const requestKey = String(options.requestKey || '').trim();
    const operationId = requestKey ? `isr-extraction:${user.organizationId}:${id}:${requestKey}` : '';
    if (operationId) {
      const priorUsage = await this.db.aIUsageLog.findFirst({
        where: { organization_id: user.organizationId, operation_id: { startsWith: `${operationId}:` }, estatus: 'COMPLETADO' },
        orderBy: { created_at: 'asc' },
      });
      if (priorUsage) {
        return {
          provider: priorUsage.provider,
          model: priorUsage.modelo,
          proposals: current.propuestas.length,
          conflicts: [...new Set(current.propuestas.filter((item) => item.status === 'CONFLICTO').map((item) => item.field_path))],
          idempotent: true,
        };
      }
    }
    const readable: DocumentoParaExtraccion[] = [];
    for (const link of current.documentos) {
      const file = await downloadFile(link.documento.storage_key);
      readable.push({ buffer: file, mimeType: link.documento.mime_type, tipoDocumento: link.documento.tipo, documentoId: link.documento.id, nombreOriginal: link.documento.nombre_original });
    }
    if (!readable.length) throw new ISRValidationError('DOCUMENT_REQUIRED', 'Carga al menos un documento antes de extraer información.');
    const extraction = await extraerMultiplesDocumentos(readable);
    const groups = new Map<string, typeof extraction.campos>();
    for (const field of extraction.campos) { const list = groups.get(field.campo) || []; list.push(field); groups.set(field.campo, list); }
    const conflicts = new Set<string>();
    for (const [field, values] of groups) if (new Set(values.map((value) => value.valor.trim().toUpperCase())).size > 1) conflicts.add(field);
    await this.db.$transaction(async (tx) => {
      await tx.calculoISRPropuesta.deleteMany({ where: { organization_id: user.organizationId, calculo_id: id, status: { in: ['PENDIENTE', 'CONFLICTO'] } } });
      for (const field of extraction.campos) {
        const doc = readable.find((item) => item.documentoId === field.documento_id) || readable[0];
        await tx.calculoISRPropuesta.create({ data: { organization_id: user.organizationId, calculo_id: id, field_path: field.campo, proposed_value: json(field.valor), status: conflicts.has(field.campo) ? 'CONFLICTO' : 'PENDIENTE', source_document_id: doc.documentoId, source_document_name: doc.nombreOriginal, source_page: field.pagina, confidence: field.confianza === 'LECTURA_CLARA' ? new Prisma.Decimal('0.95') : field.confianza === 'LECTURA_DUDOSA' ? new Prisma.Decimal('0.65') : new Prisma.Decimal('0.35'), model_version: extraction.modelo || getOpenAIModelName(), source_fragment: field.fragmento?.slice(0, 400), conflict_group: conflicts.has(field.campo) ? field.campo : null } });
      }
      for (const [index, usage] of (extraction.usos || (extraction.uso ? [extraction.uso] : [])).entries()) {
        await recordAIUsageInDb(tx, usage, {
          operacion: 'ISR_DOCUMENT_EXTRACTION', usuarioId: user.id, expedienteId: current.expediente_id,
          organizationId: user.organizationId, operationId: operationId ? `${operationId}:${index}` : undefined,
          escalamientoMotivo: usage.escalamiento_utilizado ? 'Datos documentales contradictorios o de baja confianza' : undefined,
          metadata: { module: 'ISR-001', calculo_isr_id: id, document_count: readable.length, proposal_count: extraction.campos.length },
        });
      }
      await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'EXTRAER_DATOS_ISR_IA', entidad: 'CalculoISR', entidad_id: id, detalles: json({ documentos: readable.length, propuestas: extraction.campos.length, conflictos: conflicts.size, persistencia_input: false }) } });
    });
    return { provider: extraction.proveedor, model: extraction.modelo, proposals: extraction.campos.length, conflicts: [...conflicts], idempotent: false };
  }

  async reviewProposal(user: AuthUser, id: string, proposalId: string, action: 'ACEPTADA' | 'RECHAZADA') {
    await this.get(user, id);
    const proposal = await this.db.calculoISRPropuesta.findFirst({ where: { id: proposalId, organization_id: user.organizationId, calculo_id: id } });
    if (!proposal) throw new ISRValidationError('PROPOSAL_NOT_FOUND', 'La propuesta ya no está disponible.');
    const updated = await this.db.calculoISRPropuesta.update({ where: { id: proposalId }, data: { status: action, reviewed_by_id: user.id, reviewed_at: new Date() } });
    await this.db.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: action === 'ACEPTADA' ? 'ACEPTAR_PROPUESTA_ISR_IA' : 'RECHAZAR_PROPUESTA_ISR_IA', entidad: 'CalculoISR', entidad_id: id, detalles: json({ propuesta_id: proposalId, campo: proposal.field_path }) } });
    return updated;
  }
}

export const isrService = new ISRService();
