import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import Docxtemplater from 'docxtemplater';
import JSZip from 'jszip';
import PizZip from 'pizzip';
import prisma from '../config/prisma';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { extractDocxText } from './docxText';
import { projectTemplateAssignmentService } from './projectTemplateAssignment.service';
import { projectRepository } from './projectRepository.service';
import { planLiteralProjectPatchesWithOpenAI, type LiteralProjectPatchPlan, type LiteralProjectPatchPlanItem } from './openaiDocument.service';
import { applyDirectedDocxPatches as applyDocxPatches } from './projectDocxPatch.service';

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
  kind: 'CONTRADICTION' | 'POSSIBLE_TEMPLATE_RESIDUE' | 'CONTEXT_CHRONOLOGY' | 'AI_PLANNER_MISSING';
  field?: string;
  master_value?: string;
  document_value?: string;
  document_id?: string;
  value?: string;
  location?: string;
  detail?: string;
};

export type ProjectInstructionPolicy = {
  text: string | null;
  consumed: boolean;
  focus: string[];
};

const instructionFocus = [
  ['REPRESENTACION', /representaci[oó]n|representante|sociedad/i],
  ['PODER', /\bpoder\b|apoderad/i],
  ['ANTECEDENTE', /antecedente/i],
  ['SUBDIVISION', /subdivisi[oó]n/i],
  ['CLAUSULA', /cl[aá]usula/i],
  ['TRANSCRIPCION_LITERAL', /literal|transcripci[oó]n/i],
] as const;

/**
 * Instructions are an auditable review focus; they never replace master facts.
 * Explicit attempts to bypass the factual hierarchy are rejected before any
 * document or storage write occurs.
 */
export function resolveProjectInstructions(value: unknown): ProjectInstructionPolicy {
  const normalized = text(value);
  if (!normalized) return { text: null, consumed: false, focus: [] };
  if (normalized.length > 4_000) throw new ProjectGenerationError(400, 'PROJECT_INSTRUCTIONS_TOO_LONG', 'Las indicaciones no pueden exceder 4,000 caracteres.');
  const conflicts = [
    /\b(?:inventa|inventar|fabri(?:ca|car))\b/i,
    /\b(?:ignora|ignorar|omite|omitir)\b.{0,80}\b(?:comparecientes?|predios?|fuentes?|documentos?|expediente)\b/i,
    /\baunque\s+no\s+(?:est[eé]|aparezca|conste)(?:\s|[.,;:]|$)/i,
    /\b(?:cambia|cambiar|sustituye|sustituir|reemplaza|reemplazar)\b.{0,80}\b(?:dato\s+maestro|hecho|compareciente|predio)\b/i,
  ];
  if (conflicts.some((pattern) => pattern.test(normalized))) {
    throw new ProjectGenerationError(409, 'PROJECT_INSTRUCTIONS_CONFLICT', 'La indicación contradice la jerarquía factual de EXP-010. Corrígela sin inventar ni sustituir datos maestros.');
  }
  return {
    text: normalized,
    consumed: true,
    focus: instructionFocus.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label),
  };
}

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

export async function docxLiteralSegments(source: Buffer) {
  const zip = await JSZip.loadAsync(source);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new ProjectGenerationError(422, 'PROJECT_DOCX_INVALID', 'El machote no contiene un documento Word válido.');
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map((match, paragraphIndex) => ({ text: xmlText(match[1]), paragraph_index: paragraphIndex }))
    .filter((segment) => segment.text.length >= 2)
    .map((segment) => ({ id: `P${String(segment.paragraph_index + 1).padStart(4, '0')}`, ...segment }));
}

const TEMPLATE_MASK = /[\p{L}\p{N}]*(?:\*{4,})[\p{L}\p{N}*]*/gu;
const TEMPLATE_PENDING = '[PENDIENTE: DATO DEL MACHOTE POR ACREDITAR]';

/**
 * A literal Word template may contain anonymised/example values that the model
 * cannot safely resolve. Those values must never survive as if they belonged
 * to the current matter. The model still decides source-backed substitutions;
 * this deterministic pass only turns remaining masks and explicitly reported
 * residues into visible, auditable pending markers.
 */
