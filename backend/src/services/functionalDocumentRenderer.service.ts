import { createHash } from 'crypto';
import Docxtemplater from 'docxtemplater';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PizZip from 'pizzip';
import { downloadFile } from '../storage/storage.service';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_MIME = 'application/pdf';

export class FunctionalDocumentRenderError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

type ConfiguredVersion = {
  id: string;
  version: number;
  storage_key: string | null;
  mime_type: string | null;
  nombre_original: string | null;
  checksum_sha256: string | null;
};

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const stringify = (value: unknown) => {
  if (value == null || value === '') return '[PENDIENTE: DATO NO DISPONIBLE]';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

function mappedValues(data: Record<string, unknown>, mapping: unknown) {
  const raw = mapping && typeof mapping === 'object' && !Array.isArray(mapping) ? mapping as Record<string, unknown> : {};
  const candidate = raw.placeholders && typeof raw.placeholders === 'object' && !Array.isArray(raw.placeholders)
    ? raw.placeholders as Record<string, unknown>
    : raw;
  const values: Record<string, string> = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, stringify(value)]));
  for (const [target, source] of Object.entries(candidate)) {
    if (typeof source === 'string' && Object.prototype.hasOwnProperty.call(data, source)) values[target] = stringify(data[source]);
  }
  return values;
}

function appendDocxSummary(zip: PizZip, values: Record<string, string>) {
  const path = 'word/document.xml';
  const file = zip.file(path);
  if (!file) throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_DOCX_INVALID', 'El archivo DOCX configurado no contiene un documento válido.');
  const original = file.asText();
  const rows = Object.entries(values).map(([key, value]) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(key)}: ${xmlEscape(value)}</w:t></w:r></w:p>`).join('');
  const block = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Datos generados por PRAVIA</w:t></w:r></w:p>${rows}`;
  const section = original.lastIndexOf('<w:sectPr');
  const body = original.lastIndexOf('</w:body>');
  const index = section >= 0 ? section : body;
  if (index < 0) throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_DOCX_INVALID', 'El archivo DOCX configurado no contiene un cuerpo válido.');
  zip.file(path, `${original.slice(0, index)}${block}${original.slice(index)}`);
}

export async function renderFunctionalDocumentBuffer(
  source: Buffer,
  mimeType: string,
  data: Record<string, unknown>,
  mapping?: unknown,
) {
  const values = mappedValues(data, mapping);
  if (mimeType === DOCX_MIME || source.subarray(0, 2).toString('latin1') === 'PK') {
    const zip = new PizZip(source);
    const rawXml = zip.file('word/document.xml')?.asText() || '';
    const hasTemplateFields = rawXml.includes('{{');
    if (hasTemplateFields) {
      const document = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        nullGetter: (part) => `[PENDIENTE: ${String(part.value || 'DATO').toUpperCase()}]`,
      });
      try { document.render(values); }
      catch { throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_RENDER_FAILED', 'El formato DOCX configurado no pudo combinarse con los datos estructurados.'); }
      return { buffer: document.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer, mimeType: DOCX_MIME, extension: 'docx' as const };
    }
    appendDocxSummary(zip, values);
    return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer, mimeType: DOCX_MIME, extension: 'docx' as const };
  }
  if (mimeType === PDF_MIME || source.subarray(0, 4).toString('latin1') === '%PDF') {
    let pdf: PDFDocument;
    try { pdf = await PDFDocument.load(source); }
    catch { throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_PDF_INVALID', 'El archivo PDF configurado no pudo abrirse.'); }
    let populated = 0;
    try {
      const form = pdf.getForm();
      for (const field of form.getFields()) {
        const value = values[field.getName()];
        if (value === undefined) continue;
        const kind = field.constructor.name;
        if (kind === 'PDFTextField') (field as any).setText(value);
        else if (kind === 'PDFDropdown') (field as any).select(value);
        else if (kind === 'PDFCheckBox') value === 'true' ? (field as any).check() : (field as any).uncheck();
        else continue;
        populated += 1;
      }
      if (populated) form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
    } catch {
      // Un PDF sin AcroForm sigue siendo una fuente válida: los datos se anexan abajo.
    }
    if (!populated) {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const page = pdf.addPage([612, 792]);
      page.drawText('Datos generados por PRAVIA', { x: 48, y: 744, size: 15, font: bold, color: rgb(0.08, 0.12, 0.18) });
      let y = 716;
      for (const [key, value] of Object.entries(values)) {
        const line = `${key}: ${value}`.replace(/[^\x20-\x7EÀ-ÿ]/g, ' ');
        const chunks = line.match(/.{1,88}(?:\s|$)/g) || [line.slice(0, 88)];
        for (const chunk of chunks) {
          if (y < 48) break;
          page.drawText(chunk.trim(), { x: 48, y, size: 9, font, color: rgb(0.12, 0.14, 0.18) });
          y -= 13;
        }
        if (y < 48) break;
      }
    }
    return { buffer: Buffer.from(await pdf.save()), mimeType: PDF_MIME, extension: 'pdf' as const };
  }
  throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_TYPE_UNSUPPORTED', 'El formato configurado debe ser DOCX o PDF.');
}

export async function renderConfiguredFunctionalDocument(version: ConfiguredVersion, data: Record<string, unknown>, mapping?: unknown) {
  if (!version.storage_key) throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_FILE_MISSING', 'La versión configurada no tiene archivo vigente.');
  const source = await downloadFile(version.storage_key);
  const checksum = createHash('sha256').update(source).digest('hex');
  if (version.checksum_sha256 && checksum !== version.checksum_sha256) {
    throw new FunctionalDocumentRenderError('FUNCTIONAL_TEMPLATE_CHECKSUM_MISMATCH', 'El archivo configurado no coincide con la versión registrada.');
  }
  return { ...(await renderFunctionalDocumentBuffer(source, version.mime_type || '', data, mapping)), sourceChecksum: checksum };
}
