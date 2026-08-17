import type { Role } from '@prisma/client';

/**
 * Reusable projection for the effective role in the active organization.
 * User.rol remains a legacy bootstrap attribute; authorization and tenant UI
 * must use OrganizationMembership.rol.
 */
export const activeOrganizationMembershipWhere = (
  organizationId: string,
  roles?: Role[],
) => ({
  organization_id: organizationId,
  status: 'ACTIVE',
  ...(roles?.length ? { rol: { in: roles } } : {}),
});

export const organizationMembershipRoleSelect = (
  organizationId: string,
  options: { activeOnly?: boolean } = {},
) => ({
  organizationMemberships: {
    where: {
      organization_id: organizationId,
      ...(options.activeOnly === false ? {} : { status: 'ACTIVE' }),
    },
    select: { rol: true },
    take: 1,
  },
});

export const userWithEffectiveMembershipRole = (record: any) => {
  const membership = record?.organizationMemberships?.[0];
  if (!membership) return null;
  const { organizationMemberships: _memberships, ...user } = record;
  return { ...user, rol: membership.rol };
};

export const usersWithEffectiveMembershipRoles = (records: any[]) => records
  .map(userWithEffectiveMembershipRole)
  .filter(Boolean);
