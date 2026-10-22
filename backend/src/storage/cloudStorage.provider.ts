import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StorageListPage, StorageObjectMetadata, StorageProvider } from './storage.types';

let supabaseInstance: SupabaseClient | null = null;
export const BUCKET_NAME = 'pravia_documentos';

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias para Storage cloud.');
    supabaseInstance = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  return supabaseInstance;
}

const safeMime = (mimeType: string) => [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/jpg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/xml', 'text/xml', 'application/zip',
].includes(mimeType) ? mimeType : 'application/octet-stream';

export class CloudStorageProvider implements StorageProvider {
  readonly id = 'supabase-cloud';
  readonly capabilities = { head: true, copy: true, list: true, resumable: false, multipart: false } as const;
  async upload(buffer: Buffer, key: string, mimeType: string) {
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).upload(key, buffer, { contentType: safeMime(mimeType), upsert: false });
    if (error) throw new Error(`Error subiendo archivo a Storage: ${error.message}`);
    return data.path;
  }
  async uploadFile(filename: string, key: string, mimeType: string) {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !serviceKey) throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias para Storage cloud.');
    const response = await fetch(`${url}/storage/v1/object/${BUCKET_NAME}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': safeMime(mimeType), 'x-upsert': 'false' },
      body: createReadStream(filename) as any,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!response.ok) throw new Error(`Error subiendo archivo a Storage: HTTP ${response.status}`);
    return key;
  }
  async download(key: string) {
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).download(key);
    if (error || !data) throw new Error(`Error descargando archivo: ${error?.message || 'sin datos'}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async downloadFile(key: string, filename: string) {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !serviceKey) throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias para Storage cloud.');
    const response = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET_NAME}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok || !response.body) throw new Error(`Error descargando archivo de Storage: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
  }
  async delete(key: string) {
    const { error } = await getSupabaseClient().storage.from(BUCKET_NAME).remove([key]);
    if (error) throw new Error(`Error eliminando archivo: ${error.message}`);
  }
  async signedUrl(key: string, expiresInSeconds: number) {
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).createSignedUrl(key, expiresInSeconds);
    if (error) throw new Error(`Error generando URL firmada: ${error.message}`);
    return data.signedUrl;
  }
  async exists(key: string) {
    const normalized = String(key || '').replace(/^\/+/, '');
    const slash = normalized.lastIndexOf('/');
    const folder = slash >= 0 ? normalized.slice(0, slash) : '';
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    if (!name) return false;
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).list(folder, { search: name, limit: 20 });
    if (error) return false;
    return Boolean(data?.some((item) => item.name === name));
  }
  async head(key: string): Promise<StorageObjectMetadata | null> {
    const normalized = String(key || '').replace(/^\/+/, '');
    const slash = normalized.lastIndexOf('/');
    const folder = slash >= 0 ? normalized.slice(0, slash) : '';
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).list(folder, { search: name, limit: 20 });
    if (error) throw new Error(`Error consultando metadata de Storage: ${error.message}`);
    const item = data?.find((candidate) => candidate.name === name);
    if (!item) return null;
    return {
      key: normalized,
      size: Number(item.metadata?.size || 0),
      updatedAt: item.updated_at ? new Date(item.updated_at) : undefined,
      etag: item.metadata?.eTag || item.metadata?.etag,
      contentType: item.metadata?.mimetype,
    };
  }
  async copy(sourceKey: string, destinationKey: string) {
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).copy(sourceKey, destinationKey);
    if (error) throw new Error(`Error copiando archivo en Storage: ${error.message}`);
    return data.path;
  }
  async list(prefix: string, cursor?: string, limit = 100): Promise<StorageListPage> {
    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const pageSize = Math.max(1, Math.min(limit, 1000));
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).list(prefix.replace(/^\/+|\/+$/g, ''), {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`Error listando Storage: ${error.message}`);
    const items = (data || []).filter((item) => item.id).map((item) => ({
      key: `${prefix.replace(/^\/+|\/+$/g, '')}/${item.name}`.replace(/^\//, ''),
      size: Number(item.metadata?.size || 0),
      updatedAt: item.updated_at ? new Date(item.updated_at) : undefined,
      etag: item.metadata?.eTag || item.metadata?.etag,
      contentType: item.metadata?.mimetype,
    }));
    return { items, nextCursor: items.length === pageSize ? String(offset + pageSize) : undefined };
  }
  async health() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 'not_configured' as const;
    try {
      const { error } = await getSupabaseClient().storage.getBucket(BUCKET_NAME);
      return error ? 'error' as const : 'ok' as const;
    } catch { return 'error' as const; }
  }
}
