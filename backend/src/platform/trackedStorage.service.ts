import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Prisma, type PrismaClient } from '@prisma/client';
import { currentActorContext, TenantContextError } from '../auth/actorContext';
import prisma from '../config/prisma';
import type { StorageProvider } from '../storage/storage.types';
import { PlatformDomainError } from './platform.errors';
import { StorageAccountingService } from './storageAccounting.service';

const ORGANIZATION_KEY = /^organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\//i;

function organizationFromKey(key: string) {
  return key.match(ORGANIZATION_KEY)?.[1]?.toLowerCase() || null;
}

function assertTenantKey(key: string) {
  const organizationId = organizationFromKey(key);
  if (key.startsWith('organizations/') && !organizationId) {
    throw new PlatformDomainError('TENANT_STORAGE_KEY_INVALID', 'La ruta de almacenamiento no contiene una organización válida.', 400);
  }
  if (!organizationId) return null;
  const actor = currentActorContext();
  if (actor?.organizationId && actor.organizationId.toLowerCase() !== organizationId) {
    throw new TenantContextError('La ruta de almacenamiento pertenece a una organización distinta de la sesión activa.');
  }
  return organizationId;
}

const stableKeyDigest = (key: string) => createHash('sha256').update(key).digest('hex');

export class TrackedStorageService {
  private readonly accounting: StorageAccountingService;

  constructor(
    private readonly provider: StorageProvider,
    private readonly db: PrismaClient = prisma,
  ) {
    this.accounting = new StorageAccountingService(db);
  }

  private async providerRecord() {
    return this.db.storageProviderRecord.upsert({
      where: { code: 'runtime-primary' },
      update: {
        provider_type: this.provider.id.toUpperCase(),
        capabilities_json: this.provider.capabilities,
        status: 'ACTIVE',
      },
      create: {
        code: 'runtime-primary',
        provider_type: this.provider.id.toUpperCase(),
        secret_ref: 'env:STORAGE_PROVIDER',
        capabilities_json: this.provider.capabilities,
        status: 'ACTIVE',
      },
    });
  }

  async upload(buffer: Buffer, key: string, mimeType: string, storageClass: 'PRODUCTION' | 'TEMPORARY' = 'PRODUCTION'): Promise<string> {
    const organizationId = assertTenantKey(key);
    // Compatibility path for explicitly non-tenant runtime assets. Domain files
    // use organizations/{uuid}/... and are always accounted below.
    if (!organizationId) return this.provider.upload(buffer, key, mimeType);

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const provider = await this.providerRecord();
    const existing = await this.db.storageBlobLocation.findUnique({
      where: { provider_id_object_key: { provider_id: provider.id, object_key: key } },
    });
    if (existing?.status === 'AVAILABLE') {
      const existingBlob = await this.db.storageBlob.findFirst({
        where: { id: existing.blob_id, organization_id: organizationId },
      });
      if (existing.organization_id !== organizationId || !existingBlob || existingBlob.sha256 !== sha256 || existingBlob.size_bytes !== BigInt(buffer.byteLength) || existing.storage_class !== storageClass) {
        throw new PlatformDomainError('STORAGE_OBJECT_IMMUTABLE', 'La ruta física ya pertenece a otro contenido inmutable.', 409);
      }
      return key;
    }
    if (existing) {
      throw new PlatformDomainError('STORAGE_OBJECT_KEY_RETIRED', 'La ruta física ya fue utilizada y no puede reciclarse.', 409);
    }

    const reservation = await this.accounting.reserveStorageCapacity({
      organizationId,
      bytes: buffer.byteLength,
      idempotencyKey: `object:${stableKeyDigest(key)}:${sha256}`,
      storageClass,
    });
    let physicalStored = false;
    let blobId: string | null = null;
    let locationId: string | null = null;
    try {
      const storedKey = await this.provider.upload(buffer, key, mimeType);
      physicalStored = true;
      if (storedKey !== key) {
        throw new PlatformDomainError('STORAGE_PROVIDER_KEY_MISMATCH', 'El proveedor devolvió una ruta distinta de la solicitada.', 502);
      }
      const metadata = await this.db.$transaction(async (tx) => {
        let blob = await tx.storageBlob.findUnique({
          where: { organization_id_sha256_size_bytes: {
            organization_id: organizationId,
            sha256,
            size_bytes: BigInt(buffer.byteLength),
          } },
        });
        if (!blob) {
          blob = await tx.storageBlob.create({ data: {
            organization_id: organizationId,
            sha256,
            size_bytes: BigInt(buffer.byteLength),
            mime_type: mimeType,
            original_filename: key.split('/').pop() || 'archivo',
            source: 'APPLICATION_UPLOAD',
            provenance_json: { provider: this.provider.id, objectKey: key },
          } });
        }
        const location = await tx.storageBlobLocation.create({ data: {
          blob_id: blob.id,
          organization_id: organizationId,
          provider_id: provider.id,
          object_key: key,
          storage_class: storageClass,
          status: 'ACCOUNTING_PENDING',
          last_verified_at: new Date(),
        } });
        return { blob, location };
      });
      blobId = metadata.blob.id;
      locationId = metadata.location.id;
      await this.accounting.commitStorageUpload({ organizationId, reservationId: reservation.id, blobId, locationId });
      return key;
    } catch (error) {
      if (physicalStored) await this.provider.delete(key).catch(() => undefined);
      if (locationId) await this.db.storageBlobLocation.deleteMany({ where: { id: locationId, organization_id: organizationId } }).catch(() => undefined);
      if (blobId) {
        const [locations, references] = await Promise.all([
          this.db.storageBlobLocation.count({ where: { blob_id: blobId } }),
          this.db.storageBlobReference.count({ where: { blob_id: blobId } }),
        ]).catch(() => [1, 1] as const);
        if (locations === 0 && references === 0) await this.db.storageBlob.deleteMany({ where: { id: blobId, organization_id: organizationId } }).catch(() => undefined);
      }
      await this.accounting.abortStorageUpload({ organizationId, reservationId: reservation.id }).catch(() => undefined);
      throw error;
    }
  }

