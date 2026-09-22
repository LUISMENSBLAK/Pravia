import { createHash, randomUUID } from 'node:crypto';
import { CatalogoDestinoFuncional, Prisma } from '@prisma/client';
import Docxtemplater from 'docxtemplater';
import JSZip from 'jszip';
import PizZip from 'pizzip';
import prisma from '../config/prisma';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { extractDocxText } from './docxText';
import { functionalDestinationService } from './functionalDestination.service';
import { projectRepository } from './projectRepository.service';

type Actor = NonNullable<Express.Request['user']>;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const checksum = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const text = (value: unknown) => value == null || String(value).trim() === '' ? null : String(value).trim();
const safe = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_.-]/g, '_');

export class ProjectGenerationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function pending(key: string) {
  return `[PENDIENTE: ${key.replace(/[_.]/g, ' ').toUpperCase()}]`;
}

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

type ProjectObservation = {
  kind: 'CONTRADICTION' | 'POSSIBLE_TEMPLATE_RESIDUE' | 'CONTEXT_CHRONOLOGY';
  field?: string;
  master_value?: string;
  document_value?: string;
  document_id?: string;
  value?: string;
  location?: string;
  detail?: string;
};

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = (xml: string) => xml
  .replace(/<w:tab\/?\s*>/g, '\t')
  .replace(/<w:(?:br|cr)\/?\s*>/g, '\n')
  .replace(/<\/w:p>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity.slice(1, -1)] || entity)
  .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export async function docxVisibleText(source: Buffer) {
  const zip = await JSZip.loadAsync(source);
  const names = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
  return (await Promise.all(names.map(async (name) => xmlText(await zip.files[name].async('string'))))).join('\n');
}

export type DeterministicProjectReviewObservation = {
  nivel_riesgo: 'ALTO' | 'MEDIO' | 'INFORMATIVO';
  dato_proyecto: string;
  dato_fuente: string;
  documento_fuente: string;
  ubicacion: string;
  tipo_discrepancia: 'CANTIDAD_FORMAL' | 'ESTILO_ESTRUCTURA';
  recomendacion: string;
};

type StaticParagraphSignature = {
  text: string;
  normalized: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  sourcePart: string;
};

const normalizedDocumentText = (value: string) => value
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('es-MX');

async function staticParagraphSignatures(source: Buffer) {
  const zip = await JSZip.loadAsync(source);
  const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
  const signatures: StaticParagraphSignature[] = [];
  for (const sourcePart of parts) {
    const xml = await zip.files[sourcePart].async('string');
    for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
      const body = match[1];
      if (body.includes('{{') || body.includes('}}')) continue;
      const visible = xmlText(body);
      if (visible.length < 6) continue;
      const runs = [...body.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)]
        .map((run) => run[1])
        .filter((run) => xmlText(run).trim().length > 0);
      signatures.push({
        text: visible,
        normalized: normalizedDocumentText(visible),
        bold: runs.some((run) => /<w:b(?:\s[^>]*)?\/?\s*>/.test(run) && !/<w:b[^>]*w:val="(?:false|0|off)"/.test(run)),
        italic: runs.some((run) => /<w:i(?:\s[^>]*)?\/?\s*>/.test(run) && !/<w:i[^>]*w:val="(?:false|0|off)"/.test(run)),
        underline: runs.some((run) => /<w:u(?:\s[^>]*)?\/?\s*>/.test(run) && !/<w:u[^>]*w:val="(?:none|false|0|off)"/.test(run)),
        sourcePart,
      });
    }
  }
  return signatures;
}

/**
 * Contractual checks that must not depend on model inference. The template is a
 * review baseline only; it is not added to the factual source-document count.
 */
export async function reviewProjectAgainstTemplate(
  project: Buffer,
  template: Buffer,
  canonicalAmount: unknown,
  templateName = 'Machote CFG-002',
): Promise<DeterministicProjectReviewObservation[]> {
  const observations: DeterministicProjectReviewObservation[] = [];
  const [projectText, templateStatic, projectStatic] = await Promise.all([
    docxVisibleText(project),
    staticParagraphSignatures(template),
    staticParagraphSignatures(project),
  ]);
  const normalizedProjectText = normalizedDocumentText(projectText);
  const formalAmount = formatNotarialAmount(canonicalAmount);
  if (formalAmount) {
    const accepted = [formalAmount.numberWords, formalAmount.wordsNumber].some((value) => normalizedProjectText.includes(normalizedDocumentText(value)));
    if (!accepted) observations.push({
      nivel_riesgo: 'MEDIO',
      dato_proyecto: `No contiene la expresión formal completa en guarismo y letra para $${formalAmount.numeric}.`,
      dato_fuente: `${formalAmount.numberWords} o ${formalAmount.wordsNumber}`,
      documento_fuente: 'Datos estructurados del expediente',
      ubicacion: 'Importe o valor de la operación',
      tipo_discrepancia: 'CANTIDAD_FORMAL',
      recomendacion: 'Restituir el importe canónico en guarismo y letra conforme al machote, sin cambiar el valor persistido.',
    });
  }

  const projectByText = new Map(projectStatic.map((signature) => [signature.normalized, signature]));
  const styleMismatch = templateStatic.find((expected) => {
    const actual = projectByText.get(expected.normalized);
    return !actual || actual.bold !== expected.bold || actual.italic !== expected.italic || actual.underline !== expected.underline;
  });
  if (styleMismatch) {
    const actual = projectStatic.find((item) => item.normalized.includes(styleMismatch.normalized) || styleMismatch.normalized.includes(item.normalized));
    observations.push({
      nivel_riesgo: 'MEDIO',
      dato_proyecto: actual?.text || `No se conservó el texto o formato: ${styleMismatch.text}`,
      dato_fuente: styleMismatch.text,
      documento_fuente: templateName,
      ubicacion: styleMismatch.sourcePart.replace('word/', ''),
      tipo_discrepancia: 'ESTILO_ESTRUCTURA',
      recomendacion: 'Restituir el texto, mayúsculas y formato del machote sin reconstruir la estructura DOCX.',
    });
  }
  return observations;
}