export function completeLiteralProjectPatchPlan(
  plan: LiteralProjectPatchPlan,
  segments: Array<{ text: string; paragraph_index: number }>,
): LiteralProjectPatchPlan {
  const residues = (plan.possible_residues || [])
    .map((item) => String(item.value || '').trim())
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
  const sanitize = (value: string) => {
    let next = value.replace(TEMPLATE_MASK, TEMPLATE_PENDING);
    for (const residue of residues) {
      if (!next.includes(residue)) continue;
      next = next.split(residue).join(TEMPLATE_PENDING);
    }
    return next;
  };
  const byParagraph = new Map<number, LiteralProjectPatchPlanItem>();
  const undirected: LiteralProjectPatchPlanItem[] = [];
  for (const patch of plan.patches || []) {
    if (Number.isInteger(patch.target_paragraph_index) && Number(patch.target_paragraph_index) >= 0) {
      byParagraph.set(Number(patch.target_paragraph_index), patch);
    } else undirected.push(patch);
  }
  const completed: LiteralProjectPatchPlanItem[] = [...undirected];
  for (const segment of segments) {
    const existing = byParagraph.get(segment.paragraph_index);
    const replacement = sanitize(existing?.replace ?? segment.text);
    if (existing) {
      const introducedPending = replacement !== existing.replace;
      completed.push({
        ...existing,
        replace: replacement,
        source_references: introducedPending
          ? [...new Set([...(existing.source_references || []), 'TEMPLATE_MISSING'])]
          : existing.source_references,
        reason: introducedPending
          ? `${existing.reason || 'Sustitución acreditada'}. Se neutralizaron marcadores o residuos no acreditados del machote.`
          : existing.reason,
      });
      continue;
    }
    if (replacement === segment.text) continue;
    completed.push({
      find: segment.text,
      replace: replacement,
      target_paragraph_index: segment.paragraph_index,
      source_references: ['TEMPLATE_MISSING'],
      reason: 'Marcador o dato residual del machote sin fuente acreditante; requiere revisión humana.',
      confidence: 'ALTA',
    });
  }
  return {
    ...plan,
    patches: completed,
    missing_fields: completed.length > (plan.patches || []).length
      ? [...new Set([...(plan.missing_fields || []), 'datos variables del machote pendientes de acreditar'])]
      : plan.missing_fields,
  };
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

type PositionedParagraphSignature = StaticParagraphSignature & {
  paragraphIndex: number;
};

export type DeterministicTemplateIntegrity = {
  status: 'PASS' | 'FAIL';
  checkedParagraphs: number;
  authorizedParagraphs: number;
  reasons: string[];
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

async function positionedParagraphSignatures(source: Buffer) {
  const zip = await JSZip.loadAsync(source);
  const parts = Object.keys(zip.files)
    .filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name))
    .sort();
  const signatures = new Map<string, PositionedParagraphSignature[]>();
  for (const sourcePart of parts) {
    const xml = await zip.files[sourcePart].async('string');
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match, paragraphIndex) => {
      const body = match[1];
      const visible = xmlText(body);
      const runs = [...body.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)]
        .map((run) => run[1])
        .filter((run) => xmlText(run).trim().length > 0);
      return {
        text: visible,
        normalized: normalizedDocumentText(visible),
        bold: runs.some((run) => /<w:b(?:\s[^>]*)?\/?\s*>/.test(run) && !/<w:b[^>]*w:val="(?:false|0|off)"/.test(run)),
        italic: runs.some((run) => /<w:i(?:\s[^>]*)?\/?\s*>/.test(run) && !/<w:i[^>]*w:val="(?:false|0|off)"/.test(run)),
        underline: runs.some((run) => /<w:u(?:\s[^>]*)?\/?\s*>/.test(run) && !/<w:u[^>]*w:val="(?:none|false|0|off)"/.test(run)),
        sourcePart,
        paragraphIndex,
      };
    });
    signatures.set(sourcePart, paragraphs);
  }
  return signatures;
}

/**
 * Proves that a literal projection retained every physical paragraph and all
 * non-authorized text/style from its source template. Model review can add
 * legal findings, but it cannot turn this deterministic evidence into an
 * indeterminate result merely because the expediente was reviewed in batches.
 */