  async uploadFile(filename: string, key: string, mimeType: string, storageClass: 'PRODUCTION' | 'TEMPORARY' = 'PRODUCTION'): Promise<string> {
    const organizationId = assertTenantKey(key);
    if (!organizationId) throw new PlatformDomainError('TENANT_STORAGE_KEY_REQUIRED', 'La carga por streaming exige una ruta con organización.', 400);
    if (!this.provider.uploadFile) throw new PlatformDomainError('STORAGE_STREAM_UPLOAD_UNAVAILABLE', 'El proveedor no admite carga por streaming.', 503);
    const file = await stat(filename);
    if (!file.isFile() || file.size <= 0) throw new PlatformDomainError('STORAGE_FILE_INVALID', 'El archivo temporal no es válido.', 400);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filename)) digest.update(chunk as Buffer);
    const sha256 = digest.digest('hex');
    const provider = await this.providerRecord();
    const existing = await this.db.storageBlobLocation.findUnique({ where: { provider_id_object_key: { provider_id: provider.id, object_key: key } } });
    if (existing?.status === 'AVAILABLE') {
      const blob = await this.db.storageBlob.findFirst({ where: { id: existing.blob_id, organization_id: organizationId } });
      if (blob?.sha256 === sha256 && blob.size_bytes === BigInt(file.size) && existing.storage_class === storageClass) return key;
      throw new PlatformDomainError('STORAGE_OBJECT_IMMUTABLE', 'La ruta física ya pertenece a otro contenido inmutable.', 409);
    }
    if (existing) throw new PlatformDomainError('STORAGE_OBJECT_KEY_RETIRED', 'La ruta física ya fue utilizada y no puede reciclarse.', 409);
    const reservation = await this.accounting.reserveStorageCapacity({
      organizationId, bytes: file.size, idempotencyKey: `object:${stableKeyDigest(key)}:${sha256}`, storageClass,
    });
    let physicalStored = false;
    let blobId: string | null = null;
    let locationId: string | null = null;
    try {
      const storedKey = await this.provider.uploadFile(filename, key, mimeType);
      physicalStored = true;
      if (storedKey !== key) throw new PlatformDomainError('STORAGE_PROVIDER_KEY_MISMATCH', 'El proveedor devolvió una ruta distinta de la solicitada.', 502);
      const metadata = await this.db.$transaction(async (tx) => {
        let blob = await tx.storageBlob.findUnique({ where: { organization_id_sha256_size_bytes: {
          organization_id: organizationId, sha256, size_bytes: BigInt(file.size),
        } } });
        if (!blob) blob = await tx.storageBlob.create({ data: {
          organization_id: organizationId, sha256, size_bytes: BigInt(file.size), mime_type: mimeType,
          original_filename: key.split('/').pop() || 'archivo', source: 'APPLICATION_UPLOAD',
          provenance_json: { provider: this.provider.id, objectKey: key, streamed: true },
        } });
        const location = await tx.storageBlobLocation.create({ data: {
          blob_id: blob.id, organization_id: organizationId, provider_id: provider.id, object_key: key,
          storage_class: storageClass, status: 'ACCOUNTING_PENDING', last_verified_at: new Date(),
        } });
        return { blob, location };
      });
      blobId = metadata.blob.id;
      locationId = metadata.location.id;
      await this.accounting.commitStorageUpload({ organizationId, reservationId: reservation.id, blobId, locationId });
      return key;
    } catch (error) {
      if (physicalStored) await this.provider.delete(key).catch(() => undefined);
      if (locationId) await this.db.storageBlobLocation.deleteMany({ where: { id: locationId, organization_id: organizationId } }).catch(() => undefined);
      if (blobId) {
        const [locations, references] = await Promise.all([
          this.db.storageBlobLocation.count({ where: { blob_id: blobId } }),
          this.db.storageBlobReference.count({ where: { blob_id: blobId } }),
        ]).catch(() => [1, 1] as const);
        if (!locations && !references) await this.db.storageBlob.deleteMany({ where: { id: blobId, organization_id: organizationId } }).catch(() => undefined);
      }
      await this.accounting.abortStorageUpload({ organizationId, reservationId: reservation.id }).catch(() => undefined);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const keyOrganizationId = assertTenantKey(key);
    const provider = await this.db.storageProviderRecord.findUnique({ where: { code: 'runtime-primary' } });
    const location = provider ? await this.db.storageBlobLocation.findUnique({
      where: { provider_id_object_key: { provider_id: provider.id, object_key: key } },
    }) : null;
    if (!location) {
      // An organization-owned historical document must never be removed without
      // an accounting location, even when its key predates organizations/{id}/.
      const document = await this.db.documento.findUnique({
        where: { storage_key: key }, select: { id: true, organization_id: true },
      });
      if (document?.organization_id || keyOrganizationId) {
        throw new PlatformDomainError('STORAGE_LOCATION_REQUIRED', 'No se puede eliminar un archivo de la organización sin trazabilidad de almacenamiento.', 409);
      }
      return this.provider.delete(key);
    }
    const organizationId = location.organization_id;
    if (keyOrganizationId && keyOrganizationId !== organizationId) throw new TenantContextError();
    const actor = currentActorContext();
    if (actor?.organizationId && actor.organizationId.toLowerCase() !== organizationId.toLowerCase()) throw new TenantContextError();
    if (location.status === 'DELETED') return;
    if (location.status !== 'AVAILABLE' && location.status !== 'LEGACY_UNVERIFIED') {
      throw new PlatformDomainError('STORAGE_DELETE_IN_PROGRESS', 'La ubicación no está disponible para eliminación.', 409);
    }
    const blob = await this.db.storageBlob.findFirstOrThrow({
      where: { id: location.blob_id, organization_id: organizationId },
    });
    // Reference creation and deletion serialize on the same location row. A
    // count followed by a separate status update allowed a new reference to
    // appear between those operations and its binary to be deleted.
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM storage_blob_locations WHERE id = ${location.id}::uuid FOR UPDATE`;
      const current = await tx.storageBlobLocation.findUniqueOrThrow({ where: { id: location.id } });
      if (current.status !== location.status) {
        throw new PlatformDomainError('STORAGE_DELETE_IN_PROGRESS', 'Otra operación está eliminando este archivo.', 409);
      }
      const [liveDocument, activeReferences] = await Promise.all([
        tx.documento.findUnique({ where: { storage_key: key }, select: { id: true } }),
        tx.storageBlobReference.count({ where: { organization_id: organizationId, blob_id: blob.id } }),
      ]);
      if (liveDocument || activeReferences > 0) {
        throw new PlatformDomainError('STORAGE_OBJECT_REFERENCED', 'El archivo sigue vinculado a un documento u otro objeto activo.', 409);
      }
      await tx.storageBlobLocation.update({ where: { id: location.id }, data: { status: 'DELETING' } });
    });
    try {
      await this.provider.delete(key);
    } catch (error) {
      await this.db.storageBlobLocation.update({ where: { id: location.id }, data: { status: location.status } }).catch(() => undefined);
      throw error;
    }

    try {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT organization_id FROM tenant_storage_usage WHERE organization_id = ${organizationId}::uuid FOR UPDATE`;
        const usage = await tx.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } });
        const temporary = location.storage_class === 'TEMPORARY';
        const currentBytes = temporary ? usage.temporary_bytes : usage.production_bytes;
        if (currentBytes < blob.size_bytes) {
          throw new PlatformDomainError('STORAGE_LEDGER_UNDERFLOW', 'El contador contractual requiere reconciliación antes de eliminar.', 409);
        }
        await tx.storageLedgerEvent.create({ data: {
          organization_id: organizationId,
          blob_id: location.blob_id,
          event_type: temporary ? 'MIGRATION_TEMP_REMOVE' : 'DELETE_COMMITTED',
          production_delta_bytes: temporary ? 0n : -blob.size_bytes,
          temporary_delta_bytes: temporary ? -blob.size_bytes : 0n,
          source_type: 'STORAGE_LOCATION',
          source_id: location.id,
          idempotency_key: `delete:${location.id}`,
        } });
        await tx.tenantStorageUsage.update({
          where: { organization_id: organizationId },
          data: temporary
            ? { temporary_bytes: { decrement: blob.size_bytes }, version: { increment: 1 } }
            : { production_bytes: { decrement: blob.size_bytes }, version: { increment: 1 } },
        });
        await tx.storageBlobLocation.update({
          where: { id: location.id },
          data: { status: 'DELETED', updated_at: new Date() },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.accounting.refreshStorageAlerts(organizationId);
    } catch (error) {
      // The object is already absent. Keep a recoverable state so reconciliation
      // can finalize accounting instead of pretending the deletion succeeded.
      await this.db.storageBlobLocation.updateMany({
        where: { id: location.id, organization_id: organizationId },
        data: { status: 'DELETE_ACCOUNTING_PENDING' },
      }).catch(() => undefined);
      throw error;
    }
  }

  async linkReference(input: {
    key: string;
    ownerType: string;
    ownerId: string;
    documentVersionId?: string;
  }) {
    const organizationId = assertTenantKey(input.key);
    if (!organizationId) throw new PlatformDomainError('TENANT_STORAGE_KEY_REQUIRED', 'La referencia exige una ruta con organización.', 400);
    const provider = await this.db.storageProviderRecord.findUniqueOrThrow({ where: { code: 'runtime-primary' } });
    return this.db.$transaction(async (tx) => {
      const location = await tx.storageBlobLocation.findUnique({
        where: { provider_id_object_key: { provider_id: provider.id, object_key: input.key } },
      });
      if (!location || location.organization_id !== organizationId) {
        throw new PlatformDomainError('STORAGE_LOCATION_NOT_AVAILABLE', 'No existe una ubicación física disponible para vincular.', 409);
      }
      await tx.$queryRaw`SELECT id FROM storage_blob_locations WHERE id = ${location.id}::uuid FOR UPDATE`;
      const current = await tx.storageBlobLocation.findUniqueOrThrow({ where: { id: location.id } });
      if (current.status !== 'AVAILABLE') {
        throw new PlatformDomainError('STORAGE_LOCATION_NOT_AVAILABLE', 'No existe una ubicación física disponible para vincular.', 409);
      }
      return tx.storageBlobReference.upsert({
        where: { organization_id_owner_type_owner_id_blob_id: {
          organization_id: organizationId,
          owner_type: input.ownerType,
          owner_id: input.ownerId,
          blob_id: current.blob_id,
        } },
        update: { document_version_id: input.documentVersionId },
        create: {
          organization_id: organizationId,
          blob_id: current.blob_id,
          owner_type: input.ownerType,
          owner_id: input.ownerId,
          document_version_id: input.documentVersionId,
        },
      });
    });
  }
}
