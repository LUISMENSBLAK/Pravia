import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { Prisma, type PrismaClient } from '@prisma/client';
import { deleteFile, getSignedUrl, uploadFile } from './supabase.service';
import { CfdiProviderUnavailableError, runtimeCfdiProvider, type CfdiProvider } from './cfdiProvider';

type Database = PrismaClient;

export type FiscalActor = {
  id: string;
  organizationId: string;
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

function decimal(value: unknown, field: string, allowZero = false) {
  const normalized = clean(value).replace(/[$,\s]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new FinanceFiscalError(400, 'CFDI_AMOUNT_INVALID', `${field} debe ser un importe monetario con máximo dos decimales.`);
  const result = new Prisma.Decimal(normalized);
  if (allowZero ? result.lessThan(0) : result.lessThanOrEqualTo(0)) throw new FinanceFiscalError(400, 'CFDI_AMOUNT_INVALID', `${field} debe ser ${allowZero ? 'cero o mayor' : 'mayor que cero'}.`);
  return result;
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
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new FinanceFiscalError(400, 'CFDI_XML_SIZE_INVALID', 'El XML debe pesar entre 1 byte y 10 MB.');
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

export function extractCsfFields(text: string) {
  const normalized = text.replace(/\r/g, '');
  const take = (labels: string[]) => {
    for (const label of labels) {
      const match = normalized.match(new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i'));
      if (match?.[1]) return clean(match[1]);
    }
    return null;
  };
  const foundRfc = upper(take(['RFC', 'Registro Federal de Contribuyentes']));
  const cpMatch = normalized.match(/(?:C[oó]digo Postal|CP)\s*:?\s*(\d{5})/i);
  const regimes = [...normalized.matchAll(/(?:Régimen Fiscal|Regimen Fiscal)\s*:?\s*(\d{3})\s*[-–:]?\s*([^\n]*)/gi)]
    .map((match) => ({ clave: match[1], descripcion: clean(match[2]) })).filter((item, index, all) => all.findIndex((other) => other.clave === item.clave) === index);
  return { rfc: RFC.test(foundRfc) ? foundRfc : null, razon_social: take(['Denominaci[oó]n\/Raz[oó]n Social', 'Nombre, denominaci[oó]n o raz[oó]n social']), codigo_postal: cpMatch?.[1] || null, regimenes_fiscales: regimes };
}

function safeFileName(name: string) { return clean(name).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-180) || 'archivo'; }
function correlation(value?: string) { return value && UUID.test(value) ? value : null; }
function audit(tx: Prisma.TransactionClient, actor: FiscalActor, action: string, entity: string, entityId: string, values: Prisma.InputJsonValue, correlationId?: string) {
  return tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: entity, entidad_id: entityId, valores_nuevos: values, correlation_id: correlation(correlationId) } });
}

async function storeCanonicalDocument(tx: Prisma.TransactionClient, actor: FiscalActor, file: UploadedFiscalFile, storageKey: string, kind: 'CFDI_XML' | 'CFDI_PDF', expedienteId?: string | null) {
  return tx.documento.create({ data: {
    organization_id: actor.organizationId, nombre_original: safeFileName(file.originalname), nombre_interno: storageKey,
    tipo: kind, categoria: 'OTROS', storage_key: storageKey, mime_type: kind === 'CFDI_XML' ? 'application/xml' : 'application/pdf',
    size_bytes: file.buffer.length, checksum_sha256: createHash('sha256').update(file.buffer).digest('hex'),
    observaciones: kind === 'CFDI_XML' ? 'XML fiscal cargado manualmente' : 'Representación impresa asociada al CFDI', subido_por_id: actor.id,
    expediente_id: expedienteId || null,
  } });
}

export class FinanceFiscalService {
  constructor(private readonly db: Database, private readonly provider: CfdiProvider = runtimeCfdiProvider) {}

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

  listSuppliers(actor: FiscalActor) { return this.db.proveedorFiscal.findMany({ where: { organization_id: actor.organizationId }, orderBy: [{ activo: 'desc' }, { razon_social: 'asc' }] }); }

