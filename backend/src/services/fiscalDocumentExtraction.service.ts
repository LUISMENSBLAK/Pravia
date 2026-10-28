import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { FISCAL_UPLOAD_MAX_BYTES } from '../config/uploadLimits';

export type FiscalDocumentFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
export class FiscalExtractionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const RFC = /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g;
const CSF_TITLE = /CONSTANCIA\s+DE\s+SITUACI[ÓO]N\s+FISCAL/i;
const regimeLine = /(?:R[EÉ]GIMEN(?:ES)?\s+FISCAL(?:ES)?|R[EÉ]GIMEN)\s*:?\s*(\d{3})\s*[-–:]?\s*([^\n]*)/gi;
const inlineLabels = [
  'RFC', 'CURP', 'Nombre\\s*\\(s\\)', 'Primer Apellido', 'Segundo Apellido',
  'Fecha inicio de operaciones', 'Estatus en el padr[oó]n', 'Fecha de [uú]ltimo cambio de estado',
  'Nombre Comercial', 'C[oó]digo Postal', 'Tipo de Vialidad', 'Nombre de Vialidad',
  'N[uú]mero Exterior', 'N[uú]mero Interior', 'Nombre de la Colonia', 'Nombre de la Localidad',
  'Nombre del Municipio o Demarcaci[oó]n Territorial', 'Nombre de la Entidad Federativa',
  'Entre Calle', 'Y Calle', 'Denominaci[oó]n\\s*\\/\\s*Raz[oó]n Social',
  'Nombre,? denominaci[oó]n o raz[oó]n social', 'Nombre completo',
].join('|');
const lineValue = (text: string, labels: string[]) => {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n|\\s)(?:${label})\\s*:\\s*([^\\n]*?)(?=\\s+(?:${inlineLabels})\\s*:|\\n|$)`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
};

export function parseFiscalCsfText(raw: string) {
  const text = raw.normalize('NFC').replace(/\r/g, '').replace(/[\t ]+/g, ' ');
  if (!CSF_TITLE.test(text)) throw new FiscalExtractionError(422, 'CSF_DOCUMENT_NOT_RECOGNIZED', 'El archivo no se identifica como Constancia de Situación Fiscal.');
  const rfcValues = [...new Set([...text.toUpperCase().matchAll(RFC)].map((match) => match[0]))];
  const regimes = [...text.matchAll(regimeLine)].map((match) => ({ clave: match[1], descripcion: match[2].trim() }))
    .filter((item, index, all) => all.findIndex((other) => other.clave === item.clave) === index);
  const cp = lineValue(text, ['C[oó]digo Postal', 'C\\.?P\\.?']);
  const postal = cp?.match(/\b\d{5}\b/)?.[0] || null;
  const date = lineValue(text, ['Fecha de emisi[oó]n', 'Fecha de expedici[oó]n', 'Fecha de la constancia']);
  const fechaEmision = date || text.match(/(?:Lugar y Fecha de Emisi[oó]n)\s*\n\s*([^\n]+)/i)?.[1]?.trim() || null;
  const nombre = lineValue(text, ['Nombre\\s*\\(s\\)']);
  const apellidoPaterno = lineValue(text, ['Primer Apellido']);
  const apellidoMaterno = lineValue(text, ['Segundo Apellido']);
  const addressParts = {
    tipo_vialidad: lineValue(text, ['Tipo de Vialidad']),
    nombre_vialidad: lineValue(text, ['Nombre de Vialidad']),
    numero_exterior: lineValue(text, ['N[uú]mero Exterior']),
    numero_interior: lineValue(text, ['N[uú]mero Interior']),
    colonia: lineValue(text, ['Nombre de la Colonia']),
    localidad: lineValue(text, ['Nombre de la Localidad']),
    municipio: lineValue(text, ['Nombre del Municipio o Demarcaci[oó]n Territorial']),
    estado: lineValue(text, ['Nombre de la Entidad Federativa']),
  };
  const address = lineValue(text, ['Domicilio Fiscal', 'Domicilio']) ||
    (Object.values(addressParts).some(Boolean) ? Object.values(addressParts).filter(Boolean).join(', ') : null);
  const regimeSection = text.split(/(?:R[eé]gimen(?:es)?|Reg[ií]menes)\s*:/i)[1]?.split(/Obligaciones\s*:/i)[0] || '';
  const activitySection = text.split(/Actividades Econ[oó]micas\s*:/i)[1]?.split(/(?:R[eé]gimen(?:es)?|Reg[ií]menes)\s*:/i)[0] || '';
  const actividadesEconomicas = activitySection.split('\n').map((line) => line.trim()).flatMap((line) => {
    const match = line.match(/^(\d{1,3})\s+(.+?)\s+(\d{1,3})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}\/\d{2}\/\d{4}))?$/);
    if (!match || Number(match[3]) > 100) return [];
    return [{ orden: Number(match[1]), descripcion: match[2].trim(), porcentaje: Number(match[3]),
      fecha_inicio: match[4], fecha_fin: match[5] || null }];
  });
  const regimenesDocumentales = regimeSection.split('\n').map((line) => line.trim())
    .filter((line) => /^R[eé]gimen\s+(?!Fecha\b)/i.test(line) && !/^R[eé]gimen\s+Fiscal\s*:/i.test(line))
    .map((line) => {
      const dates = [...line.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)].map((match) => match[0]);
      return { descripcion: line.replace(/\s+\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}\/\d{2}\/\d{4})?\s*$/, '').trim(),
        fecha_inicio: dates[0] || null, fecha_fin: dates[1] || null, clave: null };
    });
  const razonDetectada = lineValue(text, ['Denominaci[oó]n\\s*\\/\\s*Raz[oó]n Social', 'Nombre,? denominaci[oó]n o raz[oó]n social', 'Nombre completo']) ||
    [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ') || null;
  const conflicts = rfcValues.length > 1 ? ['RFC contradictorios detectados'] : [];
  const rfc = rfcValues.length === 1 ? rfcValues[0] : null;
  const found = [rfc, razonDetectada, postal, address, fechaEmision, regimes.length || regimenesDocumentales.length,
    actividadesEconomicas.length].filter(Boolean).length;
  return { rfc, razon_social: razonDetectada, nombre, apellido_paterno: apellidoPaterno,
    apellido_materno: apellidoMaterno, curp: lineValue(text, ['CURP']), codigo_postal: postal,
    domicilio_fiscal: address, domicilio_fiscal_estructurado: addressParts,
    fecha_csf: fechaEmision, fecha_inicio_operaciones: lineValue(text, ['Fecha inicio de operaciones']),
    estatus_fiscal: lineValue(text, ['Estatus en el padr[oó]n']),
    regimenes_fiscales: regimes, regimenes_documentales: regimenesDocumentales,
    actividades_economicas: actividadesEconomicas, conflicts,
    status: conflicts.length || (regimenesDocumentales.length > 0 && regimes.length === 0) ? 'REVIEW_REQUIRED' :
      found >= 4 ? 'EXTRACTED' : found > 0 ? 'PARTIALLY_EXTRACTED' : 'EXTRACTION_FAILED',
    provenance: { rfc: rfc ? 'TEXT' : 'NOT_FOUND', razon_social: razonDetectada ? 'TEXT' : 'NOT_FOUND',
      codigo_postal: postal ? 'TEXT' : 'NOT_FOUND', domicilio_fiscal: address ? 'TEXT' : 'NOT_FOUND',
      fecha_csf: fechaEmision ? 'TEXT' : 'NOT_FOUND', regimenes_fiscales: regimes.length ? 'TEXT' : 'NOT_FOUND',
      regimenes_documentales: regimenesDocumentales.length ? 'TEXT' : 'NOT_FOUND',
      actividades_economicas: actividadesEconomicas.length ? 'TEXT' : 'NOT_FOUND' },
  } as const;
}

function detectKind(file: FiscalDocumentFile): 'PDF' | 'PNG' | 'JPEG' {
  if (file.buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
  if (file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'PNG';
  if (file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff) return 'JPEG';
  throw new FiscalExtractionError(400, 'CSF_FORMAT_UNSUPPORTED', 'Carga un PDF, PNG o JPG legible.');
}

async function ocrImages(images: Buffer[]) {
  const languageDataDir = path.join(path.dirname(require.resolve('@tesseract.js-data/spa')), '4.0.0_best_int');
  const worker = await createWorker('spa', 1, { langPath: languageDataDir, cacheMethod: 'none' });
  try {
    const pages: string[] = [];
    for (const image of images) pages.push((await worker.recognize(image)).data.text);
    return pages;
  } finally { await worker.terminate(); }
}

export class FiscalDocumentExtractionService {
  async extract(file: FiscalDocumentFile) {
    if (!file.buffer.length || file.size !== file.buffer.length || file.size > FISCAL_UPLOAD_MAX_BYTES) {
      throw new FiscalExtractionError(400, 'CSF_FILE_INVALID', 'El archivo está vacío, incompleto o excede el límite de carga fiscal.');
    }
    const kind = detectKind(file);
    let text = '';
    let pageTexts: Array<{ page: number; text: string }> = [];
    let source: 'DETERMINISTIC_PDF_TEXT' | 'LOCAL_OCR_PDF' | 'LOCAL_OCR_IMAGE';
    if (kind === 'PDF') {
      const parser = new PDFParse({ data: file.buffer });
      try {
        const parsedPdf = await parser.getText();
        text = String(parsedPdf?.text || '');
        pageTexts = parsedPdf.pages.map((page) => ({ page: page.num, text: page.text }));
        source = 'DETERMINISTIC_PDF_TEXT';
        if (!CSF_TITLE.test(text)) {
          if (parsedPdf.total > 6) throw new FiscalExtractionError(422, 'CSF_OCR_PAGE_LIMIT',
            'El PDF escaneado supera seis páginas; no se procesó parcialmente para evitar omitir regímenes.');
          const pages = (await parser.getScreenshot({ first: 6, scale: 2, imageBuffer: true, imageDataUrl: false })).pages;
          pageTexts = (await ocrImages(pages.map((page) => Buffer.from(page.data))))
            .map((pageText, index) => ({ page: index + 1, text: pageText }));
          text = pageTexts.map((page) => page.text).join('\n');
          source = 'LOCAL_OCR_PDF';
        }
      } catch (error) {
        if (error instanceof FiscalExtractionError) throw error;
        throw new FiscalExtractionError(422, 'CSF_PDF_UNREADABLE',
          'No se pudo leer el PDF. El archivo permanece disponible para revisión manual si ya fue cargado.');
      } finally { await parser.destroy(); }
    } else {
      try {
        pageTexts = [{ page: 1, text: (await ocrImages([file.buffer]))[0] }];
      } catch {
        throw new FiscalExtractionError(422, 'CSF_IMAGE_UNREADABLE',
          'No se pudo leer la imagen. Revísala manualmente o intenta otra copia.');
      }
      text = pageTexts[0].text;
      source = 'LOCAL_OCR_IMAGE';
    }
    const parsed = parseFiscalCsfText(text);
    const pageFor = (value: string | null | undefined) => value ?
      pageTexts.find((page) => page.text.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' ')))?.page || null : null;
    const source_pages = {
      rfc: pageFor(parsed.rfc), curp: pageFor(parsed.curp), nombre: pageFor(parsed.nombre),
      apellido_paterno: pageFor(parsed.apellido_paterno), apellido_materno: pageFor(parsed.apellido_materno),
      codigo_postal: pageFor(parsed.codigo_postal), fecha_csf: pageFor(parsed.fecha_csf),
      fecha_inicio_operaciones: pageFor(parsed.fecha_inicio_operaciones),
      regimenes_documentales: parsed.regimenes_documentales.map((regime) => ({
        descripcion: regime.descripcion, page: pageFor(regime.descripcion),
      })),
      actividades_economicas: parsed.actividades_economicas.map((activity) => ({
        descripcion: activity.descripcion, page: pageFor(activity.descripcion),
      })),
    };
    return { ...parsed, source, sha256: createHash('sha256').update(file.buffer).digest('hex'),
      source_pages, requiresReview: true, filename: file.originalname, size_bytes: file.size };
  }
}
