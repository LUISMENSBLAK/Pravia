import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ISRValidationError, type ISRCalculationInput } from './isrTaxEngine';
import type { ISRV3Input } from './isrV3Engine';

type Input = ISRCalculationInput | ISRV3Input;
type Target = { partyId?: string };
const aliases: Record<string, string> = {
  precio_enajenacion: 'operation', valor_operacion: 'operation', salePrice: 'operation', 'values.operation': 'operation',
  valor_avaluo: 'appraisal', avaluo: 'appraisal', 'property.appraisalValue': 'appraisal', 'values.appraisal': 'appraisal',
  valor_catastral: 'cadastral', 'property.cadastralValue': 'cadastral', 'values.cadastral': 'cadastral',
  'values.landSale': 'landSale', 'values.constructionSale': 'constructionSale',
  'property.type': 'propertyType', party: 'party',
  fecha_enajenacion: 'date', saleDate: 'date', operationDate: 'date',
  rfc: 'rfc', 'taxpayer.rfc': 'rfc', curp: 'curp', 'taxpayer.curp': 'curp',
  nombre_completo: 'name', razon_social: 'name', 'taxpayer.fullName': 'name',
};

export const describeISRProposal = (field: string) => ({ can_apply: Object.prototype.hasOwnProperty.call(aliases, field), requires_party: ['name', 'rfc', 'curp', 'party'].includes(aliases[field]) });

/** The shared extractor emits given name and surnames separately. Compose only
 * unambiguous components from the SAME physical source; never merge two people
 * or claim that a given name alone is an extracted full name. */
export function normalizeISRExtractionFields<T extends { campo: string; valor: string; documento_id?: string; confianza?: string; fragmento?: string }>(fields: T[]): T[] {
  const output = [...fields];
  for (const documentId of new Set(fields.map((field) => field.documento_id).filter(Boolean))) {
    const fromSource = fields.filter((field) => field.documento_id === documentId);
    if (fromSource.some((field) => field.campo === 'nombre_completo')) continue;
    const component = (key: string) => {
      const candidates = fromSource.filter((field) => field.campo === key);
      return new Set(candidates.map((field) => field.valor.trim())).size === 1 ? candidates[0] : undefined;
    };
    const given = component('nombre'), paternal = component('apellido_paterno'), maternal = component('apellido_materno');
    if (['nombre', 'apellido_paterno', 'apellido_materno'].some((key) => fromSource.some((field) => field.campo === key) && !component(key))) continue;
    if (!given || (!paternal && !maternal)) continue;
    const sourceComponents = [given, paternal, maternal].filter((field): field is T => Boolean(field));
    const full = sourceComponents.map((field) => field.valor.trim()).join(' ');
    for (const field of sourceComponents) { const index = output.indexOf(field); if (index >= 0) output.splice(index, 1); }
    const confidence = sourceComponents.some((field) => field.confianza === 'NO_LEGIBLE') ? 'NO_LEGIBLE'
      : sourceComponents.some((field) => field.confianza === 'LECTURA_DUDOSA') ? 'LECTURA_DUDOSA' : given.confianza;
    output.push({ ...given, campo: 'nombre_completo', valor: full, confianza: confidence, fragmento: sourceComponents.map((field) => field.fragmento || `${field.campo}: ${field.valor}`).join(' · ') });
  }
  return output;
}

/** Closed mapping: model output never becomes an arbitrary JSON/property path.
 * A proposal changes a draft only after explicit human confirmation, never tax
 * rules, verified flags, master records or immutable calculated versions. */
