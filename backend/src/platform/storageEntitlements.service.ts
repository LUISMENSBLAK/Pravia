import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError, serializeBigInts } from './platform.errors';

export class StorageEntitlementsService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async activateAddon(input: {
    organizationId: string;
    addonVersionId: string;
    quantity: number;
    idempotencyKey: string;
    at?: Date;
  }) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new PlatformDomainError('INVALID_ADDON_QUANTITY', 'La cantidad del add-on debe ser un entero positivo.', 400);
    }
    const at = input.at || new Date();
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM tenant_entitlements WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const existing = await tx.tenantStorageAddon.findUnique({
        where: { organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey } },
      });
      if (existing) return serializeBigInts(existing);
      const version = await tx.storageAddonVersion.findFirst({
        where: {
          id: input.addonVersionId,
          active: true,
          effective_from: { lte: at },
          OR: [{ effective_to: null }, { effective_to: { gt: at } }],
        },
      });
      if (!version) throw new PlatformDomainError('STORAGE_ADDON_NOT_AVAILABLE', 'El add-on no está vigente.', 404);
      if (version.monthly_price_minor === null) {
        throw new PlatformDomainError('COMMERCIAL_PRICE_NOT_CONFIGURED', 'La tarifa comercial del add-on todavía no está configurada.', 503);
      }
      const capacity = version.capacity_bytes * BigInt(input.quantity);
      const addon = await tx.tenantStorageAddon.create({ data: {
        organization_id: input.organizationId,
        addon_version_id: version.id,
        quantity: input.quantity,
        status: 'ACTIVE',
        effective_from: at,
        price_snapshot_minor: version.monthly_price_minor * BigInt(input.quantity),
        currency: version.currency,
        idempotency_key: input.idempotencyKey,
      } });
      await tx.tenantEntitlement.update({
        where: { organization_id: input.organizationId },
        data: {
          addon_storage_bytes: { increment: capacity },
          total_storage_capacity_bytes: { increment: capacity },
          version: { increment: 1 },
        },
      });
      return serializeBigInts(addon);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async scheduleCancellation(input: { organizationId: string; addonId: string; effectiveAt: Date }) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT organization_id FROM tenant_entitlements WHERE organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const addon = await tx.tenantStorageAddon.findFirst({
        where: { id: input.addonId, organization_id: input.organizationId, status: 'ACTIVE' },
      });
      if (!addon) throw new PlatformDomainError('STORAGE_ADDON_NOT_FOUND', 'El add-on activo no existe.', 404);
      const [version, entitlement, usage] = await Promise.all([
        tx.storageAddonVersion.findUniqueOrThrow({ where: { id: addon.addon_version_id } }),
        tx.tenantEntitlement.findUniqueOrThrow({ where: { organization_id: input.organizationId } }),
        tx.tenantStorageUsage.findUniqueOrThrow({ where: { organization_id: input.organizationId } }),
      ]);
      const removed = version.capacity_bytes * BigInt(addon.quantity);
      const projected = entitlement.total_storage_capacity_bytes - removed;
      const committedAndReserved = usage.production_bytes + usage.reserved_bytes;
      if (projected < committedAndReserved) {
        throw new PlatformDomainError('STORAGE_DOWNGRADE_BLOCKED', 'Libera almacenamiento antes de reducir la capacidad contratada.', 409, {
          projectedCapacityBytes: projected.toString(),
          usedAndReservedBytes: committedAndReserved.toString(),
        });
      }
      return serializeBigInts(await tx.tenantStorageAddon.update({
        where: { id: addon.id },
        data: { cancel_at_period_end: true, effective_to: input.effectiveAt },
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export const storageEntitlementsService = new StorageEntitlementsService();
