import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.CONTROL_PLANE_BACKFILL_QA === '1' && (
  process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL
  || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510'
  || parsed.pathname !== '/pravia_control_plane_backfill_20261017'
  || parsed.searchParams.get('schema') !== 'pravia_os'
)) throw new Error('Backfill QA requires the dedicated isolated local PostgreSQL copy.');

const db = new PrismaClient({ datasources: { db: { url: target } } });
afterAll(async () => { await db.$disconnect(); });

describe.runIf(process.env.CONTROL_PLANE_BACKFILL_QA === '1')('Control plane · historical document backfill', () => {
  it('represents every historical document without claiming an unverified physical checksum', async () => {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_operation', 'true', true)`;
      const [documents, blobs, locations, references, usage, missingLocations, mismatches, bytes] = await Promise.all([
        tx.documento.count({ where: { organization_id: { not: null } } }),
        tx.storageBlob.count({ where: { source: 'LEGACY_DOCUMENT_BACKFILL', sha256: null } }),
        tx.storageBlobLocation.count({ where: { status: 'LEGACY_UNVERIFIED', storage_class: 'PRODUCTION' } }),
        tx.storageBlobReference.count({ where: { owner_type: 'DOCUMENTO' } }),
        tx.tenantStorageUsage.aggregate({ _sum: { production_bytes: true } }),
        tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM pravia_os.documentos document
        LEFT JOIN pravia_os.storage_blob_locations location ON location.object_key = document.storage_key
        WHERE document.organization_id IS NOT NULL AND location.id IS NULL
        `,
        tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM pravia_os.documentos document
        JOIN pravia_os.storage_blob_locations location ON location.object_key = document.storage_key
        JOIN pravia_os.storage_blobs blob ON blob.id = location.blob_id
        WHERE document.organization_id <> location.organization_id
           OR document.organization_id <> blob.organization_id
           OR document.size_bytes::bigint <> blob.size_bytes
        `,
        tx.documento.aggregate({ where: { organization_id: { not: null } }, _sum: { size_bytes: true } }),
      ]);
      return { documents, blobs, locations, references, usage, missingLocations, mismatches, bytes };
    });
    const { documents, blobs, locations, references, usage, missingLocations, mismatches, bytes } = result;
    expect(documents).toBeGreaterThan(0);
    expect({ blobs, locations, references }).toEqual({ blobs: documents, locations: documents, references: documents });
    expect(missingLocations[0].count).toBe(0n);
    expect(mismatches[0].count).toBe(0n);
    expect(usage._sum.production_bytes).toBe(BigInt(bytes._sum.size_bytes || 0));
  });
});