export function applyISRProposal(current: Input, field: string, proposed: unknown, target: Target = {}) {
  const kind = Object.prototype.hasOwnProperty.call(aliases, field) ? aliases[field] : undefined;
  if (!kind) throw new ISRValidationError('ISR_PROPOSAL_MANUAL_FIELD', 'Este dato requiere revisión y captura manual en su campo fiscal; no se aplicó automáticamente.', field, 409);
  if (typeof proposed !== 'string' && typeof proposed !== 'number') throw new ISRValidationError('ISR_PROPOSAL_VALUE_INVALID', 'El dato propuesto no es un valor simple.', field);
  let value = String(proposed).trim();
  if (!value || value.length > (kind === 'party' ? 2000 : 500)) throw new ISRValidationError('ISR_PROPOSAL_VALUE_INVALID', 'Revisa el dato propuesto antes de utilizarlo.', field);
  if (['operation', 'appraisal', 'cadastral', 'landSale', 'constructionSale'].includes(kind)) {
    // No locale guessing (1,234 versus 1.234) or monetary-symbol stripping.
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new ISRValidationError('ISR_PROPOSAL_AMOUNT_AMBIGUOUS', 'El importe debe confirmarse como número decimal, sin separadores de miles ni símbolos.', field);
    const amount = new Prisma.Decimal(value);
    if (amount.gt('9999999999999999.99')) throw new ISRValidationError('ISR_PROPOSAL_VALUE_INVALID', 'El importe excede la capacidad del cálculo.', field);
    value = amount.toFixed(2);
  }
  if (kind === 'date') {
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ISRValidationError('ISR_PROPOSAL_DATE_AMBIGUOUS', 'Confirma una fecha válida en formato AAAA-MM-DD.', field);
    if (date.getUTCFullYear() !== current.taxYear) throw new ISRValidationError('ISR_PROPOSAL_YEAR_MISMATCH', 'La fecha no pertenece al ejercicio de este cálculo.', field);
  }
  if (kind === 'rfc' || kind === 'curp') {
    value = value.toUpperCase();
    const pattern = kind === 'rfc' ? /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/ : /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
    if (!pattern.test(value)) throw new ISRValidationError('ISR_PROPOSAL_IDENTITY_INVALID', 'Revisa el formato del identificador propuesto.', field);
  }
  const input = structuredClone(current);
  const v3 = 'schemaVersion' in input && input.schemaVersion === 3;
  let path: string;
  let previous: unknown;
  if (v3) {
    const draft = input as ISRV3Input;
    if (kind === 'party') {
      let fact: Record<string, unknown>;
      try { fact = JSON.parse(value); } catch { throw new ISRValidationError('ISR_PARTY_PROPOSAL_INVALID', 'La parte propuesta no tiene un formato válido.'); }
      if (!fact || Array.isArray(fact) || typeof fact !== 'object' || Object.keys(fact).some((key) => !['name', 'role', 'percentage', 'acquisitionDate', 'historicalLandCost', 'historicalConstructionCost'].includes(key)) || typeof fact.name !== 'string' || !fact.name.trim() || fact.name.length > 300 || !['ENAJENANTE', 'ADQUIRENTE'].includes(String(fact.role))) throw new ISRValidationError('ISR_PARTY_PROPOSAL_INVALID', 'La parte propuesta contiene campos inválidos o no permitidos.');
      // A terminal percent sign is an explicit unit, not an ambiguous locale
      // separator. Preserve the original proposal/audit and normalize only the
      // percentage consumed by the deterministic engine.
      if (typeof fact.percentage === 'string' && /^\d+(?:\.\d{1,2})?%$/.test(fact.percentage)) fact.percentage = fact.percentage.slice(0, -1);
      for (const key of ['percentage', 'historicalLandCost', 'historicalConstructionCost']) if (fact[key] !== null && fact[key] !== undefined && (typeof fact[key] !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(fact[key] as string))) throw new ISRValidationError('ISR_PARTY_PROPOSAL_INVALID', 'Confirma porcentajes e importes de la parte sin separadores ambiguos.');
      if (fact.percentage && new Prisma.Decimal(fact.percentage as string).gt(100)) throw new ISRValidationError('ISR_PARTY_PROPOSAL_INVALID', 'El porcentaje no puede exceder 100.');
      const acquisition = fact.acquisitionDate;
      if (acquisition) {
        const date = typeof acquisition === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(acquisition) ? new Date(`${acquisition}T00:00:00Z`) : null;
        if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== acquisition || (draft.operationDate && acquisition > draft.operationDate)) throw new ISRValidationError('ISR_PARTY_PROPOSAL_INVALID', 'La fecha de adquisición propuesta no es válida.');
      }
      let party = target.partyId && target.partyId !== 'NEW_PARTY' ? draft.parties.find((item) => item.id === target.partyId) : undefined;
      if (target.partyId !== 'NEW_PARTY' && !party) throw new ISRValidationError('ISR_PROPOSAL_TARGET_REQUIRED', 'Selecciona la persona existente o confirma crear una parte nueva en este cálculo.', field, 409);
      if (party && (party.role !== fact.role || (party.acquisitionLayers?.length && (fact.acquisitionDate || fact.historicalLandCost || fact.historicalConstructionCost)))) throw new ISRValidationError('ISR_PARTY_PROPOSAL_CONFLICT', 'La parte tiene otro carácter o adquisiciones previas. Revisa y concilia manualmente; no se sobrescribieron.');
      path = `parties[${party?.id || 'NEW_PARTY'}]`; previous = party ? structuredClone(party) : null;
      if (!party) {
        party = { id: randomUUID(), name: fact.name.trim(), role: fact.role as 'ENAJENANTE' | 'ADQUIRENTE', subjectType: 'OTRO', nationalityCode: '', fiscalResidence: 'POR_DETERMINAR', percentage: String(fact.percentage || '') };
        draft.parties.push(party);
      } else { party.name = fact.name.trim(); if (fact.percentage !== null && fact.percentage !== undefined) party.percentage = String(fact.percentage); }
      if (party.role === 'ENAJENANTE' && (fact.acquisitionDate || fact.historicalLandCost || fact.historicalConstructionCost)) party.acquisitionLayers = [{ id: randomUUID(), percentage: party.percentage, acquisitionAct: 'OTRO', legalDate: String(fact.acquisitionDate || ''), fiscalDate: String(fact.acquisitionDate || ''), adjustedLandCost: '', adjustedConstructionCost: '', source: 'Descripción de operación confirmada por el usuario; revisar antecedente documental', verified: false,
        historical: { method: 'AUTO', separation: 'EXPLICIT', land: typeof fact.historicalLandCost === 'string' ? fact.historicalLandCost : '', construction: typeof fact.historicalConstructionCost === 'string' ? fact.historicalConstructionCost : '' } }];
    } else if (kind === 'propertyType') {
      if (!['TERRENO', 'CASA_HABITACION', 'TERRENO_CONSTRUCCION', 'CONSTRUCCION_COMERCIAL', 'USO_MIXTO', 'OTRO'].includes(value)) throw new ISRValidationError('ISR_PROPOSAL_VALUE_INVALID', 'El tipo de inmueble propuesto no es válido.');
      path = 'property.type'; previous = draft.property.type; draft.property.type = value as ISRV3Input['property']['type'];
    } else if (['name', 'rfc', 'curp'].includes(kind)) {
      // Even with just one seller, there can be a buyer: do not attribute the
      // document's identity to the first person by array order or model guess.
      const party = target.partyId ? draft.parties.find((item) => item.id === target.partyId) : undefined;
      if (!party) throw new ISRValidationError('ISR_PROPOSAL_TARGET_REQUIRED', 'Selecciona expresamente la persona del cálculo a la que corresponde el dato.', field, 409);
      const key = kind as 'name' | 'rfc' | 'curp';
      path = `parties[${party.id}].${key}`; previous = party[key]; party[key] = value;
    } else if (kind === 'date') {
      path = 'operationDate'; previous = draft.operationDate; draft.operationDate = value;
    } else {
      const key = kind as 'operation' | 'appraisal' | 'cadastral' | 'landSale' | 'constructionSale';
      path = `values.${key}`; previous = draft.values[key]; draft.values[key] = value;
      // Allocation terrain/construction must be confirmed separately. Do not
      // overwrite a different component merely to make the totals reconcile.
    }
  } else {
    const draft = input as ISRCalculationInput;
    if (['propertyType', 'party', 'landSale', 'constructionSale'].includes(kind)) throw new ISRValidationError('ISR_PROPOSAL_V3_REQUIRED', 'Guarda y revisa este cálculo en el editor v3 antes de aplicar este tipo de propuesta.', field, 409);
    if (['name', 'rfc', 'curp'].includes(kind)) {
      const key = kind === 'name' ? 'fullName' : kind as 'rfc' | 'curp';
      path = `taxpayer.${key}`; previous = draft.taxpayer[key]; draft.taxpayer[key] = value;
    } else if (kind === 'date') {
      path = 'saleDate'; previous = draft.saleDate; draft.saleDate = value;
      if (draft.operation) draft.operation.operationDate = value;
    } else if (kind === 'operation') {
      path = 'salePrice'; previous = draft.salePrice; draft.salePrice = value;
    } else {
      const key = kind === 'appraisal' ? 'appraisalValue' : 'cadastralValue';
      path = `property.${key}`; previous = draft.property[key]; draft.property[key] = value;
    }
  }
  return { input, path, previous: previous ?? null, value };
}
