import { createHash, randomUUID } from 'crypto';
import { FormaComparecencia, Prisma, PrismaClient, TipoPersona } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { comparecienteObjectWhere } from './objectAccess.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
export type ExpedientePartyOperation = 'LINK' | 'UPDATE' | 'UNLINK';
export type RepresentationInput = {
  representado_compareciente_id: string;
  cargo_o_caracter_descripcion: string;
  caracter_representacion_id?: string | null;
  facultades_aplicables?: string | null;
};
export type ExpedientePartyCommand = {
  operation: ExpedientePartyOperation;
  relation_id?: string;
  expediente_acto_id?: string;
  compareciente_id?: string;
  caracter_id?: string;
  forma_comparecencia?: FormaComparecencia;
  participacion_porcentaje?: number | null;
  representation?: RepresentationInput | null;
  reason?: string;
  idempotency_key?: string;
  preview_fingerprint?: string;
  confirm_protected_work?: boolean;
};

export class ExpedientePartyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const clean = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const isRepresentation = (value: FormaComparecencia) => value === FormaComparecencia.EN_REPRESENTACION_PERSONA_MORAL
  || value === FormaComparecencia.EN_REPRESENTACION_PERSONA_FISICA
  || value === FormaComparecencia.POR_PROPIO_DERECHO_Y_REPRESENTACION;
const relationInclude = {
  expedienteActo: { include: { tipo_acto: { select: { id: true, nombre: true } } } },
  caracter: { select: { id: true, clave: true, nombre: true } },
  compareciente: { include: { personaFisica: true, personaMoral: true } },
  representacionesComoRepresentante: {
    where: { archived_at: null },
    include: {
      representado: { include: { personaFisica: true, personaMoral: true } },
      caracterRepresentacion: { select: { id: true, clave: true, nombre: true } },
    },
  },
} as const;

type ImpactItem = { key: string; id: string; name: string; source: 'CFG-002' };

