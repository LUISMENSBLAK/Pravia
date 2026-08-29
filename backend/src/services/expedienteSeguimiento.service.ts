import { createHash, randomUUID } from 'crypto';
import {
  ConfiguracionTipoDias,
  Prisma,
  PrismaClient,
  SeguimientoActividadEstado,
} from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { ExpedienteArtifactsService } from './expedienteArtifacts.service';
import { dependencyGraphHasCycle, resolveOperationalActivityConfiguration } from './configurationCatalog.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;

export class ExpedienteSeguimientoError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type SeguimientoUpdateInput = {
  expected_version: number;
  estado?: SeguimientoActividadEstado;
  responsable_id?: string | null;
  excepcion_operativa?: { duracion_estimada?: number; tipo_dias?: ConfiguracionTipoDias; margen_seguridad?: number; motivo?: string } | null;
  razon?: string;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const clean = (value: unknown, max = 600) => String(value || '').trim().slice(0, max);
const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX').trim();
const terminal = new Set<SeguimientoActividadEstado>(['COMPLETADO', 'NO_APLICA']);
const started = new Set<SeguimientoActividadEstado>(['EN_PROCESO', 'EN_ESPERA_EXTERNA', 'COMPLETADO']);
export const isDependencySatisfied = (state: SeguimientoActividadEstado | null | undefined) => Boolean(state && terminal.has(state));
const stateLabels: Record<SeguimientoActividadEstado, string> = {
  NO_INICIADO: 'No iniciado', EN_PROCESO: 'En proceso', EN_ESPERA_EXTERNA: 'En espera externa',
  COMPLETADO: 'Completado', BLOQUEADO: 'Bloqueado', NO_APLICA: 'No aplica',
};

export const addOperationalDays = (date: Date, amount: number, type: ConfiguracionTipoDias) => {
  const result = new Date(date);
  let remaining = Math.max(0, Math.trunc(amount));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (type === 'NATURALES' || (result.getUTCDay() !== 0 && result.getUTCDay() !== 6)) remaining -= 1;
  }
  return result;
};

export const operationalDaysBetween = (from: Date, to: Date, type: ConfiguracionTipoDias) => {
  if (to <= from) return 0;
  const cursor = new Date(from); let count = 0;
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > to) break;
    if (type === 'NATURALES' || (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6)) count += 1;
  }
  return count;
};

const institutionIdsFrom = (value: unknown, path = ''): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => institutionIdsFrom(item, `${path}.${index}`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const nextPath = `${path}.${key}`;
    const direct = /(banco|fiduciari|institucion).*(^|_)id$/i.test(nextPath) && typeof nested === 'string' ? [nested] : [];
    return [...direct, ...institutionIdsFrom(nested, nextPath)];
  });
};

const configurationInclude = {
  etapas: { where: { activa: true }, orderBy: { orden: 'asc' as const }, include: {
    actividades: { where: { activa: true }, orderBy: { created_at: 'asc' as const }, include: {
      dependencias: true,
      excepciones: { where: { activa: true }, include: { dependencias_adicionales: true } },
    } },
  } },
} as const;

export class ExpedienteSeguimientoService {
  constructor(private readonly prisma: PrismaClient) {}