const units = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const teens = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const twenties = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const tens = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const hundreds = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function underThousand(value: number): string {
  if (value === 0) return '';
  if (value === 100) return 'CIEN';
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  const prefix = hundreds[hundred];
  if (!remainder) return prefix;
  if (remainder < 10) return `${prefix} ${units[remainder]}`.trim();
  if (remainder < 20) return `${prefix} ${teens[remainder - 10]}`.trim();
  if (remainder < 30) return `${prefix} ${twenties[remainder - 20]}`.trim();
  const ten = Math.floor(remainder / 10);
  const unit = remainder % 10;
  return `${prefix} ${tens[ten]}${unit ? ` Y ${units[unit]}` : ''}`.trim();
}

function integerToSpanish(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return '';
  if (value === 0) return 'CERO';
  const groups: Array<[number, string, string]> = [
    [1_000_000_000_000, 'UN BILLÓN', 'BILLONES'],
    [1_000_000_000, 'MIL MILLONES', 'MIL MILLONES'],
    [1_000_000, 'UN MILLÓN', 'MILLONES'],
    [1_000, 'MIL', 'MIL'],
  ];
  let remainder = value;
  const parts: string[] = [];
  for (const [size, singular, plural] of groups) {
    const count = Math.floor(remainder / size);
    if (!count) continue;
    if (count === 1) parts.push(singular);
    else parts.push(`${integerToSpanish(count)} ${plural}`);
    remainder %= size;
  }
  if (remainder) parts.push(underThousand(remainder));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function apocopeBeforeMasculineNoun(value: string) {
  return value
    .replace(/VEINTIUNO$/, 'VEINTIÚN')
    .replace(/ Y UNO$/, ' Y UN')
    .replace(/ UNO$/, ' UN');
}

export function formatNotarialAmount(value: unknown) {
  if (value == null || String(value).trim() === '') return null;
  const normalized = String(value).replace(/[$,\s]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) return null;
  const roundedCents = Math.round(amount * 100);
  const integer = Math.floor(roundedCents / 100);
  const cents = roundedCents % 100;
  const numeric = (roundedCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const words = `${apocopeBeforeMasculineNoun(integerToSpanish(integer))} ${integer === 1 ? 'PESO' : 'PESOS'} ${String(cents).padStart(2, '0')}/100 M.N.`;
  return {
    numeric,
    words,
    numberWords: `$${numeric} (${words})`,
    wordsNumber: `${words} ($${numeric})`,
  };
}

export function resolveAssignedProjectVersion(plannedVersion: number, currentDocumentCount: number) {
  return Math.max(plannedVersion, currentDocumentCount + 1);
}

export function isDefaultProjectSource(link: { tipo_vinculo?: string | null; source_context?: string | null; documento?: { tipo?: string | null } }) {
  if (['PROYECTO_ESCRITURA', 'REPORTE_IA_PROYECTO'].includes(String(link.documento?.tipo || ''))) return false;
  return link.tipo_vinculo === 'FUENTE_PROYECTO' || /(?:^|_)PROYECTO_(?:FUENTE|SOURCE)(?:_|$)/i.test(String(link.source_context || ''));
}

export async function projectTemplateFields(source: Buffer) {
  const zip = await JSZip.loadAsync(source);
  const fields = new Set<string>();
  for (const name of Object.keys(zip.files).filter((item) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(item))) {
    const xml = await zip.file(name)?.async('string');
    for (const match of xml?.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g) || []) fields.add(match[1].trim());
  }
  return [...fields];
}

async function exactSourceText(document: any) {
  const extracted = record(document.datos_extraidos);
  const project = record(extracted.proyecto);
  const literal = text(project.literal_text) || text(extracted.literal_text) || text(extracted.texto_literal);
  if (literal) return literal;
  const buffer = await downloadFile(document.storage_key);
  const mime = String(document.mime_type || '').toLowerCase();
  if (mime.includes('officedocument.wordprocessingml') || document.nombre_original.toLowerCase().endsWith('.docx')) return (await extractDocxText(buffer)).trim();
  if (mime.startsWith('text/')) return buffer.toString('utf8').trim();
  if (mime.includes('pdf') || document.nombre_original.toLowerCase().endsWith('.pdf')) {
    try {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      return String(result?.text || '').trim();
    } catch { return ''; }
  }
  return '';
}

export async function buildProjectDocumentContext(
  source: Buffer,
  selectedSources: Array<{ documento_id: string; documento: any }>,
  baseValues: Record<string, unknown>,
  transcriptionSources: unknown = {},
) {
  const fields = await projectTemplateFields(source);
  const values = { ...baseValues };
  const mappings = record(transcriptionSources);
  const observations: ProjectObservation[] = [];

  for (const link of selectedSources) {
    const extracted = record(link.documento.datos_extraidos);
    const project = record(extracted.proyecto);
    const ordinaryValues = record(project.template_values || extracted.project_template_values);
    for (const [key, value] of Object.entries(ordinaryValues)) {
      if (!fields.includes(key) || value == null || String(value).trim() === '') continue;
      const current = values[key];
      if (current == null || String(current).startsWith('[PENDIENTE:')) values[key] = value;
      else if (String(current).trim() !== String(value).trim()) observations.push({ field: key, master_value: String(current), document_value: String(value), document_id: link.documento_id, kind: 'CONTRADICTION' });
    }
    const literalValues = record(project.literal_transcriptions || extracted.literal_transcriptions);
    for (const [key, value] of Object.entries(literalValues)) {
      if (!fields.includes(key)) continue;
      const literalValue = typeof value === 'string' ? value : text(record(value).text);
      if (literalValue) values[key] = literalValue;
    }
  }

  const transcriptionFields = fields.filter((field) => /^(transcripcion|transcription)\./i.test(field));
  for (const field of transcriptionFields) {
    if (values[field] != null && !String(values[field]).startsWith('[PENDIENTE:')) continue;
    const mappedId = text(mappings[field]);
    const candidates = mappedId
      ? selectedSources.filter((link) => link.documento_id === mappedId)
      : selectedSources.length === 1 ? selectedSources : [];
    if (mappedId && !candidates.length) throw new ProjectGenerationError(403, 'PROJECT_TRANSCRIPTION_SOURCE_ACCESS_DENIED', `La fuente literal de ${field} no pertenece a la selección vigente.`);
    if (candidates.length !== 1) { values[field] = pending(`FUENTE LITERAL PARA ${field}`); continue; }
    const exact = await exactSourceText(candidates[0].documento);
    values[field] = exact || pending(`TRANSCRIPCIÓN ILEGIBLE DE ${candidates[0].documento.nombre_original}`);
  }

  const graphicFields = fields.filter((field) => /^(elemento_grafico|grafico|graphic)\./i.test(field));
  for (const field of graphicFields) {
    if (values[field] != null && !String(values[field]).startsWith('[PENDIENTE:')) continue;
    const mappedId = text(mappings[field]);
    const candidates = mappedId
      ? selectedSources.filter((link) => link.documento_id === mappedId)
      : selectedSources.length === 1 ? selectedSources : [];
    if (mappedId && !candidates.length) throw new ProjectGenerationError(403, 'PROJECT_GRAPHIC_SOURCE_ACCESS_DENIED', `La fuente gráfica de ${field} no pertenece a la selección vigente.`);
    if (candidates.length !== 1) { values[field] = pending(`FUENTE GRÁFICA PARA ${field}`); continue; }
    const extracted = record(candidates[0].documento.datos_extraidos);
    const project = record(extracted.proyecto);
    const descriptions = record(project.graphic_descriptions || extracted.graphic_descriptions);
    const direct = text(descriptions[field]);
    const graphicElements = Array.isArray(project.graphic_elements) ? project.graphic_elements.map(record) : [];
    const suffix = field.split('.').slice(1).join('.').toLowerCase();
    const matching = graphicElements.filter((item) => [item.id, item.key, item.type, item.tipo].some((candidate) => String(candidate || '').toLowerCase() === suffix));
    const candidate = matching.length === 1 ? matching[0] : graphicElements.length === 1 ? graphicElements[0] : null;
    const described = direct || text(candidate?.description) || text(candidate?.descripcion);
    if (described) values[field] = described;
    else if (candidate && (candidate.legible === false || candidate.readable === false)) {
      const kind = text(candidate.type) || text(candidate.tipo) || 'ELEMENTO GRÁFICO';
      values[field] = `${kind.toUpperCase()} ILEGIBLE`;
    } else values[field] = pending(`ELEMENTO GRÁFICO ILEGIBLE EN ${candidates[0].documento.nombre_original}`);
  }

  const chronologyItems = selectedSources.flatMap((link) => {
    const extracted = record(link.documento.datos_extraidos);
    const project = record(extracted.proyecto);
    const items = Array.isArray(project.antecedents) ? project.antecedents : Array.isArray(extracted.antecedents) ? extracted.antecedents : [];
    return items.map((item: unknown) => ({ ...record(item), document_id: link.documento_id }));
  });
  if (chronologyItems.length > 1) {
    const parsed = chronologyItems.map((item: Record<string, any>) => ({ ...item, parsedDate: Date.parse(String(item.date || item.fecha || '')) }));
    if (parsed.some((item) => !Number.isFinite(item.parsedDate))) observations.push({
      kind: 'CONTEXT_CHRONOLOGY',
      detail: 'Uno o más antecedentes no tienen fecha inequívoca; se conservaron sin inferir una secuencia.',
    });
    else if (parsed.some((item, index) => index > 0 && item.parsedDate < parsed[index - 1].parsedDate)) observations.push({
      kind: 'CONTEXT_CHRONOLOGY',
      detail: 'La secuencia documental de antecedentes no es cronológica; requiere validación humana antes de consolidar el proyecto.',
    });
  }
  return { values, fields, observations };
}

export function buildProjectTemplateData(expediente: any, confirmed: Record<string, unknown> = {}) {
  const parties = expediente.comparecientes.map((link: any) => ({
    nombre: link.compareciente.nombre_busqueda,
    caracter: link.caracter.nombre,
    tipo_persona: link.compareciente.tipo_persona,
    rfc: link.compareciente.personaFisica?.rfc || link.compareciente.personaMoral?.rfc || null,
    curp: link.compareciente.personaFisica?.curp || null,
  }));
  const properties = expediente.predios.map((link: any) => ({
    nombre: link.predio.apodo || link.predio.direccion_completa || link.predio.clave_catastral || 'Inmueble',
    clave_catastral: link.predio.clave_catastral,
    cuenta_predial: link.predio.cuenta_predial,
    folio_real: link.predio.folio_real,
    superficie: link.predio.superficie_terreno_m2 || link.predio.superficie_construccion_m2,
  }));
  const acts = expediente.actos.map((item: any) => item.tipo_acto.nombre);
  const firstSeller = parties.find((party: any) => /vende|enajena|transmite/i.test(party.caracter));
  const firstBuyer = parties.find((party: any) => /compra|adquiere/i.test(party.caracter));
  const firstProperty = properties[0];
  const formalAmount = formatNotarialAmount(expediente.valor_operacion?.toString());
  const base: Record<string, unknown> = {
    'expediente.folio': expediente.numero_pravia,
    'expediente.descripcion': expediente.descripcion,
    'expediente.cliente': expediente.cliente_alias,
    'expediente.acto': acts.join(', '),
    'expediente.responsable': expediente.abogado ? `${expediente.abogado.nombre} ${expediente.abogado.apellido}` : null,
    'notaria.nombre': expediente.notaria?.nombre,
    'operacion.precio': expediente.valor_operacion?.toString(),
    'operacion.precio_numero': formalAmount?.numeric,
    'operacion.precio_letra': formalAmount?.words,
    'operacion.precio_formal_numero_letra': formalAmount?.numberWords,
    'operacion.precio_formal_letra_numero': formalAmount?.wordsNumber,
    'vendedor.nombre': firstSeller?.nombre,
    'comprador.nombre': firstBuyer?.nombre,
    'inmueble.clave_catastral': firstProperty?.clave_catastral,
    'inmueble.cuenta_predial': firstProperty?.cuenta_predial,
    'inmueble.folio_real': firstProperty?.folio_real,
    'inmueble.superficie': firstProperty?.superficie?.toString(),
    comparecientes: parties.length
      ? parties.map((party: any) => `${party.nombre} — ${party.caracter}${party.rfc ? ` · RFC ${party.rfc}` : ''}`).join('; ')
      : null,
    predios: properties.length
      ? properties.map((property: any) => [property.nombre, property.clave_catastral ? `clave catastral ${property.clave_catastral}` : null, property.folio_real ? `folio real ${property.folio_real}` : null].filter(Boolean).join(' · ')).join('; ')
      : null,
    actos: acts.join(', '),
  };
  for (const [key, value] of Object.entries(confirmed)) base[key] = value;
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value ?? pending(key)]));
}

