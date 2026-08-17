import { AsyncLocalStorage } from 'async_hooks';
import type { Permission } from './permissions';
import type { Role } from '@prisma/client';

export type ActorScope = 'GLOBAL' | 'ASSIGNED_OBJECTS';

export type ActorContext = {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  permissions: Permission[];
  scope: ActorScope;
  sessionId: string;
  platformOperation?: string;
};

const actorStorage = new AsyncLocalStorage<ActorContext>();

export class TenantContextError extends Error {
  readonly code = 'TENANT_CONTEXT_REQUIRED';
  readonly status = 403;
  constructor(message = 'No fue posible resolver la organización activa de la sesión.') {
    super(message);
    this.name = 'TenantContextError';
  }
}

export const actorScopeForRole = (role: Role): ActorScope =>
  ['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(role) ? 'GLOBAL' : 'ASSIGNED_OBJECTS';

export const currentActorContext = () => actorStorage.getStore();

export const requireActorContext = () => {
  const context = currentActorContext();
  if (!context?.organizationId) throw new TenantContextError();
  return context;
};

export const runWithActorContext = <T>(context: ActorContext, callback: () => T): T =>
  actorStorage.run(context, callback);

export const runWithPlatformOperation = <T>(operation: string, callback: () => T): T =>
  actorStorage.run({
    userId: 'SYSTEM', organizationId: '', membershipId: '', role: 'DIRECCION', permissions: [],
    scope: 'GLOBAL', sessionId: 'SYSTEM', platformOperation: operation,
  }, callback);

export const runWithOrganizationSystemContext = <T>(organizationId: string, operation: string, callback: () => T): T => {
  if (!organizationId) throw new TenantContextError('El proceso interno no recibió una organización válida.');
  return actorStorage.run({
    userId: 'SYSTEM', organizationId, membershipId: `SYSTEM:${operation}`, role: 'DIRECCION', permissions: [],
    scope: 'GLOBAL', sessionId: `SYSTEM:${operation}`,
  }, callback);
};

export const TEST_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
export const TEST_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000011';
