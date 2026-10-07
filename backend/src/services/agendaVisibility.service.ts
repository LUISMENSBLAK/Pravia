import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type Actor = NonNullable<Request['user']>;

/** One object-level boundary for Agenda, its readers, notifications and IA. */
export function agendaReadableWhere(actor: Actor): Prisma.EventoAgendaWhereInput {
  const caseScope = actor.permissions.includes('expedientes.read')
    ? expedienteAccessWhere(actor)
    : { id: '00000000-0000-0000-0000-000000000000' };
  return {
    organization_id: actor.organizationId,
    AND: [
      {
        OR: [
          { visibilidad: 'ORGANIZATION' },
          { created_by_id: actor.id },
          { user_id: actor.id },
          { participantes: { some: { organization_id: actor.organizationId, user_id: actor.id, membership: { status: 'ACTIVE' } } } },
        ],
      },
      { OR: [{ expediente_id: null }, { expediente: caseScope }] },
    ],
  };
}

export function agendaEditableWhere(actor: Actor): Prisma.EventoAgendaWhereInput {
  return {
    organization_id: actor.organizationId,
    OR: [
      { created_by_id: actor.id },
      { user_id: actor.id },
      ...(['DIRECCION', 'ADMINISTRACION'].includes(actor.rol) ? [{ visibilidad: 'ORGANIZATION' as const }] : []),
    ],
  };
}
