import type { Request, Response } from 'express';
import path from 'path';
import { resolveRuntimeConfig } from '../config/runtime';
import { downloadFile } from '../storage/storage.service';
import { verifyLocalStorageSignature } from '../storage/localStorage.provider';

const mimeByExtension: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export class LocalStorageController {
  static async serve(req: Request, res: Response) {
    const config = resolveRuntimeConfig();
    if (config.storage.primary !== 'local') return res.status(404).json({ code: 'LOCAL_STORAGE_DISABLED', error: 'Almacenamiento local no habilitado.' });
    const key = String(req.query.key || '');
    const expires = Number(req.query.expires);
    const signature = String(req.query.signature || '');
    if (!verifyLocalStorageSignature(key, expires, signature)) return res.status(403).json({ code: 'SIGNED_URL_INVALID', error: 'El enlace es inválido o expiró.' });
    try {
      const buffer = await downloadFile(key);
      const fileName = path.basename(key).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const mime = mimeByExtension[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', `private, max-age=${Math.max(0, expires - Math.floor(Date.now() / 1000))}`);
      return res.send(buffer);
    } catch {
      return res.status(404).json({ code: 'LOCAL_FILE_NOT_FOUND', error: 'Archivo no encontrado.' });
    }
  }
}
