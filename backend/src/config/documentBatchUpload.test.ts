import type { Request } from 'express';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { createBoundedDocumentBatchStorage, DocumentBatchUploadError } from './documentBatchUpload';

function receive(storage: ReturnType<typeof createBoundedDocumentBatchStorage>, req: Request, fieldname: string, chunks: Buffer[]) {
  return new Promise<{ buffer: Buffer; size: number }>((resolve, reject) => {
    storage._handleFile(req, {
      fieldname, originalname: 'qa.pdf', encoding: '7bit', mimetype: 'application/pdf', stream: Readable.from(chunks),
    } as Express.Multer.File, (error, info) => {
      if (error) reject(error);
      else resolve(info as { buffer: Buffer; size: number });
    });
  });
}

describe('bounded document batch receiver', () => {
  it('retains bytes intact within the aggregate budget', async () => {
    const storage = createBoundedDocumentBatchStorage(10);
    const req = {} as Request;
    expect(await receive(storage, req, 'files', [Buffer.from('abc'), Buffer.from('de')]))
      .toEqual({ buffer: Buffer.from('abcde'), size: 5 });
    expect(await receive(storage, req, 'files', [Buffer.from('fghij')]))
      .toEqual({ buffer: Buffer.from('fghij'), size: 5 });
  });

  it('rejects an excessive multipart batch during reception', async () => {
    const storage = createBoundedDocumentBatchStorage(10);
    const req = {} as Request;
    await receive(storage, req, 'files', [Buffer.from('123456')]);
    await expect(receive(storage, req, 'files', [Buffer.from('78901')]))
      .rejects.toBeInstanceOf(DocumentBatchUploadError);
  });

  it('rejects a loose file over 50 MiB', async () => {
    const storage = createBoundedDocumentBatchStorage();
    await expect(receive(storage, {} as Request, 'files', [Buffer.alloc(50 * 1024 * 1024 + 1)]))
      .rejects.toMatchObject({ code: 'LIMIT_FILE_SIZE', field: 'files' });
  });
});
