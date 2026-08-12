import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider } from './storage.types';

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
  'application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].includes(mimeType) ? mimeType : 'application/octet-stream';

export class CloudStorageProvider implements StorageProvider {
  readonly id = 'supabase-cloud';
  async upload(buffer: Buffer, key: string, mimeType: string) {
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).upload(key, buffer, { contentType: safeMime(mimeType), upsert: false });
    if (error) throw new Error(`Error subiendo archivo a Storage: ${error.message}`);
    return data.path;
  }
  async download(key: string) {
    const { data, error } = await getSupabaseClient().storage.from(BUCKET_NAME).download(key);
    if (error || !data) throw new Error(`Error descargando archivo: ${error?.message || 'sin datos'}`);
    return Buffer.from(await data.arrayBuffer());
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
  async health() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 'not_configured' as const;
    try {
      const { error } = await getSupabaseClient().storage.getBucket(BUCKET_NAME);
      return error ? 'error' as const : 'ok' as const;
    } catch { return 'error' as const; }
  }
}
