import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { agendaReadableWhere } from './agendaVisibility.service';
import { cotizacionObjectWhere } from './objectAccess.service';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';

type Actor = NonNullable<Request['user']>;

/** Reuse the source modules' object boundaries before computing any Mi Día metric. */
export function miDiaDashboardScope(actor: Actor, requestedUserId?: unknown, requestedScope?: MiDiaScope) {
  const own = requestedScope === 'OWN' || actor.scope !== 'GLOBAL';
  const selectedUserId = !own && typeof requestedUserId === 'string' && requestedUserId !== 'TODOS'
    ? requestedUserId : null;
  const ownCaseWhere: Prisma.ExpedienteWhereInput = {
    OR: [{ abogado_id: actor.id }, { creador_id: actor.id }, { gestor_id: actor.id }],
  };
  const caseWhere: Prisma.ExpedienteWhereInput = {
    organization_id: actor.organizationId, archived_at: null,
    ...(own && actor.scope === 'GLOBAL' ? ownCaseWhere : expedienteAccessWhere(actor)),
    ...(selectedUserId ? { OR: [{ abogado_id: selectedUserId }, { gestor_id: selectedUserId }] } : {}),
  };
  // FINANCIERO may read tenant financial records without acquiring general expediente.read.
  const financialCaseWhere: Prisma.ExpedienteWhereInput = {
    organization_id: actor.organizationId, archived_at: null,
    ...(own && actor.scope === 'GLOBAL' ? ownCaseWhere : actor.scope === 'GLOBAL' ? {} : expedienteAccessWhere(actor)),
    ...(selectedUserId ? { OR: [{ abogado_id: selectedUserId }, { gestor_id: selectedUserId }] } : {}),
  };
  const taskWhere: Prisma.TareaWhereInput = { AND: [
    { OR: [
      { organization_id: actor.organizationId },
      { organization_id: null, expediente: { is: caseWhere } },
    ] },
    { OR: [{ expediente_id: null }, { expediente: { is: caseWhere } }] },
    ...(own ? [{ asignado_a_id: actor.id }] : selectedUserId ? [{ asignado_a_id: selectedUserId }] : []),
  ] };
  const eventWhere: Prisma.EventoAgendaWhereInput = {
    organization_id: actor.organizationId,
    AND: [agendaReadableWhere(actor), ...(own ? [{ OR: [
      { created_by_id: actor.id }, { user_id: actor.id },
      { participantes: { some: { organization_id: actor.organizationId, user_id: actor.id, membership: { status: 'ACTIVE' as const } } } },
    ] }] : [])],
    ...(selectedUserId ? { user_id: selectedUserId } : {}),
  };
  const quoteWhere: Prisma.CotizacionWhereInput = {
    ...cotizacionObjectWhere(actor),
    etapa_contractual: { in: ['ENVIADA_CLIENTE', 'EN_SEGUIMIENTO'] },
    ...(own ? { user_id: actor.id } : selectedUserId ? { user_id: selectedUserId } : {}),
  };
  return { caseWhere, financialCaseWhere, taskWhere, eventWhere, quoteWhere, selectedUserId };
}
