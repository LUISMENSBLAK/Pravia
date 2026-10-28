import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import { deleteFile, downloadFile, getSignedUrl, uploadFile } from './supabase.service';
import { CfdiProviderUnavailableError, runtimeCfdiProvider, type CfdiProvider } from './cfdiProvider';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { FISCAL_UPLOAD_MAX_BYTES, uploadLimitLabel } from '../config/uploadLimits';
import { cfdiIncomeBalance, RESERVING_CFDI_DRAFT_STATES } from '../domain/cfdiIncomeBalance';
import { renderPrefacturaPdf, type PrefacturaSnapshot } from '../domain/prefacturaPdf';
import { FiscalDocumentExtractionService, FiscalExtractionError } from './fiscalDocumentExtraction.service';

type Database = PrismaClient;

export type FiscalActor = {
  id: string;
  organizationId: string;
  rol: Role;
  permissions: string[];
};

export type UploadedFiscalFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export class FinanceFiscalError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const clean = (value: unknown) => String(value ?? '').trim();
const upper = (value: unknown) => clean(value).toUpperCase();
const RFC = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CP = /^\d{5}$/;
const SECRET_REFERENCE = /^secret:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/;
const XML_MIME = new Set(['application/xml', 'text/xml', 'application/octet-stream']);
const PDF_MIME = new Set(['application/pdf', 'application/octet-stream']);
const FISCAL_STATES = new Set(['VIGENTE', 'TIMBRADO', 'CANCELACION_SOLICITADA', 'CANCELADO', 'SUSTITUIDO']);
const RESERVING_DRAFT_STATES = RESERVING_CFDI_DRAFT_STATES;

function fiscalRegimeCodes(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return fallback ? [fallback] : [];
  return value.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item)
    ? [clean((item as Record<string, unknown>).clave)] : []).filter((code) => /^\d{3}$/.test(code));
}

function required(value: unknown, field: string) {
  const result = clean(value);
  if (!result) throw new FinanceFiscalError(400, 'CFDI_REQUIRED_FIELD', `${field} es obligatorio.`);
  return result;
}

function rfc(value: unknown, field = 'RFC') {
  const result = upper(value);
  if (!RFC.test(result)) throw new FinanceFiscalError(400, 'CFDI_RFC_INVALID', `${field} no tiene un formato válido.`);
  return result;
}

function postalCode(value: unknown, optional = false) {
  const result = clean(value);
  if (!result && optional) return null;
  if (!CP.test(result)) throw new FinanceFiscalError(400, 'CFDI_POSTAL_CODE_INVALID', 'El código postal debe tener cinco dígitos.');
  return result;
}

export function draftFiscalDetails(input: Record<string, unknown>, previous: Record<string, unknown> = {}, allowIncomplete = false) {
  const prior = previous.fiscal_comprobante && typeof previous.fiscal_comprobante === 'object' && !Array.isArray(previous.fiscal_comprobante)
    ? previous.fiscal_comprobante as Record<string, unknown> : {};
  const value = (key: string) => input[key] === undefined ? prior[key] : input[key];
  const moneda = upper(input.moneda === undefined ? previous.moneda || 'MXN' : input.moneda);
  if (!/^[A-Z]{3}$/.test(moneda)) throw new FinanceFiscalError(400, 'CFDI_CURRENCY_INVALID', 'La moneda debe tener una clave ISO de tres letras.');
  const tipoCambio = clean(value('tipo_cambio'));
  if (tipoCambio && (!/^\d+(?:\.\d{1,6})?$/.test(tipoCambio) || new Prisma.Decimal(tipoCambio).lessThanOrEqualTo(0))) {
    throw new FinanceFiscalError(400, 'CFDI_EXCHANGE_RATE_INVALID', 'El tipo de cambio debe ser positivo y tener máximo seis decimales.');
  }
  if (moneda !== 'MXN' && !tipoCambio && !allowIncomplete) throw new FinanceFiscalError(400, 'CFDI_EXCHANGE_RATE_REQUIRED', 'Confirma el tipo de cambio para una moneda distinta de MXN.');
  const exportacion = clean(value('exportacion'));
  if (exportacion && !/^\d{2}$/.test(exportacion)) throw new FinanceFiscalError(400, 'CFDI_EXPORT_INVALID', 'La exportación debe utilizar una clave SAT de dos dígitos.');
  const lugarExpedicion = clean(value('lugar_expedicion'));
  if (lugarExpedicion && !CP.test(lugarExpedicion)) throw new FinanceFiscalError(400, 'CFDI_ISSUE_PLACE_INVALID', 'El lugar de expedición debe ser un código postal de cinco dígitos.');
  const condiciones = clean(value('condiciones_pago'));
  if (condiciones.length > 300) throw new FinanceFiscalError(400, 'CFDI_PAYMENT_TERMS_INVALID', 'Las condiciones de pago no pueden superar 300 caracteres.');
  return { moneda, fiscal_comprobante: { tipo_cambio: tipoCambio || null, exportacion: exportacion || null,
    lugar_expedicion: lugarExpedicion || null, condiciones_pago: condiciones || null } };
}

function decimal(value: unknown, field: string, allowZero = false) {
  const normalized = clean(value).replace(/[$,\s]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new FinanceFiscalError(400, 'CFDI_AMOUNT_INVALID', `${field} debe ser un importe monetario con máximo dos decimales.`);
  const result = new Prisma.Decimal(normalized);
  if (allowZero ? result.lessThan(0) : result.lessThanOrEqualTo(0)) throw new FinanceFiscalError(400, 'CFDI_AMOUNT_INVALID', `${field} debe ser ${allowZero ? 'cero o mayor' : 'mayor que cero'}.`);
  return result;
}

function taxRate(value: unknown, field: string) {
  const normalized = clean(value);
  if (!/^(?:0|1)(?:\.\d{1,6})?$/.test(normalized)) throw new FinanceFiscalError(400, 'CFDI_TAX_RATE_INVALID', `${field} debe estar entre 0 y 1 con máximo seis decimales.`);
  const rate = new Prisma.Decimal(normalized);
  if (rate.greaterThan(1)) throw new FinanceFiscalError(400, 'CFDI_TAX_RATE_INVALID', `${field} no puede superar 1.`);
  return rate;
}

export function calculateFiscalLine(input: { quantity: unknown; unitPrice: unknown; ivaRate: unknown; ivaRetentionRate: unknown; isrRetentionRate: unknown }) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(clean(input.quantity))) throw new FinanceFiscalError(400, 'CFDI_QUANTITY_INVALID', 'La cantidad debe ser positiva y tener máximo seis decimales.');
  const quantity = new Prisma.Decimal(clean(input.quantity));
  if (!quantity.isFinite() || quantity.lessThanOrEqualTo(0) || quantity.decimalPlaces() > 6) throw new FinanceFiscalError(400, 'CFDI_QUANTITY_INVALID', 'La cantidad debe ser positiva y tener máximo seis decimales.');
  const unitPrice = decimal(input.unitPrice, 'Valor unitario');
  const subtotal = quantity.mul(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const ivaRate = taxRate(input.ivaRate, 'Tasa IVA');
  const ivaRetentionRate = taxRate(input.ivaRetentionRate, 'Tasa retención IVA');
  const isrRetentionRate = taxRate(input.isrRetentionRate, 'Tasa retención ISR');
  const iva = subtotal.mul(ivaRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const ivaRetention = subtotal.mul(ivaRetentionRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const isrRetention = subtotal.mul(isrRetentionRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { quantity, unitPrice, subtotal, iva, ivaRetention, isrRetention,
    total: subtotal.plus(iva).minus(ivaRetention).minus(isrRetention) };
}

function ensureNoRawSecrets(input: Record<string, unknown>) {
  const forbidden = ['pac_password', 'pac_token', 'pac_api_key', 'csd_key', 'csd_password', 'private_key', 'password'];
  const found = forbidden.find((key) => clean(input[key]));
  if (found) throw new FinanceFiscalError(400, 'CFDI_RAW_SECRET_REJECTED', 'Las llaves y contraseñas no se reciben por esta API. Configura una referencia segura del servidor.');
  for (const key of ['pac_secret_ref', 'csd_key_secret_ref', 'csd_password_secret_ref']) {
    const value = clean(input[key]);
    if (value && !SECRET_REFERENCE.test(value)) throw new FinanceFiscalError(400, 'CFDI_SECRET_REFERENCE_INVALID', 'La configuración sólo admite referencias secret://.');
  }
}

function publicEntity<T extends Record<string, unknown>>(entity: T) {
  const {
    pac_secret_ref: pac,
    csd_key_secret_ref: key,
    csd_password_secret_ref: password,
    siguiente_folio: nextFolio,
    ...safe
  } = entity;
  return {
    ...safe,
    siguiente_folio: typeof nextFolio === 'bigint' ? nextFolio.toString() : nextFolio,
    pac_secret_configured: Boolean(pac),
    csd_key_configured: Boolean(key),
    csd_password_configured: Boolean(password),
  };
}

function xmlDecode(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_all, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function attributes(fragment: string) {
  const result: Record<string, string> = {};
  const pattern = /(?:^|\s)([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  for (const match of fragment.matchAll(pattern)) result[match[1].split(':').pop()!] = xmlDecode(match[3]);
  return result;
}

function element(xml: string, localName: string, requiredElement = true) {
  const match = xml.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b([^>]*)>`, 'i'))
    || xml.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b([^>]*)/>`, 'i'));
  if (!match && requiredElement) throw new FinanceFiscalError(400, 'CFDI_XML_STRUCTURE_INVALID', `El XML no contiene ${localName}.`);
  return match ? attributes(match[1]) : {};
}

export type ParsedCfdiXml = {
  version: '4.0'; uuid: string; tipo: string; serie: string | null; folio: string | null;
  moneda: string; subtotal: Prisma.Decimal; total: Prisma.Decimal; impuestosTrasladados: Prisma.Decimal;
  impuestosRetenidos: Prisma.Decimal; metodoPago: 'PUE' | 'PPD' | null; formaPago: string | null;
  fechaEmision: Date | null; fechaTimbrado: Date | null;
  emisor: { rfc: string; nombre: string; regimen: string | null };
  receptor: { rfc: string; nombre: string; regimen: string | null; codigoPostal: string | null; usoCfdi: string | null };
};

export function parseCfdi40Xml(buffer: Buffer): ParsedCfdiXml {
  if (!buffer.length || buffer.length > FISCAL_UPLOAD_MAX_BYTES) throw new FinanceFiscalError(400, 'CFDI_XML_SIZE_INVALID', `El XML debe pesar entre 1 byte y ${uploadLimitLabel(FISCAL_UPLOAD_MAX_BYTES)}.`);
  const xml = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) throw new FinanceFiscalError(400, 'CFDI_XML_UNSAFE', 'El XML contiene declaraciones no permitidas.');
  const root = element(xml, 'Comprobante');
  if (clean(root.Version) !== '4.0') throw new FinanceFiscalError(400, 'CFDI_XML_VERSION_UNSUPPORTED', 'Sólo se admite CFDI 4.0.');
  const emitter = element(xml, 'Emisor');
  const receiver = element(xml, 'Receptor');
  const stamp = element(xml, 'TimbreFiscalDigital');
  const taxes = element(xml, 'Impuestos', false);
  const uuid = upper(stamp.UUID);
  if (!UUID.test(uuid)) throw new FinanceFiscalError(400, 'CFDI_XML_UUID_INVALID', 'El timbre fiscal no contiene un UUID válido.');
  const date = (value: unknown) => { const parsed = clean(value) ? new Date(clean(value)) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null; };
  const method = upper(root.MetodoPago);
  if (method && method !== 'PUE' && method !== 'PPD') throw new FinanceFiscalError(400, 'CFDI_PAYMENT_METHOD_INVALID', 'El método de pago del XML no es PUE ni PPD.');
  return {
    version: '4.0', uuid, tipo: upper(root.TipoDeComprobante || 'I'), serie: clean(root.Serie) || null,
    folio: clean(root.Folio) || null, moneda: upper(root.Moneda || 'MXN'), subtotal: decimal(root.SubTotal, 'Subtotal', true),
    total: decimal(root.Total, 'Total'), impuestosTrasladados: decimal(taxes.TotalImpuestosTrasladados || 0, 'Impuestos trasladados', true),
    impuestosRetenidos: decimal(taxes.TotalImpuestosRetenidos || 0, 'Impuestos retenidos', true),
    metodoPago: method ? method as 'PUE' | 'PPD' : null, formaPago: clean(root.FormaPago) || null,
    fechaEmision: date(root.Fecha), fechaTimbrado: date(stamp.FechaTimbrado),
    emisor: { rfc: rfc(emitter.Rfc, 'RFC emisor'), nombre: required(emitter.Nombre, 'Nombre del emisor'), regimen: clean(emitter.RegimenFiscal) || null },
    receptor: { rfc: rfc(receiver.Rfc, 'RFC receptor'), nombre: required(receiver.Nombre, 'Nombre del receptor'), regimen: clean(receiver.RegimenFiscalReceptor) || null, codigoPostal: postalCode(receiver.DomicilioFiscalReceptor, true), usoCfdi: clean(receiver.UsoCFDI) || null },
  };
}

function safeFileName(name: string) { return clean(name).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-180) || 'archivo'; }
function correlation(value?: string) { return value && UUID.test(value) ? value : null; }
function audit(tx: Prisma.TransactionClient, actor: FiscalActor, action: string, entity: string, entityId: string, values: Prisma.InputJsonValue, correlationId?: string) {
  return tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: entity, entidad_id: entityId, valores_nuevos: values, correlation_id: correlation(correlationId) } });
}

async function storeCanonicalDocument(tx: Prisma.TransactionClient, actor: FiscalActor, file: UploadedFiscalFile, storageKey: string, kind: 'CFDI_XML' | 'CFDI_PDF' | 'CONSTANCIA_FISCAL', expedienteId?: string | null) {
  return tx.documento.create({ data: {
    organization_id: actor.organizationId, nombre_original: safeFileName(file.originalname), nombre_interno: storageKey,
    tipo: kind, categoria: 'OTROS', storage_key: storageKey, mime_type: kind === 'CFDI_XML' ? 'application/xml' : kind === 'CFDI_PDF' ? 'application/pdf' : file.mimetype,
    ...(kind === 'CONSTANCIA_FISCAL' ? { estatus: 'VIGENTE' as const } : {}),
    size_bytes: file.buffer.length, checksum_sha256: createHash('sha256').update(file.buffer).digest('hex'),
    observaciones: kind === 'CFDI_XML' ? 'XML fiscal cargado manualmente' : kind === 'CFDI_PDF' ? 'Representación impresa asociada al CFDI' : 'Constancia fiscal de proveedor; extracción revisada por usuario', subido_por_id: actor.id,
    expediente_id: expedienteId || null,
  } });
}

