import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export const INCLUDED_STORAGE_BYTES = 50n * 1024n * 1024n * 1024n;
const ACTIVE_RESERVATION = 'RESERVED';
const STORAGE_ALERT_THRESHOLDS = [70, 80, 90, 95, 100] as const;

type StorageClass = 'PRODUCTION' | 'TEMPORARY';

const positiveBytes = (bytes: bigint | number | string) => {
  const parsed = BigInt(bytes);
  if (parsed <= 0n) throw new PlatformDomainError('INVALID_STORAGE_SIZE', 'El tamaño debe ser mayor que cero.', 400);
  return parsed;
};

export class StorageAccountingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async syncAlerts(tx: Prisma.TransactionClient, organizationId: string) {
    const [entitlement, usage] = await Promise.all([
      tx.tenantEntitlement.findUniqueOrThrow({ where: { organization_id: organizationId } }),
      tx.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: organizationId } }),
    ]);
    const used = usage.production_bytes + usage.reserved_bytes;
    const basisPoints = entitlement.total_storage_capacity_bytes === 0n
      ? 10_000
      : Number((used * 10_000n) / entitlement.total_storage_capacity_bytes);
    const now = new Date();
    for (const threshold of STORAGE_ALERT_THRESHOLDS) {
      if (basisPoints >= threshold * 100) {
        const key = {
            organization_id: organizationId,
            resource_type: 'STORAGE',
            threshold,
        };
        const existing = await tx.usageAlertState.findUnique({
          where: { organization_id_resource_type_threshold: key },
        });
        if (!existing) await tx.usageAlertState.create({ data: { ...key, crossed_at: now } });
        else if (existing.resolved_at) await tx.usageAlertState.update({
          where: { id: existing.id },
          data: { crossed_at: now, resolved_at: null },
        });
      } else {
        await tx.usageAlertState.updateMany({
          where: { organization_id: organizationId, resource_type: 'STORAGE', threshold, resolved_at: null },
          data: { resolved_at: now },
        });
      }
    }
    return basisPoints;
  }

  async refreshStorageAlerts(organizationId: string) {
    return this.db.$transaction((tx) => this.syncAlerts(tx, organizationId));
  }

  private async serializable<T>(callback: Parameters<PrismaClient['$transaction']>[0] extends (tx: infer U) => unknown ? (tx: U) => Promise<T> : never): Promise<T> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.db.$transaction(callback as never, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) as T;
      } catch (error) {
        const sqlState = error instanceof Prisma.PrismaClientKnownRequestError
          ? String((error.meta as { code?: unknown } | undefined)?.code || '')
          : '';
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(sqlState)));
        if (!retryable || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
    throw new PlatformDomainError('STORAGE_CONCURRENCY_RETRY_EXHAUSTED', 'No fue posible reservar almacenamiento de forma segura.', 503);
  }

  async getState(organizationId: string) {
    const [entitlement, usage, addons, alerts] = await Promise.all([
      this.db.tenantEntitlement.findUnique({ where: { organization_id: organizationId } }),
      this.db.tenantStorageUsage.findUnique({ where: { organization_id: organizationId } }),
      this.db.tenantStorageAddon.findMany({ where: { organization_id: organizationId, status: 'ACTIVE' } }),
      this.db.usageAlertState.findMany({
        where: { organization_id: organizationId, resource_type: 'STORAGE', resolved_at: null },
        orderBy: { threshold: 'asc' },
      }),
    ]);
    if (!entitlement || !usage) throw new PlatformDomainError('STORAGE_ACCOUNTING_NOT_INITIALIZED', 'El consumo de almacenamiento no está inicializado.', 503);
    const available = entitlement.total_storage_capacity_bytes - usage.production_bytes - usage.reserved_bytes;
    return serializeBigInts({
      includedBytes: entitlement.included_storage_bytes,
      addonBytes: entitlement.addon_storage_bytes,
      capacityBytes: entitlement.total_storage_capacity_bytes,
      productionBytes: usage.production_bytes,
      temporaryBytes: usage.temporary_bytes,
      reservedBytes: usage.reserved_bytes,
      availableBytes: available > 0n ? available : 0n,
      utilizationBasisPoints: entitlement.total_storage_capacity_bytes === 0n
        ? 0
        : Number(((usage.production_bytes + usage.reserved_bytes) * 10_000n) / entitlement.total_storage_capacity_bytes),
      addons,
      alerts,
    });
  }

  async reserveStorageCapacity(input: {
    organizationId: string;
    bytes: bigint | number | string;
    idempotencyKey: string;
    storageClass?: StorageClass;
    ttlSeconds?: number;
  }) {
    const bytes = positiveBytes(input.bytes);
    const storageClass = input.storageClass || 'PRODUCTION';
    const expiresAt = new Date(Date.now() + Math.max(60, Math.min(input.ttlSeconds || 900, 86_400)) * 1000);
    if (!input.idempotencyKey) throw new PlatformDomainError('IDEMPOTENCY_KEY_REQUIRED', 'La clave de idempotencia es obligatoria.', 400);

    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM tenant_storage_usage WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const existing = await tx.storageReservation.findUnique({
        where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
      });
      if (existing) {
        if (existing.bytes !== bytes || existing.storage_class !== storageClass) {
          throw new PlatformDomainError('IDEMPOTENCY_CONFLICT', 'La reserva existente no coincide con la solicitud.', 409);
        }
        return serializeBigInts(existing);
      }

      const [entitlement, usage] = await Promise.all([
        tx.tenantEntitlement.findUnique({ where: { organization_id: input.organizationId } }),
        tx.tenantStorageUsage.findUnique({ where: { organization_id: input.organizationId } }),
      ]);
      if (!entitlement || !usage) throw new PlatformDomainError('STORAGE_ACCOUNTING_NOT_INITIALIZED', 'El consumo de almacenamiento no está inicializado.', 503);
      if (storageClass === 'PRODUCTION') {
        const projected = usage.production_bytes + usage.reserved_bytes + bytes;
        if (projected > entitlement.total_storage_capacity_bytes) {
          throw new PlatformDomainError('STORAGE_QUOTA_EXCEEDED', 'La carga supera la capacidad de almacenamiento disponible.', 409, {
            capacityBytes: entitlement.total_storage_capacity_bytes.toString(),
            productionBytes: usage.production_bytes.toString(),
            reservedBytes: usage.reserved_bytes.toString(),
            incomingBytes: bytes.toString(),
          });
        }
      }

      const reservation = await tx.storageReservation.create({ data: {
        organization_id: input.organizationId,
        bytes,
        status: ACTIVE_RESERVATION,
        storage_class: storageClass,
        idempotency_key: input.idempotencyKey,
        expires_at: expiresAt,
      } });
      const reservedDelta = storageClass === 'PRODUCTION' ? bytes : 0n;
      if (reservedDelta > 0n) {
        await tx.tenantStorageUsage.update({
          where: { organization_id: input.organizationId },
          data: { reserved_bytes: { increment: reservedDelta }, version: { increment: 1 } },
        });
      }
      await tx.storageLedgerEvent.create({ data: {
        organization_id: input.organizationId,
        event_type: 'UPLOAD_RESERVED',
        reserved_delta_bytes: reservedDelta,
        source_type: 'STORAGE_RESERVATION',
        source_id: reservation.id,
        idempotency_key: `reserve:${input.idempotencyKey}`,
      } });
      await this.syncAlerts(tx, input.organizationId);
      return serializeBigInts(reservation);
    });
  }

  async commitStorageUpload(input: {
    organizationId: string;
    reservationId: string;
    blobId?: string;
    locationId?: string;
  }) {
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM tenant_storage_usage WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const reservation = await tx.storageReservation.findFirst({ where: { id: input.reservationId, organization_id: input.organizationId } });
      if (!reservation) throw new PlatformDomainError('STORAGE_RESERVATION_NOT_FOUND', 'La reserva no existe.', 404);
      if (reservation.status === 'COMMITTED') return serializeBigInts(reservation);
      if (reservation.status !== ACTIVE_RESERVATION) throw new PlatformDomainError('STORAGE_RESERVATION_NOT_ACTIVE', 'La reserva ya no está activa.');

      const production = reservation.storage_class === 'PRODUCTION' ? reservation.bytes : 0n;
      const temporary = reservation.storage_class === 'TEMPORARY' ? reservation.bytes : 0n;
      const reserved = reservation.storage_class === 'PRODUCTION' ? reservation.bytes : 0n;
      await tx.tenantStorageUsage.update({
        where: { organization_id: input.organizationId },
        data: {
          production_bytes: { increment: production },
          temporary_bytes: { increment: temporary },
          reserved_bytes: { decrement: reserved },
          version: { increment: 1 },
        },
      });
      await tx.storageLedgerEvent.create({ data: {
        organization_id: input.organizationId,
        blob_id: input.blobId,
        event_type: reservation.storage_class === 'TEMPORARY' ? 'MIGRATION_TEMP_ADD' : 'UPLOAD_COMMITTED',
        production_delta_bytes: production,
        temporary_delta_bytes: temporary,
        reserved_delta_bytes: -reserved,
        source_type: 'STORAGE_RESERVATION',
        source_id: reservation.id,
        idempotency_key: `commit:${reservation.id}`,
      } });
      const committed = await tx.storageReservation.update({
        where: { id: reservation.id },
        data: { status: 'COMMITTED', committed_at: new Date() },
      });
      if (input.locationId) {
        const finalized = await tx.storageBlobLocation.updateMany({
          where: {
            id: input.locationId,
            organization_id: input.organizationId,
            blob_id: input.blobId,
            status: 'ACCOUNTING_PENDING',
          },
          data: { status: 'AVAILABLE' },
        });
        if (finalized.count !== 1) {
          throw new PlatformDomainError('STORAGE_LOCATION_NOT_PENDING', 'La ubicación física no corresponde a esta reserva.', 409);
        }
      }
      await this.syncAlerts(tx, input.organizationId);
      return serializeBigInts(committed);
    });
  }

  async abortStorageUpload(input: { organizationId: string; reservationId: string }) {
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM tenant_storage_usage WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const reservation = await tx.storageReservation.findFirst({ where: { id: input.reservationId, organization_id: input.organizationId } });
      if (!reservation) throw new PlatformDomainError('STORAGE_RESERVATION_NOT_FOUND', 'La reserva no existe.', 404);
      if (reservation.status === 'ABORTED') return serializeBigInts(reservation);
      if (reservation.status !== ACTIVE_RESERVATION) throw new PlatformDomainError('STORAGE_RESERVATION_NOT_ACTIVE', 'La reserva ya no está activa.');
      const reserved = reservation.storage_class === 'PRODUCTION' ? reservation.bytes : 0n;
      if (reserved > 0n) {
        await tx.tenantStorageUsage.update({
          where: { organization_id: input.organizationId },
          data: { reserved_bytes: { decrement: reserved }, version: { increment: 1 } },
        });
      }
      await tx.storageLedgerEvent.create({ data: {
        organization_id: input.organizationId,
        event_type: 'UPLOAD_ABORTED',
        reserved_delta_bytes: -reserved,
        source_type: 'STORAGE_RESERVATION',
        source_id: reservation.id,
        idempotency_key: `abort:${reservation.id}`,
      } });
      const aborted = await tx.storageReservation.update({ where: { id: reservation.id }, data: { status: 'ABORTED', released_at: new Date() } });
      await this.syncAlerts(tx, input.organizationId);
      return serializeBigInts(aborted);
    });
  }

  async reconcileStorageUsage(organizationId: string, providerId: string) {
    return this.db.$transaction(async (tx) => {
      const [usage, sums] = await Promise.all([
        tx.tenantStorageUsage.findUnique({ where: { organization_id: organizationId } }),
        tx.storageLedgerEvent.aggregate({
          where: { organization_id: organizationId },
          _sum: { production_delta_bytes: true, temporary_delta_bytes: true, reserved_delta_bytes: true },
        }),
      ]);
      if (!usage) throw new PlatformDomainError('STORAGE_ACCOUNTING_NOT_INITIALIZED', 'El consumo de almacenamiento no está inicializado.', 503);
      const expectedProduction = sums._sum.production_delta_bytes || 0n;
      const expectedTemporary = sums._sum.temporary_delta_bytes || 0n;
      const expectedReserved = sums._sum.reserved_delta_bytes || 0n;
      const difference = (usage.production_bytes - expectedProduction) + (usage.temporary_bytes - expectedTemporary) + (usage.reserved_bytes - expectedReserved);
      const run = await tx.storageReconciliationRun.create({ data: {
        organization_id: organizationId,
        provider_id: providerId,
        started_at: new Date(),
        finished_at: new Date(),
        expected_bytes: expectedProduction + expectedTemporary,
        physical_bytes: usage.production_bytes + usage.temporary_bytes,
        difference_bytes: difference,
        status: difference === 0n ? 'MATCHED' : 'DISCREPANCY',
        details: {
          expectedReserved: expectedReserved.toString(),
          actualReserved: usage.reserved_bytes.toString(),
        },
      } });
      return serializeBigInts(run);
    });
  }
}

export const storageAccountingService = new StorageAccountingService();