function highlightPendingRuns(xml: string) {
  return xml.replace(/<w:r(\s[^>]*)?>([\s\S]*?)<\/w:r>/g, (run, attrs = '', body) => {
    if (!body.includes('[PENDIENTE:')) return run;
    if (/<w:rPr[\s>]/.test(body)) return `<w:r${attrs}>${body.replace(/<w:rPr([^>]*)>/, '<w:rPr$1><w:highlight w:val="yellow"/>')}</w:r>`;
    return `<w:r${attrs}><w:rPr><w:highlight w:val="yellow"/></w:rPr>${body}</w:r>`;
  });
}

function countPattern(value: string, pattern: RegExp) {
  return (value.match(pattern) || []).length;
}

async function assertDocxStructuralFidelity(original: JSZip, result: JSZip) {
  const originalDocument = await original.file('word/document.xml')?.async('string') || '';
  const resultDocument = await result.file('word/document.xml')?.async('string') || '';
  const checks = [
    ['sections', /<w:sectPr[\s>]/g],
    ['tables', /<w:tbl[\s>]/g],
    ['paragraphs', /<w:p[\s>]/g],
    ['page breaks', /w:type="page"/g],
  ] as const;
  for (const [label, pattern] of checks) {
    if (countPattern(originalDocument, pattern) !== countPattern(resultDocument, pattern)) {
      throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_STRUCTURE_CHANGED', `El documento resultante alteró ${label} del machote.`);
    }
  }
  const immutableParts = Object.keys(original.files).filter((name) => /^(word\/(styles|numbering|settings|fontTable|theme\/[^/]+)\.xml|word\/_rels\/document\.xml\.rels)$/.test(name));
  for (const name of immutableParts) {
    const before = await original.files[name].async('nodebuffer');
    const after = await result.files[name]?.async('nodebuffer');
    if (!after || checksum(before) !== checksum(after)) {
      throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_STYLE_CHANGED', `El documento resultante alteró el componente estructural ${name}.`);
    }
  }
  return { sections: countPattern(resultDocument, /<w:sectPr[\s>]/g), tables: countPattern(resultDocument, /<w:tbl[\s>]/g), immutable_parts: immutableParts.length };
}