export class FinanceFiscalService {
  constructor(private readonly db: Database, private readonly provider: CfdiProvider = runtimeCfdiProvider) {}

  private async calculateIncomeConcepts(tx: Prisma.TransactionClient, actor: FiscalActor,
    entityId: string, expeditionId: string | null, requestedLines: unknown) {
    const lines = Array.isArray(requestedLines) ? requestedLines : [];
    if (!lines.length || lines.length > 20) throw new FinanceFiscalError(400, 'CFDI_CONCEPTS_REQUIRED', 'Selecciona entre uno y veinte conceptos fiscales configurados.');
    const requestedIds = lines.map((line) => clean(line?.concepto_fiscal_id));
    if (requestedIds.some((id) => !UUID.test(id))) throw new FinanceFiscalError(400, 'CFDI_CONCEPT_ID_INVALID', 'Selecciona un concepto fiscal configurado válido.');
    const configs = await tx.conceptoFiscalCfdi.findMany({ where: {
      id: { in: requestedIds }, organization_id: actor.organizationId, entidad_fiscal_id: entityId, activo: true,
    } });
    if (configs.length !== new Set(requestedIds).size) throw new FinanceFiscalError(403, 'CFDI_CONCEPT_SCOPE_DENIED', 'Un concepto fiscal no pertenece a la entidad fiscal activa.');
    const acts = expeditionId ? await tx.expedienteActo.findMany({ where: { organization_id: actor.organizationId, expediente_id: expeditionId,
      estatus: 'ACTIVO', removed_at: null }, select: { tipo_acto_id: true } }) : [];
    const actIds = new Set(acts.map((item) => item.tipo_acto_id));
    let subtotal = new Prisma.Decimal(0);
    let transferred = new Prisma.Decimal(0);
    let retained = new Prisma.Decimal(0);
    const canonicalConcepts: Array<Record<string, string>> = lines.map((requested) => {
      const config = configs.find((item) => item.id === clean(requested.concepto_fiscal_id));
      if (!config || (config.tipo_acto_id && !actIds.has(config.tipo_acto_id))) throw new FinanceFiscalError(403, 'CFDI_CONCEPT_ACT_MISMATCH', 'El concepto fiscal no corresponde a un acto activo del expediente.');
      const calculated = calculateFiscalLine({ quantity: requested.cantidad, unitPrice: requested.valor_unitario,
        ivaRate: config.iva_tasa, ivaRetentionRate: config.iva_retencion_tasa, isrRetentionRate: config.isr_retencion_tasa });
      subtotal = subtotal.plus(calculated.subtotal);
      transferred = transferred.plus(calculated.iva);
      retained = retained.plus(calculated.ivaRetention).plus(calculated.isrRetention);
      return { concepto_fiscal_id: config.id, descripcion: config.descripcion,
        clave_prod_serv: config.clave_prod_serv, clave_unidad: config.clave_unidad,
        objeto_impuesto: config.objeto_impuesto, cantidad: calculated.quantity.toString(),
        valor_unitario: calculated.unitPrice.toFixed(2), subtotal: calculated.subtotal.toFixed(2),
        iva_tasa: config.iva_tasa.toFixed(6), iva: calculated.iva.toFixed(2),
        iva_retencion_tasa: config.iva_retencion_tasa.toFixed(6), iva_retencion: calculated.ivaRetention.toFixed(2),
        isr_retencion_tasa: config.isr_retencion_tasa.toFixed(6), isr_retencion: calculated.isrRetention.toFixed(2),
        total: calculated.total.toFixed(2) };
    });
    return { canonicalConcepts, subtotal, transferred, retained, total: subtotal.plus(transferred).minus(retained) };
  }

  providerStatus() {
    return { configured: this.provider.configured, provider: this.provider.configured ? this.provider.id : null, cfdiEnabled: this.provider.configured, manualUploadEnabled: true, localDraftsEnabled: true, realStampingVerified: false, message: this.provider.configured ? 'Proveedor configurado; requiere certificación externa antes de habilitarse en producción.' : 'PAC no configurado. Borradores y carga manual XML/PDF permanecen disponibles.' };
  }

  async listEntities(actor: FiscalActor) {
    const rows = await this.db.entidadFiscalCfdi.findMany({ where: { organization_id: actor.organizationId }, include: { cuentas: { include: { cuenta: { select: { id: true, alias: true, institucion: true, ultimos_cuatro: true, moneda: true } } } } }, orderBy: [{ activa: 'desc' }, { razon_social: 'asc' }] });
    return rows.map((row) => publicEntity(row as unknown as Record<string, unknown>));
  }

  async createEntity(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string) {
    ensureNoRawSecrets(input);
    const data = {
      organization_id: actor.organizationId, razon_social: required(input.razon_social, 'Razón social'), rfc: rfc(input.rfc),
      tipo_contribuyente: clean(input.tipo_contribuyente) || null, regimen_fiscal: required(input.regimen_fiscal, 'Régimen fiscal'),
      codigo_postal: postalCode(input.codigo_postal)!, pac_provider: clean(input.pac_provider) || null,
      pac_secret_ref: clean(input.pac_secret_ref) || null, csd_cer_storage_ref: clean(input.csd_cer_storage_ref) || null,
      csd_key_secret_ref: clean(input.csd_key_secret_ref) || null, csd_password_secret_ref: clean(input.csd_password_secret_ref) || null,
      csd_serial: clean(input.csd_serial) || null, csd_vigente_desde: input.csd_vigente_desde ? new Date(clean(input.csd_vigente_desde)) : null,
      csd_vigente_hasta: input.csd_vigente_hasta ? new Date(clean(input.csd_vigente_hasta)) : null,
      serie: clean(input.serie) || null, plantilla_id: clean(input.plantilla_id) || null, created_by_id: actor.id,
    };
    const result = await this.db.$transaction(async (tx) => {
      const created = await tx.entidadFiscalCfdi.create({ data });
      const accountIds = Array.isArray(input.cuenta_ids) ? input.cuenta_ids.map(clean).filter(Boolean) : [];
      const accounts = accountIds.length ? await tx.cuentaFinanciera.findMany({ where: { id: { in: accountIds }, organization_id: actor.organizationId, activa: true }, select: { id: true } }) : [];
      if (accounts.length !== new Set(accountIds).size) throw new FinanceFiscalError(403, 'CFDI_ACCOUNT_SCOPE_DENIED', 'Una cuenta bancaria no pertenece a la organización activa.');
      if (accounts.length) await tx.entidadFiscalCuenta.createMany({ data: accounts.map((account, index) => ({ organization_id: actor.organizationId, entidad_fiscal_id: created.id, cuenta_id: account.id, predeterminada: index === 0 })) });
      await audit(tx, actor, 'CREATE_FISCAL_ENTITY', 'EntidadFiscalCfdi', created.id, { rfc: created.rfc, razon_social: created.razon_social, secret_references_configured: Boolean(data.pac_secret_ref || data.csd_key_secret_ref || data.csd_password_secret_ref), account_ids: accountIds }, correlationId);
      return tx.entidadFiscalCfdi.findUniqueOrThrow({ where: { id: created.id }, include: { cuentas: true } });
    });
    return publicEntity(result as unknown as Record<string, unknown>);
  }