export class ExpedientePartiesService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const data = await this.prisma.expedienteCompareciente.findMany({
      where: { organization_id: actor.organizationId, expediente_id: expedienteId, archived_at: null, estatus: 'ACTIVO' },
      include: relationInclude,
      orderBy: [{ orden_comparecencia: 'asc' }, { created_at: 'asc' }],
    });
    return { data, canonical_source: 'ExpedienteCompareciente', legacy_pending_act_assignment: data.filter((item) => !item.expediente_acto_id).length };
  }

  async search(actor: Actor, expedienteId: string, term: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const search = clean(term, 120);
    const data = await this.prisma.compareciente.findMany({
      where: {
        organization_id: actor.organizationId,
        archived_at: null,
        estatus: 'ACTIVO',
        ...comparecienteObjectWhere(actor),
        ...(search ? { OR: [
          ...(uuid.test(search) ? [{ id: search }] : []),
          { nombre_busqueda: { contains: search, mode: 'insensitive' } },
          { personaFisica: { is: { OR: [{ rfc: { contains: search, mode: 'insensitive' } }, { curp: { contains: search, mode: 'insensitive' } }] } } },
          { personaMoral: { is: { rfc: { contains: search, mode: 'insensitive' } } } },
        ] } : {}),
      },
      include: { personaFisica: { select: { nombre_completo_calculado: true, rfc: true } }, personaMoral: { select: { razon_social: true, rfc: true } } },
      orderBy: { nombre_busqueda: 'asc' },
      take: 25,
    });
    return { data: data.map((item) => {
      const rfc = item.personaFisica?.rfc || item.personaMoral?.rfc || '';
      return {
        id: item.id,
        tipo_persona: item.tipo_persona,
        nombre: item.personaFisica?.nombre_completo_calculado || item.personaMoral?.razon_social || item.nombre_busqueda,
        identificador: rfc ? `RFC ·••••${rfc.slice(-4)}` : 'Sin identificador fiscal registrado',
      };
    }) };
  }

  async catalogs(actor: Actor, expedienteId: string) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const [acts, representationCharacters] = await Promise.all([
      this.prisma.expedienteActo.findMany({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null },
        include: { tipo_acto: { select: { id: true, nombre: true, tipoActoCaracteresCompareciente: { where: { caracter: { activo: true } }, include: { caracter: true }, orderBy: [{ sugerido: 'desc' }, { orden: 'asc' }] } } } },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.caracterRepresentacion.findMany({ where: { activo: true }, select: { id: true, clave: true, nombre: true }, orderBy: { nombre: 'asc' } }),
    ]);
    return { data: { acts, representationCharacters, appearanceForms: Object.values(FormaComparecencia) } };
  }

  async preview(actor: Actor, expedienteId: string, command: ExpedientePartyCommand) {
    return this.buildPreview(this.prisma, actor, expedienteId, command);
  }

  async apply(actor: Actor, expedienteId: string, command: ExpedientePartyCommand) {
    const key = clean(command.idempotency_key, 160);
    if (!key) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_IDEMPOTENCY_REQUIRED', 'La operación requiere una clave de idempotencia.');
    if (!clean(command.preview_fingerprint, 128)) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_PREVIEW_REQUIRED', 'Primero revisa el impacto de este cambio.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:expediente-parties:${expedienteId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      const prior = await tx.expedienteCompareciente.findFirst({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId, OR: [{ idempotency_key: key }, { unlink_idempotency_key: key }] },
        include: relationInclude,
      });
      if (prior) return { relation: prior, idempotent: true };
      const preview = await this.buildPreview(tx, actor, expedienteId, command);
      if (preview.fingerprint !== command.preview_fingerprint) throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_PREVIEW_STALE', 'El expediente o su configuración cambió. Revisa nuevamente el impacto.');
      if (preview.classification === 'BLOCKED') throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_CHANGE_BLOCKED', 'La relación no puede cambiarse porque existe trabajo jurídico protegido.');
      if (preview.classification === 'REVIEW_REQUIRED' && command.confirm_protected_work !== true) throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_CONFIRMATION_REQUIRED', 'Confirma expresamente el impacto sobre el trabajo existente.');

      const before = preview.current_relation;
      let relation: any;
      if (command.operation === 'LINK') {
        relation = await tx.expedienteCompareciente.create({ data: {
          organization_id: actor.organizationId,
          expediente_id: expedienteId,
          expediente_acto_id: preview.proposed.expediente_acto_id,
          compareciente_id: preview.proposed.compareciente_id,
          caracter_id: preview.proposed.caracter_id,
          forma_comparecencia: preview.proposed.forma_comparecencia,
          participacion_porcentaje: preview.proposed.participacion_porcentaje,
          creado_por_id: actor.id,
          idempotency_key: key,
          es_principal: false,
        } });
      } else if (command.operation === 'UPDATE') {
        relation = await tx.expedienteCompareciente.update({ where: { id: before!.id }, data: {
          expediente_acto_id: preview.proposed.expediente_acto_id,
          caracter_id: preview.proposed.caracter_id,
          forma_comparecencia: preview.proposed.forma_comparecencia,
          participacion_porcentaje: preview.proposed.participacion_porcentaje,
          idempotency_key: key,
          datos_validados: false,
          validado_por_id: null,
          validado_at: null,
        } });
      } else {
        relation = await tx.expedienteCompareciente.update({ where: { id: before!.id }, data: {
          estatus: 'INACTIVO', archived_at: new Date(), archived_by_id: actor.id,
          motivo_desvinculacion: clean(command.reason), unlink_idempotency_key: key,
        } });
      }

      if (command.operation === 'UNLINK' || !isRepresentation(preview.proposed.forma_comparecencia)) {
        await tx.expedienteRepresentacion.updateMany({
          where: { organization_id: actor.organizationId, expediente_id: expedienteId, expediente_compareciente_representante_id: relation.id, archived_at: null },
          data: { archived_at: new Date() },
        });
      } else {
        const representation = preview.proposed.representation!;
        const existing = await tx.expedienteRepresentacion.findFirst({
          where: { organization_id: actor.organizationId, expediente_id: expedienteId, expediente_compareciente_representante_id: relation.id, archived_at: null },
          select: { id: true },
        });
        const representedLink = await tx.expedienteCompareciente.findFirst({
          where: { organization_id: actor.organizationId, expediente_id: expedienteId, compareciente_id: representation.representado_compareciente_id, archived_at: null, estatus: 'ACTIVO' },
          select: { id: true },
        });
        const data = {
          organization_id: actor.organizationId,
          expediente_id: expedienteId,
          representado_compareciente_id: representation.representado_compareciente_id,
          representante_compareciente_id: preview.proposed.compareciente_id,
          expediente_compareciente_representado_id: representedLink?.id || null,
          expediente_compareciente_representante_id: relation.id,
          caracter_representacion_id: representation.caracter_representacion_id || null,
          cargo_o_caracter_descripcion: clean(representation.cargo_o_caracter_descripcion, 150),
          facultades_aplicables: clean(representation.facultades_aplicables, 1000) || null,
          creado_por_id: actor.id,
        };
        if (existing) await tx.expedienteRepresentacion.update({ where: { id: existing.id }, data });
        else await tx.expedienteRepresentacion.create({ data });
      }

      const updated = await tx.expediente.update({ where: { id: expedienteId }, data: { version: { increment: 1 } }, select: { version: true } });
      const correlationId = randomUUID();
      const action = command.operation === 'LINK' ? 'LINK_EXPEDIENTE_PARTY' : command.operation === 'UPDATE' ? 'UPDATE_EXPEDIENTE_PARTY_RELATION' : 'UNLINK_EXPEDIENTE_PARTY';
      const summary = {
        operation: command.operation,
        relation_id: relation.id,
        expediente_acto_id: relation.expediente_acto_id,
        compareciente_id: relation.compareciente_id,
        caracter_id: relation.caracter_id,
        forma_comparecencia: relation.forma_comparecencia,
        participacion_porcentaje: relation.participacion_porcentaje,
        representation: preview.proposed.representation ? { representado_compareciente_id: preview.proposed.representation.representado_compareciente_id, caracter_representacion_id: preview.proposed.representation.caracter_representacion_id || null } : null,
        classification: preview.classification,
        impact: preview.impact,
        version: updated.version,
      };
      await tx.expedienteActividad.create({ data: {
        organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'AUDITORIA',
        titulo: command.operation === 'LINK' ? 'Compareciente vinculado a un acto' : command.operation === 'UPDATE' ? 'Comparecencia actualizada' : 'Compareciente desvinculado de un acto',
        descripcion: command.operation === 'UNLINK' ? clean(command.reason) : 'Relación operativa actualizada.', metadatos: json(summary),
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: 'ExpedienteCompareciente', entidad_id: relation.id,
        valores_anteriores: before ? json(this.auditShape(before)) : undefined, valores_nuevos: json(summary), correlation_id: correlationId, session_id: actor.sessionId,
      } });
      await tx.domainEventOutbox.create({ data: {
        organization_id: actor.organizationId, event_type: command.operation === 'LINK' ? 'ExpedientePartyLinked' : command.operation === 'UPDATE' ? 'ExpedientePartyRelationUpdated' : 'ExpedientePartyUnlinked',
        aggregate_type: 'Expediente', aggregate_id: expedienteId, actor_user_id: actor.id, correlation_id: correlationId, payload: json(summary),
      } });
      const complete = await tx.expedienteCompareciente.findFirst({ where: { id: relation.id, organization_id: actor.organizationId, expediente_id: expedienteId }, include: relationInclude });
      return { relation: complete || relation, idempotent: false, version: updated.version };
    }, { timeout: 20_000 });
  }

  private auditShape(value: any) {
    return {
      id: value.id, expediente_id: value.expediente_id, expediente_acto_id: value.expediente_acto_id,
      compareciente_id: value.compareciente_id, caracter_id: value.caracter_id,
      forma_comparecencia: value.forma_comparecencia, participacion_porcentaje: value.participacion_porcentaje,
      estatus: value.estatus, archived_at: value.archived_at,
    };
  }

  private async assertExpediente(db: Db, actor: Actor, expedienteId: string) {
    const expediente = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true } });
    if (!expediente) throw new ExpedientePartyError(403, 'EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return expediente;
  }

  private async currentRelation(db: Db, actor: Actor, expedienteId: string, relationId?: string) {
    if (!relationId) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_RELATION_REQUIRED', 'Selecciona la relación que deseas modificar.');
    const relation = await db.expedienteCompareciente.findFirst({
      where: { id: relationId, organization_id: actor.organizationId, expediente_id: expedienteId, archived_at: null, estatus: 'ACTIVO' },
      include: relationInclude,
    });
    if (!relation) throw new ExpedientePartyError(403, 'EXPEDIENTE_PARTY_RELATION_ACCESS_DENIED', 'No tienes acceso a esta relación.');
    return relation;
  }

  private async validateProposed(db: Db, actor: Actor, expedienteId: string, command: ExpedientePartyCommand, current: any | null) {
    const expedienteActoId = clean(command.expediente_acto_id || current?.expediente_acto_id, 64);
    const comparecienteId = clean(command.compareciente_id || current?.compareciente_id, 64);
    const caracterId = clean(command.caracter_id || current?.caracter_id, 64);
    const forma = command.forma_comparecencia || current?.forma_comparecencia || FormaComparecencia.PROPIO_DERECHO;
    if (!expedienteActoId || !comparecienteId || !caracterId) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_REQUIRED_FIELDS', 'Selecciona persona, acto y carácter.');
    if (!Object.values(FormaComparecencia).includes(forma)) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_APPEARANCE_INVALID', 'Selecciona una forma de comparecencia válida.');
    const participation = command.participacion_porcentaje === undefined ? current?.participacion_porcentaje == null ? null : Number(current.participacion_porcentaje) : command.participacion_porcentaje;
    if (participation !== null && (!Number.isFinite(Number(participation)) || Number(participation) <= 0 || Number(participation) > 100)) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_PARTICIPATION_INVALID', 'La participación debe ser mayor que 0 y no superar 100%.');
    const [act, party, allowedCharacter] = await Promise.all([
      db.expedienteActo.findFirst({ where: { id: expedienteActoId, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null }, include: { tipo_acto: { select: { id: true, nombre: true } } } }),
      db.compareciente.findFirst({ where: { id: comparecienteId, organization_id: actor.organizationId, archived_at: null, estatus: 'ACTIVO', ...comparecienteObjectWhere(actor) }, select: { id: true, tipo_persona: true } }),
      db.tipoActoCaracterCompareciente.findFirst({ where: { caracter_id: caracterId, tipo_acto: { expedienteActos: { some: { id: expedienteActoId, organization_id: actor.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', removed_at: null } } } }, include: { caracter: { select: { id: true, nombre: true } } } }),
    ]);
    if (!act) throw new ExpedientePartyError(403, 'EXPEDIENTE_PARTY_ACT_ACCESS_DENIED', 'El acto no pertenece a este expediente o ya no está activo.');
    if (!party) throw new ExpedientePartyError(403, 'EXPEDIENTE_PARTY_MASTER_ACCESS_DENIED', 'No tienes acceso al compareciente seleccionado.');
    if (!allowedCharacter) throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_CHARACTER_NOT_ALLOWED', 'El carácter no está configurado para el acto seleccionado.');
    const duplicate = await db.expedienteCompareciente.findFirst({ where: {
      organization_id: actor.organizationId, expediente_id: expedienteId, expediente_acto_id: expedienteActoId,
      compareciente_id: comparecienteId, caracter_id: caracterId, forma_comparecencia: forma,
      archived_at: null, estatus: 'ACTIVO', ...(current ? { id: { not: current.id } } : {}),
    }, select: { id: true } });
    if (duplicate) throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_DUPLICATE_RELATION', 'Esta persona ya tiene la misma comparecencia en el acto seleccionado.');

    let representation: RepresentationInput | null = null;
    if (isRepresentation(forma)) {
      const input = command.representation || current?.representacionesComoRepresentante?.[0] && {
        representado_compareciente_id: current.representacionesComoRepresentante[0].representado_compareciente_id,
        cargo_o_caracter_descripcion: current.representacionesComoRepresentante[0].cargo_o_caracter_descripcion,
        caracter_representacion_id: current.representacionesComoRepresentante[0].caracter_representacion_id,
        facultades_aplicables: current.representacionesComoRepresentante[0].facultades_aplicables,
      };
      if (!input?.representado_compareciente_id || !clean(input.cargo_o_caracter_descripcion, 150)) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_REPRESENTATION_REQUIRED', 'Indica a quién representa y el carácter de la representación.');
      if (input.representado_compareciente_id === comparecienteId) throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_SELF_REPRESENTATION', 'Una persona no puede representarse a sí misma en esta relación.');
      const represented = await db.compareciente.findFirst({ where: { id: input.representado_compareciente_id, organization_id: actor.organizationId, archived_at: null, estatus: 'ACTIVO', ...comparecienteObjectWhere(actor) }, select: { id: true } });
      if (!represented) throw new ExpedientePartyError(403, 'EXPEDIENTE_PARTY_REPRESENTED_ACCESS_DENIED', 'No tienes acceso a la persona representada.');
      if (input.caracter_representacion_id) {
        const character = await db.caracterRepresentacion.findFirst({ where: { id: input.caracter_representacion_id, activo: true }, select: { id: true } });
        if (!character) throw new ExpedientePartyError(404, 'EXPEDIENTE_PARTY_REPRESENTATION_CHARACTER_INVALID', 'El carácter de representación ya no está disponible.');
      }
      representation = { ...input, cargo_o_caracter_descripcion: clean(input.cargo_o_caracter_descripcion, 150), facultades_aplicables: clean(input.facultades_aplicables, 1000) || null };
    }
    return { expediente_acto_id: expedienteActoId, compareciente_id: comparecienteId, caracter_id: caracterId, forma_comparecencia: forma, participacion_porcentaje: participation, representation, act, party, role: allowedCharacter.caracter };
  }

  private async buildPreview(db: Db, actor: Actor, expedienteId: string, command: ExpedientePartyCommand) {
    if (!['LINK', 'UPDATE', 'UNLINK'].includes(command.operation)) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_OPERATION_INVALID', 'Selecciona una operación válida.');
    await this.assertExpediente(db, actor, expedienteId);
    const expediente = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId }, select: { id: true, estatus: true, version: true, updated_at: true, _count: { select: { expedienteDocumentos: true, requisitos_docs: true, calculosISR: true } } } });
    if (!expediente) throw new ExpedientePartyError(404, 'EXPEDIENTE_NOT_FOUND', 'Expediente no encontrado.');
    const current = command.operation === 'LINK' ? null : await this.currentRelation(db, actor, expedienteId, command.relation_id);
    if (command.operation === 'UNLINK' && !clean(command.reason)) throw new ExpedientePartyError(400, 'EXPEDIENTE_PARTY_UNLINK_REASON_REQUIRED', 'Indica el motivo de la desvinculación.');
    const proposed = command.operation === 'UNLINK'
      ? { expediente_acto_id: current!.expediente_acto_id || '', compareciente_id: current!.compareciente_id, caracter_id: current!.caracter_id, forma_comparecencia: (current!.forma_comparecencia || FormaComparecencia.PROPIO_DERECHO) as FormaComparecencia, participacion_porcentaje: current!.participacion_porcentaje == null ? null : Number(current!.participacion_porcentaje), representation: null, act: current!.expedienteActo, party: current!.compareciente, role: current!.caracter }
      : await this.validateProposed(db, actor, expedienteId, command, current);
    if (!proposed.expediente_acto_id && command.operation === 'UNLINK') throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_LEGACY_ACT_REQUIRED', 'Asigna primero un acto al vínculo histórico para poder evaluar su impacto.');
    if (!proposed.act) throw new ExpedientePartyError(409, 'EXPEDIENTE_PARTY_ACT_ACCESS_DENIED', 'El acto asociado ya no está disponible.');
    const proposedActTypeId = proposed.act.tipo_acto_id;
    const [currentImpact, projectedImpact] = await Promise.all([
      current ? this.resolveCfg002Impact(db, actor.organizationId, current.expedienteActo?.tipo_acto_id || proposedActTypeId, current.compareciente.tipo_persona, current.caracter_id) : Promise.resolve([]),
      command.operation === 'UNLINK' ? Promise.resolve([]) : this.resolveCfg002Impact(db, actor.organizationId, proposedActTypeId, proposed.party.tipo_persona, proposed.caracter_id),
    ]);
    const beforeMap = new Map(currentImpact.map((item) => [item.key, item]));
    const afterMap = new Map(projectedImpact.map((item) => [item.key, item]));
    const added = [...afterMap.values()].filter((item) => !beforeMap.has(item.key));
    const removed = [...beforeMap.values()].filter((item) => !afterMap.has(item.key));
    const retained = [...afterMap.values()].filter((item) => beforeMap.has(item.key));
    const protectedCount = Object.values(expediente._count).reduce((sum, value) => sum + value, 0) + Number(current?.representacionesComoRepresentante?.length || 0);
    const affectsProtected = removed.length > 0 && protectedCount > 0;
    const immutable = ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(expediente.estatus);
    const classification = affectsProtected && immutable ? 'BLOCKED' : affectsProtected ? 'REVIEW_REQUIRED' : 'SAFE';
    const fingerprint = createHash('sha256').update(JSON.stringify({
      expediente_id: expediente.id, version: expediente.version, updated_at: expediente.updated_at.toISOString(), operation: command.operation,
      current: current ? this.auditShape(current) : null,
      proposed: { expediente_acto_id: proposed.expediente_acto_id, compareciente_id: proposed.compareciente_id, caracter_id: proposed.caracter_id, forma_comparecencia: proposed.forma_comparecencia, participacion_porcentaje: proposed.participacion_porcentaje, representation: proposed.representation },
      impact: { current: currentImpact.map((item) => item.key), projected: projectedImpact.map((item) => item.key) },
    })).digest('hex');
    return {
      fingerprint, classification, current_relation: current,
      proposed: { expediente_acto_id: proposed.expediente_acto_id, compareciente_id: proposed.compareciente_id, caracter_id: proposed.caracter_id, forma_comparecencia: proposed.forma_comparecencia, participacion_porcentaje: proposed.participacion_porcentaje, representation: proposed.representation },
      impact: { added, removed_or_no_longer_applicable: removed, retained, protected_work: { count: affectsProtected ? protectedCount : 0, requires_human_confirmation: classification === 'REVIEW_REQUIRED' }, sources: { cfg002: true } },
    };
  }

  private async resolveCfg002Impact(db: Db, organizationId: string, typeId: string, personType: TipoPersona, characterId: string): Promise<ImpactItem[]> {
    const artifacts = await db.catalogoArtefacto.findMany({
      where: { organization_id: organizationId, activo: true, actos: { some: { tipo_acto_id: typeId } } },
      select: { id: true, nombre: true, reglas: { where: { activa: true }, select: { tipo_persona: true, caracter_compareciente_id: true } } },
    });
    return artifacts.filter((artifact) => !artifact.reglas.length || artifact.reglas.some((rule) =>
      (!rule.tipo_persona || rule.tipo_persona === personType) && (!rule.caracter_compareciente_id || rule.caracter_compareciente_id === characterId),
    )).map((artifact) => ({ key: `cfg002:artifact:${artifact.id}`, id: artifact.id, name: artifact.nombre, source: 'CFG-002' as const }));
  }
}
