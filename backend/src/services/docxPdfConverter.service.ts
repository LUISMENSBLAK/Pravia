import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import PizZip from 'pizzip';
import { PDFDocument } from 'pdf-lib';

const DOCX_MAX_BYTES = 50 * 1024 * 1024;
const PDF_MAX_BYTES = 80 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
const MAX_CONCURRENT = 2;
let activeConversions = 0;

export class DocumentConversionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function validateDocx(bytes: Buffer) {
  if (!bytes.length || bytes.length > DOCX_MAX_BYTES) {
    throw new DocumentConversionError('DOCX_SIZE_INVALID', 'El Word no cumple el límite de tamaño permitido.');
  }
  let zip: PizZip;
  try { zip = new PizZip(bytes); }
  catch { throw new DocumentConversionError('DOCX_INVALID', 'El archivo Word generado no es válido.'); }
  if (!zip.file('word/document.xml') || !zip.file('[Content_Types].xml')) {
    throw new DocumentConversionError('DOCX_INVALID', 'El archivo Word generado está incompleto.');
  }
  const unsafe = Object.keys(zip.files).some((name) =>
    /(^|\/)(vbaProject\.bin|activeX|embeddings)(\/|$)/i.test(name)
    || /\.docm$/i.test(name));
  if (unsafe) throw new DocumentConversionError('DOCX_ACTIVE_CONTENT', 'El formato contiene contenido activo no permitido.');
  for (const name of Object.keys(zip.files).filter((entry) => entry.endsWith('.rels'))) {
    const relationships = zip.file(name)?.asText() || '';
    if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) {
      throw new DocumentConversionError('DOCX_EXTERNAL_RELATIONSHIP', 'El formato contiene enlaces externos no permitidos.');
    }
  }
}

async function runConverter(binary: string, input: string, outputDir: string, profile: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', outputDir, input,
    ], { shell: false, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: outputDir } });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stderr.resume();
    child.once('error', (cause) => {
      clearTimeout(timer);
      reject(new DocumentConversionError('PDF_CONVERTER_UNAVAILABLE', `El conversor PDF no está disponible: ${cause.message}`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (signal === 'SIGKILL') return reject(new DocumentConversionError('PDF_CONVERSION_TIMEOUT', 'La conversión a PDF excedió el tiempo permitido.'));
      if (code !== 0) return reject(new DocumentConversionError('PDF_CONVERSION_FAILED', `El conversor PDF terminó con error ${code ?? 'desconocido'}.`));
      resolve();
    });
  });
}

/** Converts only an in-memory validated DOCX; callers never choose filesystem paths. */
export async function convertDocxToPdf(bytes: Buffer): Promise<Buffer> {
  validateDocx(bytes);
  if (activeConversions >= MAX_CONCURRENT) {
    throw new DocumentConversionError('PDF_CONVERSION_BUSY', 'Hay demasiadas conversiones simultáneas. Intenta nuevamente.');
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'pravia-docx-pdf-'));
  activeConversions += 1;
  try {
    const name = randomUUID();
    const source = path.join(dir, `${name}.docx`);
    const output = path.join(dir, `${name}.pdf`);
    const profile = path.join(dir, 'profile');
    await writeFile(source, bytes, { mode: 0o600 });
    await runConverter(process.env.PRAVIA_DOC_CONVERTER_BIN?.trim() || 'soffice', source, dir, profile);
    let pdf: Buffer;
    try { pdf = await readFile(output); }
    catch { throw new DocumentConversionError('PDF_OUTPUT_MISSING', 'El conversor no produjo el PDF esperado.'); }
    if (pdf.length < 100 || pdf.length > PDF_MAX_BYTES || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new DocumentConversionError('PDF_OUTPUT_INVALID', 'El PDF generado está vacío o no es válido.');
    }
    try {
      const parsed = await PDFDocument.load(pdf, { ignoreEncryption: false });
      if (parsed.getPageCount() < 1) throw new Error('empty');
    } catch { throw new DocumentConversionError('PDF_OUTPUT_INVALID', 'El PDF generado no contiene páginas legibles.'); }
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true });
    activeConversions -= 1;
  }
}
