import type { PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { PlatformDomainError } from './platform.errors';

export type TenantPlacementResult = {
  organizationId: string;
  shardId: string;
  shardCode: string;
  deploymentType: 'SHARED' | 'DEDICATED_DB' | 'DEDICATED_STACK';
  region: string;
  placementVersion: number;
};

/**
 * Central placement resolver. It intentionally returns a logical shard and a
 * secret reference, never credentials. Domain rows remain keyed by Organization.
 */
export class TenantDataRouter {
  constructor(private readonly db: PrismaClient = prisma) {}

  async forTenant(organizationId: string): Promise<TenantPlacementResult> {
    if (!organizationId) throw new PlatformDomainError('TENANT_REQUIRED', 'La organización es obligatoria.', 403);
    const placement = await this.db.tenantPlacement.findUnique({ where: { organization_id: organizationId } });
    if (!placement || placement.status !== 'ACTIVE') {
      throw new PlatformDomainError('TENANT_PLACEMENT_UNAVAILABLE', 'La ubicación de datos de la organización no está disponible.', 503);
    }
    const shard = await this.db.platformShard.findUnique({ where: { id: placement.shard_id } });
    if (!shard || shard.status !== 'ACTIVE') {
      throw new PlatformDomainError('SHARD_UNAVAILABLE', 'El shard asignado no está disponible.', 503);
    }
    return {
      organizationId,
      shardId: shard.id,
      shardCode: shard.code,
      deploymentType: placement.deployment_type as TenantPlacementResult['deploymentType'],
      region: placement.region,
      placementVersion: placement.placement_version,
    };
  }
}

export const tenantDataRouter = new TenantDataRouter();
