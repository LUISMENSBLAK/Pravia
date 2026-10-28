import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { validateCurp } from '../domain/mexicanIdentity';

type PositionedText = { text: string; page: number; x: number; y: number; width: number };
type CurpField = 'curp' | 'nombre_literal' | 'folio_documental' | 'entidad_registro' | 'fecha_inscripcion' | 'certificacion_literal';
type Detection = { literal: string; normalized: string; document_id: string; page: number;
  block: { x: number; y: number; width: number }; method: 'DETERMINISTIC_PDF_TEXT'; status: 'DETECTED_UNCONFIRMED' };

export class CurpDocumentExtractionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const normal = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const labelPatterns: Record<Exclude<CurpField, 'certificacion_literal'>, RegExp> = {
  curp: /^Clave\s*:?$/i,
  nombre_literal: /^Nombre\s*:?$/i,
  folio_documental: /^Folio\s*:?$/i,
  entidad_registro: /^Entidad de registro\s*:?$/i,
  fecha_inscripcion: /^Fecha de inscripci[oó]n\s*:?$/i,
};

function detectNearLabel(items: PositionedText[], label: RegExp, documentId: string): Detection | null {
  const anchor = items.find((item) => label.test(item.text));
  if (!anchor) return null;
  const value = items.filter((item) => item.page === anchor.page && item !== anchor &&
    Math.abs(item.x - anchor.x) <= 28 && anchor.y - item.y >= 8 && anchor.y - item.y <= 35 &&
    !Object.values(labelPatterns).some((pattern) => pattern.test(item.text)))
    .sort((a, b) => (anchor.y - a.y) - (anchor.y - b.y))[0];
  if (!value) return null;
  return { literal: value.text, normalized: normal(value.text), document_id: documentId,
    page: value.page, block: { x: value.x, y: value.y, width: value.width },
    method: 'DETERMINISTIC_PDF_TEXT', status: 'DETECTED_UNCONFIRMED' };
}

function canonicalDate(input: string): string | null {
  const match = normal(input).match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return date.getUTCDate() === Number(day) && date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCFullYear() === Number(year) ? `${year}-${month}-${day}` : null;
}

export async function extractCurpPdf(buffer: Buffer, documentId: string) {
  if (!buffer.length || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new CurpDocumentExtractionError('CURP_PDF_INVALID', 'El archivo no es un PDF CURP legible.');
  }
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 3) throw new CurpDocumentExtractionError('CURP_PAGE_LIMIT',
      'El documento excede tres páginas; revísalo manualmente.');
    const items: PositionedText[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const entry of content.items) {
        if (!('str' in entry)) continue;
        const item = entry as { str: string; transform: number[]; width: number };
        const text = normal(item.str);
        if (text) items.push({ text, page: pageNumber, x: item.transform[4], y: item.transform[5], width: item.width });
      }
      page.cleanup();
    }
    if (!items.some((item) => /Clave [ÚU]nica de Registro de Poblaci[oó]n/i.test(item.text)) &&
      !items.some((item) => /CURP Certificada/i.test(item.text))) {
      throw new CurpDocumentExtractionError('CURP_DOCUMENT_NOT_RECOGNIZED',
        'El PDF no se identifica como constancia CURP; no se aplicaron datos.');
    }
    const fields = Object.fromEntries(Object.entries(labelPatterns)
      .map(([field, label]) => [field, detectNearLabel(items, label, documentId)])) as Record<Exclude<CurpField, 'certificacion_literal'>, Detection | null>;
    const certified = items.find((item) => /^CURP Certificada\s*:/i.test(item.text));
    const certification: Detection | null = certified ? {
      literal: certified.text, normalized: normal(certified.text), document_id: documentId,
      page: certified.page, block: { x: certified.x, y: certified.y, width: certified.width },
      method: 'DETERMINISTIC_PDF_TEXT', status: 'DETECTED_UNCONFIRMED',
    } : null;
    const rawCurp = fields.curp?.normalized || '';
    let curp: string | null = null;
    try { curp = validateCurp(rawCurp); } catch { /* Un candidato inválido queda pendiente de revisión. */ }
    if (!curp && fields.curp) fields.curp = null;
    else if (curp && fields.curp) fields.curp.normalized = curp;
    const date = fields.fecha_inscripcion && canonicalDate(fields.fecha_inscripcion.literal);
    if (fields.fecha_inscripcion && date) fields.fecha_inscripcion.normalized = date;
    else fields.fecha_inscripcion = null;
    return { schema: 'CURP_PDF_LAYOUT_V1', source: 'DETERMINISTIC_PDF_TEXT' as const,
      sha256: createHash('sha256').update(buffer).digest('hex'), document_id: documentId,
      status: 'REVIEW_REQUIRED' as const, requires_human_confirmation: true,
      fields: { ...fields, certificacion_literal: certification,
        apellido_paterno: null, apellido_materno: null, fecha_emision: null },
      warnings: [
        ...(!fields.curp ? ['CURP_NO_LEGIBLE_O_INVALIDA'] : []),
        ...(!fields.nombre_literal ? ['NOMBRE_NO_ENCONTRADO'] : []),
        'APELLIDOS_NO_SEPARADOS_SIN_ETIQUETA_EXPLICITA',
        'NO_VALIDADO_CON_RENAPO',
      ],
    };
  } catch (error) {
    if (error instanceof CurpDocumentExtractionError) throw error;
    throw new CurpDocumentExtractionError('CURP_PDF_UNREADABLE',
      'No se pudo leer el PDF CURP. El original debe conservarse para revisión manual.');
  } finally { await task.destroy(); }
}
