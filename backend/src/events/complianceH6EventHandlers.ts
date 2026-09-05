import prisma from '../config/prisma';
import { permissionsForRole } from '../auth/permissions';
import { actorScopeForRole } from '../auth/actorContext';
import { ComplianceLegalEngineService } from '../services/complianceLegalEngine.service';
import { DomainEventBus, type DomainEvent } from './domainEventBus';

type SignedPayload = { expediente_id?: string; actor_user_id?: string };

DomainEventBus.register('ExpedienteFirmado', 'H6_MATERIALIZE_POST_SIGN_AVI', async (raw) => {
  const event = raw as DomainEvent<SignedPayload>;
  const organizationId = String(event.organization_id || '');
  const expedienteId = String(event.payload.expediente_id || event.aggregate_id || '');
  const actorUserId = String(event.payload.actor_user_id || event.actor_user_id || '');
  if (!organizationId || !expedienteId || !actorUserId) throw new Error('H6_SIGNED_EVENT_CONTEXT_REQUIRED');
  const [membership, expediente] = await Promise.all([
    prisma.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: actorUserId, status: 'ACTIVE' }, include: { user: true } }),
    prisma.expediente.findFirst({ where: { id: expedienteId, organization_id: organizationId }, select: { fecha_real_firma: true } }),
  ]);
  if (!membership || !expediente?.fecha_real_firma) throw new Error('H6_SIGNED_EVENT_CANONICAL_CONTEXT_NOT_FOUND');
  const role = membership.rol;
  await ComplianceLegalEngineService.evaluateCase({
    id: membership.user.id,
    email: membership.user.email,
    nombre: membership.user.nombre,
    apellido: membership.user.apellido,
    rol: role,
    sessionId: `EVENT:${event.event_id}`,
    organizationId,
    membershipId: membership.id,
    scope: actorScopeForRole(role),
    permissions: permissionsForRole(role),
    requiresPasswordChange: false,
  }, expedienteId, {
    idempotency_key: `H6:SIGNED:${event.event_id}`,
    fecha_juridica_confirmada: expediente.fecha_real_firma.toISOString(),
  }, event.correlation_id);
});

export {};