function uniqueValues(values: unknown[]) {
  return [...new Set(values.map((value) => text(value)).filter((value): value is string => Boolean(value)))];
}

export async function detectProjectTemplateResidues(
  source: Buffer,
  rendered: Buffer,
  supportedValues: Record<string, unknown>,
  declaredResiduals: unknown = [],
): Promise<ProjectObservation[]> {
  const [templateText, projectText] = await Promise.all([docxVisibleText(source), docxVisibleText(rendered)]);
  const supported = uniqueValues(Object.values(supportedValues)).map((value) => value.toLocaleLowerCase('es-MX'));
  const configured = Array.isArray(declaredResiduals)
    ? declaredResiduals.flatMap((item) => typeof item === 'string' ? [item] : [text(record(item).value)]).filter((item): item is string => Boolean(item))
    : [];
  const candidates = new Set(configured);
  const patterns = [
    /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g,
    /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g,
    /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g,
    /\b(?:FOLIO(?:\s+REAL)?|ESCRITURA|INSTRUMENTO|CLIENTE|DOMICILIO|PRECIO|VALOR|FECHA)\s*(?:N[ÚU]M(?:ERO)?\.?|NO\.?|#)?\s*[:.-]\s*([^\n]{3,140})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of templateText.matchAll(pattern)) {
      const candidate = (match[1] || match[0]).trim().replace(/[;,.]+$/, '').trim();
      if (!candidate.includes('{{') && !candidate.includes('[PENDIENTE:')) candidates.add(candidate);
    }
  }
  return [...candidates].filter((candidate) => {
    const normalized = candidate.toLocaleLowerCase('es-MX');
    return projectText.includes(candidate) && !supported.some((value) => value.includes(normalized) || normalized.includes(value));
  }).map((value) => ({
    kind: 'POSSIBLE_TEMPLATE_RESIDUE',
    value,
    location: 'Machote original y proyecto generado',
    detail: 'El valor sobrevivió desde el machote y no tiene una fuente actual entre los datos integrados; requiere revisión humana.',
  }));
}

