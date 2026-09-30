import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import {
  extraerFinanzasDesdeDocumento,
  extraerMultiplesDocumentos,
  extraerPredioDesdeDocumento,
  type DocumentoParaExtraccion,
} from '../src/services/openaiDocument.service';

type Mode = 'IDENTITY' | 'PROPERTY' | 'FINANCE';

function required(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} es obligatorio.`);
  return value;
}

function mimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  throw new Error(`Formato no compatible para extracción IA: ${extension || 'sin extensión'}.`);
}

async function main() {
  const mode = required('QA_EXTRACTION_MODE') as Mode;
  if (!['IDENTITY', 'PROPERTY', 'FINANCE'].includes(mode)) throw new Error('QA_EXTRACTION_MODE no es válido.');
  const root = await realpath(required('QA_DOSSIER_ROOT'));
  const output = path.resolve(required('QA_OUTPUT_PATH'));
  if (!output.startsWith('/private/tmp/') && !output.startsWith('/tmp/')) throw new Error('QA_OUTPUT_PATH debe estar dentro del almacenamiento temporal local.');
  const requested = JSON.parse(required('QA_DOCUMENT_PATHS_JSON'));
  if (!Array.isArray(requested) || !requested.length || requested.some((item) => typeof item !== 'string')) throw new Error('QA_DOCUMENT_PATHS_JSON debe ser una lista no vacía de rutas.');
  if (mode !== 'IDENTITY' && requested.length !== 1) throw new Error(`${mode} requiere exactamente un documento.`);

  const documents: DocumentoParaExtraccion[] = [];
  for (const requestedPath of requested) {
    const resolved = await realpath(path.resolve(requestedPath));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Documento fuera del expediente local autorizado.');
    const buffer = await readFile(resolved);
    documents.push({
      buffer,
      mimeType: mimeType(resolved),
      tipoDocumento: path.basename(resolved, path.extname(resolved)).slice(0, 120),
      documentoId: createHash('sha256').update(resolved).digest('hex').slice(0, 24),
      nombreOriginal: path.basename(resolved),
    });
  }

  const result = mode === 'IDENTITY'
    ? await extraerMultiplesDocumentos(documents)
    : mode === 'PROPERTY'
      ? await extraerPredioDesdeDocumento(documents[0])
      : await extraerFinanzasDesdeDocumento(documents[0]);
  await writeFile(output, JSON.stringify({ mode, documents: documents.map((document) => ({ id: document.documentoId, name: document.nombreOriginal, bytes: document.buffer.length })), result }, null, 2), { mode: 0o600 });
  await chmod(output, 0o600);
  const alerts = Array.isArray((result as any).alertas) ? (result as any).alertas.length : Array.isArray((result as any).faltantes) ? (result as any).faltantes.length : 0;
  const fields = Array.isArray((result as any).campos) ? (result as any).campos.length : 0;
  console.log(`EXTRACTION_PASS mode=${mode} documents=${documents.length} fields=${fields} alerts_or_missing=${alerts}`);
}

main().catch((error) => {
  console.error(`EXTRACTION_FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
