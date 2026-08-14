import 'dotenv/config';
import crypto from 'node:crypto';
import { LocalStorageProvider, verifyLocalStorageSignature } from '../src/storage/localStorage.provider';

async function main() {
  if (process.env.PRAVIA_ENV !== 'staging' || process.env.STORAGE_MODE !== 'local') {
    throw new Error('REFUSED_PRODUCTION_WRITE: esta prueba requiere staging con Storage local.');
  }
  const provider = new LocalStorageProvider();
  const key = `phase15a-staging/smoke-${crypto.randomUUID()}.txt`;
  const expected = Buffer.from('PRAVIA staging storage smoke');
  await provider.upload(expected, key);
  try {
    const downloaded = await provider.download(key);
    const signed = new URL(`http://local${await provider.signedUrl(key, 300)}`);
    const expires = Number(signed.searchParams.get('expires'));
    const signature = String(signed.searchParams.get('signature') || '');
    if (!downloaded.equals(expected)) throw new Error('El contenido descargado no coincide.');
    if (!verifyLocalStorageSignature(key, expires, signature)) throw new Error('La URL firmada no valida.');
    console.log(JSON.stringify({ ok: true, provider: provider.id, upload: true, read: true, signed_url: true, unlink: 'scheduled' }));
  } finally {
    await provider.delete(key);
  }
  let deleted = false;
  try { await provider.download(key); } catch { deleted = true; }
  if (!deleted) throw new Error('El objeto controlado no fue desvinculado/eliminado.');
  console.log(JSON.stringify({ ok: true, controlled_object_deleted: true }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