export async function renderProjectTemplate(source: Buffer, values: Record<string, unknown>) {
  const original = await JSZip.loadAsync(source);
  const originalEntries = Object.keys(original.files).sort();
  const originalMedia = Object.fromEntries(await Promise.all(originalEntries.filter((name) => name.startsWith('word/media/') && !original.files[name].dir).map(async (name) => [name, checksum(await original.files[name].async('nodebuffer'))])));
  let document: Docxtemplater;
  try {
    document = new Docxtemplater(new PizZip(source), { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' }, nullGetter: (part) => pending(String(part.value || 'DATO')) });
    document.render(values);
  } catch (error: any) {
    throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_RENDER_FAILED', error?.message || 'No fue posible combinar el machote.');
  }
  let output = document.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  const highlighted = await JSZip.loadAsync(output);
  for (const name of Object.keys(highlighted.files).filter((item) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(item))) {
    const xml = await highlighted.file(name)?.async('string');
    if (xml) highlighted.file(name, highlightPendingRuns(xml));
  }
  output = await highlighted.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const result = await JSZip.loadAsync(output);
  const resultEntries = Object.keys(result.files).sort();
  if (JSON.stringify(originalEntries) !== JSON.stringify(resultEntries)) throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_STRUCTURE_CHANGED', 'El documento resultante no conservó todos los componentes del machote.');
  for (const [name, digest] of Object.entries(originalMedia)) if (checksum(await result.files[name].async('nodebuffer')) !== digest) throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_MEDIA_CHANGED', 'El documento resultante alteró imágenes del machote.');
  const resultXml = await Promise.all(resultEntries.filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)).map((name) => result.files[name].async('string')));
  const residual = resultXml.flatMap((xml) => [...xml.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]));
  if (residual.length) throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_RESIDUAL_FIELDS', `Quedaron campos técnicos sin resolver: ${[...new Set(residual)].join(', ')}.`);
  const fidelity = await assertDocxStructuralFidelity(original, result);
  return { buffer: output, pendingCount: resultXml.reduce((total, xml) => total + (xml.match(/PENDIENTE:/g) || []).length, 0), fidelity };
}