export async function verifyLiteralProjectTemplateIntegrity(
  project: Buffer,
  template: Buffer,
  authorizedTemplateTargets: string[] = [],
): Promise<DeterministicTemplateIntegrity> {
  const reasons: string[] = [];
  try {
    await assertDocxStructuralFidelity(await JSZip.loadAsync(template), await JSZip.loadAsync(project));
  } catch (error: any) {
    reasons.push(error?.message || 'La estructura DOCX no coincide con el machote.');
  }
  const [expectedParts, actualParts] = await Promise.all([
    positionedParagraphSignatures(template),
    positionedParagraphSignatures(project),
  ]);
  const normalizedAuthorizedTargets = authorizedTemplateTargets.map(normalizedDocumentText).filter(Boolean);
  let checkedParagraphs = 0;
  let authorizedParagraphs = 0;
  for (const [sourcePart, expectedParagraphs] of expectedParts) {
    const actualParagraphs = actualParts.get(sourcePart) || [];
    if (actualParagraphs.length !== expectedParagraphs.length) {
      reasons.push(`${sourcePart}: ${expectedParagraphs.length} párrafos esperados, ${actualParagraphs.length} encontrados.`);
      continue;
    }
    for (const expected of expectedParagraphs) {
      const actual = actualParagraphs[expected.paragraphIndex];
      const authorized = Boolean(expected.normalized) && normalizedAuthorizedTargets.some((target) =>
        expected.normalized.includes(target) || target.includes(expected.normalized),
      );
      if (authorized) {
        authorizedParagraphs += 1;
        continue;
      }
      checkedParagraphs += 1;
      if (actual.normalized !== expected.normalized) {
        reasons.push(`${sourcePart} P${expected.paragraphIndex + 1}: el texto fijo fue modificado o desplazado.`);
        continue;
      }
      if (actual.bold !== expected.bold || actual.italic !== expected.italic || actual.underline !== expected.underline) {
        reasons.push(`${sourcePart} P${expected.paragraphIndex + 1}: el estilo fijo fue modificado.`);
      }
    }
  }
  for (const sourcePart of actualParts.keys()) {
    if (!expectedParts.has(sourcePart)) reasons.push(`${sourcePart}: componente de texto no presente en el machote.`);
  }
  return {
    status: reasons.length ? 'FAIL' : 'PASS',
    checkedParagraphs,
    authorizedParagraphs,
    reasons: reasons.slice(0, 25),
  };
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
  authorizedTemplateTargets: string[] = [],
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

  const normalizedAuthorizedTargets = authorizedTemplateTargets.map(normalizedDocumentText).filter(Boolean);
  const unchangedTemplateStatic = templateStatic.filter((expected) => !normalizedAuthorizedTargets.some((target) =>
    expected.normalized.includes(target) || target.includes(expected.normalized),
  ));
  const projectByText = new Map(projectStatic.map((signature) => [signature.normalized, signature]));
  const styleMismatch = unchangedTemplateStatic.find((expected) => {
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

export function buildProjectFactSheet(
  values: Record<string, unknown>,
  sourceDocumentIds: string[],
  observations: ProjectObservation[],
  confirmed: Record<string, unknown> = {},
) {
  const variable = /(^operacion\.|precio|monto|fecha|condicion|instruccion|descripcion)/i;
  return Object.entries(values).map(([field, value]) => {
    const rendered = String(value ?? '');
    const conflicts = observations.filter((item) => item.kind === 'CONTRADICTION' && item.field === field);
    return {
      field,
      value: rendered,
      status: rendered.startsWith('[PENDIENTE:') ? 'PENDIENTE' : conflicts.length ? 'CONFLICTO' : 'CONFIRMADO',
      mutability: variable.test(field) ? 'VARIABLE' : 'FIJO',
      provenance: Object.prototype.hasOwnProperty.call(confirmed, field)
        ? { type: 'USER_CONFIRMED', document_ids: [] }
        : { type: sourceDocumentIds.length ? 'STRUCTURED_AND_DOCUMENTARY' : 'STRUCTURED', document_ids: sourceDocumentIds },
      conflicts,
    };
  });
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
  const fields = await projectTemplateFields(source);
  if (fields.length === 0) {
    throw new ProjectGenerationError(
      422,
      'PROJECT_TEMPLATE_FIELDS_REQUIRED',
      'El machote no contiene campos PRAVIA {{...}}. Debe parametrizarse antes de generar un proyecto para evitar conservar datos residuales de otro asunto.',
    );
  }
  const original = await JSZip.loadAsync(source);
  const originalEntries = Object.keys(original.files).filter((name) => !original.files[name].dir).sort();
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
  const resultEntries = Object.keys(result.files).filter((name) => !result.files[name].dir).sort();
  if (JSON.stringify(originalEntries) !== JSON.stringify(resultEntries)) {
    const missingEntries = originalEntries.filter((name) => !resultEntries.includes(name));
    const addedEntries = resultEntries.filter((name) => !originalEntries.includes(name));
    throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_STRUCTURE_CHANGED', `El documento resultante no conservó todos los componentes del machote. Faltantes: ${missingEntries.join(', ') || 'ninguno'}. Agregados: ${addedEntries.join(', ') || 'ninguno'}.`);
  }
  for (const [name, digest] of Object.entries(originalMedia)) if (checksum(await result.files[name].async('nodebuffer')) !== digest) throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_MEDIA_CHANGED', 'El documento resultante alteró imágenes del machote.');
  const resultXml = await Promise.all(resultEntries.filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)).map((name) => result.files[name].async('string')));
  const residual = resultXml.flatMap((xml) => [...xml.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]));
  if (residual.length) throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_RESIDUAL_FIELDS', `Quedaron campos técnicos sin resolver: ${[...new Set(residual)].join(', ')}.`);
  const fidelity = await assertDocxStructuralFidelity(original, result);
  return { buffer: output, pendingCount: resultXml.reduce((total, xml) => total + (xml.match(/PENDIENTE:/g) || []).length, 0), fidelity };
}