  async read(actor: Actor, expedienteId: string) {
    const expediente = await this.assertExpediente(this.prisma, actor, expedienteId);
    const [activities, dependencies, acts, responsibleUsers] = await Promise.all([
      this.prisma.expedienteSeguimientoActividad.findMany({
        where: { organization_id: actor.organizationId, expediente_id: expedienteId },
        orderBy: [{ etapa_orden_snapshot: 'asc' }, { created_at: 'asc' }],
      }),
      this.prisma.expedienteSeguimientoDependencia.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId } }),
      this.prisma.expedienteActo.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId }, include: { tipo_acto: { select: { nombre: true } } } }),
      this.prisma.organizationMembership.findMany({
        where: { organization_id: actor.organizationId, status: 'ACTIVE' },
        select: { user: { select: { id: true, nombre: true, apellido: true, activo: true } } },
      }),
    ]);
    const byId = new Map(activities.map((item) => [item.id, item]));
    const depsByActivity = new Map<string, typeof dependencies>();
    dependencies.forEach((dep) => depsByActivity.set(dep.actividad_id, [...(depsByActivity.get(dep.actividad_id) || []), dep]));
    const now = new Date();
    const users = new Map(responsibleUsers.filter((item) => item.user.activo).map((item) => [item.user.id, item.user]));
    const decorated = activities.map((item) => {
      const deps = depsByActivity.get(item.id) || [];
      const blockers = deps.filter((dep) => dep.bloqueante && !isDependencySatisfied(byId.get(dep.depende_actividad_id)?.estado))
        .map((dep) => byId.get(dep.depende_actividad_id)).filter(Boolean) as typeof activities;
      const effectiveState = item.en_alcance && !terminal.has(item.estado) && blockers.length ? 'BLOQUEADO' : item.estado;
      const override = item.excepcion_operativa && typeof item.excepcion_operativa === 'object' && !Array.isArray(item.excepcion_operativa)
        ? item.excepcion_operativa as Record<string, any> : {};
      const effectiveDuration = Number.isInteger(override.duracion_estimada) ? override.duracion_estimada : item.duracion_estimada;
      const effectiveDayType = ['HABILES', 'NATURALES'].includes(override.tipo_dias) ? override.tipo_dias as ConfiguracionTipoDias : item.tipo_dias;
      const effectiveMargin = Number.isInteger(override.margen_seguridad) ? override.margen_seguridad : item.margen_seguridad;
      const end = item.fecha_completada_actual || now;
      const elapsed = item.primera_fecha_inicio ? operationalDaysBetween(item.primera_fecha_inicio, end, effectiveDayType) : 0;
      const due = item.primera_fecha_inicio ? addOperationalDays(item.primera_fecha_inicio, effectiveDuration, effectiveDayType) : null;
      const marginEnd = due ? addOperationalDays(due, effectiveMargin, effectiveDayType) : null;
      return {
        ...item,
        estado_efectivo: effectiveState,
        estado_label: stateLabels[effectiveState],
        estado_operativo: item.estado,
        responsable: item.responsable_id ? users.get(item.responsable_id) || null : null,
        dependencias: deps.map((dep) => ({
          id: dep.id, bloqueante: dep.bloqueante, actividad_id: dep.depende_actividad_id,
          nombre: byId.get(dep.depende_actividad_id)?.actividad_nombre_snapshot || 'Actividad no disponible',
          estado: byId.get(dep.depende_actividad_id)?.estado || 'NO_INICIADO',
        })),
        bloqueada_por: blockers.map((blocker) => ({ id: blocker.id, nombre: blocker.actividad_nombre_snapshot, estado: blocker.estado })),
        tiempo: {
          estimado: effectiveDuration, tipo_dias: effectiveDayType, margen: effectiveMargin,
          transcurrido: elapsed, fecha_objetivo: due, limite_margen: marginEnd,
          atrasada: Boolean(item.en_alcance && started.has(item.estado) && !terminal.has(item.estado) && marginEnd && now > marginEnd),
          margen_consumido: Boolean(item.en_alcance && started.has(item.estado) && !terminal.has(item.estado) && due && now > due),
        },
      };
    });
    const actsById = new Map(acts.map((item) => [item.id, item]));
    const grouped = [...new Set(decorated.map((item) => item.expediente_acto_id))].map((actId) => {
      const act = actsById.get(actId);
      const actActivities = decorated.filter((item) => item.expediente_acto_id === actId);
      const stages = [...new Set(actActivities.map((item) => `${item.etapa_orden_snapshot}:${item.etapa_nombre_snapshot}`))].map((key) => {
        const [orderText, ...nameParts] = key.split(':'); const name = nameParts.join(':');
        return { nombre: name, orden: Number(orderText), actividades: actActivities.filter((item) => item.etapa_orden_snapshot === Number(orderText) && item.etapa_nombre_snapshot === name) };
      });
      return { expediente_acto_id: actId, tipo_acto_id: act?.tipo_acto_id, nombre: act?.tipo_acto.nombre || 'Acto retirado', estatus: act?.estatus || 'RETIRADO', etapas: stages };
    });
    return {
      expediente_id: expediente.id,
      configuracion_actual_no_reaplicada: true,
      fecha_firma_manual: expediente.fecha_real_firma || expediente.fecha_estimada_firma,
      firma: { programada: expediente.fecha_estimada_firma, efectiva: expediente.fecha_real_firma, snapshot_canonico: expediente.estatus === 'FIRMADO' || expediente.estatus === 'POST_FIRMA' || expediente.estatus === 'LISTO_ENTREGA' || expediente.estatus === 'ENTREGADO' },
      entrega: { completada: expediente.estatus === 'ENTREGADO', fecha: expediente.fecha_entrega_cliente, alertas_operativas_activas: expediente.estatus !== 'ENTREGADO' },
      actos: grouped,
      responsables: [...users.values()],
      signals: { prefirm: decorated.filter((item) => normalize(item.etapa_nombre_snapshot) === 'prefirma'), postfirm: decorated.filter((item) => normalize(item.etapa_nombre_snapshot) === 'postfirma') },
    };
  }

  async materialize(actor: Actor, expedienteId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp005:${expedienteId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      return this.materializeInTransaction(tx, actor, expedienteId);
    }, { timeout: 20_000 });
  }

  async materializeInTransaction(tx: Prisma.TransactionClient, actor: Pick<Actor, 'id' | 'organizationId' | 'sessionId'>, expedienteId: string, onlyActId?: string) {
    const expediente = await tx.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null },
      select: {
        id: true, organization_id: true, abogado_id: true, notaria_id: true, datos_operacion: true,
        notaria: { select: { entidad_federativa: true } },
        predios: { where: { estatus: 'ACTIVO' }, select: { predio: { select: { estado: true } } } },
        actos: { where: { estatus: 'ACTIVO', removed_at: null, ...(onlyActId ? { id: onlyActId } : {}) }, select: { id: true, tipo_acto_id: true } },
      },
    });
    if (!expediente) throw new ExpedienteSeguimientoError(403, 'EXP005_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    const configurations = await tx.configuracionActo.findMany({
      where: { organization_id: actor.organizationId, tipo_acto_id: { in: expediente.actos.map((item) => item.tipo_acto_id) }, activa: true, requiere_revision: false },
      include: configurationInclude,
    });
    const byType = new Map(configurations.map((item) => [item.tipo_acto_id, item]));
    const selectors = {
      institutionIds: institutionIdsFrom(expediente.datos_operacion),
      notaryId: expediente.notaria_id,
      jurisdictions: [expediente.notaria?.entidad_federativa, ...expediente.predios.map((item) => item.predio.estado)].filter(Boolean) as string[],
    };
    let created = 0; let existing = 0; let reviewRequired = 0;
    for (const act of expediente.actos) {
      const config = byType.get(act.tipo_acto_id); if (!config) continue;
      const existingMasterIds = new Set((await tx.expedienteSeguimientoActividad.findMany({
        where: { organization_id: actor.organizationId, expediente_acto_id: act.id }, select: { actividad_maestra_id: true },
      })).map((item) => item.actividad_maestra_id));
      const instanceByMaster = new Map<string, string>();
      for (const stage of config.etapas) for (const activity of stage.actividades) {
        const resolved = resolveOperationalActivityConfiguration(activity, selectors);
        const defaultResponsible = await this.resolveDefaultResponsible(tx, actor.organizationId, expediente.abogado_id, activity.responsable_usuario_id, activity.responsable_rol);
        const initialState: SeguimientoActividadEstado = activity.aplica_por_defecto ? 'NO_INICIADO' : 'NO_APLICA';
        const row = await tx.expedienteSeguimientoActividad.upsert({
          where: { organization_id_expediente_acto_id_actividad_maestra_id: { organization_id: actor.organizationId, expediente_acto_id: act.id, actividad_maestra_id: activity.id } },
          update: {},
          create: {
            organization_id: actor.organizationId, expediente_id: expediente.id, expediente_acto_id: act.id, tipo_acto_id: act.tipo_acto_id,
            configuracion_acto_id: config.id, configuracion_revision: config.revision, etapa_maestra_id: stage.id,
            actividad_maestra_id: activity.id, etapa_nombre_snapshot: stage.nombre, etapa_orden_snapshot: stage.orden,
            actividad_nombre_snapshot: activity.nombre, actividad_descripcion_snapshot: activity.descripcion,
            duracion_estimada: resolved.duration, tipo_dias: resolved.day_type, margen_seguridad: resolved.safety_margin,
            responsable_rol_snapshot: activity.responsable_rol, responsable_default_id: defaultResponsible,
            responsable_id: defaultResponsible, aplica_por_defecto: activity.aplica_por_defecto,
            excepcion_maestra_id: resolved.exception?.id || null, excepciones_coincidentes: json(resolved.matching_exception_ids),
            resolucion_fuente: resolved.source, estado: initialState,
            requiere_revision: resolved.status === 'REVIEW_REQUIRED',
            motivo_revision: resolved.status === 'REVIEW_REQUIRED' ? 'Coinciden excepciones incompatibles de CFG-001; requiere decisión humana.' : null,
          },
        });
        const wasCreated = !existingMasterIds.has(activity.id);
        if (wasCreated) {
          created += 1;
          await tx.expedienteSeguimientoHistorial.create({ data: {
            organization_id: actor.organizationId, expediente_id: expediente.id, actividad_id: row.id, actor_user_id: actor.id,
            estado_anterior: null, estado_nuevo: initialState, version_anterior: null, version_nueva: row.version,
            razon: activity.aplica_por_defecto ? 'Materializada desde CFG-001.' : 'Actividad opcional; no aplica por defecto.',
            detalles: json({ configuracion_acto_id: config.id, configuracion_revision: config.revision, actividad_maestra_id: activity.id, master_mutated: false }),
          } });
        } else existing += 1;
        if (resolved.status === 'REVIEW_REQUIRED') reviewRequired += 1;
        instanceByMaster.set(activity.id, row.id);
      }
      const operationalGraph = config.etapas.flatMap((stage) => stage.actividades.flatMap((activity) => {
        const resolved = resolveOperationalActivityConfiguration(activity, selectors);
        return [
          ...activity.dependencias.map((dep) => ({ actividad_id: activity.id, depende_actividad_id: dep.depende_actividad_id })),
          ...resolved.additional_dependencies.map((dep: any) => ({ actividad_id: activity.id, depende_actividad_id: dep.depende_actividad_id })),
        ];
      }));
      if (dependencyGraphHasCycle(operationalGraph)) {
        throw new ExpedienteSeguimientoError(409, 'EXP005_OPERATIONAL_DEPENDENCY_CYCLE', 'La configuración resuelta contiene un ciclo y requiere revisión antes de materializarse.');
      }
      for (const stage of config.etapas) for (const activity of stage.actividades) {
        const activityId = instanceByMaster.get(activity.id); if (!activityId) continue;
        const resolved = resolveOperationalActivityConfiguration(activity, selectors);
        const dependencies = [
          ...activity.dependencias.map((dep) => ({ masterId: dep.id, exceptionMasterId: null, prerequisiteMasterId: dep.depende_actividad_id, blocking: dep.bloqueante })),
          ...resolved.additional_dependencies.map((dep: any) => ({ masterId: null, exceptionMasterId: dep.id, prerequisiteMasterId: dep.depende_actividad_id, blocking: dep.bloqueante })),
        ];
        for (const dependency of dependencies) {
          const prerequisiteId = instanceByMaster.get(dependency.prerequisiteMasterId);
          if (!prerequisiteId || prerequisiteId === activityId) continue;
          await tx.expedienteSeguimientoDependencia.upsert({
            where: { organization_id_actividad_id_depende_actividad_id: { organization_id: actor.organizationId, actividad_id: activityId, depende_actividad_id: prerequisiteId } },
            update: {},
            create: { organization_id: actor.organizationId, expediente_id: expediente.id, actividad_id: activityId, depende_actividad_id: prerequisiteId, dependencia_maestra_id: dependency.masterId, excepcion_dependencia_maestra_id: dependency.exceptionMasterId, bloqueante: dependency.blocking },
          });
        }
      }
    }
    await this.reevaluateDependencies(tx, actor, expedienteId, randomUUID());
    if (created) {
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'EXP005_MATERIALIZE', entidad: 'Expediente', entidad_id: expedienteId, valores_nuevos: json({ created, review_required: reviewRequired, cfg001_unchanged: true }), session_id: actor.sessionId } });
    }
    return { created, existing, review_required: reviewRequired, idempotent: created === 0 };
  }

  async update(actor: Actor, expedienteId: string, activityId: string, input: SeguimientoUpdateInput) {
    if (!Number.isInteger(input.expected_version) || input.expected_version < 1) throw new ExpedienteSeguimientoError(400, 'EXP005_VERSION_REQUIRED', 'Recarga la actividad antes de guardar.');
    const correlationId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp005-activity:${activityId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      const current = await tx.expedienteSeguimientoActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId, expediente_id: expedienteId } });
      if (!current) throw new ExpedienteSeguimientoError(403, 'EXP005_ACTIVITY_ACCESS_DENIED', 'No tienes acceso a esta actividad.');
      if (current.version !== input.expected_version) throw new ExpedienteSeguimientoError(409, 'EXP005_ACTIVITY_STALE', 'La actividad cambió. Recarga antes de guardar.');
      if (!current.en_alcance) throw new ExpedienteSeguimientoError(409, 'EXP005_ACTIVITY_OUT_OF_SCOPE', 'La actividad dejó de aplicar y requiere revisión.');
      const blockers = await this.blockers(tx, actor.organizationId, expedienteId, activityId);
      if (input.estado && !['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'COMPLETADO', 'BLOQUEADO', 'NO_APLICA'].includes(input.estado)) throw new ExpedienteSeguimientoError(400, 'EXP005_STATE_INVALID', 'Selecciona un estado operativo válido.');
      if (input.estado === 'BLOQUEADO') throw new ExpedienteSeguimientoError(400, 'EXP005_BLOCKED_DERIVED', 'El bloqueo se calcula a partir de las dependencias.');
      if (input.estado && ['EN_PROCESO', 'EN_ESPERA_EXTERNA', 'COMPLETADO'].includes(input.estado) && blockers.length) throw new ExpedienteSeguimientoError(409, 'EXP005_DEPENDENCY_BLOCKED', `Completa primero: ${blockers.map((item) => item.actividad_nombre_snapshot).join(', ')}.`);
      if (current.estado === 'COMPLETADO' && input.estado && input.estado !== 'COMPLETADO') throw new ExpedienteSeguimientoError(409, 'EXP005_REOPEN_REQUIRED', 'Usa la acción Reabrir para conservar la trazabilidad.');
      const allowed: Record<string, string[]> = {
        NO_INICIADO: ['EN_PROCESO', 'NO_APLICA'], BLOQUEADO: ['NO_APLICA'],
        EN_PROCESO: ['EN_ESPERA_EXTERNA', 'COMPLETADO', 'NO_APLICA'],
        EN_ESPERA_EXTERNA: ['EN_PROCESO', 'COMPLETADO', 'NO_APLICA'],
        NO_APLICA: [], COMPLETADO: [],
      };
      if (input.estado && input.estado !== current.estado && !allowed[current.estado].includes(input.estado)) throw new ExpedienteSeguimientoError(409, 'EXP005_TRANSITION_INVALID', 'La transición operativa no es válida.');
      const responsibleId = input.responsable_id === undefined ? current.responsable_id : input.responsable_id;
      if (responsibleId) await this.assertResponsible(tx, actor.organizationId, responsibleId);
      const operationalException = this.validateOperationalException(input.excepcion_operativa, input.razon);
      const nextState = input.estado || current.estado;
      const now = new Date();
      const updated = await tx.expedienteSeguimientoActividad.updateMany({
        where: { id: activityId, organization_id: actor.organizationId, expediente_id: expedienteId, version: input.expected_version },
        data: {
          estado: nextState, version: { increment: 1 }, responsable_id: responsibleId,
          ...(input.excepcion_operativa !== undefined ? { excepcion_operativa: operationalException === null ? Prisma.JsonNull : json(operationalException) } : {}),
          ...(!current.primera_fecha_inicio && started.has(nextState) ? { primera_fecha_inicio: now } : {}),
          ...(nextState === 'COMPLETADO' ? { fecha_completada_actual: now } : {}),
          requiere_revision: false, motivo_revision: null,
        },
      });
      if (updated.count !== 1) throw new ExpedienteSeguimientoError(409, 'EXP005_ACTIVITY_STALE', 'La actividad cambió. Recarga antes de guardar.');
      const next = await tx.expedienteSeguimientoActividad.findUniqueOrThrow({ where: { id: activityId } });
      await this.recordChange(tx, actor, current, next, clean(input.razon), correlationId, input);
      await this.reevaluateDependencies(tx, actor, expedienteId, correlationId);
      await new ExpedienteArtifactsService(this.prisma).reconcileContextChangeInTransaction(tx, actor, expedienteId, 'EXPEDIENTE_STAGE_CHANGE');
      return tx.expedienteSeguimientoActividad.findUniqueOrThrow({ where: { id: activityId } });
    }, { timeout: 20_000 });
  }

  async reopen(actor: Actor, expedienteId: string, activityId: string, input: { expected_version: number; razon: string }) {
    const reason = clean(input.razon);
    if (!reason) throw new ExpedienteSeguimientoError(400, 'EXP005_REOPEN_REASON_REQUIRED', 'Indica el motivo de reapertura.');
    const correlationId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp005-activity:${activityId}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      const current = await tx.expedienteSeguimientoActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId, expediente_id: expedienteId } });
      if (!current) throw new ExpedienteSeguimientoError(403, 'EXP005_ACTIVITY_ACCESS_DENIED', 'No tienes acceso a esta actividad.');
      if (current.version !== input.expected_version) throw new ExpedienteSeguimientoError(409, 'EXP005_ACTIVITY_STALE', 'La actividad cambió. Recarga antes de guardar.');
      if (!terminal.has(current.estado)) throw new ExpedienteSeguimientoError(409, 'EXP005_REOPEN_INVALID', 'Sólo puede reabrirse una actividad completada o marcada No aplica.');
      const nextVersion = current.version + 1;
      await tx.expedienteSeguimientoActividad.update({ where: { id: activityId }, data: { estado: 'NO_INICIADO', version: nextVersion, fecha_completada_actual: null } });
      const next = await tx.expedienteSeguimientoActividad.findUniqueOrThrow({ where: { id: activityId } });
      await this.recordChange(tx, actor, current, next, reason, correlationId, { action: 'REOPEN' });
      await this.reevaluateDependencies(tx, actor, expedienteId, correlationId);
      await new ExpedienteArtifactsService(this.prisma).reconcileContextChangeInTransaction(tx, actor, expedienteId, 'EXPEDIENTE_STAGE_REOPEN');
      return next;
    }, { timeout: 20_000 });
  }

  async reconcileActChangeInTransaction(tx: Prisma.TransactionClient, actor: Actor, expedienteId: string, oldActId: string | null, newActId: string | null) {
    if (newActId) await this.materializeInTransaction(tx, actor, expedienteId, newActId);
    if (!oldActId) return;
    const rows = await tx.expedienteSeguimientoActividad.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, expediente_acto_id: oldActId, en_alcance: true } });
    for (const row of rows) {
      const history = await tx.expedienteSeguimientoHistorial.count({ where: { organization_id: actor.organizationId, actividad_id: row.id } });
      const protectedWork = history > 1 || started.has(row.estado) || Boolean(row.excepcion_operativa);
      await tx.expedienteSeguimientoActividad.update({ where: { id: row.id }, data: protectedWork
        ? { en_alcance: false, requiere_revision: true, motivo_revision: 'El acto dejó de aplicar; el trabajo existente se preservó para decisión humana.', version: { increment: 1 } }
        : { en_alcance: false, estado: 'NO_APLICA', motivo_revision: 'El acto dejó de aplicar sin trabajo operativo previo.', version: { increment: 1 } } });
    }
  }

  async recordCanonicalSignatureInTransaction(tx: Prisma.TransactionClient, actor: Pick<Actor, 'id' | 'organizationId' | 'sessionId'>, expedienteId: string, effectiveDate: Date, correlationId: string) {
    const rows = await tx.expedienteSeguimientoActividad.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, en_alcance: true, etapa_nombre_snapshot: { equals: 'Firma', mode: 'insensitive' } } });
    for (const row of rows.filter((item) => normalize(item.actividad_nombre_snapshot).includes('firma') && item.estado !== 'COMPLETADO' && item.estado !== 'NO_APLICA')) {
      const blockers = await this.blockers(tx, actor.organizationId, expedienteId, row.id);
      if (blockers.length) {
        await tx.expedienteSeguimientoActividad.update({ where: { id: row.id }, data: { requiere_revision: true, motivo_revision: 'La firma ocurrió con prerrequisitos operativos pendientes; revisar sin borrar avance.', version: { increment: 1 } } });
        continue;
      }
      const next = await tx.expedienteSeguimientoActividad.update({ where: { id: row.id }, data: { estado: 'COMPLETADO', primera_fecha_inicio: row.primera_fecha_inicio || effectiveDate, fecha_completada_actual: effectiveDate, version: { increment: 1 } } });
      await this.recordChange(tx, actor, row, next, 'Firma contractual registrada mediante la transición canónica EXP-004.', correlationId, { canonical_signature: true });
    }
    await this.reevaluateDependencies(tx, actor, expedienteId, correlationId);
  }

  private async assertExpediente(db: Db, actor: Actor, expedienteId: string) {
    const record = await db.expediente.findFirst({
      where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) },
      select: { id: true, estatus: true, fecha_estimada_firma: true, fecha_real_firma: true, fecha_entrega_cliente: true },
    });
    if (!record) throw new ExpedienteSeguimientoError(403, 'EXP005_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return record;
  }

  private async assertResponsible(db: Db, organizationId: string, userId: string) {
    const member = await db.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: userId, status: 'ACTIVE', user: { activo: true } }, select: { id: true } });
    if (!member) throw new ExpedienteSeguimientoError(403, 'EXP005_RESPONSIBLE_ACCESS_DENIED', 'El responsable no pertenece a la organización activa.');
  }

  private async resolveDefaultResponsible(db: Db, organizationId: string, lawyerId: string, configuredUserId: string | null, configuredRole: any) {
    if (configuredUserId) {
      const configured = await db.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: configuredUserId, status: 'ACTIVE', user: { activo: true } }, select: { user_id: true } });
      if (configured) return configured.user_id;
    }
    if (!configuredRole || configuredRole === 'ABOGADO') {
      const lawyer = await db.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: lawyerId, status: 'ACTIVE', user: { activo: true } }, select: { user_id: true } });
      if (lawyer) return lawyer.user_id;
    }
    const roleMember = configuredRole ? await db.organizationMembership.findFirst({ where: { organization_id: organizationId, rol: configuredRole, status: 'ACTIVE', user: { activo: true } }, orderBy: { created_at: 'asc' }, select: { user_id: true } }) : null;
    return roleMember?.user_id || null;
  }

  private validateOperationalException(value: SeguimientoUpdateInput['excepcion_operativa'], reason: unknown) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const motivo = clean(value.motivo || reason);
    if (!motivo) throw new ExpedienteSeguimientoError(400, 'EXP005_OPERATIONAL_EXCEPTION_REASON_REQUIRED', 'Indica el motivo de la excepción particular.');
    const duration = value.duracion_estimada;
    const margin = value.margen_seguridad;
    if (duration !== undefined && (!Number.isInteger(duration) || duration < 0)) throw new ExpedienteSeguimientoError(400, 'EXP005_DURATION_INVALID', 'La duración debe ser un entero igual o mayor a cero.');
    if (margin !== undefined && (!Number.isInteger(margin) || margin < 0)) throw new ExpedienteSeguimientoError(400, 'EXP005_MARGIN_INVALID', 'El margen debe ser un entero igual o mayor a cero.');
    if (value.tipo_dias !== undefined && !['HABILES', 'NATURALES'].includes(value.tipo_dias)) throw new ExpedienteSeguimientoError(400, 'EXP005_DAY_TYPE_INVALID', 'Selecciona días hábiles o naturales.');
    return { ...value, motivo };
  }

  private async blockers(db: Db, organizationId: string, expedienteId: string, activityId: string) {
    const dependencies = await db.expedienteSeguimientoDependencia.findMany({ where: { organization_id: organizationId, expediente_id: expedienteId, actividad_id: activityId, bloqueante: true } });
    if (!dependencies.length) return [];
    return db.expedienteSeguimientoActividad.findMany({ where: { organization_id: organizationId, expediente_id: expedienteId, id: { in: dependencies.map((item) => item.depende_actividad_id) }, estado: { notIn: ['COMPLETADO', 'NO_APLICA'] } } });
  }

  private async reevaluateDependencies(db: Prisma.TransactionClient, actor: Pick<Actor, 'id' | 'organizationId' | 'sessionId'>, expedienteId: string, correlationId: string) {
    const rows = await db.expedienteSeguimientoActividad.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, en_alcance: true } });
    for (const row of rows) {
      if (terminal.has(row.estado)) continue;
      const blockers = await this.blockers(db, actor.organizationId, expedienteId, row.id);
      if (['NO_INICIADO', 'BLOQUEADO'].includes(row.estado)) {
        const target: SeguimientoActividadEstado = blockers.length ? 'BLOQUEADO' : 'NO_INICIADO';
        if (target !== row.estado) {
          const next = await db.expedienteSeguimientoActividad.update({ where: { id: row.id }, data: { estado: target, version: { increment: 1 } } });
          await db.expedienteSeguimientoHistorial.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId, actividad_id: row.id, actor_user_id: actor.id, estado_anterior: row.estado, estado_nuevo: target, version_anterior: row.version, version_nueva: next.version, razon: blockers.length ? 'Dependencia operativa pendiente.' : 'Dependencias completadas; desbloqueo automático.', correlation_id: correlationId } });
        }
      } else if (blockers.length) {
        await db.expedienteSeguimientoActividad.update({ where: { id: row.id }, data: { requiere_revision: true, motivo_revision: `Dependencia reabierta: ${blockers.map((item) => item.actividad_nombre_snapshot).join(', ')}. El avance se conserva.`, version: { increment: 1 } } });
      }
    }
  }

  private async recordChange(db: Prisma.TransactionClient, actor: Pick<Actor, 'id' | 'organizationId' | 'sessionId'>, before: any, after: any, reason: string, correlationId: string, details: unknown) {
    await db.expedienteSeguimientoHistorial.create({ data: { organization_id: actor.organizationId, expediente_id: before.expediente_id, actividad_id: before.id, actor_user_id: actor.id, estado_anterior: before.estado, estado_nuevo: after.estado, version_anterior: before.version, version_nueva: after.version, razon: reason || null, detalles: json(details), correlation_id: correlationId } });
    await db.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: before.estado === 'COMPLETADO' && after.estado === 'NO_INICIADO' ? 'EXP005_REOPEN_ACTIVITY' : 'EXP005_UPDATE_ACTIVITY', entidad: 'ExpedienteSeguimientoActividad', entidad_id: before.id, valores_anteriores: json({ estado: before.estado, responsable_id: before.responsable_id, version: before.version }), valores_nuevos: json({ estado: after.estado, responsable_id: after.responsable_id, version: after.version }), detalles: json(details), correlation_id: correlationId, session_id: actor.sessionId } });
    await db.expedienteActividad.create({ data: { organization_id: actor.organizationId, expediente_id: before.expediente_id, usuario_id: actor.id, tipo: 'SEGUIMIENTO', titulo: `${after.actividad_nombre_snapshot}: ${stateLabels[after.estado as SeguimientoActividadEstado]}`, descripcion: reason || 'Actividad operativa actualizada.', metadatos: json({ actividad_id: before.id, estado_anterior: before.estado, estado_nuevo: after.estado, correlation_id: correlationId }) } });
  }
}

export const operationalCopyFingerprint = (activity: Pick<any, 'expediente_acto_id' | 'actividad_maestra_id' | 'configuracion_revision'>) =>
  createHash('sha256').update(`${activity.expediente_acto_id}:${activity.actividad_maestra_id}:${activity.configuracion_revision}`).digest('hex');
