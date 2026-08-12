export type SessionUser = {
  id?: string;
  name: string;
  email?: string;
  role?: string;
  notary?: string;
  permissions?: string[];
};

export type LoginCredentials = {
  email: string;
  password: string;
  remember: boolean;
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
  return normalized;
};