export function validateLiteralProjectPatches(
  templateText: string,
  plan: Pick<LiteralProjectPatchPlan, 'patches'>,
  allowedSourceIds: string[],
) {
  const effectivePatches = Array.isArray(plan.patches)
    ? plan.patches.filter((patch) => String(patch.find || '').length > 0 && String(patch.replace || '').length > 0 && String(patch.find) !== String(patch.replace))
    : [];
  if (effectivePatches.length < 1 || effectivePatches.length > 120) {
    throw new ProjectGenerationError(422, 'PROJECT_LITERAL_PATCHES_REQUIRED', 'La IA no identificó sustituciones seguras suficientes para proyectar este machote literal.');
  }
  const allowed = new Set(['CANONICAL_FACTS', 'TEMPLATE_MISSING', ...allowedSourceIds]);
  const seen = new Set<string>();
  const resolveExactTemplateTarget = (candidate: string) => {
    if (templateText.split(candidate).length - 1 === 1) return candidate;
    const normalize = (value: string) => value
      .normalize('NFKC')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) return null;
    const matches = templateText.split('\n').filter((paragraph) => {
      const normalizedParagraph = normalize(paragraph);
      return normalizedParagraph === normalizedCandidate || normalizedParagraph.includes(normalizedCandidate);
    });
    if (matches.length !== 1) return null;
    const paragraph = matches[0];
    if (normalize(paragraph) === normalizedCandidate) return paragraph;
    const candidateTokens = normalizedCandidate.split(' ');
    const paragraphTokens = paragraph.match(/\S+/g) || [];
    const normalizedTokens = paragraphTokens.map(normalize);
    const tokenMatches: number[] = [];
    for (let index = 0; index <= normalizedTokens.length - candidateTokens.length; index += 1) {
      if (candidateTokens.every((token, offset) => normalizedTokens[index + offset] === token)) tokenMatches.push(index);
    }
    if (tokenMatches.length !== 1) return null;
    const firstToken = paragraphTokens[tokenMatches[0]];
    const lastToken = paragraphTokens[tokenMatches[0] + candidateTokens.length - 1];
    const start = paragraph.indexOf(firstToken);
    const end = paragraph.indexOf(lastToken, start) + lastToken.length;
    return start >= 0 && end > start ? paragraph.slice(start, end) : null;
  };
  return effectivePatches.map((raw, index): LiteralProjectPatchPlanItem => {
    const proposedFind = String(raw.find || '');
    const find = resolveExactTemplateTarget(proposedFind) || proposedFind;
    const replace = String(raw.replace || '');
    const references = Array.isArray(raw.source_references) ? raw.source_references.map(String) : [];
    if (find.length > 5_000 || replace.length > 10_000 || /\{\{[^{}]+\}\}/.test(replace)) {
      throw new ProjectGenerationError(422, 'PROJECT_LITERAL_PATCH_INVALID', `La sustitución literal ${index + 1} no es segura.`);
    }
    const occurrences = templateText.split(find).length - 1;
    const targetParagraphIndex = Number.isInteger(raw.target_paragraph_index) && Number(raw.target_paragraph_index) >= 0
      ? Number(raw.target_paragraph_index)
      : undefined;
    const targetKey = `${find}#${targetParagraphIndex ?? 'unique'}`;
    if ((targetParagraphIndex === undefined && occurrences !== 1) || occurrences < 1 || seen.has(targetKey)) {
      throw new ProjectGenerationError(422, occurrences ? 'PROJECT_LITERAL_PATCH_AMBIGUOUS' : 'PROJECT_LITERAL_PATCH_NOT_FOUND', occurrences ? `La sustitución ${index + 1} no identifica un texto único del machote.` : `La sustitución ${index + 1} no existe literalmente en el machote.`);
    }
    if (!references.length || references.some((reference) => !allowed.has(reference))) {
      throw new ProjectGenerationError(422, 'PROJECT_LITERAL_PATCH_SOURCE_INVALID', `La sustitución ${index + 1} no está respaldada por una fuente cerrada.`);
    }
    const pendingReplacement = /\[PENDIENTE(?::[^\]]+)?\]/i.test(replace);
    if (pendingReplacement && !references.includes('TEMPLATE_MISSING')) {
      throw new ProjectGenerationError(422, 'PROJECT_LITERAL_PENDING_SOURCE_INVALID', `El pendiente ${index + 1} no está identificado como dato faltante.`);
    }
    if (!pendingReplacement && references.every((reference) => reference === 'TEMPLATE_MISSING')) {
      throw new ProjectGenerationError(422, 'PROJECT_LITERAL_VALUE_WITHOUT_SOURCE', `La sustitución ${index + 1} contiene un valor sin fuente.`);
    }
    seen.add(targetKey);
    return { find, replace, target_paragraph_index: targetParagraphIndex, source_references: references, reason: String(raw.reason || ''), confidence: raw.confidence === 'MEDIA' ? 'MEDIA' : 'ALTA' };
  });
}

export function isRetryableLiteralProjectPlanError(error: unknown): error is ProjectGenerationError {
  return error instanceof ProjectGenerationError && new Set([
    'PROJECT_LITERAL_PATCHES_REQUIRED',
    'PROJECT_LITERAL_PATCH_INVALID',
    'PROJECT_LITERAL_PATCH_AMBIGUOUS',
    'PROJECT_LITERAL_PATCH_NOT_FOUND',
    'PROJECT_LITERAL_PATCH_SOURCE_INVALID',
    'PROJECT_LITERAL_PENDING_SOURCE_INVALID',
    'PROJECT_LITERAL_VALUE_WITHOUT_SOURCE',
  ]).has(error.code);
}

export async function renderLiteralProjectTemplate(
  source: Buffer,
  plan: LiteralProjectPatchPlan,
  allowedSourceIds: string[],
) {
  const original = await JSZip.loadAsync(source);
  const originalEntries = Object.keys(original.files).filter((name) => !original.files[name].dir).sort();
  const originalMedia = Object.fromEntries(await Promise.all(originalEntries.filter((name) => name.startsWith('word/media/') && !original.files[name].dir).map(async (name) => [name, checksum(await original.files[name].async('nodebuffer'))])));
  const templateText = await docxVisibleText(source);
  const patches = validateLiteralProjectPatches(templateText, plan, allowedSourceIds);
  const patched = await applyDocxPatches(source, patches, (status, code, message) => new ProjectGenerationError(status, code, message));
  const highlighted = await JSZip.loadAsync(patched.buffer);
  for (const name of Object.keys(highlighted.files).filter((item) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(item))) {
    const xml = await highlighted.file(name)?.async('string');
    if (xml) highlighted.file(name, highlightPendingRuns(xml));
  }
  const output = await highlighted.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const result = await JSZip.loadAsync(output);
  const resultEntries = Object.keys(result.files).filter((name) => !result.files[name].dir).sort();
  if (JSON.stringify(originalEntries) !== JSON.stringify(resultEntries)) {
    const missingEntries = originalEntries.filter((name) => !resultEntries.includes(name));
    const addedEntries = resultEntries.filter((name) => !originalEntries.includes(name));
    throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_STRUCTURE_CHANGED', `El documento resultante no conservó todos los componentes del machote. Faltantes: ${missingEntries.join(', ') || 'ninguno'}. Agregados: ${addedEntries.join(', ') || 'ninguno'}.`);
  }
  for (const [name, digest] of Object.entries(originalMedia)) {
    if (checksum(await result.files[name].async('nodebuffer')) !== digest) throw new ProjectGenerationError(422, 'PROJECT_TEMPLATE_MEDIA_CHANGED', 'El documento resultante alteró imágenes del machote.');
  }
  const resultXml = await Promise.all(resultEntries.filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)).map((name) => result.files[name].async('string')));
  const fidelity = await assertDocxStructuralFidelity(original, result);
  return {
    buffer: output,
    pendingCount: resultXml.reduce((total, xml) => total + (xml.match(/PENDIENTE:/g) || []).length, 0),
    fidelity,
    patches,
    planner: { model: plan.model, usage: plan.usage, missing_fields: plan.missing_fields, conflicts: plan.conflicts, possible_residues: plan.possible_residues },
  };
}

