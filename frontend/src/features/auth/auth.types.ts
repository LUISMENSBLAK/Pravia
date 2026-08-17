export type SessionUser = {
  id?: string;
  name: string;
  email?: string;
  role?: string;
  notary?: string;
  permissions?: string[];
  organization?: { id: string; name: string };
  organizations?: Array<{ id: string; name: string }>;
  membershipId?: string;
  scope?: 'GLOBAL' | 'ASSIGNED_OBJECTS';
};

export type LoginCredentials = {
  email: string;
  password: string;
  remember: boolean;
  organizationId?: string;
};

export const normalizeUser = (payload: unknown): SessionUser | null => {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = typeof root.data === 'object' && root.data ? root.data as Record<string, unknown> : root;
  const candidate = typeof root.user === 'object' && root.user
    ? root.user as Record<string, unknown>
    : typeof data.user === 'object' && data.user
      ? data.user as Record<string, unknown>
      : data;

  const email = typeof candidate.email === 'string' ? candidate.email : undefined;
  const backendName = typeof candidate.nombre === 'string'
    ? `${candidate.nombre}${typeof candidate.apellido === 'string' ? ` ${candidate.apellido}` : ''}`.trim()
    : undefined;
  const fullName = candidate.name ?? candidate.fullName ?? candidate.full_name ?? candidate.displayName ?? backendName;
  const name = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : email;
  if (!name) return null;

  const roleValue = candidate.role ?? candidate.roleName ?? candidate.tipo ?? candidate.rol;
  const notaryValue = candidate.notary ?? candidate.notaryName ?? candidate.notaria;
  const permissions = Array.isArray(candidate.permissions)
    ? candidate.permissions.filter((permission): permission is string => typeof permission === 'string')
    : undefined;

  const normalized: SessionUser = {
    id: typeof candidate.id === 'string' ? candidate.id : undefined,
    name,
    email,
    role: typeof roleValue === 'string' ? roleValue : undefined,
    notary: typeof notaryValue === 'string' ? notaryValue : undefined,
  };
  if (permissions) normalized.permissions = permissions;
  const organization = candidate.organization && typeof candidate.organization === 'object' ? candidate.organization as Record<string, unknown> : undefined;
  if (organization && typeof organization.id === 'string' && typeof organization.name === 'string') normalized.organization = { id: organization.id, name: organization.name };
  const organizations = Array.isArray(candidate.organizations) ? candidate.organizations.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    return typeof value.id === 'string' && typeof value.name === 'string' ? [{ id: value.id, name: value.name }] : [];
  }) : undefined;
  if (organizations) normalized.organizations = organizations;
  if (typeof candidate.membership_id === 'string') normalized.membershipId = candidate.membership_id;
  if (candidate.scope === 'GLOBAL' || candidate.scope === 'ASSIGNED_OBJECTS') normalized.scope = candidate.scope;
  return normalized;
};