  async createSupplier(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string) {
    const supplierRfc = rfc(input.rfc);
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
    const supplier = await this.db.$transaction(async (tx) => {
      const created = await tx.proveedorFiscal.create({ data: {
        organization_id: actor.organizationId, razon_social: required(input.razon_social, 'Razón social'), rfc: supplierRfc,
        tipo_persona: clean(input.tipo_persona) || null, codigo_postal: postalCode(input.codigo_postal, true),
        regimenes_fiscales: Array.isArray(input.regimenes_fiscales) ? input.regimenes_fiscales as Prisma.InputJsonValue : Prisma.JsonNull,
        correo: clean(input.correo) || null, telefono: clean(input.telefono) || null,
        datos_bancarios: input.datos_bancarios && typeof input.datos_bancarios === 'object' ? input.datos_bancarios as Prisma.InputJsonValue : Prisma.JsonNull,
        csf_documento_id: clean(input.csf_documento_id) || null, created_by_id: actor.id,
      } });
      const pending = await tx.documentoCfdi.findMany({ where: { organization_id: actor.organizationId, direccion: 'RECIBIDO', emisor_rfc: supplierRfc, proveedor_id: null }, select: { id: true } });
      if (pending.length) {
        await tx.documentoCfdi.updateMany({ where: { id: { in: pending.map((item) => item.id) }, organization_id: actor.organizationId }, data: { proveedor_id: created.id } });
        await tx.cuentaPorPagarCfdi.updateMany({ where: { cfdi_id: { in: pending.map((item) => item.id) }, organization_id: actor.organizationId, proveedor_id: null }, data: { proveedor_id: created.id } });
      }
      await audit(tx, actor, 'CREATE_FISCAL_SUPPLIER', 'ProveedorFiscal', created.id, { rfc: created.rfc, razon_social: created.razon_social }, correlationId);
      return created;
    });
    return { supplier, idempotent: false };
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
    }, include: { entidadFiscal: { select: { id: true, razon_social: true, rfc: true } }, proveedor: true, expediente: { select: { id: true, numero_pravia: true, cliente_alias: true } }, cuentaPorCobrar: true, cuentaPorPagar: true, aplicacionesPago: true, xmlDocumento: { select: { id: true, nombre_original: true } }, pdfDocumento: { select: { id: true, nombre_original: true } } }, orderBy: { created_at: 'desc' } });
    return { items, count: items.length };
  }

  async createDraft(actor: FiscalActor, input: Record<string, unknown>, correlationId?: string) {
    const direction = upper(input.direccion);
    if (direction !== 'EMITIDO' && direction !== 'RECIBIDO') throw new FinanceFiscalError(400, 'CFDI_DIRECTION_INVALID', 'La dirección debe ser EMITIDO o RECIBIDO.');
    const type = upper(input.tipo || 'I');
    if (!['I', 'E', 'P', 'T', 'N', 'RET'].includes(type)) throw new FinanceFiscalError(400, 'CFDI_TYPE_INVALID', 'Tipo de CFDI no válido.');
    const method = upper(input.metodo_pago);
    if (method && method !== 'PUE' && method !== 'PPD') throw new FinanceFiscalError(400, 'CFDI_PAYMENT_METHOD_INVALID', 'Selecciona PUE o PPD.');
    const subtotal = decimal(input.subtotal, 'Subtotal', true);
    const transferred = decimal(input.impuestos_trasladados || 0, 'Impuestos trasladados', true);
    const retained = decimal(input.impuestos_retenidos || 0, 'Impuestos retenidos', true);
    const total = decimal(input.total, 'Total');
    const calculated = subtotal.plus(transferred).minus(retained);
    if (!calculated.equals(total)) throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Subtotal, impuestos y total no cuadran.');
    const idempotencyKey = required(input.idempotency_key, 'Idempotency key');
    const existing = await this.db.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
    if (existing) return { cfdi: existing, idempotent: true };
    const [entity, supplier, expediente, receiver] = await Promise.all([
      clean(input.entidad_fiscal_id) ? this.db.entidadFiscalCfdi.findFirst({ where: { id: clean(input.entidad_fiscal_id), organization_id: actor.organizationId, activa: true } }) : null,
      clean(input.proveedor_id) ? this.db.proveedorFiscal.findFirst({ where: { id: clean(input.proveedor_id), organization_id: actor.organizationId, activo: true } }) : null,
      clean(input.expediente_id) ? this.db.expediente.findFirst({ where: { id: clean(input.expediente_id), organization_id: actor.organizationId, archived_at: null }, select: { id: true } }) : null,
      clean(input.receptor_compareciente_id) ? this.db.compareciente.findFirst({ where: { id: clean(input.receptor_compareciente_id), organization_id: actor.organizationId, archived_at: null }, select: { id: true } }) : null,
    ]);
    if (direction === 'EMITIDO' && !entity) throw new FinanceFiscalError(400, 'CFDI_ENTITY_REQUIRED', 'Selecciona una entidad fiscal activa.');
    if (clean(input.proveedor_id) && !supplier) throw new FinanceFiscalError(403, 'CFDI_SUPPLIER_SCOPE_DENIED', 'El proveedor no pertenece a la organización activa.');
    if (clean(input.expediente_id) && !expediente) throw new FinanceFiscalError(403, 'CFDI_EXPEDIENTE_SCOPE_DENIED', 'El expediente no pertenece a la organización activa.');
    if (clean(input.receptor_compareciente_id) && !receiver) throw new FinanceFiscalError(403, 'CFDI_RECEIVER_SCOPE_DENIED', 'El receptor no pertenece a la organización activa.');
    const emisorRfc = direction === 'EMITIDO' ? entity!.rfc : (supplier?.rfc || rfc(input.emisor_rfc, 'RFC emisor'));
    const emisorName = direction === 'EMITIDO' ? entity!.razon_social : (supplier?.razon_social || required(input.emisor_nombre, 'Nombre del emisor'));
    const receptorRfc = direction === 'EMITIDO' ? rfc(input.receptor_rfc, 'RFC receptor') : (entity?.rfc || rfc(input.receptor_rfc, 'RFC receptor'));
    const receptorName = direction === 'EMITIDO' ? required(input.receptor_nombre, 'Nombre del receptor') : (entity?.razon_social || required(input.receptor_nombre, 'Nombre del receptor'));
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-draft:${actor.organizationId}:${idempotencyKey}`}))`);
      const duplicate = await tx.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, idempotency_key: idempotencyKey }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
      if (duplicate) return { cfdi: duplicate, idempotent: true };
      const cfdi = await tx.documentoCfdi.create({ data: {
        organization_id: actor.organizationId, direccion: direction, tipo: type, estado: 'PREFACTURA', source: 'LOCAL_DRAFT',
        entidad_fiscal_id: entity?.id || null, proveedor_id: supplier?.id || null, expediente_id: expediente?.id || null,
        receptor_compareciente_id: receiver?.id || null, emisor_rfc: emisorRfc, emisor_nombre: emisorName,
        receptor_rfc: receptorRfc, receptor_nombre: receptorName, receptor_regimen: clean(input.receptor_regimen) || null,
        receptor_codigo_postal: postalCode(input.receptor_codigo_postal, true), uso_cfdi: clean(input.uso_cfdi) || null,
        metodo_pago: method || null, forma_pago: clean(input.forma_pago) || null, moneda: upper(input.moneda || 'MXN'),
        subtotal, impuestos_trasladados: transferred, impuestos_retenidos: retained, total, saldo: total,
        draft_payload: { source: clean(input.source_context) || 'CENTRAL', concepts: Array.isArray(input.conceptos) ? input.conceptos : [], complemento_notarios: input.complemento_notarios || null, retenciones: input.retenciones || null },
        idempotency_key: idempotencyKey, created_by_id: actor.id,
      } });
      if (direction === 'EMITIDO') await tx.cuentaPorCobrarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: cfdi.id, expediente_id: expediente?.id || null, concepto: required(input.concepto || 'Factura emitida', 'Concepto'), monto_total: total, saldo: total, fecha_vencimiento: input.fecha_vencimiento ? new Date(clean(input.fecha_vencimiento)) : null, created_by_id: actor.id } });
      else await tx.cuentaPorPagarCfdi.create({ data: { organization_id: actor.organizationId, cfdi_id: cfdi.id, proveedor_id: supplier?.id || null, expediente_id: expediente?.id || null, concepto: required(input.concepto || 'Factura recibida', 'Concepto'), monto_total: total, saldo: total, fecha_vencimiento: input.fecha_vencimiento ? new Date(clean(input.fecha_vencimiento)) : null, created_by_id: actor.id } });
      await audit(tx, actor, 'CREATE_CFDI_DRAFT', 'DocumentoCfdi', cfdi.id, { direccion: direction, tipo: type, total: total.toFixed(2), metodo_pago: method || null, source_context: clean(input.source_context) || 'CENTRAL', pac_invoked: false }, correlationId);
      return { cfdi: await tx.documentoCfdi.findUniqueOrThrow({ where: { id: cfdi.id }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } }), idempotent: false };
    });
    return result;
  }

  async updateDraft(actor: FiscalActor, id: string, input: Record<string, unknown>, correlationId?: string) {
    const existing = await this.db.documentoCfdi.findFirst({ where: { id, organization_id: actor.organizationId }, include: { cuentaPorCobrar: true, cuentaPorPagar: true } });
    if (!existing) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
    if (FISCAL_STATES.has(existing.estado)) throw new FinanceFiscalError(409, 'CFDI_FISCAL_IMMUTABLE', 'Un CFDI fiscal vigente no puede editarse.');
    const subtotal = input.subtotal === undefined ? existing.subtotal : decimal(input.subtotal, 'Subtotal', true);
    const transferred = input.impuestos_trasladados === undefined ? existing.impuestos_trasladados : decimal(input.impuestos_trasladados, 'Impuestos trasladados', true);
    const retained = input.impuestos_retenidos === undefined ? existing.impuestos_retenidos : decimal(input.impuestos_retenidos, 'Impuestos retenidos', true);
    const total = input.total === undefined ? existing.total : decimal(input.total, 'Total');
    if (!subtotal.plus(transferred).minus(retained).equals(total)) throw new FinanceFiscalError(400, 'CFDI_TOTAL_MISMATCH', 'Subtotal, impuestos y total no cuadran.');
    return this.db.$transaction(async (tx) => {
      const row = await tx.documentoCfdi.update({ where: { id }, data: { subtotal, impuestos_trasladados: transferred, impuestos_retenidos: retained, total, saldo: total, ...(input.metodo_pago !== undefined ? { metodo_pago: upper(input.metodo_pago) || null } : {}), ...(input.forma_pago !== undefined ? { forma_pago: clean(input.forma_pago) || null } : {}), ...(input.uso_cfdi !== undefined ? { uso_cfdi: clean(input.uso_cfdi) || null } : {}) } });
      if (existing.cuentaPorCobrar) await tx.cuentaPorCobrarCfdi.update({ where: { id: existing.cuentaPorCobrar.id }, data: { monto_total: total, saldo: total.minus(existing.cuentaPorCobrar.monto_cobrado) } });
      if (existing.cuentaPorPagar) await tx.cuentaPorPagarCfdi.update({ where: { id: existing.cuentaPorPagar.id }, data: { monto_total: total, saldo: total.minus(existing.cuentaPorPagar.monto_pagado) } });
      await audit(tx, actor, 'UPDATE_CFDI_DRAFT', 'DocumentoCfdi', row.id, { total: total.toFixed(2), pac_invoked: false }, correlationId);
      return row;
    });
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
    const xmlStorage = `organizations/${actor.organizationId}/fiscal/xml/${parsed.uuid}.xml`;
    const pdfStorage = pdfFile ? `organizations/${actor.organizationId}/fiscal/pdf/${parsed.uuid}.pdf` : null;
    const uploaded: string[] = [];
    try {
      await uploadFile(xmlFile.buffer, xmlStorage, 'application/xml'); uploaded.push(xmlStorage);
      if (pdfFile && pdfStorage) { await uploadFile(pdfFile.buffer, pdfStorage, 'application/pdf'); uploaded.push(pdfStorage); }
      const cfdi = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-uuid:${actor.organizationId}:${parsed.uuid}`}))`);
        const duplicate = await tx.documentoCfdi.findFirst({ where: { organization_id: actor.organizationId, uuid_fiscal: parsed.uuid }, include: { proveedor: true, xmlDocumento: true, pdfDocumento: true } });
        if (duplicate) return duplicate;
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
        return tx.documentoCfdi.findUniqueOrThrow({ where: { id: created.id }, include: { proveedor: true, xmlDocumento: true, pdfDocumento: true, cuentaPorCobrar: true, cuentaPorPagar: true } });
      });
      return { cfdi, idempotent: false, supplierStatus: supplier ? 'REGISTERED' : 'UNREGISTERED', supplierPrefill: supplier ? null : { rfc: parsed.emisor.rfc, razon_social: parsed.emisor.nombre, regimenes_fiscales: parsed.emisor.regimen ? [{ clave: parsed.emisor.regimen, descripcion: '' }] : [] } };
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