  async updateEntity(actor: FiscalActor, id: string, input: Record<string, unknown>, correlationId?: string) {
    ensureNoRawSecrets(input);
    const existing = await this.db.entidadFiscalCfdi.findFirst({ where: { id, organization_id: actor.organizationId } });
    if (!existing) throw new FinanceFiscalError(404, 'CFDI_ENTITY_NOT_FOUND', 'Entidad fiscal no encontrada.');
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.entidadFiscalCfdi.update({ where: { id }, data: {
        ...(input.razon_social !== undefined ? { razon_social: required(input.razon_social, 'Razón social') } : {}),
        ...(input.regimen_fiscal !== undefined ? { regimen_fiscal: required(input.regimen_fiscal, 'Régimen fiscal') } : {}),
        ...(input.codigo_postal !== undefined ? { codigo_postal: postalCode(input.codigo_postal)! } : {}),
        ...(input.serie !== undefined ? { serie: clean(input.serie) || null } : {}), ...(input.plantilla_id !== undefined ? { plantilla_id: clean(input.plantilla_id) || null } : {}),
        ...(input.activa !== undefined ? { activa: Boolean(input.activa) } : {}),
      } });
      await audit(tx, actor, 'UPDATE_FISCAL_ENTITY', 'EntidadFiscalCfdi', row.id, { rfc: row.rfc, fields: Object.keys(input).filter((key) => !key.includes('secret') && !key.includes('password') && !key.includes('key')) }, correlationId);
      return row;
    });
    return publicEntity(updated as unknown as Record<string, unknown>);
  }

  async listFiscalConcepts(actor: FiscalActor, entityId?: string) {
    return this.db.conceptoFiscalCfdi.findMany({ where: { organization_id: actor.organizationId,
      ...(entityId ? { entidad_fiscal_id: entityId } : {}) },
      include: { entidadFiscal: { select: { id: true, razon_social: true } }, tipoActo: { select: { id: true, nombre: true } } },
      orderBy: [{ activo: 'desc' }, { descripcion: 'asc' }],
    });
  }

  async listFiscalActOptions(actor: FiscalActor) {
    return this.db.tipoActo.findMany({ where: { organization_id: actor.organizationId, activo: true, archived_at: null },
      select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } });
  }

  async createFiscalConcept(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string) {
    const entityId = required(input.entidad_fiscal_id, 'Entidad fiscal');
    const entity = await this.db.entidadFiscalCfdi.findFirst({ where: { id: entityId, organization_id: actor.organizationId, activa: true }, select: { id: true } });
    if (!entity) throw new FinanceFiscalError(403, 'CFDI_ENTITY_SCOPE_DENIED', 'La entidad fiscal no pertenece a la organización activa.');
    const actId = clean(input.tipo_acto_id);
    if (actId) {
      const act = await this.db.tipoActo.findFirst({ where: { id: actId, organization_id: actor.organizationId, activo: true, archived_at: null }, select: { id: true } });
      if (!act) throw new FinanceFiscalError(403, 'CFDI_ACT_SCOPE_DENIED', 'El acto no pertenece a la organización activa.');
    }
    const productCode = required(input.clave_prod_serv, 'Clave SAT de producto/servicio');
    const unitCode = required(input.clave_unidad, 'Clave SAT de unidad');
    const taxObject = required(input.objeto_impuesto, 'Objeto de impuesto');
    if (!/^\d{8}$/.test(productCode) || !/^[A-Za-z0-9]{1,8}$/.test(unitCode) || !['01', '02', '03'].includes(taxObject)) {
      throw new FinanceFiscalError(400, 'CFDI_CONCEPT_CATALOG_INVALID', 'Revisa las claves fiscales del concepto.');
    }
    const iva = taxRate(input.iva_tasa, 'Tasa IVA');
    const ivaRetention = taxRate(input.iva_retencion_tasa, 'Tasa retención IVA');
    const isrRetention = taxRate(input.isr_retencion_tasa, 'Tasa retención ISR');
    if (taxObject !== '02' && [iva, ivaRetention, isrRetention].some((rate) => rate.greaterThan(0))) {
      throw new FinanceFiscalError(400, 'CFDI_CONCEPT_TAX_OBJECT_MISMATCH', 'Las tasas positivas requieren objeto de impuesto 02.');
    }
    return this.db.$transaction(async (tx) => {
      const row = await tx.conceptoFiscalCfdi.create({ data: {
        organization_id: actor.organizationId, entidad_fiscal_id: entityId, tipo_acto_id: actId || null,
        descripcion: required(input.descripcion, 'Descripción'), clave_prod_serv: productCode,
        clave_unidad: unitCode, objeto_impuesto: taxObject,
        iva_tasa: iva, iva_retencion_tasa: ivaRetention, isr_retencion_tasa: isrRetention,
        created_by_id: actor.id,
      } });
      await audit(tx, actor, 'CREATE_CFDI_FISCAL_CONCEPT', 'ConceptoFiscalCfdi', row.id,
        { entidad_fiscal_id: entityId, tipo_acto_id: actId || null, clave_prod_serv: productCode, clave_unidad: unitCode,
          objeto_impuesto: taxObject, iva_tasa: iva.toFixed(6), iva_retencion_tasa: ivaRetention.toFixed(6), isr_retencion_tasa: isrRetention.toFixed(6) }, correlationId);
      return row;
    });
  }

  listSuppliers(actor: FiscalActor) { return this.db.proveedorFiscal.findMany({ where: { organization_id: actor.organizationId }, orderBy: [{ activo: 'desc' }, { razon_social: 'asc' }] }); }

  async supplierCsfUrl(actor: FiscalActor, supplierId: string, correlationId?: string) {
    if (!actor.permissions.includes('documentos.read')) throw new FinanceFiscalError(403, 'CFDI_CSF_READ_DENIED', 'No tienes permiso para consultar la constancia fiscal.');
    const supplier = await this.db.proveedorFiscal.findFirst({ where: { id: supplierId, organization_id: actor.organizationId },
      select: { id: true, csf_documento_id: true } });
    if (!supplier?.csf_documento_id) throw new FinanceFiscalError(404, 'CFDI_CSF_NOT_FOUND', 'Este proveedor no tiene constancia fiscal asociada.');
    const document = await this.db.documento.findFirst({ where: { id: supplier.csf_documento_id,
      organization_id: actor.organizationId, tipo: 'CONSTANCIA_FISCAL', estatus: 'VIGENTE' },
      select: { id: true, storage_key: true, nombre_original: true, mime_type: true,
        checksum_sha256: true, size_bytes: true } });
    if (!document) throw new FinanceFiscalError(404, 'CFDI_CSF_NOT_FOUND', 'La constancia fiscal ya no está disponible.');
    const url = await getSignedUrl(document.storage_key, 300);
    await this.db.$transaction((tx) => audit(tx, actor, 'VIEW_FISCAL_SUPPLIER_CSF', 'Documento', document.id,
      { proveedor_id: supplier.id, checksum_sha256: document.checksum_sha256 }, correlationId));
    return { url, filename: document.nombre_original, mimeType: document.mime_type,
      sha256: document.checksum_sha256, sizeBytes: document.size_bytes };
  }

  async createSupplier(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string, csfFile?: UploadedFiscalFile) {
    const supplierRfc = rfc(input.rfc);
    let csfExtraction: Awaited<ReturnType<FiscalDocumentExtractionService['extract']>> | null = null;
    if (csfFile) {
      if (!actor.permissions.includes('documentos.write')) throw new FinanceFiscalError(403, 'CFDI_CSF_UPLOAD_DENIED', 'No tienes permiso para cargar documentos.');
      if (input.csf_reviewed !== true && input.csf_reviewed !== 'true') {
        throw new FinanceFiscalError(400, 'CFDI_CSF_REVIEW_REQUIRED', 'Confirma expresamente los datos fiscales extraídos antes de guardar.');
      }
      const filename = csfFile.originalname.toLowerCase();
      const signature = csfFile.buffer;
      const accepted = (filename.endsWith('.pdf') && signature.subarray(0, 5).toString('latin1') === '%PDF-') ||
        (filename.endsWith('.png') && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (/\.jpe?g$/.test(filename) && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff);
      if (csfFile.size > FISCAL_UPLOAD_MAX_BYTES || !accepted) {
        throw new FinanceFiscalError(400, 'CFDI_CSF_FILE_INVALID', `La constancia debe ser PDF, PNG o JPG válido de máximo ${uploadLimitLabel(FISCAL_UPLOAD_MAX_BYTES)}.`);
      }
      try { csfExtraction = await new FiscalDocumentExtractionService().extract(csfFile); }
      catch (error) {
        if (error instanceof FiscalExtractionError) throw new FinanceFiscalError(error.status, error.code, error.message);
        throw error;
      }
      if (clean(input.csf_sha256) !== csfExtraction.sha256) {
        throw new FinanceFiscalError(409, 'CFDI_CSF_FILE_CHANGED', 'La constancia cambió después de extraerla. Vuelve a revisar el archivo antes de guardar.');
      }
    }
    const inputRegimes = Array.isArray(input.regimenes_fiscales) ? input.regimenes_fiscales as Array<{ clave?: unknown; descripcion?: unknown }> : [];
    if (inputRegimes.length > 20 || inputRegimes.some((item) => !item || !/^\d{3}$/.test(clean(item.clave)))) {
      throw new FinanceFiscalError(400, 'CFDI_REGIMES_INVALID', 'Confirma cada régimen fiscal con una clave de tres dígitos.');
    }
    if (csfExtraction && inputRegimes.some((item) =>
      !csfExtraction.regimenes_fiscales.some((detected) => detected.clave === clean(item.clave)))) {
      throw new FinanceFiscalError(422, 'CFDI_CSF_REGIME_UNVERIFIED',
        'La clave fiscal no figura en la constancia extraída. Revísala con el catálogo oficial antes de registrar el proveedor.');
    }
    const confirmedRegimes = [...inputRegimes.map((item) => ({ clave: clean(item.clave), descripcion: clean(item.descripcion) }))];
    for (const detected of csfExtraction?.regimenes_fiscales || []) {
      if (!confirmedRegimes.some((item) => item.clave === detected.clave)) confirmedRegimes.push(detected);
    }
    if (csfFile && (!confirmedRegimes.length || !confirmedRegimes.some((item) => item.clave === clean(input.regimen_fiscal)))) {
      throw new FinanceFiscalError(400, 'CFDI_REGIME_SELECTION_INVALID', 'Selecciona un régimen confirmado sin descartar los demás detectados.');
    }
    const confirmed = { rfc: supplierRfc, razon_social: required(input.razon_social, 'Razón social'),
      codigo_postal: postalCode(input.codigo_postal, true), regimen_fiscal: clean(input.regimen_fiscal), regimenes_fiscales: confirmedRegimes };
    const correctedFields: string[] = csfExtraction ? (['rfc', 'razon_social', 'codigo_postal'] as const).filter((field) =>
      csfExtraction[field] && upper(csfExtraction[field]) !== upper(confirmed[field])) : [];
    if (csfExtraction && csfExtraction.regimenes_fiscales.length &&
      !csfExtraction.regimenes_fiscales.some((item) => item.clave === confirmed.regimen_fiscal)) correctedFields.push('regimen_fiscal');
    const csfDocumentId = clean(input.csf_documento_id);
    if (csfFile && csfDocumentId) throw new FinanceFiscalError(400, 'CFDI_CSF_SOURCE_AMBIGUOUS', 'Selecciona una sola constancia fiscal.');
    if (csfDocumentId) {
      const csf = await this.db.documento.findFirst({ where: { id: csfDocumentId, organization_id: actor.organizationId,
        subido_por_id: actor.id, estatus: 'VIGENTE', tipo: 'CONSTANCIA_FISCAL' }, select: { id: true } });
      if (!csf) throw new FinanceFiscalError(403, 'CFDI_CSF_DOCUMENT_SCOPE_DENIED', 'La constancia fiscal no pertenece a esta operación.');
    }
    const existing = await this.db.proveedorFiscal.findFirst({ where: { organization_id: actor.organizationId, rfc: supplierRfc } });
    if (existing) {
      await this.db.$transaction(async (tx) => {
        const pending = await tx.documentoCfdi.findMany({ where: { organization_id: actor.organizationId, direccion: 'RECIBIDO', emisor_rfc: supplierRfc, proveedor_id: null }, select: { id: true } });
        if (pending.length) {
          await tx.documentoCfdi.updateMany({ where: { id: { in: pending.map((item) => item.id) }, organization_id: actor.organizationId }, data: { proveedor_id: existing.id } });
          await tx.cuentaPorPagarCfdi.updateMany({ where: { cfdi_id: { in: pending.map((item) => item.id) }, organization_id: actor.organizationId, proveedor_id: null }, data: { proveedor_id: existing.id } });
        }
      });
      return { supplier: existing, idempotent: true };
    }
    const csfStorageKey = csfFile ? `organizations/${actor.organizationId}/fiscal/csf/${randomUUID()}${csfFile.originalname.toLowerCase().match(/\.(?:pdf|png|jpe?g)$/)?.[0] || ''}` : null;
    if (csfFile && csfStorageKey) await uploadFile(csfFile.buffer, csfStorageKey, csfFile.mimetype);
    try {
    const supplier = await this.db.$transaction(async (tx) => {
      const csfDocument = csfFile && csfStorageKey ? await storeCanonicalDocument(tx, actor, csfFile, csfStorageKey, 'CONSTANCIA_FISCAL') : null;
      const created = await tx.proveedorFiscal.create({ data: {
        organization_id: actor.organizationId, razon_social: confirmed.razon_social, rfc: confirmed.rfc,
        tipo_persona: clean(input.tipo_persona) || null, codigo_postal: confirmed.codigo_postal,
        regimenes_fiscales: confirmedRegimes.length ? confirmedRegimes as Prisma.InputJsonValue : Prisma.JsonNull,
        csf_extraction: csfExtraction ? { sha256: csfExtraction.sha256, source: csfExtraction.source,
          extraction_status: csfExtraction.status, confirmation_status: correctedFields.length ? 'CORRECTED' : 'CONFIRMED',
          detected: { rfc: csfExtraction.rfc, razon_social: csfExtraction.razon_social,
            codigo_postal: csfExtraction.codigo_postal, domicilio_fiscal: csfExtraction.domicilio_fiscal,
            fecha_csf: csfExtraction.fecha_csf, regimenes_fiscales: csfExtraction.regimenes_fiscales,
            regimenes_documentales: csfExtraction.regimenes_documentales,
            actividades_economicas: csfExtraction.actividades_economicas },
          provenance: csfExtraction.provenance, source_pages: csfExtraction.source_pages,
          conflicts: csfExtraction.conflicts,
          confirmed, corrected_fields: correctedFields, confirmed_by_id: actor.id,
          confirmed_at: new Date().toISOString() } as Prisma.InputJsonValue : Prisma.JsonNull,
        correo: clean(input.correo) || null, telefono: clean(input.telefono) || null,
        datos_bancarios: input.datos_bancarios && typeof input.datos_bancarios === 'object' ? input.datos_bancarios as Prisma.InputJsonValue : Prisma.JsonNull,
        csf_documento_id: csfDocument?.id || csfDocumentId || null, created_by_id: actor.id,
      } });
      const pending = await tx.documentoCfdi.findMany({ where: { organization_id: actor.organizationId, direccion: 'RECIBIDO', emisor_rfc: supplierRfc, proveedor_id: null }, select: { id: true } });
      if (pending.length) {
        await tx.documentoCfdi.updateMany({ where: { id: { in: pending.map((item) => item.id) }, organization_id: actor.organizationId }, data: { proveedor_id: created.id } });
        await tx.cuentaPorPagarCfdi.updateMany({ where: { cfdi_id: { in: pending.map((item) => item.id) }, organization_id: actor.organizationId, proveedor_id: null }, data: { proveedor_id: created.id } });
      }
      await audit(tx, actor, 'CREATE_FISCAL_SUPPLIER', 'ProveedorFiscal', created.id, { rfc: created.rfc, razon_social: created.razon_social,
        csf_documento_id: created.csf_documento_id, csf_sha256: csfExtraction?.sha256 || null,
        extraction_status: csfExtraction?.status || null, corrected_fields: correctedFields,
        fiscal_data_reviewed: Boolean(csfFile) && (input.csf_reviewed === true || input.csf_reviewed === 'true') }, correlationId);
      return created;
    });
    return { supplier, idempotent: false };
    } catch (error) {
      if (csfStorageKey) await deleteFile(csfStorageKey).catch(() => undefined);
      throw error;
    }
  }

  async updateSupplier(actor: FiscalActor, id: string, input: Record<string, unknown>, correlationId?: string) {
    const existing = await this.db.proveedorFiscal.findFirst({ where: { id, organization_id: actor.organizationId } });
    if (!existing) throw new FinanceFiscalError(404, 'CFDI_SUPPLIER_NOT_FOUND', 'Proveedor no encontrado.');
    return this.db.$transaction(async (tx) => {
      const row = await tx.proveedorFiscal.update({ where: { id }, data: {
        ...(input.razon_social !== undefined ? { razon_social: required(input.razon_social, 'Razón social') } : {}),
        ...(input.codigo_postal !== undefined ? { codigo_postal: postalCode(input.codigo_postal, true) } : {}),
        ...(input.regimenes_fiscales !== undefined ? { regimenes_fiscales: input.regimenes_fiscales as Prisma.InputJsonValue } : {}),
        ...(input.correo !== undefined ? { correo: clean(input.correo) || null } : {}), ...(input.telefono !== undefined ? { telefono: clean(input.telefono) || null } : {}),
        ...(input.activo !== undefined ? { activo: Boolean(input.activo) } : {}),
      } });
      await audit(tx, actor, 'UPDATE_FISCAL_SUPPLIER', 'ProveedorFiscal', row.id, { rfc: row.rfc, fields: Object.keys(input) }, correlationId);
      return row;
    });
  }

  async listDocuments(actor: FiscalActor, filters: Record<string, unknown> = {}) {
    const items = await this.db.documentoCfdi.findMany({ where: { organization_id: actor.organizationId,
      ...(clean(filters.direccion) ? { direccion: upper(filters.direccion) } : {}), ...(clean(filters.estado) ? { estado: upper(filters.estado) } : {}),
      ...(clean(filters.expediente_id) ? { expediente_id: clean(filters.expediente_id) } : {}),
    }, include: { entidadFiscal: { select: { id: true, razon_social: true, rfc: true } }, proveedor: true, expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } }, cuentaPorCobrar: true, cuentaPorPagar: true, aplicacionesPago: true, xmlDocumento: { select: { id: true, nombre_original: true } }, pdfDocumento: { select: { id: true, nombre_original: true } }, prefacturaRepresentaciones: { select: { id: true, version: true, created_at: true, pdf_sha256: true, size_bytes: true }, orderBy: { version: 'desc' } } }, orderBy: { created_at: 'desc' } });
    return { items, count: items.length };
  }

  private async incomeBalance(tx: Prisma.TransactionClient, actor: FiscalActor, incomeId: string, excludeDraftId?: string) {
    const income = await tx.expedienteIngresoReportado.findFirst({
      where: { id: incomeId, organization_id: actor.organizationId,
        expediente: { archived_at: null, ...(actor.rol === 'FINANCIERO' ? {} : expedienteAccessWhere(actor as Parameters<typeof expedienteAccessWhere>[0])) } },
      include: {
        expediente: { select: { id: true, numero_pravia: true, cliente_alias: true, archived_at: true,
          abogado: { select: { id: true, nombre: true, apellido: true } },
          presupuesto: { select: { id: true, version: true, subtotal_honorarios: true, subtotal_impuestos_derechos: true, total: true } } } },
        facturarAVinculo: { include: { compareciente: { select: { id: true, nombre_busqueda: true, tipo_persona: true } } } },
      },
    });
    if (!income || income.expediente.archived_at || income.estado === 'ANULADO') {
      throw new FinanceFiscalError(404, 'CFDI_INCOME_NOT_AVAILABLE', 'El ingreso no está disponible en esta organización.');
    }
    const amount = income.monto_validado ?? income.monto_reportado;
    if (!amount || amount.lessThanOrEqualTo(0)) {
      throw new FinanceFiscalError(409, 'CFDI_INCOME_AMOUNT_MISSING', 'El ingreso no tiene un importe confirmado para facturar.');
    }
    const linked = await tx.documentoCfdi.findMany({
      where: { organization_id: actor.organizationId, ingreso_reportado_id: incomeId, ...(excludeDraftId ? { id: { not: excludeDraftId } } : {}) },
      select: { id: true, estado: true, total: true, subtotal: true, impuestos_trasladados: true, impuestos_retenidos: true,
        receptor_compareciente_id: true, receptor_rfc: true, receptor_nombre: true,
        receptor_regimen: true, entidad_fiscal_id: true,
        metodo_pago: true, forma_pago: true, uso_cfdi: true, moneda: true, draft_payload: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });
    const { facturableAmount, invoicedAmount, reservedDraftAmount, remainingInvoiceableAmount } = cfdiIncomeBalance({
      amount, facturaEstado: income.factura_estado, linked,
    });
    return { income, facturableAmount, invoicedAmount, reservedDraftAmount, remainingInvoiceableAmount, linked };
  }

  private async assertDraftExpedienteAccess(tx: Prisma.TransactionClient, actor: FiscalActor, expedienteId: string | null) {
    if (!expedienteId) return;
    const accessible = await tx.expediente.findFirst({ where: {
      id: expedienteId, organization_id: actor.organizationId, archived_at: null,
      ...(actor.rol === 'FINANCIERO' ? {} : expedienteAccessWhere(actor as Parameters<typeof expedienteAccessWhere>[0])),
    }, select: { id: true } });
    if (!accessible) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Prefactura no encontrada.');
  }

  async incomeContext(actor: FiscalActor, incomeId: string) {
    const balance = await this.db.$transaction((tx) => this.incomeBalance(tx, actor, incomeId));
    const { income, facturableAmount, invoicedAmount, reservedDraftAmount, remainingInvoiceableAmount, linked } = balance;
    const receivers = await this.db.expedienteCompareciente.findMany({ where: {
      organization_id: actor.organizationId, expediente_id: income.expediente_id, archived_at: null, estatus: 'ACTIVO',
    }, select: { id: true, compareciente: { select: { id: true, nombre_busqueda: true, tipo_persona: true,
      personaFisica: { select: { rfc: true } }, personaMoral: { select: { rfc: true } }, fiscalProfile: true } } },
      orderBy: { orden_comparecencia: 'asc' },
    });
    const acts = await this.db.expedienteActo.findMany({ where: { organization_id: actor.organizationId,
      expediente_id: income.expediente_id, estatus: 'ACTIVO', removed_at: null },
      select: { tipo_acto_id: true, tipo_acto: { select: { nombre: true } } } });
    return {
      income: { id: income.id, expediente_id: income.expediente_id, expediente: income.expediente,
        concepto_contexto: income.concepto_contexto, fecha_ingreso: income.fecha_ingreso,
        forma_pago: income.forma_pago, estado: income.estado, factura_estado: income.factura_estado,
        receptor: income.facturarAVinculo?.compareciente ?? null },
      receivers,
      acts,
      facturableAmount: facturableAmount.toFixed(2), invoicedAmount: invoicedAmount.toFixed(2),
      reservedDraftAmount: reservedDraftAmount.toFixed(2), remainingInvoiceableAmount: remainingInvoiceableAmount.toFixed(2),
      documents: linked.map((item) => ({ ...item, total: item.total.toFixed(2), subtotal: item.subtotal.toFixed(2),
        impuestos_trasladados: item.impuestos_trasladados.toFixed(2), impuestos_retenidos: item.impuestos_retenidos.toFixed(2) })),
    };
  }

  async confirmIncomeReceiver(actor: FiscalActor, incomeId: string, comparecienteId: string, input: Record<string, unknown>, correlationId?: string) {
    const fiscalRfc = rfc(input.rfc);
    const fiscalName = required(input.razon_social, 'Nombre fiscal');
    const regime = required(input.regimen_fiscal, 'Régimen fiscal');
    if (!/^\d{3}$/.test(regime)) throw new FinanceFiscalError(400, 'CFDI_REGIME_INVALID', 'El régimen fiscal debe tener una clave de tres dígitos.');
    const receivedRegimes = input.regimenes_fiscales;
    if (receivedRegimes !== undefined && (!Array.isArray(receivedRegimes) || receivedRegimes.length > 20 ||
      receivedRegimes.some((item) => !item || typeof item !== 'object' || Array.isArray(item) ||
        !/^\d{3}$/.test(clean((item as Record<string, unknown>).clave)) ||
        clean((item as Record<string, unknown>).descripcion).length > 300))) {
      throw new FinanceFiscalError(400, 'CFDI_REGIMES_INVALID', 'Confirma los regímenes detectados con claves de tres dígitos.');
    }
    const regimes = (receivedRegimes as Array<{ clave: string; descripcion?: string }> | undefined)
      ?.map((item) => ({ clave: clean(item.clave), descripcion: clean(item.descripcion) })) || [{ clave: regime, descripcion: '' }];
    if (!regimes.some((item) => item.clave === regime) || new Set(regimes.map((item) => item.clave)).size !== regimes.length) {
      throw new FinanceFiscalError(400, 'CFDI_REGIME_SELECTION_INVALID', 'El régimen seleccionado debe estar en la lista confirmada sin duplicados.');
    }
    const csfDocumentId = clean(input.csf_documento_id);
    let actualExtraction: Awaited<ReturnType<FiscalDocumentExtractionService['extract']>> | null = null;
    if (csfDocumentId) {
      if (!UUID.test(csfDocumentId)) throw new FinanceFiscalError(400, 'CFDI_CSF_DOCUMENT_INVALID', 'La referencia de la CSF no es válida.');
      const link = await this.db.comparecienteDocumento.findFirst({ where: {
        compareciente_id: comparecienteId, documento_id: csfDocumentId,
        categoria: 'CONSTANCIA_FISCAL', archived_at: null,
        estatus: 'ACTIVO', vigencia: 'VIGENTE',
        compareciente: { organization_id: actor.organizationId, archived_at: null },
      }, include: { documento: { select: { storage_key: true, checksum_sha256: true,
        nombre_original: true, mime_type: true, size_bytes: true } } } });
      if (!link?.documento.storage_key) throw new FinanceFiscalError(404, 'CFDI_CSF_DOCUMENT_NOT_FOUND',
        'La constancia no está vinculada al compareciente en esta organización.');
      const bytes = await downloadFile(link.documento.storage_key);
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== link.documento.checksum_sha256 || sha !== clean(input.csf_sha256)) {
        throw new FinanceFiscalError(409, 'CFDI_CSF_FILE_CHANGED', 'El archivo confirmado no coincide con la constancia almacenada.');
      }
      actualExtraction = await new FiscalDocumentExtractionService().extract({ buffer: bytes,
        originalname: link.documento.nombre_original, mimetype: link.documento.mime_type || 'application/octet-stream',
        size: bytes.length });
      for (const found of actualExtraction.regimenes_fiscales) {
        if (!regimes.some((item) => item.clave === found.clave)) regimes.push(found);
      }
    }
    const cp = postalCode(input.codigo_postal)!;
    return this.db.$transaction(async (tx) => {
      const income = await tx.expedienteIngresoReportado.findFirst({ where: { id: incomeId, organization_id: actor.organizationId,
        expediente: { archived_at: null, ...(actor.rol === 'FINANCIERO' ? {} : expedienteAccessWhere(actor as Parameters<typeof expedienteAccessWhere>[0])) } }, select: { expediente_id: true } });
      if (!income) throw new FinanceFiscalError(404, 'CFDI_INCOME_NOT_AVAILABLE', 'Ingreso no encontrado.');
      const link = await tx.expedienteCompareciente.findFirst({ where: {
        organization_id: actor.organizationId, expediente_id: income.expediente_id,
        compareciente_id: comparecienteId, archived_at: null, estatus: 'ACTIVO',
      }, include: { compareciente: { include: { personaFisica: true, personaMoral: true } } } });
      if (!link || link.compareciente.organization_id !== actor.organizationId) throw new FinanceFiscalError(403, 'CFDI_RECEIVER_NOT_LINKED', 'El compareciente no pertenece al expediente.');
      if (csfDocumentId) {
        const stillLinked = await tx.comparecienteDocumento.findFirst({ where: {
          compareciente_id: comparecienteId, documento_id: csfDocumentId,
          categoria: 'CONSTANCIA_FISCAL',
          archived_at: null, estatus: 'ACTIVO', vigencia: 'VIGENTE',
        }, select: { id: true } });
        if (!stillLinked) throw new FinanceFiscalError(409, 'CFDI_CSF_DOCUMENT_CHANGED',
          'La constancia cambió durante la confirmación. Vuelve a revisarla.');
      }
      const canonicalRfc = link.compareciente.personaFisica?.rfc || link.compareciente.personaMoral?.rfc;
      if (canonicalRfc && upper(canonicalRfc) !== fiscalRfc) throw new FinanceFiscalError(409, 'CFDI_RFC_CONFLICT', 'El RFC confirmado difiere del RFC canónico del compareciente; corrige primero su ficha.');
      const priorProfile = await tx.comparecienteFiscalProfile.findFirst({ where: {
        organization_id: actor.organizationId, compareciente_id: comparecienteId,
      }, select: { csf_extraction: true, regimen_fiscal: true, regimenes_fiscales: true } });
      if (receivedRegimes === undefined && priorProfile) {
        const previousCodes = fiscalRegimeCodes(priorProfile.regimenes_fiscales, priorProfile.regimen_fiscal);
        for (const code of previousCodes) if (!regimes.some((item) => item.clave === code)) {
          regimes.push({ clave: code, descripcion: '' });
        }
      }
      const previousLineage = priorProfile?.csf_extraction && typeof priorProfile.csf_extraction === 'object' &&
        !Array.isArray(priorProfile.csf_extraction) ? priorProfile.csf_extraction as Record<string, unknown> : null;
      const detected = actualExtraction ? {
        rfc: actualExtraction.rfc, razon_social: actualExtraction.razon_social,
        codigo_postal: actualExtraction.codigo_postal,
        domicilio_fiscal: actualExtraction.domicilio_fiscal, fecha_csf: actualExtraction.fecha_csf,
        regimenes_fiscales: actualExtraction.regimenes_fiscales,
        regimenes_documentales: actualExtraction.regimenes_documentales,
        actividades_economicas: actualExtraction.actividades_economicas,
      } : previousLineage?.detected || null;
      const baseline = detected && typeof detected === 'object' && !Array.isArray(detected)
        ? detected as Record<string, unknown> : null;
      const baselineRegimes = baseline?.regimenes_fiscales;
      const detectedCodes = fiscalRegimeCodes(baselineRegimes, '');
      const correctedFields = [
        baseline?.rfc && baseline.rfc !== fiscalRfc ? 'rfc' : null,
        baseline?.razon_social && baseline.razon_social !== fiscalName ? 'razon_social' : null,
        baseline?.codigo_postal && baseline.codigo_postal !== cp ? 'codigo_postal' : null,
        detectedCodes.length && regimes.some((item) => !detectedCodes.includes(item.clave)) ? 'regimenes_fiscales' : null,
      ].filter((field): field is string => Boolean(field));
      const lineage = {
        source: actualExtraction?.source || previousLineage?.source || 'MANUAL_CONFIRMATION',
        sha256: actualExtraction?.sha256 || previousLineage?.sha256 || null,
        extraction_status: actualExtraction?.status || previousLineage?.extraction_status || 'NOT_EXECUTED',
        detected, confirmed: { rfc: fiscalRfc, razon_social: fiscalName, codigo_postal: cp,
          regimen_fiscal: regime, regimenes_fiscales: regimes },
        corrected_fields: correctedFields,
        confirmation_status: correctedFields.length ? 'CORRECTED' : 'CONFIRMED',
        provenance: actualExtraction?.provenance || previousLineage?.provenance || null,
        source_pages: actualExtraction?.source_pages || previousLineage?.source_pages || null,
        confirmed_by_id: actor.id, confirmed_at: new Date().toISOString(),
      };
      const profile = await tx.comparecienteFiscalProfile.upsert({ where: {
        compareciente_id_organization_id: { compareciente_id: comparecienteId, organization_id: actor.organizationId },
      }, create: { organization_id: actor.organizationId, compareciente_id: comparecienteId,
        rfc: fiscalRfc, razon_social: fiscalName, regimen_fiscal: regime, regimenes_fiscales: regimes,
        codigo_postal: cp, csf_documento_id: csfDocumentId || null, csf_extraction: lineage,
        confirmed_by_id: actor.id },
      update: { rfc: fiscalRfc, razon_social: fiscalName, regimen_fiscal: regime,
        regimenes_fiscales: regimes, codigo_postal: cp, csf_extraction: lineage,
        ...(csfDocumentId ? { csf_documento_id: csfDocumentId } : {}), confirmed_by_id: actor.id,
        confirmed_at: new Date(), version: { increment: 1 } },
      });
      await audit(tx, actor, 'CONFIRM_CFDI_RECEIVER_PROFILE', 'ComparecienteFiscalProfile', profile.id,
        { compareciente_id: comparecienteId, expediente_id: income.expediente_id, profile_version: profile.version,
          regimenes_confirmados: regimes.map((item) => item.clave), csf_sha256: actualExtraction?.sha256 || null,
          csf_source: actualExtraction?.source || null, csf_extraction_auto_applied: false,
          canonical_identity_modified: false }, correlationId);
      return profile;
    });
  }

  async createDraft(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string) {
    const direction = upper(input.direccion);
    const incomeId = clean(input.ingreso_reportado_id);
    const incompleteRequested = input.allow_incomplete === true;
    const incompleteCentralDraft = !incomeId && incompleteRequested;
    if (direction !== 'EMITIDO' && direction !== 'RECIBIDO') throw new FinanceFiscalError(400, 'CFDI_DIRECTION_INVALID', 'La dirección debe ser EMITIDO o RECIBIDO.');
    const type = upper(input.tipo || 'I');
    if (!['I', 'E', 'P', 'T', 'N', 'RET'].includes(type)) throw new FinanceFiscalError(400, 'CFDI_TYPE_INVALID', 'Tipo de CFDI no válido.');
    if (incomeId && (direction !== 'EMITIDO' || type !== 'I')) throw new FinanceFiscalError(400, 'CFDI_INCOME_TYPE_INVALID', 'Un ingreso sólo puede generar una prefactura emitida de tipo ingreso.');
    const method = upper(input.metodo_pago);
    if (method && method !== 'PUE' && method !== 'PPD') throw new FinanceFiscalError(400, 'CFDI_PAYMENT_METHOD_INVALID', 'Selecciona PUE o PPD.');
    const subtotal = decimal(input.subtotal ?? (incompleteRequested ? '0.00' : undefined), 'Subtotal', true);
    const transferred = decimal(input.impuestos_trasladados || 0, 'Impuestos trasladados', true);
    const retained = decimal(input.impuestos_retenidos || 0, 'Impuestos retenidos', true);
    const total = decimal(input.total ?? (incompleteRequested ? '0.00' : undefined), 'Total', incompleteRequested);
    const incompleteIncomeDraft = Boolean(incomeId && incompleteRequested && total.equals(0));
    const calculated = subtotal.plus(transferred).minus(retained);
    if (!calculated.equals(total)) throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Subtotal, impuestos y total no cuadran.');
    const idempotencyKey = required(input.idempotency_key, 'Idempotency key');
    const details = draftFiscalDetails(input, {}, incompleteCentralDraft || incompleteIncomeDraft);
    const existing = await this.db.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
    if (existing) return { cfdi: existing, idempotent: true };
    const [entity, supplier, expediente, receiver] = await Promise.all([
      clean(input.entidad_fiscal_id) ? this.db.entidadFiscalCfdi.findFirst({ where: { id: clean(input.entidad_fiscal_id), organization_id: actor.organizationId, activa: true } }) : null,
      clean(input.proveedor_id) ? this.db.proveedorFiscal.findFirst({ where: { id: clean(input.proveedor_id), organization_id: actor.organizationId, activo: true } }) : null,
      clean(input.expediente_id) ? this.db.expediente.findFirst({ where: { id: clean(input.expediente_id), organization_id: actor.organizationId, archived_at: null }, select: { id: true } }) : null,
      clean(input.receptor_compareciente_id) ? this.db.compareciente.findFirst({ where: { id: clean(input.receptor_compareciente_id), organization_id: actor.organizationId, archived_at: null }, select: { id: true } }) : null,
    ]);
    if (direction === 'EMITIDO' && !entity && !incompleteCentralDraft && !incompleteIncomeDraft) throw new FinanceFiscalError(400, 'CFDI_ENTITY_REQUIRED', 'Selecciona una entidad fiscal activa.');
    if (clean(input.proveedor_id) && !supplier) throw new FinanceFiscalError(403, 'CFDI_SUPPLIER_SCOPE_DENIED', 'El proveedor no pertenece a la organización activa.');
    if (clean(input.expediente_id) && !expediente) throw new FinanceFiscalError(403, 'CFDI_EXPEDIENTE_SCOPE_DENIED', 'El expediente no pertenece a la organización activa.');
    if (clean(input.receptor_compareciente_id) && !receiver) throw new FinanceFiscalError(403, 'CFDI_RECEIVER_SCOPE_DENIED', 'El receptor no pertenece a la organización activa.');
    const emisorRfc = direction === 'EMITIDO' ? entity?.rfc || '' : (supplier?.rfc || (incompleteCentralDraft && !clean(input.emisor_rfc) ? '' : rfc(input.emisor_rfc, 'RFC emisor')));
    const emisorName = direction === 'EMITIDO' ? entity?.razon_social || '' : (supplier?.razon_social || (incompleteCentralDraft ? clean(input.emisor_nombre) : required(input.emisor_nombre, 'Nombre del emisor')));
    const receptorRfc = incomeId ? '' : direction === 'EMITIDO' ? (incompleteCentralDraft && !clean(input.receptor_rfc) ? '' : rfc(input.receptor_rfc, 'RFC receptor')) : (entity?.rfc || (incompleteCentralDraft && !clean(input.receptor_rfc) ? '' : rfc(input.receptor_rfc, 'RFC receptor')));
    const receptorName = incomeId ? '' : direction === 'EMITIDO' ? (incompleteCentralDraft ? clean(input.receptor_nombre) : required(input.receptor_nombre, 'Nombre del receptor')) : (entity?.razon_social || (incompleteCentralDraft ? clean(input.receptor_nombre) : required(input.receptor_nombre, 'Nombre del receptor')));
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-draft:${actor.organizationId}:${idempotencyKey}`}))`);
      const duplicate = await tx.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
      if (duplicate) return { cfdi: duplicate, idempotent: true };
      let receiverProfile: { rfc: string; razon_social: string; regimen_fiscal: string;
        regimenes_fiscales: Prisma.JsonValue | null; codigo_postal: string } | null = null;
      let selectedReceiverRegime = '';
      let canonicalConcepts: Array<Record<string, string>> = [];
      if (incomeId) {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-income:${actor.organizationId}:${incomeId}`}))`);
        const balance = await this.incomeBalance(tx, actor, incomeId);
        if (!expediente || expediente.id !== balance.income.expediente_id) throw new FinanceFiscalError(403, 'CFDI_INCOME_EXPEDIENTE_MISMATCH', 'El ingreso no pertenece al expediente seleccionado.');
        const linkedReceiver = await tx.expedienteCompareciente.findFirst({ where: {
          organization_id: actor.organizationId, expediente_id: expediente.id,
          compareciente_id: receiver?.id ?? '', archived_at: null, estatus: 'ACTIVO',
        }, select: { id: true } });
        if (!receiver || !linkedReceiver) throw new FinanceFiscalError(403, 'CFDI_RECEIVER_NOT_LINKED', 'El receptor debe ser un compareciente activo del expediente.');
        receiverProfile = await tx.comparecienteFiscalProfile.findFirst({ where: { compareciente_id: receiver.id, organization_id: actor.organizationId },
          select: { rfc: true, razon_social: true, regimen_fiscal: true, regimenes_fiscales: true, codigo_postal: true } });
        if (!receiverProfile && !incompleteIncomeDraft) throw new FinanceFiscalError(409, 'CFDI_RECEIVER_FISCAL_PROFILE_REQUIRED', 'Confirma los datos fiscales del compareciente antes de generar la prefactura.');
        const choices = receiverProfile ? fiscalRegimeCodes(receiverProfile.regimenes_fiscales, receiverProfile.regimen_fiscal) : [];
        selectedReceiverRegime = clean(input.receptor_regimen) || (choices.length === 1 ? choices[0] : '');
        if ((!selectedReceiverRegime && !incompleteIncomeDraft) ||
            (selectedReceiverRegime && !choices.includes(selectedReceiverRegime))) throw new FinanceFiscalError(400,
          'CFDI_RECEIVER_REGIME_SELECTION_REQUIRED', 'Selecciona un régimen confirmado del receptor para esta factura.');
        if (balance.income.factura_estado === 'CARGADA') throw new FinanceFiscalError(409, 'CFDI_INCOME_ALREADY_INVOICED', 'Este ingreso ya tiene factura externa completa.');
        if (!incompleteIncomeDraft) {
          const calculated = await this.calculateIncomeConcepts(tx, actor, entity!.id, expediente.id, input.conceptos);
          canonicalConcepts = calculated.canonicalConcepts;
          if (!calculated.subtotal.equals(subtotal) || !calculated.transferred.equals(transferred) || !calculated.retained.equals(retained) || !calculated.total.equals(total)) {
            throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Los totales deben derivarse de los conceptos fiscales configurados.');
          }
        } else if (!subtotal.equals(0) || !transferred.equals(0) || !retained.equals(0) ||
            (Array.isArray(input.conceptos) && input.conceptos.length > 0)) {
          throw new FinanceFiscalError(400, 'CFDI_INCOMPLETE_DRAFT_NONZERO', 'Un borrador pendiente de datos fiscales no puede reservar importes ni conceptos.');
        }
        if (total.greaterThan(balance.remainingInvoiceableAmount)) throw new FinanceFiscalError(409, 'CFDI_INCOME_BALANCE_EXCEEDED', `El saldo facturable disponible es ${balance.remainingInvoiceableAmount.toFixed(2)}.`);
        const form = clean(input.forma_pago);
        if (!incompleteIncomeDraft && method === 'PPD' && form !== '99') throw new FinanceFiscalError(400, 'CFDI_PPD_FORM_INVALID', 'PPD requiere forma de pago 99 (Por definir).');
        if (!incompleteIncomeDraft && method === 'PUE') {
          if (balance.income.estado !== 'APLICADO') throw new FinanceFiscalError(409, 'CFDI_PUE_PAYMENT_UNCONFIRMED', 'No puede marcarse PUE hasta que el ingreso quede aplicado.');
          const expected = { TRANSFERENCIA: '03', EFECTIVO: '01', CHEQUE: '02' }[balance.income.forma_pago || ''];
          if (expected && form !== expected) throw new FinanceFiscalError(400, 'CFDI_PUE_FORM_MISMATCH', `La forma de pago registrada en el ingreso corresponde a ${expected}.`);
          if (!expected && !/^\d{2}$/.test(form)) throw new FinanceFiscalError(400, 'CFDI_PUE_FORM_REQUIRED', 'Confirma una forma de pago SAT válida para este ingreso.');
        }
      } else if (total.greaterThan(0)) {
        if (!entity) throw new FinanceFiscalError(400, 'CFDI_ENTITY_REQUIRED', 'Selecciona una entidad fiscal activa.');
        const calculated = await this.calculateIncomeConcepts(tx, actor, entity.id, expediente?.id || null, input.conceptos);
        if (!calculated.subtotal.equals(subtotal) || !calculated.transferred.equals(transferred) ||
          !calculated.retained.equals(retained) || !calculated.total.equals(total)) {
          throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Los totales deben derivarse de conceptos fiscales configurados.');
        }
        canonicalConcepts = calculated.canonicalConcepts;
      }
      const [{ value: nextFolio }] = await tx.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`SELECT nextval('pravia_os.cfdi_internal_folio_seq') AS value`);
      const cfdi = await tx.documentoCfdi.create({ data: {
        organization_id: actor.organizationId, direccion: direction, tipo: type, estado: 'DRAFT', source: 'LOCAL_DRAFT',
        internal_folio: `FAC-BOR-${nextFolio.toString().padStart(6, '0')}`,
        entidad_fiscal_id: entity?.id || null, proveedor_id: supplier?.id || null, expediente_id: expediente?.id || null, ingreso_reportado_id: incomeId || null,
        receptor_compareciente_id: receiver?.id || null, emisor_rfc: emisorRfc, emisor_nombre: emisorName,
        receptor_rfc: receiverProfile?.rfc || receptorRfc, receptor_nombre: receiverProfile?.razon_social || receptorName,
        receptor_regimen: incomeId ? selectedReceiverRegime || null : clean(input.receptor_regimen) || null,
        receptor_codigo_postal: receiverProfile?.codigo_postal || postalCode(input.receptor_codigo_postal, true), uso_cfdi: clean(input.uso_cfdi) || null,
        metodo_pago: method || null, forma_pago: clean(input.forma_pago) || null, moneda: details.moneda,
        subtotal, impuestos_trasladados: transferred, impuestos_retenidos: retained, total, saldo: total,
        draft_payload: { source: incomeId ? 'EXP008_INCOME' : clean(input.source_context) || 'CENTRAL', incomplete_income: incompleteIncomeDraft,
          concepts: canonicalConcepts, complemento_notarios: input.complemento_notarios || null, retenciones: input.retenciones || null, fiscal_comprobante: details.fiscal_comprobante },
        idempotency_key: idempotencyKey, created_by_id: actor.id,
      } });
      if (direction === 'EMITIDO' && !incomeId && total.greaterThan(0)) await tx.cuentaPorCobrarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: cfdi.id, expediente_id: expediente?.id || null, concepto: required(input.concepto || 'Factura emitida', 'Concepto'), monto_total: total, saldo: total, fecha_vencimiento: input.fecha_vencimiento ? new Date(clean(input.fecha_vencimiento)) : null, created_by_id: actor.id } });
      if (direction === 'RECIBIDO' && total.greaterThan(0)) await tx.cuentaPorPagarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: cfdi.id, proveedor_id: supplier?.id || null, expediente_id: expediente?.id || null, concepto: required(input.concepto || 'Factura recibida', 'Concepto'), monto_total: total, saldo: total, fecha_vencimiento: input.fecha_vencimiento ? new Date(clean(input.fecha_vencimiento)) : null, created_by_id: actor.id } });
      await audit(tx, actor, 'CREATE_CFDI_DRAFT', 'DocumentoCfdi', cfdi.id, { direccion: direction, tipo: type, total: total.toFixed(2), metodo_pago: method || null, source_context: incomeId ? 'EXP008_INCOME' : clean(input.source_context) || 'CENTRAL', ingreso_reportado_id: incomeId || null, pac_invoked: false }, correlationId);
      return { cfdi: await tx.documentoCfdi.findUniqueOrThrow({ where: { id: cfdi.id }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } }), idempotent: false };
    });
    return result;
  }

  async updateDraft(actor: FiscalActor, id: string, input: Record<string, unknown>, correlationId?: string) {
    const existing = await this.db.documentoCfdi.findFirst({ where: { id, organization_id: actor.organizationId }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
    if (!existing) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
    if (!RESERVING_DRAFT_STATES.has(existing.estado)) throw new FinanceFiscalError(409, 'CFDI_FISCAL_IMMUTABLE', 'Sólo se puede editar una prefactura.');
    const subtotal = input.subtotal === undefined ? existing.subtotal : decimal(input.subtotal, 'Subtotal', true);
    const transferred = input.impuestos_trasladados === undefined ? existing.impuestos_trasladados : decimal(input.impuestos_trasladados, 'Impuestos trasladados', true);
    const retained = input.impuestos_retenidos === undefined ? existing.impuestos_retenidos : decimal(input.impuestos_retenidos, 'Impuestos retenidos', true);
    const savedPayload = existing.draft_payload && typeof existing.draft_payload === 'object' && !Array.isArray(existing.draft_payload)
      ? existing.draft_payload as Record<string, unknown> : {};
    const incomeIncomplete = Boolean(existing.ingreso_reportado_id && savedPayload.incomplete_income === true &&
      (input.total === undefined ? existing.total.equals(0) : clean(input.total) === '0.00' || clean(input.total) === '0'));
    const total = input.total === undefined ? existing.total : decimal(input.total, 'Total', !existing.ingreso_reportado_id || incomeIncomplete);
    if (!subtotal.plus(transferred).minus(retained).equals(total)) throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Subtotal, impuestos y total no cuadran.');
    if (existing.cuentaPorCobrar?.monto_cobrado.greaterThan(total) || existing.cuentaPorPagar?.monto_pagado.greaterThan(total)) {
      throw new FinanceFiscalError(409, 'CFDI_DRAFT_BELOW_PAID', 'El borrador no puede quedar por debajo de los pagos ya aplicados.');
    }
    const details = draftFiscalDetails(input, { ...savedPayload, moneda: existing.moneda }, !existing.ingreso_reportado_id || incomeIncomplete);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-draft-id:${actor.organizationId}:${id}`}))`);
      const current = await tx.documentoCfdi.findFirst({ where: { id, organization_id: actor.organizationId },
        select: { estado: true, ingreso_reportado_id: true, updated_at: true } });
      if (!current || !RESERVING_DRAFT_STATES.has(current.estado) ||
        current.ingreso_reportado_id !== existing.ingreso_reportado_id ||
        current.updated_at.getTime() !== existing.updated_at.getTime()) {
        throw new FinanceFiscalError(409, 'CFDI_DRAFT_CHANGED', 'La prefactura cambió; vuelve a cargarla.');
      }
      const selectedEntity = clean(input.entidad_fiscal_id) ? await tx.entidadFiscalCfdi.findFirst({ where: {
        id: clean(input.entidad_fiscal_id), organization_id: actor.organizationId, activa: true,
      }, select: { id: true, rfc: true, razon_social: true } }) : null;
      if (clean(input.entidad_fiscal_id) && !selectedEntity) throw new FinanceFiscalError(403, 'CFDI_ENTITY_SCOPE_DENIED', 'La entidad fiscal no está disponible para esta organización.');
      const effectiveEntityId = selectedEntity?.id || existing.entidad_fiscal_id;
      let canonicalConcepts: Array<Record<string, string>> | null = null;
      let confirmedReceiver: { rfc: string; razon_social: string; codigo_postal: string } | null = null;
      let selectedRegime = '';
      if (existing.ingreso_reportado_id) {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-income:${actor.organizationId}:${existing.ingreso_reportado_id}`}))`);
        const balance = await this.incomeBalance(tx, actor, existing.ingreso_reportado_id, id);
        if (balance.income.factura_estado === 'CARGADA' || total.greaterThan(balance.remainingInvoiceableAmount)) {
          throw new FinanceFiscalError(409, 'CFDI_INCOME_BALANCE_EXCEEDED', `El saldo facturable disponible es ${balance.remainingInvoiceableAmount.toFixed(2)}.`);
        }
        const receiverProfile = await tx.comparecienteFiscalProfile.findFirst({ where: {
          organization_id: actor.organizationId, compareciente_id: existing.receptor_compareciente_id || '',
        }, select: { rfc: true, razon_social: true, codigo_postal: true, regimen_fiscal: true, regimenes_fiscales: true } });
        if (!receiverProfile && !incomeIncomplete) throw new FinanceFiscalError(409, 'CFDI_RECEIVER_FISCAL_PROFILE_REQUIRED',
          'Confirma los datos fiscales del receptor antes de editar la prefactura.');
        selectedRegime = clean(input.receptor_regimen === undefined ? existing.receptor_regimen : input.receptor_regimen);
        const choices = receiverProfile ? fiscalRegimeCodes(receiverProfile.regimenes_fiscales, receiverProfile.regimen_fiscal) : [];
        if ((!selectedRegime && !incomeIncomplete) || (selectedRegime && !choices.includes(selectedRegime))) {
          throw new FinanceFiscalError(400, 'CFDI_RECEIVER_REGIME_SELECTION_REQUIRED',
            'Selecciona un régimen confirmado del receptor para esta factura.');
        }
        if (receiverProfile) confirmedReceiver = receiverProfile;
        const saved = savedPayload;
        const requestedLines = input.conceptos !== undefined ? input.conceptos : Array.isArray(saved.concepts)
          ? saved.concepts.map((line) => ({ concepto_fiscal_id: (line as Record<string, unknown>).concepto_fiscal_id,
            cantidad: (line as Record<string, unknown>).cantidad, valor_unitario: (line as Record<string, unknown>).valor_unitario })) : [];
        if (incomeIncomplete) {
          if (!subtotal.equals(0) || !transferred.equals(0) || !retained.equals(0) ||
            (Array.isArray(requestedLines) && requestedLines.length > 0)) throw new FinanceFiscalError(400,
            'CFDI_INCOMPLETE_DRAFT_NONZERO', 'Un borrador pendiente de datos fiscales no puede reservar importes ni conceptos.');
          canonicalConcepts = [];
        } else {
          if (!effectiveEntityId) throw new FinanceFiscalError(400, 'CFDI_ENTITY_REQUIRED', 'Selecciona una entidad fiscal activa.');
          const calculated = await this.calculateIncomeConcepts(tx, actor, effectiveEntityId, existing.expediente_id!, requestedLines);
          if (!calculated.subtotal.equals(subtotal) || !calculated.transferred.equals(transferred) || !calculated.retained.equals(retained) || !calculated.total.equals(total)) {
            throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Los totales deben derivarse de los conceptos fiscales configurados.');
          }
          canonicalConcepts = calculated.canonicalConcepts;
        }
        const method = upper(input.metodo_pago === undefined ? existing.metodo_pago : input.metodo_pago);
        const form = clean(input.forma_pago === undefined ? existing.forma_pago : input.forma_pago);
        if (!incomeIncomplete && method !== 'PUE' && method !== 'PPD') throw new FinanceFiscalError(400, 'CFDI_PAYMENT_METHOD_INVALID', 'Selecciona PUE o PPD.');
        if (!incomeIncomplete && method === 'PPD' && form !== '99') throw new FinanceFiscalError(400, 'CFDI_PPD_FORM_INVALID', 'PPD requiere forma de pago 99 (Por definir).');
        if (!incomeIncomplete && method === 'PUE') {
          if (balance.income.estado !== 'APLICADO') throw new FinanceFiscalError(409, 'CFDI_PUE_PAYMENT_UNCONFIRMED', 'No puede marcarse PUE hasta que el ingreso quede aplicado.');
          const expected: string | undefined = ({ TRANSFERENCIA: '03', EFECTIVO: '01', CHEQUE: '02' } as Record<string, string>)[balance.income.forma_pago || ''];
          if (expected && form !== expected) throw new FinanceFiscalError(400, 'CFDI_PUE_FORM_MISMATCH', `La forma de pago registrada en el ingreso corresponde a ${expected}.`);
          if (!expected && !/^\d{2}$/.test(form)) throw new FinanceFiscalError(400, 'CFDI_PUE_FORM_REQUIRED', 'Confirma una forma de pago SAT válida para este ingreso.');
        }
      } else {
        await this.assertDraftExpedienteAccess(tx, actor, existing.expediente_id);
        if (total.greaterThan(0)) {
          const entityId = clean(input.entidad_fiscal_id) || existing.entidad_fiscal_id;
          if (!entityId) throw new FinanceFiscalError(400, 'CFDI_ENTITY_REQUIRED', 'Selecciona una entidad fiscal activa.');
          const requestedLines = input.conceptos !== undefined ? input.conceptos : savedPayload.concepts;
          const calculated = await this.calculateIncomeConcepts(tx, actor, entityId, existing.expediente_id, requestedLines);
          if (!calculated.subtotal.equals(subtotal) || !calculated.transferred.equals(transferred) ||
            !calculated.retained.equals(retained) || !calculated.total.equals(total)) {
            throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Los totales deben derivarse de conceptos fiscales configurados.');
          }
          canonicalConcepts = calculated.canonicalConcepts;
        } else canonicalConcepts = [];
      }
      const receiverRfc = input.receptor_rfc === undefined ? existing.receptor_rfc
        : clean(input.receptor_rfc) ? rfc(input.receptor_rfc, 'RFC receptor') : '';
      const receiverName = input.receptor_nombre === undefined ? existing.receptor_nombre : clean(input.receptor_nombre);
      const receiverCp = input.receptor_codigo_postal === undefined ? existing.receptor_codigo_postal
        : postalCode(input.receptor_codigo_postal, true);
      const row = await tx.documentoCfdi.update({ where: { id }, data: { subtotal, impuestos_trasladados: transferred, impuestos_retenidos: retained, total, saldo: total,
        estado: 'DRAFT', pdf_documento_id: null,
        moneda: details.moneda,
        ...(!existing.ingreso_reportado_id ? { entidad_fiscal_id: input.entidad_fiscal_id === '' ? null : selectedEntity?.id || existing.entidad_fiscal_id,
          emisor_rfc: selectedEntity?.rfc || existing.emisor_rfc, emisor_nombre: selectedEntity?.razon_social || existing.emisor_nombre,
          receptor_rfc: receiverRfc, receptor_nombre: receiverName,
          receptor_codigo_postal: receiverCp,
          ...(input.receptor_regimen !== undefined ? { receptor_regimen: clean(input.receptor_regimen) || null } : {}) } : {}),
        ...(existing.ingreso_reportado_id ? { entidad_fiscal_id: effectiveEntityId || null,
          emisor_rfc: selectedEntity?.rfc || existing.emisor_rfc, emisor_nombre: selectedEntity?.razon_social || existing.emisor_nombre,
          receptor_rfc: confirmedReceiver?.rfc || existing.receptor_rfc,
          receptor_nombre: confirmedReceiver?.razon_social || existing.receptor_nombre,
          receptor_codigo_postal: confirmedReceiver?.codigo_postal || existing.receptor_codigo_postal,
          receptor_regimen: selectedRegime || null } : {}),
        draft_payload: { ...savedPayload, incomplete_income: Boolean(existing.ingreso_reportado_id && incomeIncomplete),
          concepts: canonicalConcepts || [], fiscal_comprobante: details.fiscal_comprobante } as Prisma.InputJsonValue,
        ...(input.metodo_pago !== undefined ? { metodo_pago: upper(input.metodo_pago) || null } : {}), ...(input.forma_pago !== undefined ? { forma_pago: clean(input.forma_pago) || null } : {}), ...(input.uso_cfdi !== undefined ? { uso_cfdi: clean(input.uso_cfdi) || null } : {}) } });
      if (existing.cuentaPorCobrar) await tx.cuentaPorCobrarCfdi.update({ where: { id: existing.cuentaPorCobrar.id }, data: { monto_total: total, saldo: total.minus(existing.cuentaPorCobrar.monto_cobrado) } });
      if (existing.cuentaPorPagar) await tx.cuentaPorPagarCfdi.update({ where: { id: existing.cuentaPorPagar.id }, data: { monto_total: total, saldo: total.minus(existing.cuentaPorPagar.monto_pagado) } });
      if (!existing.ingreso_reportado_id && total.greaterThan(0) && row.direccion === 'EMITIDO' && !existing.cuentaPorCobrar) {
        await tx.cuentaPorCobrarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: id,
          expediente_id: existing.expediente_id, concepto: 'Borrador de factura', monto_total: total, saldo: total, created_by_id: actor.id } });
      }
      if (!existing.ingreso_reportado_id && total.greaterThan(0) && row.direccion === 'RECIBIDO' && !existing.cuentaPorPagar) {
        await tx.cuentaPorPagarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: id,
          proveedor_id: existing.proveedor_id, expediente_id: existing.expediente_id,
          concepto: 'Borrador de factura recibida', monto_total: total, saldo: total, created_by_id: actor.id } });
      }
      await audit(tx, actor, 'UPDATE_CFDI_DRAFT', 'DocumentoCfdi', row.id, { total: total.toFixed(2), pac_invoked: false }, correlationId);
      return row;
    });
  }

  async deleteDraft(actor: FiscalActor, id: string, correlationId?: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-draft-id:${actor.organizationId}:${id}`}))`);
      const existing = await tx.documentoCfdi.findFirst({ where: { id, organization_id: actor.organizationId }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
      if (!existing) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Prefactura no encontrada.');
      if (!RESERVING_DRAFT_STATES.has(existing.estado)) throw new FinanceFiscalError(409, 'CFDI_FISCAL_IMMUTABLE', 'No se puede eliminar un CFDI fiscal.');
      if (existing.ingreso_reportado_id) {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-income:${actor.organizationId}:${existing.ingreso_reportado_id}`}))`);
        await this.incomeBalance(tx, actor, existing.ingreso_reportado_id);
      } else {
        await this.assertDraftExpedienteAccess(tx, actor, existing.expediente_id);
      }
      if (existing.cuentaPorCobrar?.monto_cobrado.greaterThan(0) || existing.cuentaPorPagar?.monto_pagado.greaterThan(0)) throw new FinanceFiscalError(409, 'CFDI_DRAFT_HAS_PAYMENTS', 'La prefactura tiene pagos aplicados y no puede eliminarse.');
      const versions = await tx.prefacturaRepresentacion.count({ where: { organization_id: actor.organizationId, cfdi_id: id } });
      if (versions) throw new FinanceFiscalError(409, 'CFDI_DRAFT_HAS_PDF_HISTORY', 'La prefactura tiene versiones PDF conservadas. Debe cancelarse sin destruir su historial.');
      if (existing.cuentaPorCobrar) await tx.cuentaPorCobrarCfdi.delete({ where: { id: existing.cuentaPorCobrar.id } });
      if (existing.cuentaPorPagar) await tx.cuentaPorPagarCfdi.delete({ where: { id: existing.cuentaPorPagar.id } });
      await tx.documentoCfdi.delete({ where: { id } });
      await audit(tx, actor, 'DELETE_CFDI_DRAFT', 'DocumentoCfdi', id, { ingreso_reportado_id: existing.ingreso_reportado_id, total: existing.total.toFixed(2), pac_invoked: false }, correlationId);
      return { id, deleted: true };
    });
  }

  async prefacturaVersions(actor: FiscalActor, cfdiId: string) {
    const draft = await this.db.documentoCfdi.findFirst({ where: { id: cfdiId, organization_id: actor.organizationId }, select: { id: true, expediente_id: true, source: true, internal_folio: true } });
    if (!draft || draft.source !== 'LOCAL_DRAFT') throw new FinanceFiscalError(404, 'CFDI_DRAFT_NOT_FOUND', 'Borrador no encontrado.');
    await this.db.$transaction((tx) => this.assertDraftExpedienteAccess(tx, actor, draft.expediente_id));
    const versions = await this.db.prefacturaRepresentacion.findMany({ where: { organization_id: actor.organizationId, cfdi_id: cfdiId },
      select: { id: true, version: true, pdf_sha256: true, snapshot_sha256: true, size_bytes: true, created_at: true,
        documento: { select: { id: true, nombre_original: true, mime_type: true } } }, orderBy: { version: 'desc' } });
    return { draft_id: draft.id, internal_folio: draft.internal_folio, versions };
  }

  async prefacturaVersionUrl(actor: FiscalActor, cfdiId: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new FinanceFiscalError(400, 'CFDI_PDF_VERSION_INVALID', 'Versión PDF no válida.');
    const history = await this.prefacturaVersions(actor, cfdiId);
    const selected = history.versions.find((item) => item.version === version);
    if (!selected) throw new FinanceFiscalError(404, 'CFDI_PDF_VERSION_NOT_FOUND', 'La versión solicitada no existe.');
    const document = await this.db.documento.findFirst({ where: { id: selected.documento.id, organization_id: actor.organizationId }, select: { storage_key: true } });
    if (!document) throw new FinanceFiscalError(404, 'CFDI_PDF_VERSION_NOT_FOUND', 'El PDF no está disponible.');
    return { url: await getSignedUrl(document.storage_key, 600), filename: selected.documento.nombre_original,
      mimeType: 'application/pdf', sha256: selected.pdf_sha256, sizeBytes: selected.size_bytes, version };
  }

  async generatePrefactura(actor: FiscalActor, cfdiId: string, idempotencyKey: string, correlationId?: string) {
    if (!idempotencyKey || idempotencyKey.length > 180) throw new FinanceFiscalError(400, 'CFDI_PDF_IDEMPOTENCY_REQUIRED', 'Indica una clave de operación válida para generar el PDF.');
    let uploadedKey: string | null = null;
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:prefactura-pdf:${actor.organizationId}:${cfdiId}`}))`);
        const duplicate = await tx.prefacturaRepresentacion.findFirst({ where: { organization_id: actor.organizationId, cfdi_id: cfdiId, idempotency_key: idempotencyKey },
          select: { id: true, version: true, pdf_sha256: true, size_bytes: true, documento: { select: { nombre_original: true } } } });
        if (duplicate) return { representation: duplicate, idempotent: true };
        const draft = await tx.documentoCfdi.findFirst({ where: { id: cfdiId, organization_id: actor.organizationId },
          include: { entidadFiscal: true, prefacturaRepresentaciones: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 } } });
        if (!draft || draft.source !== 'LOCAL_DRAFT') throw new FinanceFiscalError(404, 'CFDI_DRAFT_NOT_FOUND', 'Borrador no encontrado.');
        if (!RESERVING_DRAFT_STATES.has(draft.estado)) throw new FinanceFiscalError(409, 'CFDI_FISCAL_IMMUTABLE', 'El documento ya no es un borrador editable.');
        await this.assertDraftExpedienteAccess(tx, actor, draft.expediente_id);
        const payload = draft.draft_payload && typeof draft.draft_payload === 'object' && !Array.isArray(draft.draft_payload)
          ? draft.draft_payload as Record<string, unknown> : {};
        const fiscal = payload.fiscal_comprobante && typeof payload.fiscal_comprobante === 'object' && !Array.isArray(payload.fiscal_comprobante)
          ? payload.fiscal_comprobante as Record<string, unknown> : {};
        const concepts = Array.isArray(payload.concepts) ? payload.concepts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
        const missing = [
          !draft.entidadFiscal && 'entidad fiscal', !draft.emisor_rfc && 'RFC emisor', !draft.emisor_nombre && 'nombre emisor',
          !draft.receptor_rfc && 'RFC receptor', !draft.receptor_nombre && 'nombre receptor', !draft.receptor_regimen && 'régimen receptor',
          !draft.receptor_codigo_postal && 'CP receptor', !draft.uso_cfdi && 'Uso CFDI', !draft.metodo_pago && 'método de pago',
          !draft.forma_pago && 'forma de pago', !clean(fiscal.lugar_expedicion) && 'lugar de expedición',
          (!concepts.length || concepts.some((item) => !clean(item.concepto_fiscal_id))) && 'conceptos fiscales configurados', draft.total.lessThanOrEqualTo(0) && 'total mayor que cero',
          draft.moneda !== 'MXN' && !clean(fiscal.tipo_cambio) && 'tipo de cambio',
        ].filter(Boolean);
        if (missing.length) throw new FinanceFiscalError(409, 'CFDI_PDF_FIELDS_MISSING', `Para generar el PDF faltan: ${missing.join(', ')}.`);
        const version = (draft.prefacturaRepresentaciones[0]?.version || 0) + 1;
        const folio = draft.internal_folio || `FAC-BOR-${(await tx.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`SELECT nextval('pravia_os.cfdi_internal_folio_seq') AS value`))[0].value.toString().padStart(6, '0')}`;
        const normalizedConcepts = concepts.map((item) => ({
          description: clean(item.descripcion), product_code: clean(item.clave_prod_serv), unit_code: clean(item.clave_unidad),
          quantity: clean(item.cantidad), unit_price: clean(item.valor_unitario), subtotal: clean(item.subtotal),
          transferred: clean(item.iva || '0.00'), retained: new Prisma.Decimal(clean(item.iva_retencion || '0')).plus(clean(item.isr_retencion || '0')).toFixed(2), total: clean(item.total),
        }));
        if (normalizedConcepts.some((item) => !item.description || !item.product_code || !item.unit_code || !item.quantity || !item.unit_price || !item.subtotal || !item.total)) {
          throw new FinanceFiscalError(409, 'CFDI_PDF_CONCEPTS_INCOMPLETE', 'Los conceptos fiscales del borrador están incompletos. Revísalos antes de generar.');
        }
        const fx = clean(fiscal.tipo_cambio) || null;
        const snapshot: PrefacturaSnapshot = {
          folio, version, generated_at: new Date().toISOString(),
          emitter: { name: draft.emisor_nombre, rfc: draft.emisor_rfc, regimen: draft.entidadFiscal?.regimen_fiscal || '', postal_code: draft.entidadFiscal?.codigo_postal || '' },
          receiver: { name: draft.receptor_nombre, rfc: draft.receptor_rfc, regimen: draft.receptor_regimen!, postal_code: draft.receptor_codigo_postal!, uso_cfdi: draft.uso_cfdi! },
          currency: draft.moneda, exchange_rate: fx, equivalent_mxn: fx ? draft.total.mul(new Prisma.Decimal(fx)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : null,
          payment: { method: draft.metodo_pago!, form: draft.forma_pago!, terms: clean(fiscal.condiciones_pago) || null },
          export_code: clean(fiscal.exportacion) || null, issue_place: clean(fiscal.lugar_expedicion), concepts: normalizedConcepts,
          amounts: { subtotal: draft.subtotal.toFixed(2), transferred: draft.impuestos_trasladados.toFixed(2), retained: draft.impuestos_retenidos.toFixed(2), total: draft.total.toFixed(2) },
        };
        const pdf = await renderPrefacturaPdf(snapshot);
        if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new FinanceFiscalError(500, 'CFDI_PDF_RENDER_INVALID', 'El generador no produjo un PDF válido.');
        const name = `${folio}-v${version}.pdf`;
        const key = `organizations/${actor.organizationId}/fiscal/prefacturas/${cfdiId}/v${version}_${randomUUID()}.pdf`;
        await uploadFile(pdf, key, 'application/pdf');
        uploadedKey = key;
        const pdfHash = createHash('sha256').update(pdf).digest('hex');
        const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        const document = await tx.documento.create({ data: { organization_id: actor.organizationId, nombre_original: name,
          nombre_interno: key, storage_key: key, tipo: 'PREFACTURA_PDF', categoria: 'OTROS', mime_type: 'application/pdf',
          size_bytes: pdf.length, checksum_sha256: pdfHash, observaciones: 'PREFACTURA — DOCUMENTO SIN VALIDEZ FISCAL',
          subido_por_id: actor.id, expediente_id: draft.expediente_id } });
        const representation = await tx.prefacturaRepresentacion.create({ data: { organization_id: actor.organizationId,
          cfdi_id: draft.id, documento_id: document.id, version, idempotency_key: idempotencyKey,
          snapshot: snapshot as unknown as Prisma.InputJsonValue, snapshot_sha256: snapshotHash, pdf_sha256: pdfHash,
          size_bytes: pdf.length, created_by_id: actor.id },
          select: { id: true, version: true, pdf_sha256: true, size_bytes: true, documento: { select: { nombre_original: true } } } });
        await tx.documentoCfdi.update({ where: { id: draft.id }, data: { internal_folio: folio, estado: 'PREFACTURA', pdf_documento_id: document.id } });
        await audit(tx, actor, 'GENERATE_PREFACTURA_PDF', 'PrefacturaRepresentacion', representation.id,
          { cfdi_id: draft.id, version, document_id: document.id, pdf_sha256: pdfHash, size_bytes: pdf.length, pac_invoked: false }, correlationId);
        return { representation, idempotent: false };
      }, { timeout: 30000 });
    } catch (error) {
      if (uploadedKey) await deleteFile(uploadedKey).catch(() => undefined);
      throw error;
    }
  }

  async uploadManual(actor: FiscalActor, xmlFile: UploadedFiscalFile, pdfFile?: UploadedFiscalFile, correlationId?: string) {
    const xmlName = xmlFile.originalname.toLowerCase();
    if (!xmlName.endsWith('.xml') || !XML_MIME.has(xmlFile.mimetype)) throw new FinanceFiscalError(400, 'CFDI_XML_FILE_INVALID', 'Selecciona un archivo XML CFDI.');
    if (pdfFile && (!pdfFile.originalname.toLowerCase().endsWith('.pdf') || !PDF_MIME.has(pdfFile.mimetype))) throw new FinanceFiscalError(400, 'CFDI_PDF_FILE_INVALID', 'La representación impresa debe ser PDF.');
    const parsed = parseCfdi40Xml(xmlFile.buffer);
    const existing = await this.db.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, uuid_fiscal: parsed.uuid }, include: { proveedor: true, xmlDocumento: true, pdfDocumento: true } });
    if (existing) return { cfdi: existing, idempotent: true, supplierStatus: existing.proveedor_id ? 'REGISTERED' : 'UNREGISTERED' };
    const entities = await this.db.entidadFiscalCfdi.findMany({ where: { organization_id: actor.organizationId, activa: true, rfc: { in: [parsed.emisor.rfc, parsed.receptor.rfc] } } });
    const entity = entities.find((item) => item.rfc === parsed.emisor.rfc) || entities.find((item) => item.rfc === parsed.receptor.rfc);
    if (!entity) throw new FinanceFiscalError(400, 'CFDI_XML_ORGANIZATION_UNRELATED', 'El XML no corresponde a una entidad fiscal de la organización activa.');
    const direction = entity.rfc === parsed.emisor.rfc ? 'EMITIDO' : 'RECIBIDO';
    const supplier = direction === 'RECIBIDO' ? await this.db.proveedorFiscal.findFirst({ where: { organization_id: actor.organizationId, rfc: parsed.emisor.rfc } }) : null;
    // A duplicate import can race after the first UUID lookup. Never upload two
    // attempts to the same object key: the losing attempt must not overwrite or
    // delete the winning document's files.
    const uploadId = randomUUID();
    const xmlStorage = `organizations/${actor.organizationId}/fiscal/xml/${parsed.uuid}/${uploadId}.xml`;
    const pdfStorage = pdfFile ? `organizations/${actor.organizationId}/fiscal/pdf/${parsed.uuid}/${uploadId}.pdf` : null;
    const uploaded: string[] = [];
    try {
      await uploadFile(xmlFile.buffer, xmlStorage, 'application/xml'); uploaded.push(xmlStorage);
      if (pdfFile && pdfStorage) { await uploadFile(pdfFile.buffer, pdfStorage, 'application/pdf'); uploaded.push(pdfStorage); }
      const result = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-uuid:${actor.organizationId}:${parsed.uuid}`}))`);
        const duplicate = await tx.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, uuid_fiscal: parsed.uuid }, include: { proveedor: true, xmlDocumento: true, pdfDocumento: true } });
        if (duplicate) return { cfdi: duplicate, idempotent: true };
        const xmlDocument = await storeCanonicalDocument(tx, actor, xmlFile, xmlStorage, 'CFDI_XML', null);
        const pdfDocument = pdfFile && pdfStorage ? await storeCanonicalDocument(tx, actor, pdfFile, pdfStorage, 'CFDI_PDF', null) : null;
        const created = await tx.documentoCfdi.create({ data: {
          organization_id: actor.organizationId, direccion: direction, tipo: parsed.tipo, estado: 'VIGENTE', source: 'MANUAL_XML', version: parsed.version,
          uuid_fiscal: parsed.uuid, serie: parsed.serie, folio: parsed.folio, entidad_fiscal_id: entity.id, proveedor_id: supplier?.id || null,
          emisor_rfc: parsed.emisor.rfc, emisor_nombre: parsed.emisor.nombre, receptor_rfc: parsed.receptor.rfc, receptor_nombre: parsed.receptor.nombre,
          receptor_regimen: parsed.receptor.regimen, receptor_codigo_postal: parsed.receptor.codigoPostal, uso_cfdi: parsed.receptor.usoCfdi,
          metodo_pago: parsed.metodoPago, forma_pago: parsed.formaPago, moneda: parsed.moneda, subtotal: parsed.subtotal,
          impuestos_trasladados: parsed.impuestosTrasladados, impuestos_retenidos: parsed.impuestosRetenidos, total: parsed.total, saldo: parsed.total,
          fecha_emision: parsed.fechaEmision, fecha_timbrado: parsed.fechaTimbrado, draft_payload: { imported_manually: true, immutable_source: 'XML', supplier_registered_at_import: Boolean(supplier) },
          xml_documento_id: xmlDocument.id, pdf_documento_id: pdfDocument?.id || null, idempotency_key: `manual-xml:${parsed.uuid}`, created_by_id: actor.id,
        } });
        if (direction === 'EMITIDO') await tx.cuentaPorCobrarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: created.id, concepto: `CFDI ${parsed.serie || ''}${parsed.folio || parsed.uuid}`.trim(), monto_total: parsed.total, saldo: parsed.total, created_by_id: actor.id } });
        else await tx.cuentaPorPagarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: created.id, proveedor_id: supplier?.id || null, concepto: `CFDI recibido ${parsed.serie || ''}${parsed.folio || parsed.uuid}`.trim(), monto_total: parsed.total, saldo: parsed.total, created_by_id: actor.id } });
        await audit(tx, actor, 'UPLOAD_MANUAL_CFDI', 'DocumentoCfdi', created.id, { uuid: parsed.uuid, direccion: direction, total: parsed.total.toFixed(2), xml_documento_id: xmlDocument.id, pdf_documento_id: pdfDocument?.id || null, supplier_registered: Boolean(supplier) }, correlationId);
        return { cfdi: await tx.documentoCfdi.findUniqueOrThrow({ where: { id: created.id }, include: { proveedor: true, xmlDocumento: true, pdfDocumento: true, cuentaPorCobrar: true, cuentaPorPagar: true } }), idempotent: false };
      });
      if (result.idempotent) await Promise.all(uploaded.map((key) => deleteFile(key).catch(() => undefined)));
      return { cfdi: result.cfdi, idempotent: result.idempotent,
        supplierStatus: result.cfdi.proveedor_id ? 'REGISTERED' : 'UNREGISTERED',
        supplierPrefill: result.cfdi.proveedor_id ? null : { rfc: parsed.emisor.rfc, razon_social: parsed.emisor.nombre, regimenes_fiscales: parsed.emisor.regimen ? [{ clave: parsed.emisor.regimen, descripcion: '' }] : [] } };
    } catch (error) {
      await Promise.all(uploaded.map((key) => deleteFile(key).catch(() => undefined)));
      throw error;
    }
  }

  async documentUrl(actor: FiscalActor, cfdiId: string, kind: 'xml' | 'pdf') {
    const row = await this.db.documentoCfdi.findFirst({ where: { id: cfdiId, organization_id: actor.organizationId }, include: { xmlDocumento: true, pdfDocumento: true } });
    if (!row) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
    const document = kind === 'xml' ? row.xmlDocumento : row.pdfDocumento;
    if (!document) throw new FinanceFiscalError(404, 'CFDI_FILE_NOT_FOUND', 'El CFDI no tiene este archivo asociado.');
    return { url: await getSignedUrl(document.storage_key, 600), filename: document.nombre_original, mimeType: document.mime_type };
  }

  async applyPayment(actor: FiscalActor, cfdiId: string, input: Record<string, unknown>, correlationId?: string) {
    const amount = decimal(input.monto, 'Monto aplicado');
    const movementId = required(input.movimiento_id, 'Movimiento');
    const idempotencyKey = required(input.idempotency_key, 'Idempotency key');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-payment:${actor.organizationId}:${cfdiId}`}))`);
      const duplicate = await tx.aplicacionPagoCfdi.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey } });
      if (duplicate) return { application: duplicate, idempotent: true };
      const cfdi = await tx.documentoCfdi.findFirst({ where: { id: cfdiId, organization_id: actor.organizationId }, include: { cuentaPorCobrar: true, cuentaPorPagar: true, aplicacionesPago: true } });
      if (!cfdi) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
      const movement = await tx.movimientoFinanciero.findFirst({ where: { id: movementId, organization_id: actor.organizationId, estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] } } });
      if (!movement) throw new FinanceFiscalError(404, 'CFDI_PAYMENT_MOVEMENT_INVALID', 'Selecciona un movimiento aplicado de la organización activa.');
      if (cfdi.direccion === 'EMITIDO' && movement.naturaleza !== 'INGRESO') throw new FinanceFiscalError(409, 'CFDI_PAYMENT_NATURE_MISMATCH', 'Una cuenta por cobrar requiere un ingreso.');
      if (cfdi.direccion === 'RECIBIDO' && movement.naturaleza !== 'EGRESO') throw new FinanceFiscalError(409, 'CFDI_PAYMENT_NATURE_MISMATCH', 'Una cuenta por pagar requiere un egreso.');
      const account = cfdi.direccion === 'EMITIDO' ? cfdi.cuentaPorCobrar : cfdi.cuentaPorPagar;
      if (!account) throw new FinanceFiscalError(409, 'CFDI_ACCOUNT_MISSING', 'El CFDI no tiene cuenta por cobrar/pagar.');
      const previous = account.saldo;
      if (amount.greaterThan(previous)) throw new FinanceFiscalError(409, 'CFDI_PAYMENT_EXCEEDS_BALANCE', 'El pago excede el saldo pendiente.');
      if (cfdi.metodo_pago === 'PUE' && !amount.equals(previous)) throw new FinanceFiscalError(409, 'CFDI_PUE_REQUIRES_FULL_PAYMENT', 'PUE requiere liquidar el saldo completo.');
      const remaining = previous.minus(amount);
      const partiality = cfdi.metodo_pago === 'PPD' ? cfdi.aplicacionesPago.length + 1 : null;
      const application = await tx.aplicacionPagoCfdi.create({ data: {
        organization_id: actor.organizationId, cfdi_id: cfdi.id, movimiento_id: movement.id,
        cuenta_por_cobrar_id: cfdi.cuentaPorCobrar?.id || null, cuenta_por_pagar_id: cfdi.cuentaPorPagar?.id || null,
        monto_aplicado: amount, numero_parcialidad: partiality, saldo_anterior: previous, saldo_insoluto: remaining,
        estado_rep: cfdi.metodo_pago === 'PPD' ? 'ELEGIBLE_PREPARACION' : null, idempotency_key: idempotencyKey, created_by_id: actor.id,
      } });
      const state = remaining.equals(0) ? 'LIQUIDADA' : 'PARCIAL';
      if (cfdi.cuentaPorCobrar) await tx.cuentaPorCobrarCfdi.update({ where: { id: cfdi.cuentaPorCobrar.id }, data: { monto_cobrado: cfdi.cuentaPorCobrar.monto_cobrado.plus(amount), saldo: remaining, estado: state } });
      if (cfdi.cuentaPorPagar) await tx.cuentaPorPagarCfdi.update({ where: { id: cfdi.cuentaPorPagar.id }, data: { monto_pagado: cfdi.cuentaPorPagar.monto_pagado.plus(amount), saldo: remaining, estado: state } });
      await tx.documentoCfdi.update({ where: { id: cfdi.id }, data: { saldo: remaining } });
      await audit(tx, actor, 'APPLY_CFDI_PAYMENT', 'AplicacionPagoCfdi', application.id, { cfdi_id: cfdi.id, movimiento_id: movement.id, monto: amount.toFixed(2), saldo_anterior: previous.toFixed(2), saldo_insoluto: remaining.toFixed(2), parcialidad: partiality }, correlationId);
      return { application, idempotent: false, balance: remaining.toFixed(2) };
    });
  }

  async prepareRep(actor: FiscalActor, cfdiId: string) {
    const cfdi = await this.db.documentoCfdi.findFirst({ where: { id: cfdiId, organization_id: actor.organizationId }, include: { aplicacionesPago: { include: { movimiento: true }, orderBy: { created_at: 'asc' } } } });
    if (!cfdi) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
    if (cfdi.metodo_pago !== 'PPD') throw new FinanceFiscalError(409, 'CFDI_REP_NOT_APPLICABLE', 'El complemento de pagos sólo aplica a CFDI PPD.');
    if (!cfdi.uuid_fiscal || !['VIGENTE', 'TIMBRADO'].includes(cfdi.estado)) return { eligible: false, reason: 'SOURCE_CFDI_NOT_STAMPED', message: 'La factura origen debe estar timbrada antes de preparar el REP.', providerCall: false };
    const pending = cfdi.aplicacionesPago.filter((item) => !item.rep_cfdi_id);
    if (!pending.length) return { eligible: false, reason: 'NO_UNREPORTED_PAYMENTS', message: 'No hay pagos pendientes de complemento.', providerCall: false };
    return { eligible: true, providerCall: false, payload: { version: '2.0', relatedUuid: cfdi.uuid_fiscal, currency: cfdi.moneda, payments: pending.map((item) => ({ applicationId: item.id, movementId: item.movimiento_id, date: item.movimiento.fecha_movimiento, amount: item.monto_aplicado.toFixed(2), partiality: item.numero_parcialidad, previousBalance: item.saldo_anterior?.toFixed(2), outstandingBalance: item.saldo_insoluto?.toFixed(2) })) } };
  }

  async stamp(actor: FiscalActor, cfdiId: string) {
    const row = await this.db.documentoCfdi.findFirst({ where: { id: cfdiId, organization_id: actor.organizationId } });
    if (!row) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
    if (!this.provider.configured) throw new FinanceFiscalError(503, 'CFDI_PROVIDER_NOT_CONFIGURED', 'El PAC no está configurado; no se generó timbrado ni UUID.');
    try {
      return await this.provider.stamp({ version: '4.0', tipo: row.tipo as 'I', emisorRfc: row.emisor_rfc, receptorRfc: row.receptor_rfc, total: row.total.toFixed(2), metodoPago: row.metodo_pago as 'PUE' | 'PPD' | null });
    } catch (error) {
      if (error instanceof CfdiProviderUnavailableError) throw new FinanceFiscalError(error.status, error.code, error.message);
      throw error;
    }
  }

  async createInternalTransfer(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string) {
    const sourceId = required(input.cuenta_origen_id, 'Cuenta origen');
    const targetId = required(input.cuenta_destino_id, 'Cuenta destino');
    if (sourceId === targetId) throw new FinanceFiscalError(400, 'TRANSFER_SAME_ACCOUNT', 'Origen y destino deben ser cuentas distintas.');
    const amount = decimal(input.monto, 'Monto');
    const idempotencyKey = required(input.idempotency_key, 'Idempotency key');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:internal-transfer:${actor.organizationId}:${idempotencyKey}`}))`);
      const existing = await tx.transferenciaInterna.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey }, include: { movimientoOrigen: true, movimientoDestino: true } });
      if (existing) return { transfer: existing, idempotent: true };
      const accounts = await tx.cuentaFinanciera.findMany({ where: { id: { in: [sourceId, targetId] }, organization_id: actor.organizationId, activa: true } });
      if (accounts.length !== 2) throw new FinanceFiscalError(403, 'TRANSFER_ACCOUNT_SCOPE_DENIED', 'Ambas cuentas deben pertenecer a la organización activa.');
      const sequence = await tx.$queryRaw<Array<{ first: bigint; second: bigint }>>`SELECT nextval('finance_movement_folio_seq') AS first, nextval('finance_movement_folio_seq') AS second`;
      const year = new Date().getUTCFullYear();
      const first = `MOV-${year}-${String(sequence[0].first).padStart(6, '0')}`;
      const second = `MOV-${year}-${String(sequence[0].second).padStart(6, '0')}`;
      const common = { organization_id: actor.organizationId, tipo_movimiento: 'AJUSTE' as const, categoria: 'TRANSFERENCIA_INTERNA', concepto: required(input.concepto || 'Transferencia entre cuentas propias', 'Concepto'), monto: amount, fecha_movimiento: input.fecha ? new Date(clean(input.fecha)) : new Date(), referencia: clean(input.referencia) || null, estatus: 'APLICADO' as const, capturado_por_id: actor.id, validado_por_id: actor.id, fecha_validacion: new Date(), aplicado_por_id: actor.id, fecha_aplicacion: new Date() };
      const debit = await tx.movimientoFinanciero.create({ data: { ...common, folio: first, cuenta_id: sourceId, naturaleza: 'EGRESO', idempotency_key: `${idempotencyKey}:debit` } });
      const credit = await tx.movimientoFinanciero.create({ data: { ...common, folio: second, cuenta_id: targetId, naturaleza: 'INGRESO', idempotency_key: `${idempotencyKey}:credit` } });
      const transfer = await tx.transferenciaInterna.create({ data: { organization_id: actor.organizationId, cuenta_origen_id: sourceId, cuenta_destino_id: targetId, movimiento_origen_id: debit.id, movimiento_destino_id: credit.id, monto: amount, referencia: clean(input.referencia) || null, idempotency_key: idempotencyKey, created_by_id: actor.id }, include: { movimientoOrigen: true, movimientoDestino: true } });
      await audit(tx, actor, 'CREATE_INTERNAL_TRANSFER', 'TransferenciaInterna', transfer.id, { monto: amount.toFixed(2), cuenta_origen_id: sourceId, cuenta_destino_id: targetId, pnl_effect: '0.00', invoice_effect: 0 }, correlationId);
      return { transfer, idempotent: false };
    });
  }

  async listAccounts(actor: FiscalActor) {
    const [receivables, payables, transfers] = await Promise.all([
      this.db.cuentaPorCobrarCfdi.findMany({ where: { organization_id: actor.organizationId }, include: { cfdi: true, expediente: { select: { id: true, numero_pravia: true } }, aplicaciones: true }, orderBy: { created_at: 'desc' } }),
      this.db.cuentaPorPagarCfdi.findMany({ where: { organization_id: actor.organizationId }, include: { cfdi: true, proveedor: true, expediente: { select: { id: true, numero_pravia: true } }, aplicaciones: true }, orderBy: { created_at: 'desc' } }),
      this.db.transferenciaInterna.findMany({ where: { organization_id: actor.organizationId }, include: { cuentaOrigen: true, cuentaDestino: true }, orderBy: { created_at: 'desc' } }),
    ]);
    return { receivables, payables, transfers };
  }

  async exportXlsx(actor: FiscalActor) {
    const [documents, accounts] = await Promise.all([this.listDocuments(actor), this.listAccounts(actor)]);
    const rows: Array<Array<string | number>> = [['Tipo', 'Dirección', 'Estado', 'UUID', 'RFC contraparte', 'Nombre contraparte', 'Total', 'Saldo', 'Fecha']];
    for (const cfdi of documents.items) rows.push(['CFDI', cfdi.direccion, cfdi.estado, cfdi.uuid_fiscal || '', cfdi.direccion === 'EMITIDO' ? cfdi.receptor_rfc : cfdi.emisor_rfc, cfdi.direccion === 'EMITIDO' ? cfdi.receptor_nombre : cfdi.emisor_nombre, Number(cfdi.total), Number(cfdi.saldo), cfdi.created_at.toISOString()]);
    for (const row of accounts.receivables) rows.push(['CXC', 'EMITIDO', row.estado, row.cfdi?.uuid_fiscal || '', '', row.concepto, Number(row.monto_total), Number(row.saldo), row.created_at.toISOString()]);
    for (const row of accounts.payables) rows.push(['CXP', 'RECIBIDO', row.estado, row.cfdi?.uuid_fiscal || '', row.proveedor?.rfc || '', row.concepto, Number(row.monto_total), Number(row.saldo), row.created_at.toISOString()]);
    const escapeXml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const sheetRows = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => { const letter = String.fromCharCode(65 + column); return typeof value === 'number' ? `<c r="${letter}${index + 1}"><v>${value}</v></c>` : `<c r="${letter}${index + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`; }).join('')}</row>`).join('');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    zip.folder('_rels')!.file('.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.folder('xl')!.file('workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Finanzas CFDI" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.folder('xl')!.folder('_rels')!.file('workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.folder('xl')!.folder('worksheets')!.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), rowCount: rows.length - 1, filename: `pravia-finanzas-${new Date().toISOString().slice(0, 10)}.xlsx` };
  }
}