export async function buildLiteralProjectSources(
  selectedSources: Array<{ documento_id: string; documento: any }>,
  readSource: (document: any) => Promise<string> = exactSourceText,
) {
  const compactExtraction = (value: Record<string, any>) => {
    const extractions = Array.isArray(value.ai_extractions) ? value.ai_extractions : [];
    const results = extractions.map((item: any) => record(item).result).map((item: any) => {
      const result = { ...record(item) };
      delete result.usos;
      delete result.uso;
      delete result.modelo;
      delete result.proveedor;
      return result;
    }).filter((item: Record<string, any>) => Object.keys(item).length > 0);
    return results.length > 0 ? { results } : {};
  };
  // Keep every selected document represented, but enforce one global prompt
  // budget. This avoids repeating extraction telemetry and large OCR payloads
  // while retaining both structured facts and a literal excerpt per source.
  let remaining = 80_000;
  const sources = [];
  const observations: ProjectObservation[] = [];
  for (let index = 0; index < selectedSources.length; index += 1) {
    const link = selectedSources[index];
    const extracted = record(link.documento.datos_extraidos);
    const documentsLeft = selectedSources.length - index;
    const fairShare = documentsLeft > 0 ? Math.max(0, Math.floor(remaining / documentsLeft)) : 0;
    const sourceBudget = Math.min(2_400, fairShare);
    const compact = compactExtraction(extracted);
    const extractedText = JSON.stringify(compact).slice(0, Math.floor(sourceBudget * 0.7));
    const literalBudget = Math.max(0, sourceBudget - extractedText.length);
    const sourceName = String(link.documento.nombre_original || link.documento_id);
    const mime = String(link.documento.mime_type || '').toLowerCase();
    const isLegacyDoc = mime === 'application/msword' || /\.doc$/i.test(sourceName);
    let literal = '';
    let issue: string | null = null;
    if (literalBudget > 0) {
      try {
        literal = (await readSource(link.documento)).slice(0, literalBudget);
        if (!literal && isLegacyDoc) {
          issue = 'El archivo DOC legacy no admite extracción literal validada; conserva trazabilidad y requiere revisión manual.';
        }
      } catch {
        issue = 'El archivo fuente no está disponible en el storage local validado; conserva trazabilidad y requiere revisión manual.';
      }
    }
    if (issue) {
      observations.push({
        kind: 'AI_PLANNER_MISSING',
        field: `FUENTE: ${sourceName}`,
        document_id: link.documento_id,
        detail: issue,
      });
      literal = `[FUENTE NO LEGIBLE: ${sourceName}. REQUIERE REVISIÓN MANUAL]`.slice(0, literalBudget);
    }
    remaining -= extractedText.length + literal.length;
    sources.push({
      id: link.documento_id,
      name: sourceName,
      text: literal,
      extracted: extractedText ? { snapshot: extractedText } : {},
    });
  }
  return { sources, observations };
}

export class ProjectGenerationService {
  async generateFromManualTemplate(actor: Actor, expedienteId: string, input: any, file: Express.Multer.File) {
    if (!file?.buffer?.length || file.mimetype !== DOCX || !file.originalname.toLowerCase().endsWith('.docx'))
      throw new ProjectGenerationError(400, 'PROJECT_TEMPLATE_DOCX_REQUIRED', 'Carga un machote DOCX válido.');
    return this.generate(actor, expedienteId, { ...input, __manual_template: { buffer: file.buffer, name: file.originalname } });
  }

