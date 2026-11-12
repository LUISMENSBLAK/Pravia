import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { validateCurp } from '../domain/mexicanIdentity';

const normalize = (value: string) => value.normalize('NFC').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();

async function recognizeImages(images: Buffer[]) {
  const languageDataDir = path.join(path.dirname(require.resolve('@tesseract.js-data/spa')), '4.0.0_best_int');
  const worker = await createWorker('spa', 1, { langPath: languageDataDir, cacheMethod: 'none' });
  try {
    const results: Array<{ page: number; text: string }> = [];
    for (const [index, image] of images.entries()) {
      results.push({ page: index + 1, text: normalize((await worker.recognize(image)).data.text) });
    }
    return results;
  } finally { await worker.terminate(); }
}

function assertBoundedImage(buffer: Buffer, mimeType: string) {
  let width = 0;
  let height = 0;
  if (mimeType === 'image/png' && buffer.length >= 33 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.readUInt32BE(8) === 13 && buffer.toString('ascii', 12, 16) === 'IHDR') {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (mimeType === 'image/jpeg' && buffer[0] === 255 && buffer[1] === 216) {
    for (let offset = 2; offset + 4 <= buffer.length;) {
      if (buffer[offset++] !== 255) break;
      while (buffer[offset] === 255) offset++;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > buffer.length) break;
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || offset + size > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        height = buffer.readUInt16BE(offset + 3);
        width = buffer.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  }
  if (!width || !height || width > 6000 || height > 6000 || width * height > 16_000_000) {
    throw new Error('IDENTITY_OCR_IMAGE_DIMENSIONS');
  }
}

async function ocrPdf(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer, maxImageSize: 16_000_000 });
  try {
    const info = await parser.getInfo();
    if (info.total > 3) throw new Error('IDENTITY_OCR_PAGE_LIMIT');
    const sizes = (await parser.getInfo({ parsePageInfo: true })).pages;
    const longestSide = Math.max(0, ...sizes.flatMap((page) => [page.width, page.height]));
    if (sizes.length !== info.total || !Number.isFinite(longestSide) || longestSide <= 0) throw new Error('IDENTITY_OCR_PAGE_SIZE');
    const scale = Math.min(2.5, 2200 / longestSide);
    const pages = (await parser.getScreenshot({ first: 3, scale, imageBuffer: true, imageDataUrl: false })).pages;
    if (!pages.length || pages.some((page) => !page.data.length)) throw new Error('IDENTITY_OCR_RENDER_FAILED');
    return await recognizeImages(pages.map((page) => Buffer.from(page.data)));
  } finally { await parser.destroy(); }
}

const validCurps = (text: string) => {
  const candidates = text.toUpperCase().match(/\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g) || [];
  return [...new Set(candidates.flatMap((candidate) => {
    try {
      const value = validateCurp(candidate);
      return value ? [value] : [];
    } catch { return []; }
  }))];
};

export type OcrIdentityDocumentResult = {
  document_id: string;
  sha256: string;
  method: 'LOCAL_OCR_PDF' | 'LOCAL_OCR_IMAGE';
  status: 'REVIEW_REQUIRED';
  recognized: boolean;
  fields: Array<{ campo: 'curp'; valor: string; page: number; fragmento: string }>;
  identificadores_ine: { cic?: string; ocr?: string };
  warnings: string[];
};

/**
 * Local OCR for a scanned identity PDF. It deliberately returns only values
 * that satisfy closed formats. A readable page with no closed-format value is
 * still a real OCR attempt, but remains REVIEW_REQUIRED and never mutates the
 * master record automatically.
 */
export async function extractIdentityPdfWithLocalOcr(buffer: Buffer, documentId: string, kind: 'CURP' | 'INE'): Promise<OcrIdentityDocumentResult> {
  if (!buffer.length || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('IDENTITY_PDF_INVALID');
  return extractIdentityFields(buffer, documentId, kind, await ocrPdf(buffer), 'LOCAL_OCR_PDF');
}

export async function extractIdentityImageWithLocalOcr(buffer: Buffer, documentId: string, kind: 'CURP' | 'INE', mimeType: string): Promise<OcrIdentityDocumentResult> {
  assertBoundedImage(buffer, mimeType);
  return extractIdentityFields(buffer, documentId, kind, await recognizeImages([buffer]), 'LOCAL_OCR_IMAGE');
}

function extractIdentityFields(buffer: Buffer, documentId: string, kind: 'CURP' | 'INE',
  pages: Array<{ page: number; text: string }>, method: OcrIdentityDocumentResult['method']): OcrIdentityDocumentResult {
  const combined = pages.map((page) => page.text).join('\n');
  const upper = combined.toUpperCase();
  const heading = upper.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const recognized = kind === 'CURP'
    ? /CLAVE\s+UNICA\s+DE\s+REGISTRO\s+DE\s+POBLACION|CURP\s+CERTIFICADA/.test(heading)
    : /INSTITUTO\s+NACIONAL\s+ELECTORAL|CREDENCIAL\s+PARA\s+VOTAR/.test(heading);
  const curps = recognized ? validCurps(upper) : [];
  // This position allows letters and digits. An OCR 0/O or 1/I cannot be
  // disambiguated by the shape validator; never select one silently.
  const ambiguousCurp = curps.length === 1 && /[01OI]/.test(curps[0][16]);
  const curp = curps.length === 1 && !ambiguousCurp ? curps[0] : undefined;
  const readUnique = (pattern: RegExp) => {
    const values = [...new Set([...upper.matchAll(pattern)].map((match) => match[1]))];
    return values.length === 1 ? values[0] : undefined;
  };
  const cic = recognized && kind === 'INE' ? readUnique(/\bCIC[ \t]*[:#-]?[ \t]*((?:IDMEX)?\d{8,12})\b/g) : undefined;
  const ocr = recognized && kind === 'INE' ? readUnique(/\bOCR[ \t]*[:#-]?[ \t]*(\d{8,18})\b/g) : undefined;
  const curpPage = curp ? pages.find((page) => page.text.toUpperCase().includes(curp))?.page : undefined;
  return {
    document_id: documentId,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    method,
    status: 'REVIEW_REQUIRED',
    recognized,
    fields: curp && curpPage ? [{ campo: 'curp', valor: curp, page: curpPage, fragmento: curp }] : [],
    identificadores_ine: { cic: cic || undefined, ocr: ocr || undefined },
    warnings: [
      'OCR_LOCAL_REQUIERE_CONFIRMACION_HUMANA',
      ...(!recognized ? ['IDENTIFICACION_NO_RECONOCIDA'] : []),
      ...(kind === 'INE' && !cic ? ['INE_CIC_NO_LEGIBLE_O_AMBIGUO'] : []),
      ...(kind === 'INE' && !ocr ? ['INE_OCR_NO_LEGIBLE_O_AMBIGUO'] : []),
      ...(!curp ? [curps.length > 1 ? 'CURP_CONTRADICTORIA'
        : ambiguousCurp ? 'CURP_CARACTER_AMBIGUO' : 'CURP_NO_LEGIBLE_O_INVALIDA'] : []),
    ],
  };
}
