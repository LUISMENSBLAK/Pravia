import prisma from '../config/prisma';
import { BeneficialControllerService } from '../services/beneficialController.service';
import { DomainEventBus, type DomainEvent } from './domainEventBus';

type SignedPayload = { expediente_id?: string; actor_user_id?: string };

DomainEventBus.register('ExpedienteFirmado', 'H4_MARK_SOCIETY_CONSTITUTED', async (raw) => {
  const event = raw as DomainEvent<SignedPayload>;
  const expedienteId = String(event.payload.expediente_id || event.aggregate_id || '');
  const actorUserId = String(event.payload.actor_user_id || event.actor_user_id || '');
  if (!event.organization_id || !expedienteId || !actorUserId) throw new Error('H4_SIGNED_EVENT_CONTEXT_REQUIRED');
  await prisma.$transaction((tx) => BeneficialControllerService.markSocietyConstitutedTx(tx, {
    organizationId: event.organization_id,
    expedienteId,
    actorUserId,
  }));
});

export {};