  async workspace(actor: Actor, expedienteId: string) {
    const expediente = await prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null }, select: { id: true, numero_pravia: true, cliente_alias: true, descripcion: true, notaria_id: true, actos: { where: { estatus: 'ACTIVO', removed_at: null }, select: { tipo_acto_id: true, tipo_acto: { select: { nombre: true } } } }, comparecientes: { where: { estatus: 'ACTIVO' }, select: { id: true } }, predios: { where: { estatus: 'ACTIVO' }, select: { id: true } } } });
    if (!expediente) throw new ProjectGenerationError(404, 'PROJECT_CASE_NOT_FOUND', 'No se encontró el expediente.');
    const currentProject = await prisma.expedienteDocumento.findFirst({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' },
      include: { documento: { select: { datos_extraidos: true } } },
      orderBy: { fecha_vinculo: 'desc' },
    });
    const currentProjectMetadata = record(record(currentProject?.documento?.datos_extraidos).proyecto);
    if (currentProject?.document_role === 'DEFINITIVE_DEED' || currentProjectMetadata.es_version_final === true) {
      throw new ProjectGenerationError(409, 'PROJECT_VALIDATED_REOPEN_REQUIRED', 'El proyecto está validado. Reábrelo explícitamente antes de volver a proyectar con IA.');
    }
    const actIds = expediente.actos.map((item) => item.tipo_acto_id);
    const templates = await projectTemplateAssignmentService.list(actor, actIds);
    const documents = await prisma.expedienteDocumento.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO' }, select: { id: true, tipo_vinculo: true, source_context: true, documento: { select: { id: true, nombre_original: true, mime_type: true, checksum_sha256: true, tipo: true, categoria: true } } }, orderBy: { fecha_vinculo: 'asc' } });
    const mappedTemplates = templates.map((link) => ({
      id: link.artefacto.id,
      name: link.artefacto.nombre,
      default: link.tipo_acto_id === actIds[0],
      applicable_act_ids: [link.tipo_acto_id],
      versions: [{ id: link.version.id, version: link.version.version, name: link.version.nombre_original || undefined, checksum: link.version.checksum_sha256 }],
    }));
    const suggestedArtifact = mappedTemplates.find((item) => item.default) || mappedTemplates[0];
    const suggestedVersion = suggestedArtifact?.versions[0];
    const pendingDetectable = [!expediente.cliente_alias, !expediente.descripcion, !expediente.notaria_id, expediente.comparecientes.length === 0, expediente.predios.length === 0].filter(Boolean).length;
    return {
      modes: ['GENERAR_PROYECTO', 'REVISAR_PROYECTO'],
      expediente: { id: expediente.id, folio: expediente.numero_pravia, acts: expediente.actos.map((item) => ({ id: item.tipo_acto_id, name: item.tipo_acto.nombre })) },
      templates: mappedTemplates,
      suggested_template: suggestedArtifact && suggestedVersion ? { artifact_id: suggestedArtifact.id, name: suggestedArtifact.name, version_id: suggestedVersion.id, version: suggestedVersion.version } : null,
      pending_detectable_count: pendingDetectable,
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
    const idempotencyKey = text(input?.idempotency_key);
    if (idempotencyKey && idempotencyKey.length > 160) throw new ProjectGenerationError(400, 'PROJECT_IDEMPOTENCY_INVALID', 'La clave de idempotencia no es válida.');
    if (idempotencyKey) {
      const existing = await prisma.expedienteDocumento.findFirst({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey },
        include: { documento: true },
      });
      if (existing) {
        const persisted = await projectRepository.getVersion(expedienteId, existing.documento_id);
        const metadata = record(existing.documento.datos_extraidos);
        const project = record(metadata.proyecto);
        return { version: persisted?.record, pending_count: Number(project.pending_count || 0), contradiction_count: Array.isArray(project.contradiction_observations) ? project.contradiction_observations.length : 0, generation_observation_count: Array.isArray(project.generation_observations) ? project.generation_observations.length : 0, residual_observation_count: Array.isArray(project.residual_observations) ? project.residual_observations.length : 0, critical_count: 0, instructions_consumed: Boolean(project.instructions_consumed), instruction_focus: Array.isArray(project.instruction_focus) ? project.instruction_focus : [], generation_origin: project.generation_origin || 'UI', docx_structural_fidelity: 'PASS', template: { artifact_id: project.template_artifact_id || null, version_id: project.template_version_id || null, version: project.template_version || null, name: project.template_name || null, exclusive: String(project.generation_mode || '').includes('EXCEPCIONAL') }, review_required: true, idempotent: true };
      }
    }
    const instructionPolicy = resolveProjectInstructions(input?.instructions);
    const instructions = instructionPolicy.text;
    const origin = input?.origin == null ? 'UI' : String(input.origin);
    if (!['UI', 'PRAVIA_IA'].includes(origin)) throw new ProjectGenerationError(400, 'PROJECT_ORIGIN_INVALID', 'El origen de la proyección no es válido.');
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
    if (!actId) throw new ProjectGenerationError(409, 'PROJECT_ACT_REQUIRED', 'El expediente necesita al menos un acto activo antes de proyectar la escritura.');
    const assignment = manualTemplate ? null : await projectTemplateAssignmentService.resolve(actor, actId);
    const resolved = assignment && (!requestedVersionId || requestedVersionId === assignment.version_id)
      ? { ...assignment.version, artefacto: assignment.artefacto }
      : null;
    if (!manualTemplate && requestedVersionId && !resolved) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_ASSIGNMENT_MISMATCH', 'La versión elegida no es el machote asignado estructuralmente al Acto del expediente.');
    let artifact: any; let version: any;
    if (manualTemplate) {
      artifact = { id: null, nombre: manualTemplate.name };
      version = { id: null, version: 1, storage_key: null, mime_type: DOCX, size_bytes: manualTemplate.buffer.length, checksum_sha256: checksum(manualTemplate.buffer), definition_json: null };
    } else if (resolved) { artifact = resolved.artefacto; version = resolved; }
    else throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_NOT_CONFIGURED', 'Configura un machote exacto para el Acto de este expediente.');
    if ((!manualTemplate && !version.storage_key) || version.mime_type !== DOCX) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_DOCX_REQUIRED', 'El machote seleccionado debe ser un DOCX activo.');
    const source = manualTemplate?.buffer || await downloadFile(version.storage_key);
    if (version.size_bytes != null && source.length !== version.size_bytes) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_SIZE_MISMATCH', 'El machote no coincide con el tamaño registrado.');
    if (version.checksum_sha256 && checksum(source) !== version.checksum_sha256) throw new ProjectGenerationError(409, 'PROJECT_TEMPLATE_CHECKSUM_MISMATCH', 'No se pudo verificar la integridad del machote.');
    const confirmedValues = input?.confirmed_values && typeof input.confirmed_values === 'object' ? input.confirmed_values : {};
    const baseValues = buildProjectTemplateData(expediente, confirmedValues);
    const documentContext = await buildProjectDocumentContext(source, selectedSources, baseValues, input?.transcription_sources);
    const literalMode = documentContext.fields.length === 0;
    const literalSegments = literalMode ? await docxLiteralSegments(source) : [];
    const literalSources = literalMode
      ? await buildLiteralProjectSources(selectedSources)
      : { sources: [], observations: [] as ProjectObservation[] };
    let literalPlan: LiteralProjectPatchPlan | null = null;
    let rendered!: Awaited<ReturnType<typeof renderProjectTemplate>> & { patches?: LiteralProjectPatchPlanItem[] };
    if (literalMode) {
      let validationFeedback: { code: string; message: string } | undefined;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const planned = await planLiteralProjectPatchesWithOpenAI({
          templateName: artifact.nombre,
          templateSegments: literalSegments,
          canonicalFacts: documentContext.values,
          sourceDocuments: literalSources.sources,
          instructions,
          validationFeedback,
        });
        const completed = completeLiteralProjectPatchPlan(planned, literalSegments);
        try {
          rendered = await renderLiteralProjectTemplate(source, completed, selectedSources.map((link) => link.documento_id));
          literalPlan = completed;
          break;
        } catch (error) {
          if (attempt >= 2 || !isRetryableLiteralProjectPlanError(error)) throw error;
          validationFeedback = { code: error.code, message: error.message };
        }
      }
      if (!literalPlan) throw new ProjectGenerationError(422, 'PROJECT_LITERAL_PLAN_RETRY_EXHAUSTED', 'La IA no produjo un plan literal válido después de la corrección automática.');
    } else {
      rendered = await renderProjectTemplate(source, documentContext.values);
    }
    const renderedLiteralPatches: LiteralProjectPatchPlanItem[] = literalPlan && 'patches' in rendered && Array.isArray(rendered.patches)
      ? rendered.patches as LiteralProjectPatchPlanItem[]
      : [];
    const templateDefinition = record(version.definition_json);
    const templateProjectDefinition = record(templateDefinition.project);
    const residueObservations = await detectProjectTemplateResidues(
      source,
      rendered.buffer,
      literalPlan
        ? { ...documentContext.values, ...Object.fromEntries(literalPlan.patches.map((patch, index) => [`literal_patch_${index + 1}`, patch.replace])) }
        : documentContext.values,
      templateProjectDefinition.residual_values || templateDefinition.residual_values || [],
    );
    const plannerObservations: ProjectObservation[] = literalPlan ? [
      ...literalPlan.missing_fields.map((field) => ({ kind: 'AI_PLANNER_MISSING' as const, field, detail: 'Dato variable no acreditado; se conserva como pendiente para revisión humana.' })),
      ...literalPlan.conflicts.map((conflict) => ({ kind: 'CONTRADICTION' as const, field: conflict.field, detail: conflict.detail })),
      ...literalPlan.possible_residues.map((residue) => ({ kind: 'POSSIBLE_TEMPLATE_RESIDUE' as const, value: residue.value, location: residue.location, detail: residue.detail })),
    ] : [];
    const generationObservations = [...documentContext.observations, ...literalSources.observations, ...plannerObservations, ...residueObservations];
    const factSheet = buildProjectFactSheet(documentContext.values, selectedSources.map((link) => link.documento_id), generationObservations, confirmedValues);
    const prior = await projectRepository.listVersions(expedienteId);
    const versionNumber = prior.reduce((max, item) => Math.max(max, item.version_numero), 0) + 1;
    const storageKey = `organizations/${actor.organizationId}/documentos/expedientes/${expedienteId}/proyectos/${randomUUID()}_Proyecto_${safe(expediente.numero_pravia)}.docx`;
    const manualStorageKey = manualTemplate ? `organizations/${actor.organizationId}/documentos/expedientes/${expedienteId}/proyectos/machotes/${randomUUID()}_${safe(manualTemplate.name)}` : null;
    if (manualStorageKey) await uploadFile(source, manualStorageKey, DOCX);
    await uploadFile(rendered.buffer, storageKey, DOCX);
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:proyecto-version:${expedienteId}`}))`);
        if (idempotencyKey) {
          const concurrent = await tx.expedienteDocumento.findFirst({
            where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey },
            include: { documento: true },
          });
          if (concurrent) return { document: concurrent.documento, idempotent: true };
        }
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
          datos_extraidos: json({ proyecto: { version_numero: assignedVersion, es_version_final: false, nota_version: `V${assignedVersion} · borrador para revisión notarial`, template_artifact_id: artifact.id, template_version_id: sourceEntityId, template_version: version.version, template_name: artifact.nombre, template_checksum: version.checksum_sha256, source_document_ids: selectedSources.map((link) => link.documento_id), source_selection_explicit: requestedSourceIds !== undefined, instructions, instructions_consumed: instructionPolicy.consumed, instruction_focus: instructionPolicy.focus, generation_origin: origin, pending_count: rendered.pendingCount, contradiction_observations: generationObservations.filter((item) => item.kind === 'CONTRADICTION'), generation_observations: generationObservations, residual_observations: [...plannerObservations.filter((item) => item.kind === 'POSSIBLE_TEMPLATE_RESIDUE'), ...residueObservations], docx_structural_fidelity: { status: 'PASS', ...rendered.fidelity }, generation_mode: literalMode ? (manualSource ? 'MACHOTE_LITERAL_IA_EXCEPCIONAL' : 'MACHOTE_LITERAL_IA_CFG002') : manualSource ? 'MACHOTE_EXCEPCIONAL' : 'MACHOTE_CFG002', literal_projection: literalPlan ? { patch_count: renderedLiteralPatches.length, authorized_template_targets: renderedLiteralPatches.map((patch) => patch.find), planner_model: literalPlan.model, planner_usage: literalPlan.usage, source_references: [...new Set(renderedLiteralPatches.flatMap((patch) => patch.source_references))] } : null } }),
        } });
        await tx.expedienteDocumento.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, documento_id: created.id, tipo_vinculo: 'PROYECTO_ESCRITURA', creado_por_id: actor.id, estatus: 'ACTIVO', origen: 'EXPEDIENTE', source_entity_type: manualSource ? 'Documento' : 'CatalogoArtefactoVersion', source_entity_id: sourceEntityId, source_context: 'PROYECTO_ESCRITURA', source_key: `EXPEDIENTE:${manualSource ? 'Documento' : 'CatalogoArtefactoVersion'}:${sourceEntityId}:${created.id}:PROYECTO_ESCRITURA`, document_version: checksum(rendered.buffer), provenance: json({ template_artifact_id: artifact.id, template_version_id: sourceEntityId, template_checksum: version.checksum_sha256, exclusive_template: Boolean(manualSource), source_selection_explicit: requestedSourceIds !== undefined, source_documents: selectedSources.map((link) => ({ id: link.documento_id, checksum: link.documento.checksum_sha256 })) }), document_role: 'PROJECT_DRAFT', idempotency_key: idempotencyKey || null } });
        await tx.projectFactSnapshot.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, project_document_id: created.id, project_version: assignedVersion, facts: json(factSheet), conflicts: json(generationObservations), created_by_id: actor.id } });
        await tx.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, tipo: 'AUDITORIA', titulo: `Proyecto generado (V${assignedVersion})`, descripcion: `Origen ${origin}; machote ${manualSource ? 'exclusivo' : 'CFG-002'} ${artifact.nombre}, versión ${version.version}; ${selectedSources.length} fuente(s) documental(es); indicaciones ${instructionPolicy.consumed ? 'consumidas como foco de revisión' : 'no proporcionadas'}; ${rendered.pendingCount} pendiente(s) y ${generationObservations.length} observación(es) para revisión.`, usuario_id: actor.id } });
        return { document: created, idempotent: false };
      }, { timeout: 20_000 });
      if (result.idempotent) await Promise.all([deleteFile(storageKey).catch(() => undefined), manualStorageKey ? deleteFile(manualStorageKey).catch(() => undefined) : Promise.resolve()]);
      const persisted = await projectRepository.getVersion(expedienteId, result.document.id);
      if (result.idempotent) {
        const metadata = record(result.document.datos_extraidos); const project = record(metadata.proyecto);
        return { version: persisted?.record, pending_count: Number(project.pending_count || 0), contradiction_count: Array.isArray(project.contradiction_observations) ? project.contradiction_observations.length : 0, generation_observation_count: Array.isArray(project.generation_observations) ? project.generation_observations.length : 0, residual_observation_count: Array.isArray(project.residual_observations) ? project.residual_observations.length : 0, critical_count: 0, instructions_consumed: Boolean(project.instructions_consumed), instruction_focus: Array.isArray(project.instruction_focus) ? project.instruction_focus : [], generation_origin: project.generation_origin || origin, docx_structural_fidelity: 'PASS', template: { artifact_id: project.template_artifact_id || null, version_id: project.template_version_id || null, version: project.template_version || null, name: project.template_name || null, exclusive: String(project.generation_mode || '').includes('EXCEPCIONAL') }, review_required: true, idempotent: true };
      }
      return { version: persisted?.record, pending_count: rendered.pendingCount, contradiction_count: documentContext.observations.filter((item) => item.kind === 'CONTRADICTION').length, generation_observation_count: generationObservations.length, residual_observation_count: residueObservations.length, critical_count: 0, instructions_consumed: instructionPolicy.consumed, instruction_focus: instructionPolicy.focus, generation_origin: origin, docx_structural_fidelity: 'PASS', template: { artifact_id: artifact.id, version_id: version.id, version: version.version, name: artifact.nombre, exclusive: Boolean(manualTemplate) }, review_required: true, idempotent: false };
    } catch (error) { await Promise.all([deleteFile(storageKey).catch(() => undefined), manualStorageKey ? deleteFile(manualStorageKey).catch(() => undefined) : Promise.resolve()]); throw error; }
  }
}

export const projectGenerationService = new ProjectGenerationService();
