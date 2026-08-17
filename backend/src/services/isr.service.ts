import crypto from 'crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { downloadFile } from './supabase.service';
import { extraerMultiplesDocumentos, getOpenAIModelName, type DocumentoParaExtraccion } from './openaiDocument.service';
import { calculateISR, ISRCalculationInput, ISRRateBracket, ISRRuleSetSnapshot, ISRValidationError } from '../domain/isrTaxEngine';
import { comparecienteObjectWhere } from './objectAccess.service';

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
const safeInput = (value: unknown): ISRCalculationInput => value as ISRCalculationInput;

const defaultInput = (exercise: number, operationType: ISRCalculationInput['operationType']): ISRCalculationInput => ({
  operationType, taxYear: exercise,
  taxpayer: { fullName: '', rfc: '', curp: '', personType: 'FISICA', fiscalResidence: 'NO_CONFIRMADA', confirmed: false },
  property: { description: '', landAndConstructionSameAcquisitionDate: true },
  acquisitionDate: '', saleDate: '', yearsElapsed: 1, salePrice: '', deductions: [],
  exemptionTreatment: 'PENDIENTE_REVISION', ordinaryCaseConfirmed: false, specialCases: [],
});

const statusFrom = (input: ISRCalculationInput, hadVersion: boolean) => {
  if (input.operationType !== 'ENAJENACION_INMUEBLE' || input.specialCases.length || input.exemptionTreatment === 'SOLICITADA') return 'REQUIERE_REVISION' as const;
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

  async list(user: AuthUser, query: Record<string, unknown>) {
    const search = String(query.search || '').trim();
    const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where: any = {
      archived_at: null, ...isrObjectWhere(user),
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
      where: { id, archived_at: null, ...isrObjectWhere(user) },
      include: {
        expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } },
        compareciente: { select: { id: true, nombre_busqueda: true } },
        versiones: { orderBy: { version: 'desc' } },
        documentos: { where: { estatus: 'ACTIVO' }, orderBy: { fecha_vinculo: 'desc' }, include: { documento: true } },
        propuestas: { orderBy: { extracted_at: 'desc' } },
      },
    });
    if (!record) throw new ISRValidationError('ISR_NOT_FOUND', 'El cálculo no existe o no está dentro de tu alcance.');
    return record;
  }

  async create(user: AuthUser, body: Record<string, unknown>) {
    const exercise = Number(body.ejercicio) || new Date().getFullYear();
    const operationType = (body.tipo_operacion || 'ENAJENACION_INMUEBLE') as ISRCalculationInput['operationType'];
    const expedienteId = body.expediente_id ? String(body.expediente_id) : null;
    const comparecienteId = body.compareciente_id ? String(body.compareciente_id) : null;
    let contribuyenteSnapshot: Prisma.InputJsonValue | undefined;
    let proposedInput = defaultInput(exercise, operationType);
    if (expedienteId) {
      const expediente = await this.db.expediente.findFirst({ where: { id: expedienteId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true, cliente_alias: true, valor_operacion: true, datos_operacion: true } });
      if (!expediente) throw new ISRValidationError('EXPEDIENT_ACCESS_DENIED', 'No tienes acceso al expediente seleccionado.');
      proposedInput = { ...proposedInput, taxpayer: { ...proposedInput.taxpayer, fullName: expediente.cliente_alias || '' }, salePrice: expediente.valor_operacion?.toFixed(2) || '', property: { ...proposedInput.property, description: String((expediente.datos_operacion as any)?.inmueble || '') } };
    }
    if (comparecienteId) {
      const compareciente = await this.db.compareciente.findFirst({ where: { id: comparecienteId, archived_at: null, ...comparecienteObjectWhere(user) }, include: { personaFisica: true, personaMoral: true } });
      if (!compareciente) throw new ISRValidationError('COMPARECIENTE_ACCESS_DENIED', 'No tienes acceso al compareciente seleccionado.');
      const person = compareciente.personaFisica; const organization = compareciente.personaMoral;
      const taxpayer = { fullName: person?.nombre_completo_calculado || organization?.razon_social || compareciente.nombre_busqueda, rfc: person?.rfc || organization?.rfc || '', curp: person?.curp || '', personType: compareciente.tipo_persona, fiscalResidence: 'NO_CONFIRMADA', confirmed: false } as ISRCalculationInput['taxpayer'];
      proposedInput = { ...proposedInput, taxpayer };
      contribuyenteSnapshot = json({ compareciente_id: compareciente.id, captured_at: new Date().toISOString(), nombre: taxpayer.fullName, rfc: taxpayer.rfc, curp: taxpayer.curp, tipo_persona: taxpayer.personType });
    }
    const folio = `ISR-${exercise}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const record = await this.db.$transaction(async (tx) => {
      const created = await tx.calculoISR.create({ data: { folio, tipo_operacion: operationType, estado: 'BORRADOR', ejercicio: exercise, expediente_id: expedienteId, compareciente_id: comparecienteId, contribuyente_snapshot: contribuyenteSnapshot, input_data: json(proposedInput), ...inputSummary(proposedInput), creado_por_id: user.id, actualizado_por_id: user.id } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'CREAR_CALCULO_ISR', entidad: 'CalculoISR', entidad_id: created.id, detalles: json({ folio, expediente_id: expedienteId }) } });
      return created;
    });
    return record;
  }

  async update(user: AuthUser, id: string, body: Record<string, unknown>) {
    const current = await this.get(user, id);
    const input = safeInput(body.input_data || current.input_data);
    if (input.taxYear !== current.ejercicio || input.operationType !== current.tipo_operacion) throw new ISRValidationError('IMMUTABLE_DISCRIMINATOR', 'El tipo de operación y el ejercicio no pueden cambiarse en este cálculo.');
    if (body.expediente_id && String(body.expediente_id) !== current.expediente_id) {
      const allowed = await this.db.expediente.findFirst({ where: { id: String(body.expediente_id), archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } });
      if (!allowed) throw new ISRValidationError('EXPEDIENT_ACCESS_DENIED', 'No tienes acceso al expediente seleccionado.');
    }
    if (body.compareciente_id && String(body.compareciente_id) !== current.compareciente_id) {
      const allowed = await this.db.compareciente.findFirst({ where: { id: String(body.compareciente_id), archived_at: null, ...comparecienteObjectWhere(user) }, select: { id: true } });
      if (!allowed) throw new ISRValidationError('COMPARECIENTE_ACCESS_DENIED', 'No tienes acceso al compareciente seleccionado.');
    }
    const nextStatus = statusFrom(input, current.ultima_version > 0);
    const changed = JSON.stringify(current.input_data) !== JSON.stringify(input);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.calculoISR.update({ where: { id }, data: { input_data: json(input), contribuyente_snapshot: body.contribuyente_snapshot ? json(body.contribuyente_snapshot) : undefined, compareciente_id: body.compareciente_id === null ? null : body.compareciente_id ? String(body.compareciente_id) : undefined, expediente_id: body.expediente_id === null ? null : body.expediente_id ? String(body.expediente_id) : undefined, ...inputSummary(input), estado: nextStatus, datos_modificados: current.ultima_version > 0 && changed, actualizado_por_id: user.id } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'EDITAR_CALCULO_ISR', entidad: 'CalculoISR', entidad_id: id, valores_anteriores: json({ input_data: current.input_data }), valores_nuevos: json({ input_data: input }), detalles: json({ datos_modificados: changed }) } });
      if (Object.prototype.hasOwnProperty.call(body, 'expediente_id') && (body.expediente_id || null) !== current.expediente_id) await tx.auditLog.create({ data: { user_id: user.id, accion: 'VINCULAR_EXPEDIENTE_ISR', entidad: 'CalculoISR', entidad_id: id, detalles: json({ expediente_anterior_id: current.expediente_id, expediente_nuevo_id: body.expediente_id || null }) } });
      return updated;
    });
  }

  async calculate(user: AuthUser, id: string) {
    const current = await this.get(user, id);
    const input = safeInput(current.input_data);
    const ruleRecord = await this.db.fiscalRuleSet.findFirst({ where: { ejercicio: current.ejercicio, tipo_operacion: current.tipo_operacion, activo: true, vigencia_desde: { lte: new Date(`${input.saleDate}T00:00:00Z`) }, OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: new Date(`${input.saleDate}T00:00:00Z`) } }] }, include: { rate_tables: { include: { brackets: { orderBy: { orden: 'asc' } } } } } });
    if (!ruleRecord?.rate_tables[0]) throw new ISRValidationError('RULESET_NOT_FOUND', `No existe una tarifa confirmada para el ejercicio ${current.ejercicio}.`);
    const rules = mapRuleSet(ruleRecord); const result = calculateISR(input, rules); const version = current.ultima_version + 1;
    return this.db.$transaction(async (tx) => {
      const created = await tx.calculoISRVersion.create({ data: { calculo_id: id, version, rule_set_id: ruleRecord.id, input_snapshot: json(input), ruleset_snapshot: json(rules), breakdown: json(result.breakdown), result: json(result), calculado_por_id: user.id } });
      await tx.calculoISR.update({ where: { id }, data: { estado: 'CALCULADO', ultima_version: version, datos_modificados: false, actualizado_por_id: user.id } });
      await tx.auditLog.create({ data: { user_id: user.id, accion: version === 1 ? 'GENERAR_CALCULO_ISR' : 'RECALCULAR_ISR', entidad: 'CalculoISR', entidad_id: id, detalles: json({ version, ruleset: rules.version, scope: result.scope, provisionalFederalISR: result.provisionalFederalISR }) } });
      return created;
    });
  }

  async extract(user: AuthUser, id: string) {
    const current = await this.get(user, id);
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
      await tx.calculoISRPropuesta.deleteMany({ where: { calculo_id: id, status: { in: ['PENDIENTE', 'CONFLICTO'] } } });
      for (const field of extraction.campos) {
        const doc = readable.find((item) => item.documentoId === field.documento_id) || readable[0];
        await tx.calculoISRPropuesta.create({ data: { calculo_id: id, field_path: field.campo, proposed_value: json(field.valor), status: conflicts.has(field.campo) ? 'CONFLICTO' : 'PENDIENTE', source_document_id: doc.documentoId, source_document_name: doc.nombreOriginal, source_page: field.pagina, confidence: field.confianza === 'LECTURA_CLARA' ? new Prisma.Decimal('0.95') : field.confianza === 'LECTURA_DUDOSA' ? new Prisma.Decimal('0.65') : new Prisma.Decimal('0.35'), model_version: extraction.modelo || getOpenAIModelName(), source_fragment: field.fragmento?.slice(0, 400), conflict_group: conflicts.has(field.campo) ? field.campo : null } });
      }
      await tx.auditLog.create({ data: { user_id: user.id, accion: 'EXTRAER_DATOS_ISR_IA', entidad: 'CalculoISR', entidad_id: id, detalles: json({ documentos: readable.length, propuestas: extraction.campos.length, conflictos: conflicts.size, persistencia_input: false }) } });
    });
    return { provider: extraction.proveedor, model: extraction.modelo, proposals: extraction.campos.length, conflicts: [...conflicts] };
  }

  async reviewProposal(user: AuthUser, id: string, proposalId: string, action: 'ACEPTADA' | 'RECHAZADA') {
    await this.get(user, id);
    const proposal = await this.db.calculoISRPropuesta.findFirst({ where: { id: proposalId, calculo_id: id } });
    if (!proposal) throw new ISRValidationError('PROPOSAL_NOT_FOUND', 'La propuesta ya no está disponible.');
    const updated = await this.db.calculoISRPropuesta.update({ where: { id: proposalId }, data: { status: action, reviewed_by_id: user.id, reviewed_at: new Date() } });
    await this.db.auditLog.create({ data: { user_id: user.id, accion: action === 'ACEPTADA' ? 'ACEPTAR_PROPUESTA_ISR_IA' : 'RECHAZAR_PROPUESTA_ISR_IA', entidad: 'CalculoISR', entidad_id: id, detalles: json({ propuesta_id: proposalId, campo: proposal.field_path }) } });
    return updated;
  }
}

export const isrService = new ISRService();
