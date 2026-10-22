import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL || '';
const directUrl = process.env.DIRECT_URL || '';
const storageUrl = process.env.SUPABASE_URL || '';
const storageKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const database = new URL(databaseUrl || 'postgresql://invalid.invalid/blocked');
const storage = new URL(storageUrl || 'https://invalid.invalid');

if (process.env.LEGACY_PHYSICAL_AUDIT !== '1'
  || process.env.NODE_ENV !== 'test'
  || databaseUrl !== directUrl
  || database.hostname !== '127.0.0.1'
  || database.port !== '55510'
  || database.pathname !== '/pravia_control_plane_backfill_20261017'
  || database.searchParams.get('schema') !== 'pravia_os'
  || !storage.hostname.endsWith('.supabase.co')
  || !storageKey) {
  throw new Error('Physical audit requires the isolated local backfill DB and an explicitly configured read-only Storage source.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

type Result = {
  documentId: string;
  found: boolean;
  readable: boolean;
  logicalAssociation: boolean;
  tenantMatch: boolean;
  sizeMatch: boolean;
  currentSha256?: string;
  persistedShaMatch?: boolean;
  historicalShaAvailable: boolean;
  reason?: string;
};

async function main() {
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.platform_operation', 'true', true)`;
    const [documents, blobs, locations, references] = await Promise.all([
      tx.documento.findMany({ where: { organization_id: { not: null } }, select: {
        id: true, organization_id: true, storage_key: true, size_bytes: true, checksum_sha256: true,
      }, orderBy: { id: 'asc' } }),
      tx.storageBlob.findMany({ where: { source: 'LEGACY_DOCUMENT_BACKFILL' }, select: {
        id: true, organization_id: true, sha256: true, size_bytes: true,
      } }),
      tx.storageBlobLocation.findMany({ where: { status: 'LEGACY_UNVERIFIED' }, select: {
        id: true, blob_id: true, organization_id: true, object_key: true,
      } }),
      tx.storageBlobReference.findMany({ where: { owner_type: 'DOCUMENTO' }, select: {
        organization_id: true, blob_id: true, owner_id: true,
      } }),
    ]);
    return { documents, blobs, locations, references };
  });

  if (rows.documents.length !== 83 || rows.blobs.length !== 83
    || rows.locations.length !== 83 || rows.references.length !== 83) {
    throw new Error('The local backfill no longer contains exactly 83 documents, blobs, locations and references.');
  }

  const blobs = new Map(rows.blobs.map((blob) => [blob.id, blob]));
  const locations = new Map(rows.locations.map((location) => [location.object_key, location]));
  const references = new Map(rows.references.map((reference) => [reference.owner_id, reference]));
  const results: Result[] = [];

  if (process.env.LEGACY_PHYSICAL_AUDIT_ALTERNATE_BUCKET === 'documents') {
    const requested = new Set((process.env.LEGACY_PHYSICAL_AUDIT_ONLY_IDS || '').split(',').filter(Boolean));
    if (requested.size !== 26 || [...requested].some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new Error('Alternate-bucket audit requires the exact 26 previously missing document IDs.');
    }
    let readable = 0;
    let sizeMatched = 0;
    let trustedShaMatched = 0;
    for (const document of rows.documents.filter((item) => requested.has(item.id))) {
      const objectPath = document.storage_key.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${storage.origin}/storage/v1/object/authenticated/documents/${objectPath}`, {
        method: 'GET', headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` }, redirect: 'error',
      });
      if (!response.ok || !response.body) {
        process.stdout.write(`ALTERNATE ${JSON.stringify({ documentId: document.id, readable: false, httpStatus: response.status })}\n`);
        await response.body?.cancel();
        continue;
      }
      const digest = createHash('sha256');
      let size = 0;
      for await (const chunk of Readable.fromWeb(response.body as any)) {
        const bytes = Buffer.from(chunk); size += bytes.length; digest.update(bytes);
      }
      const sha256 = digest.digest('hex');
      const sizeMatch = size === document.size_bytes;
      const storedShaMatch = document.checksum_sha256 ? document.checksum_sha256 === sha256 : null;
      readable += 1;
      if (sizeMatch) sizeMatched += 1;
      if (storedShaMatch) trustedShaMatched += 1;
      process.stdout.write(`ALTERNATE ${JSON.stringify({ documentId: document.id, readable: true,
        sizeMatch, storedShaMatch, currentSha256: sha256 })}\n`);
    }
    process.stdout.write(`ALTERNATE_SUMMARY ${JSON.stringify({ checked: requested.size, readable, sizeMatched, trustedShaMatched })}\n`);
    if (readable !== requested.size || sizeMatched !== requested.size) process.exitCode = 1;
    return;
  }

  if (process.env.LEGACY_PHYSICAL_AUDIT_DIAGNOSE === '1') {
    const statuses: Record<string, number> = {};
    for (const document of rows.documents.filter((item) => !process.env.LEGACY_PHYSICAL_AUDIT_ONLY_ID
      || item.id === process.env.LEGACY_PHYSICAL_AUDIT_ONLY_ID)) {
      const objectPath = document.storage_key.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${storage.origin}/storage/v1/object/authenticated/pravia_documentos/${objectPath}`, {
        method: 'GET', headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` }, redirect: 'error',
      });
      statuses[String(response.status)] = (statuses[String(response.status)] || 0) + 1;
      if (!response.ok) {
        const body = await response.text();
        const classification = /object not found|not found|does not exist/i.test(body) ? 'OBJECT_NOT_FOUND' : 'OTHER_STORAGE_ERROR';
        process.stdout.write(`UNREADABLE ${JSON.stringify({ documentId: document.id, httpStatus: response.status, classification })}\n`);
      }
      if (response.ok) await response.body?.cancel();
    }
    process.stdout.write(`HTTP_STATUS_COUNTS ${JSON.stringify(statuses)}\n`);
    return;
  }

  for (const document of rows.documents) {
    const location = locations.get(document.storage_key);
    const blob = location && blobs.get(location.blob_id);
    const reference = references.get(document.id);
    const logicalAssociation = Boolean(location && blob && reference && reference.blob_id === blob.id);
    const tenantMatch = Boolean(document.organization_id && location && blob && reference
      && document.organization_id === location.organization_id
      && document.organization_id === blob.organization_id
      && document.organization_id === reference.organization_id);
    const historicalShaAvailable = Boolean(document.checksum_sha256 || blob?.sha256);
    const result: Result = { documentId: document.id, found: false, readable: false,
      logicalAssociation, tenantMatch, sizeMatch: false, historicalShaAvailable };
    if (!location || !blob) {
      result.reason = 'MISSING_LOGICAL_LOCATION';
      results.push(result);
      if (process.env.LEGACY_PHYSICAL_AUDIT_QUIET !== '1') process.stdout.write(`${JSON.stringify(result)}\n`);
      continue;
    }

    const objectPath = location.object_key.split('/').map(encodeURIComponent).join('/');
    const url = `${storage.origin}/storage/v1/object/authenticated/pravia_documentos/${objectPath}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` },
        redirect: 'error',
      });
      // Supabase Storage also reports a missing object as HTTP 400 on some
      // authenticated legacy paths. Only a successful read proves existence.
      result.found = response.ok;
      if (!response.ok || !response.body) {
        const body = await response.text();
        result.reason = /object not found|not found|does not exist/i.test(body)
          ? 'OBJECT_NOT_FOUND' : `STORAGE_HTTP_${response.status}`;
        results.push(result);
        if (process.env.LEGACY_PHYSICAL_AUDIT_QUIET !== '1') process.stdout.write(`${JSON.stringify(result)}\n`);
        continue;
      }
      const digest = createHash('sha256');
      let size = 0;
      for await (const chunk of Readable.fromWeb(response.body as any)) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        digest.update(bytes);
      }
      const currentSha256 = digest.digest('hex');
      result.readable = true;
      result.currentSha256 = currentSha256;
      result.sizeMatch = size === document.size_bytes && BigInt(size) === blob.size_bytes;
      if (historicalShaAvailable) {
        result.persistedShaMatch = (!document.checksum_sha256 || document.checksum_sha256 === currentSha256)
          && (!blob.sha256 || blob.sha256 === currentSha256);
      }
    } catch (error) {
      result.reason = error instanceof Error ? error.name : 'STORAGE_READ_FAILURE';
    }
    results.push(result);
    if (process.env.LEGACY_PHYSICAL_AUDIT_QUIET !== '1') process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  const count = (predicate: (result: Result) => boolean) => results.filter(predicate).length;
  if (process.env.LEGACY_PHYSICAL_AUDIT_LIST_METADATA === '1') {
    // Supabase Storage's list API uses POST but is a SELECT-only operation.
    // Never print object names, paths or provider response bodies.
    const missing = new Set(results.filter((result) => !result.readable).map((result) => result.documentId));
    if (missing.size !== 26) throw new Error('Metadata inspection requires the same exact 26 unreadable documents.');
    for (const bucket of ['pravia_documentos', 'documents']) {
      let listedParents = 0;
      let nonemptyParents = 0;
      let exactMetadataMatches = 0;
      let listErrors = 0;
      for (const document of rows.documents.filter((item) => missing.has(item.id))) {
        const separator = document.storage_key.lastIndexOf('/');
        const parent = separator < 0 ? '' : document.storage_key.slice(0, separator);
        const basename = document.storage_key.slice(separator + 1);
        let offset = 0;
        let parentHasObjects = false;
        let exactFound = false;
        let success = true;
        do {
          const response = await fetch(`${storage.origin}/storage/v1/object/list/${bucket}`, {
            method: 'POST', headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}`,
              'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix: parent, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
            redirect: 'error',
          });
          if (!response.ok) { success = false; await response.body?.cancel(); break; }
          const entries = await response.json() as Array<{ name?: string }>;
          if (!Array.isArray(entries)) { success = false; break; }
          if (entries.length) parentHasObjects = true;
          if (entries.some((entry) => entry.name === basename)) exactFound = true;
          offset += entries.length;
          if (exactFound || entries.length < 1000) break;
        } while (offset <= 100_000);
        if (!success) listErrors += 1;
        else { listedParents += 1; if (parentHasObjects) nonemptyParents += 1;
          if (exactFound) exactMetadataMatches += 1; }
      }
      process.stdout.write(`METADATA_LIST ${JSON.stringify({ bucket, checked: missing.size, listedParents,
        nonemptyParents, exactMetadataMatches, listErrors })}\n`);
    }
  }
  const summary = {
    expected: 83,
    checked: results.length,
    found: count((result) => result.found),
    readable: count((result) => result.readable),
    sizeMatched: count((result) => result.sizeMatch),
    historicalShaAvailable: count((result) => result.historicalShaAvailable),
    persistedShaMatched: count((result) => result.persistedShaMatch === true),
    historicalShaUnavailable: count((result) => !result.historicalShaAvailable),
    tenantMismatches: count((result) => !result.tenantMatch),
    missingLogicalAssociations: count((result) => !result.logicalAssociation),
    missingPhysical: count((result) => !result.found),
    unreadable: count((result) => !result.readable),
    unexpectedSizeMismatch: count((result) => result.readable && !result.sizeMatch),
    unexpectedHashMismatch: count((result) => result.persistedShaMatch === false),
    objectNotFound: count((result) => result.reason === 'OBJECT_NOT_FOUND'),
  };
  process.stdout.write(`UNREADABLE_IDS ${JSON.stringify(results.filter((result) => !result.readable).map((result) => result.documentId))}\n`);
  process.stdout.write(`SUMMARY ${JSON.stringify(summary)}\n`);
  if (summary.checked !== 83 || summary.missingPhysical || summary.unreadable
    || summary.unexpectedSizeMismatch || summary.unexpectedHashMismatch
    || summary.tenantMismatches || summary.missingLogicalAssociations) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'AUDIT_FAILURE'}\n`); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
