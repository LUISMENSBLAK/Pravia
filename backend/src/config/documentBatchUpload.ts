import type { Request } from 'express';
import multer from 'multer';
import {
  DOCUMENT_ARCHIVE_MAX_BYTES,
  DOCUMENT_BATCH_MAX_BYTES,
  DOCUMENT_UPLOAD_MAX_BYTES,
} from './uploadLimits';

export class DocumentBatchUploadError extends Error {
  readonly code = 'UPLOAD_BATCH_TOO_LARGE';
  constructor() {
    super(`La carga conjunta supera el límite de ${DOCUMENT_BATCH_MAX_BYTES / (1024 * 1024)} MB. Divide los documentos en lotes más pequeños.`);
  }
}

// Multer memoryStorage buffers every file before domain validation. Bound the
// aggregate while chunks arrive, so a many-file request cannot accumulate more
// than the same 200 MiB ceiling enforced after archive extraction.
export function createBoundedDocumentBatchStorage(maxBatchBytes = DOCUMENT_BATCH_MAX_BYTES): multer.StorageEngine {
const receivedByRequest = new WeakMap<Request, number>();
return {
  _handleFile(req, file, callback) {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      chunks.length = 0;
      callback(error);
    };
    file.stream.on('data', (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      receivedByRequest.set(req, (receivedByRequest.get(req) || 0) + chunk.length);
      const maxFileBytes = file.fieldname === 'archive' ? DOCUMENT_ARCHIVE_MAX_BYTES : DOCUMENT_UPLOAD_MAX_BYTES;
      if (size > maxFileBytes) return fail(new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname));
      if ((receivedByRequest.get(req) || 0) > maxBatchBytes) return fail(new DocumentBatchUploadError());
      chunks.push(chunk);
    });
    file.stream.once('error', fail);
    file.stream.once('end', () => {
      if (finished) return;
      finished = true;
      callback(null, { buffer: Buffer.concat(chunks, size), size });
    });
  },
  _removeFile(_req, file, callback) {
    file.buffer = Buffer.alloc(0);
    callback(null);
  },
};
}

export const boundedDocumentBatchStorage = createBoundedDocumentBatchStorage();