export class ProjectGenerationService {
  async generateFromManualTemplate(actor: Actor, expedienteId: string, input: any, file: Express.Multer.File) {
    if (!file?.buffer?.length || file.mimetype !== DOCX || !file.originalname.toLowerCase().endsWith('.docx'))
      throw new ProjectGenerationError(400, 'PROJECT_TEMPLATE_DOCX_REQUIRED', 'Carga un machote DOCX válido.');
    return this.generate(actor, expedienteId, { ...input, __manual_template: { buffer: file.buffer, name: file.originalname } });
  }

  async workspace(actor: Actor, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId }, select: { id: true, actos: { where: { estatus: 'ACTIVO', removed_at: null }, select: { tipo_acto_id: true, tipo_acto: { select: { nombre: true } } } } } });
    if (!expediente) throw new ProjectGenerationError(404, 'PROJECT_CASE_NOT_FOUND', 'No se encontró el expediente.');
    const actIds = expediente.actos.map((item) => item.tipo_acto_id);
    const templates = await prisma.catalogoArtefactoDestino.findMany({
      where: { organization_id: actor.organizationId, destino: 'PROYECTO_MACHOTE', activo: true, artefacto: { activo: true, tipo: 'PLANTILLA', OR: [{ actos: { none: {} } }, { actos: { some: { tipo_acto_id: { in: actIds } } } }] } },
      include: { artefacto: { include: { actos: true, versiones: { where: { activa: true, storage_key: { not: null } }, orderBy: { version: 'desc' } } } } },
      orderBy: [{ predeterminado: 'desc' }, { created_at: 'asc' }],
    });
    const documents = await prisma.expedienteDocumento.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' }, select: { id: true, tipo_vinculo: true, source_context: true, documento: { select: { id: true, nombre_original: true, mime_type: true, checksum_sha256: true, tipo: true, categoria: true } } }, orderBy: { fecha_vinculo: 'asc' } });
    return {
      modes: ['GENERAR_PROYECTO', 'REVISAR_PROYECTO'],
      templates: templates.map((link) => ({ id: link.artefacto.id, name: link.artefacto.nombre, default: link.predeterminado, applicable_act_ids: link.artefacto.actos.map((act) => act.tipo_acto_id), versions: link.artefacto.versiones.map((version) => ({ id: version.id, version: version.version, name: version.nombre_original, checksum: version.checksum_sha256 })) })),
      sources: { structured: ['comparecientes', 'predios', 'expediente', 'actos'], documents: documents.map((link) => ({ ...link, selected_by_default: isDefaultProjectSource(link) })) },
    };
  }

  async generate(actor: Actor, expedienteId: string, input: any) {
    const expediente = await prisma.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null },
      include: {
        abogado: { select: { nombre: true, apellido: true } }, notaria: true,
        actos: { where: { estatus: 'ACTIVO', removed_at: null }, include: { tipo_acto: true }, orderBy: { created_at: 'asc' } },
        comparecientes: { where: { estatus: 'ACTIVO' }, include: { caracter: true, compareciente: { include: { personaFisica: true, personaMoral: true } } }, orderBy: { orden_comparecencia: 'asc' } },
        predios: { where: { estatus: 'ACTIVO' }, include: { predio: true }, orderBy: { created_at: 'asc' } },
        expedienteDocumentos: { where: { estatus: 'ACTIVO' }, include: { documento: true }, orderBy: { fecha_vinculo: 'asc' } },
      },
    });
    if (!expediente) throw new ProjectGenerationError(404, 'PROJECT_CASE_NOT_FOUND', 'No se encontró el expediente.');
    const instructions = text(input?.instructions);
    if (instructions && instructions.length > 4_000) throw new ProjectGenerationError(400, 'PROJECT_INSTRUCTIONS_TOO_LONG', 'Las instrucciones no pueden exceder 4,000 caracteres.');
    const requestedSourceIds = input?.source_document_ids;
    if (requestedSourceIds !== undefined && (!Array.isArray(requestedSourceIds) || requestedSourceIds.some((id: unknown) => typeof id !== 'string'))) {
      throw new ProjectGenerationError(400, 'PROJECT_SOURCES_INVALID', 'La selección de fuentes documentales no es válida.');
    }
    const availableSourceIds = new Set(expediente.expedienteDocumentos.map((link) => link.documento_id));
    const selectedSourceIds = requestedSourceIds === undefined
      ? expediente.expedienteDocumentos.filter(isDefaultProjectSource).map((link) => link.documento_id)
      : [...new Set<string>(requestedSourceIds.map((id: string) => id.trim()).filter(Boolean))];
    if (selectedSourceIds.some((id) => !availableSourceIds.has(id))) {
      throw new ProjectGenerationError(403, 'PROJECT_SOURCE_ACCESS_DENIED', 'Una fuente seleccionada no pertenece a los documentos vigentes del expediente.');
    }
    const selectedSources = expediente.expedienteDocumentos.filter((link) => selectedSourceIds.includes(link.documento_id));
    const manualTemplate = input?.__manual_template as { buffer: Buffer; name: string } | undefined;
    const requestedVersionId = manualTemplate ? null : text(input?.template_version_id);
    const actId = expediente.actos[0]?.tipo_acto_id || expediente.tipo_acto_id;
    const resolved = requestedVersionId
      ? await prisma.catalogoArtefactoVersion.findFirst({ where: { id: requestedVersionId, organization_id: actor.organizationId, activa: true, artefacto: { activo: true, destinosFuncionales: { some: { destino: 'PROYECTO_MACHOTE', activo: true } }, OR: [{ actos: { none: {} } }, ...(actId ? [{ actos: { some: { tipo_acto_id: actId } } }] : [])] } }, include: { artefacto: true } })
      : null;
    let artifact: any; let version: any;
    if (manualTemplate) {
      artifact = { id: null, nombre: manualTemplate.name };
      version = { id: null, version: 1, storage_key: null, mime_type: DOCX, size_bytes: manualTemplate.buffer.length, checksum_sha256: checksum(manualTemplate.buffer), definition_json: null };
    } else if (resolved) { artifact = resolved.artefacto; version = resolved; }
    else {
      try { const selected = await functionalDestinationService.resolve(actor, CatalogoDestinoFuncional.PROYECTO_MACHOTE, { tipoActoId: actId }); artifact = selected.artifact; version = selected.version; }
      catch (error: any) { throw new ProjectGenerationError(error?.status || 409, error?.code || 'PROJECT_TEMPLATE_NOT_CONFIGURED', error?.message || 'Configura un machote aplicable.'); }
    }
    if ((!manualTemplate && !version.storage_key) || version.mime_type !== DOCX) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_DOCX_REQUIRED', 'El machote seleccionado debe ser un DOCX activo.');
    const source = manualTemplate?.buffer || await downloadFile(version.storage_key);
    if (version.size_bytes != null && source.length !== version.size_bytes) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_SIZE_MISMATCH', 'El machote no coincide con el tamaño registrado.');
    if (version.checksum_sha256 && checksum(source) !== version.checksum_sha256) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_CHECKSUM_MISMATCH', 'No se pudo verificar la integridad del machote.');
    const baseValues = buildProjectTemplateData(expediente, input?.confirmed_values && typeof input.confirmed_values === 'object' ? input.confirmed_values : {});
    const documentContext = await buildProjectDocumentContext(source, selectedSources, baseValues, input?.transcription_sources);
    const rendered = await renderProjectTemplate(source, documentContext.values);
    const templateDefinition = record(version.definition_json);
    const templateProjectDefinition = record(templateDefinition.project);
    const residueObservations = await detectProjectTemplateResidues(
      source,
      rendered.buffer,
      documentContext.values,
      templateProjectDefinition.residual_values || templateDefinition.residual_values || [],
    );
    const generationObservations = [...documentContext.observations, ...residueObservations];
    const prior = await projectRepository.listVersions(expedienteId);
    const versionNumber = prior.reduce((max, item) => Math.max(max, item.version_numero), 0) + 1;
    const storageKey = `organizations/${actor.organizationId}/documentos/expedientes/${expedienteId}/proyectos/${randomUUID()}_Proyecto_${safe(expediente.numero_pravia)}.docx`;
    const manualStorageKey = manualTemplate ? `organizations/${actor.organizationId}/documentos/expedientes/${expedienteId}/proyectos/machotes/${randomUUID()}_${safe(manualTemplate.name)}` : null;
    if (manualStorageKey) await uploadFile(source, manualStorageKey, DOCX);
    await uploadFile(rendered.buffer, storageKey, DOCX);
    try {
      const document = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:proyecto-version:${expedienteId}`}))`);
        const concurrent = await tx.documento.count({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo: 'PROYECTO_ESCRITURA' } });
        const assignedVersion = resolveAssignedProjectVersion(versionNumber, concurrent);
        const assignedFileName = `Proyecto_${safe(expediente.numero_pravia)}_V${assignedVersion}.docx`;
        await tx.expedienteDocumento.updateMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' }, data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: `Sustituido por V${assignedVersion}` } });
        const manualSource = manualTemplate && manualStorageKey ? await tx.documento.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, nombre_original: manualTemplate.name, nombre_interno: manualStorageKey, storage_key: manualStorageKey,
          tipo: 'MACHOTE_PROYECTO_EXCEPCIONAL', categoria: 'PROYECTO', mime_type: DOCX, size_bytes: source.length, checksum_sha256: checksum(source),
          subido_por_id: actor.id, estatus: 'VIGENTE', observaciones: 'Machote de uso exclusivo para esta proyección; no pertenece a CFG-002.',
          datos_extraidos: json({ proyecto: { exclusive_template: true, promoted_to_cfg002: false } }),
        } }) : null;
        if (manualSource) await tx.expedienteDocumento.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: manualSource.id, tipo_vinculo: 'MACHOTE_PROYECTO_EXCEPCIONAL', creado_por_id: actor.id,
          estatus: 'ACTIVO', origen: 'EXPEDIENTE', source_entity_type: 'Documento', source_entity_id: manualSource.id, source_context: 'MACHOTE_EXCEPCIONAL',
          source_key: `EXPEDIENTE:Documento:${manualSource.id}:MACHOTE_EXCEPCIONAL`, document_version: checksum(source),
          provenance: json({ exclusive_to_expediente: true, cfg002_artifact_created: false }),
        } });
        const sourceEntityId = manualSource?.id || version.id;
        const created = await tx.documento.create({ data: {
          organization_id: actor.organizationId, expediente_id: expedienteId, nombre_original: assignedFileName, nombre_interno: storageKey, storage_key: storageKey,
          tipo: 'PROYECTO_ESCRITURA', categoria: 'PROYECTO', mime_type: DOCX, size_bytes: rendered.buffer.length, checksum_sha256: checksum(rendered.buffer),
          subido_por_id: actor.id, estatus: 'VIGENTE', observaciones: `V${assignedVersion} · borrador para revisión notarial`,
          datos_extraidos: json({ proyecto: { version_numero: assignedVersion, es_version_final: false, nota_version: `V${assignedVersion} · borrador para revisión notarial`, template_artifact_id: artifact.id, template_version_id: sourceEntityId, template_version: version.version, template_checksum: version.checksum_sha256, source_document_ids: selectedSources.map((link) => link.documento_id), source_selection_explicit: requestedSourceIds !== undefined, instructions, pending_count: rendered.pendingCount, contradiction_observations: documentContext.observations.filter((item) => item.kind === 'CONTRADICTION'), generation_observations: generationObservations, residual_observations: residueObservations, docx_structural_fidelity: { status: 'PASS', ...rendered.fidelity }, generation_mode: manualSource ? 'MACHOTE_EXCEPCIONAL' : 'MACHOTE_CFG002' } }),
        } });
        await tx.expedienteDocumento.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: created.id, tipo_vinculo: 'PROYECTO_ESCRITURA', creado_por_id: actor.id, estatus: 'ACTIVO', origen: 'EXPEDIENTE', source_entity_type: manualSource ? 'Documento' : 'CatalogoArtefactoVersion', source_entity_id: sourceEntityId, source_context: 'PROYECTO_ESCRITURA', source_key: `EXPEDIENTE:${manualSource ? 'Documento' : 'CatalogoArtefactoVersion'}:${sourceEntityId}:${created.id}:PROYECTO_ESCRITURA`, document_version: checksum(rendered.buffer), provenance: json({ template_artifact_id: artifact.id, template_version_id: sourceEntityId, template_checksum: version.checksum_sha256, exclusive_template: Boolean(manualSource), source_selection_explicit: requestedSourceIds !== undefined, source_documents: selectedSources.map((link) => ({ id: link.documento_id, checksum: link.documento.checksum_sha256 })) }), document_role: 'PROJECT_DRAFT' } });
        await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo: 'AUDITORIA', titulo: `Proyecto generado (V${assignedVersion})`, descripcion: `Machote ${manualSource ? 'exclusivo' : 'CFG-002'} ${artifact.nombre}, versión ${version.version}; ${selectedSources.length} fuente(s) documental(es); ${rendered.pendingCount} pendiente(s) y ${generationObservations.length} observación(es) para revisión.`, usuario_id: actor.id } });
        return created;
      }, { timeout: 20_000 });
      const persisted = await projectRepository.getVersion(expedienteId, document.id);
      return { version: persisted?.record, pending_count: rendered.pendingCount, contradiction_count: documentContext.observations.filter((item) => item.kind === 'CONTRADICTION').length, generation_observation_count: generationObservations.length, residual_observation_count: residueObservations.length, docx_structural_fidelity: 'PASS', template: { artifact_id: artifact.id, version_id: version.id, version: version.version, exclusive: Boolean(manualTemplate) }, review_required: true };
    } catch (error) { await Promise.all([deleteFile(storageKey).catch(() => undefined), manualStorageKey ? deleteFile(manualStorageKey).catch(() => undefined) : Promise.resolve()]); throw error; }
  }
}

export const projectGenerationService = new ProjectGenerationService();
