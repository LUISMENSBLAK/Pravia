import { createHash, randomUUID } from 'crypto';
import {
  CatalogoArtefactoTipo,
  CatalogoInstitucionTipo,
  CatalogoMultiplicidad,
  CatalogoPropietarioTipo,
  ConfiguracionActividadNaturaleza,
  ConfiguracionAlcanceInstancia,
  ConfiguracionFuenteTiempo,
  ConfiguracionSelectorExcepcion,
  ConfiguracionTipoDias,
  ConfiguracionUnidadTiempo,
  Prisma,
  Role,
} from '@prisma/client';
import prisma from '../config/prisma';
import { deleteFile, getSignedUrl, uploadFile } from './supabase.service';
import { inheritableActivityAttributes, resolveInheritedActivity, validateDeclarativeCondition } from './configurationCatalogV2.domain';
import { CatalogConfigurationError } from './configurationCatalogError';

export { CatalogConfigurationError } from './configurationCatalogError';

type Actor = NonNullable<Express.Request['user']>;
type Db = typeof prisma | Prisma.TransactionClient;

const requiredText = (value: unknown, label: string, max = 180) => {
  const clean = String(value || '').trim().slice(0, max);
  if (!clean) throw new CatalogConfigurationError(400, 'CATALOG_FIELD_REQUIRED', `${label} es obligatorio.`);
  return clean;
};
const optionalText = (value: unknown, max = 500) => {
  const clean = String(value || '').trim().slice(0, max);
  return clean || null;
};
const nonNegative = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new CatalogConfigurationError(400, 'CATALOG_NUMBER_INVALID', `${label} debe ser un número entero igual o mayor a cero.`);
  return parsed;
};
const positive = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new CatalogConfigurationError(400, 'CATALOG_NUMBER_INVALID', `${label} debe ser un número entero mayor a cero.`);
  return parsed;
};
const enumValue = <T extends Record<string, string>>(source: T, value: unknown, label: string): T[keyof T] => {
  if (!Object.values(source).includes(value as T[keyof T])) throw new CatalogConfigurationError(400, 'CATALOG_ENUM_INVALID', `${label} no es válido.`);
  return value as T[keyof T];
};
const booleanValue = (value: unknown, fallback: boolean) => value === undefined ? fallback : Boolean(value);
const idList = (value: unknown) => Array.from(new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []));

const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const redactPrivateArtifactData = (value: any): any => {
  if (Array.isArray(value)) return value.map(redactPrivateArtifactData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    key === 'storage_key' || key === 'url' ? '[PRIVATE]' : redactPrivateArtifactData(nested),
  ]));
};
const audit = (db: Db, actor: Actor, action: string, entity: string, id: string, before?: unknown, after?: unknown) => db.auditLog.create({
  data: {
    organization_id: actor.organizationId,
    user_id: actor.id,
    accion: action,
    entidad: entity,
    entidad_id: id,
    valores_anteriores: before === undefined ? undefined : jsonSafe(before),
    valores_nuevos: after === undefined ? undefined : jsonSafe(after),
    session_id: actor.sessionId,
  },
});

const touchConfiguration = (db: Db, actor: Actor, configurationId: string, review = true) => db.configuracionActo.update({
  where: { id: configurationId },
  data: { actualizado_por_id: actor.id, revision: { increment: 1 }, ...(review ? { requiere_revision: true } : {}) },
});

const actInclude = {
  etapas: {
    orderBy: { orden: 'asc' as const },
    include: {
      actividades: {
        orderBy: [{ created_at: 'asc' as const }],
        include: {
          dependencias: { orderBy: { created_at: 'asc' as const } },
          excepciones: { include: { dependencias_adicionales: true }, orderBy: { created_at: 'asc' as const } },
        },
      },
    },
  },
};

export const configurationComplete = (configuration: any) => Boolean(
  configuration?.activa
  && !configuration.requiere_revision
  && configuration.etapas?.some((stage: any) => stage.activa)
  && configuration.etapas.filter((stage: any) => stage.activa).every((stage: any) =>
    stage.actividades?.some((activity: any) => activity.activa)
    && stage.actividades.filter((activity: any) => activity.activa).every((activity: any) =>
      activity.nombre && activity.duracion_estimada >= 0 && activity.margen_seguridad >= 0 && activity.tipo_dias
    )
  )
);

export const dependencyGraphHasCycle = (rows: Array<{ actividad_id: string; depende_actividad_id: string }>) => {
  const graph = new Map<string, string[]>();
  rows.forEach((row) => graph.set(row.actividad_id, [...(graph.get(row.actividad_id) || []), row.depende_actividad_id]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) || []).some(visit)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  return Array.from(graph.keys()).some(visit);
};

export const resolveActivityTiming = (activity: any, selector: { type?: string; id?: string }) => {
  const match = (activity.excepciones || []).filter((item: any) => item.activa).find((item: any) =>
    (selector.type === 'INSTITUCION' && item.selector_tipo === 'INSTITUCION' && item.institucion_id === selector.id)
    || (selector.type === 'NOTARIA' && item.selector_tipo === 'NOTARIA' && item.notaria_id === selector.id)
    || (selector.type === 'JURISDICCION' && item.selector_tipo === 'JURISDICCION' && item.jurisdiccion?.localeCompare(selector.id || '', 'es', { sensitivity: 'base' }) === 0)
  );
  return match ? { source: 'EXCEPTION', duration: match.duracion, day_type: match.tipo_dias, safety_margin: match.margen_seguridad, exception: match } : { source: 'GENERAL', duration: activity.duracion_estimada, day_type: activity.tipo_dias, safety_margin: activity.margen_seguridad, exception: null };
};

export type OperationalConfigurationSelectors = {
  institutionIds?: string[];
  notaryId?: string | null;
  jurisdictions?: string[];
};

const normalized = (value: unknown) => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX');
const exceptionDependencySignature = (exception: any) => (exception.dependencias_adicionales || [])
  .map((item: any) => `${item.depende_actividad_id}:${item.bloqueante !== false}`)
  .sort();

/**
 * Resolución canónica para EXP-005. No introduce precedencia entre Banco,
 * Notaría y jurisdicción: una colisión incompatible queda para revisión humana.
 */
export const resolveOperationalActivityConfiguration = (activity: any, selectors: OperationalConfigurationSelectors) => {
  const institutionIds = new Set((selectors.institutionIds || []).filter(Boolean));
  const jurisdictions = new Set((selectors.jurisdictions || []).map(normalized).filter(Boolean));
  const matches = (activity.excepciones || []).filter((item: any) => item.activa && (
    (item.selector_tipo === 'INSTITUCION' && item.institucion_id && institutionIds.has(item.institucion_id))
    || (item.selector_tipo === 'NOTARIA' && item.notaria_id && item.notaria_id === selectors.notaryId)
    || (item.selector_tipo === 'JURISDICCION' && item.jurisdiccion && jurisdictions.has(normalized(item.jurisdiccion)))
  ));
  if (!matches.length) return {
    status: 'RESOLVED' as const, source: 'GENERAL' as const,
    duration: activity.duracion_estimada, day_type: activity.tipo_dias, safety_margin: activity.margen_seguridad,
    exception: null, matching_exception_ids: [] as string[], additional_dependencies: [] as any[],
  };
  const signature = (item: any) => JSON.stringify([
    item.duracion, item.tipo_dias, item.margen_seguridad, exceptionDependencySignature(item),
  ]);
  if (new Set(matches.map(signature)).size > 1) return {
    status: 'REVIEW_REQUIRED' as const, source: 'COLLISION' as const,
    duration: activity.duracion_estimada, day_type: activity.tipo_dias, safety_margin: activity.margen_seguridad,
    exception: null, matching_exception_ids: matches.map((item: any) => item.id).sort(), additional_dependencies: [] as any[],
  };
  const resolved = [...matches].sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))[0];
  return {
    status: 'RESOLVED' as const, source: matches.length > 1 ? 'EQUIVALENT_EXCEPTIONS' as const : 'EXCEPTION' as const,
    duration: resolved.duracion, day_type: resolved.tipo_dias, safety_margin: resolved.margen_seguridad,
    exception: resolved, matching_exception_ids: matches.map((item: any) => item.id).sort(),
    additional_dependencies: resolved.dependencias_adicionales || [],
  };
};

const effectiveAct = ({ configuracionesOperativas, ...act }: any) => {
  const configuration = configuracionesOperativas[0] || null;
  return {
    ...act,
    nombre_catalogo: act.nombre,
    descripcion_catalogo: act.descripcion,
    nombre: configuration?.nombre_personalizado || act.nombre,
    descripcion: configuration?.descripcion_personalizada ?? act.descripcion,
    activo: Boolean(act.activo && (configuration?.activa ?? true)),
    configuration,
    complete: configurationComplete(configuration),
    edited: Boolean(configuration && configuration.revision > 1),
  };
};

export const catalogActMetrics = (data: any[]) => ({
  total: data.length,
  complete: data.filter((item) => item.complete).length,
  edited: data.filter((item) => item.edited).length,
  pending: data.filter((item) => !item.complete || item.configuration?.requiere_revision).length,
});

const codeForAct = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 70) || `ACTO_${randomUUID().slice(0, 8).toUpperCase()}`;

async function uniqueActCode(db: Db, name: string) {
  const base = codeForAct(name).slice(0, 60);
  let candidate = `${base}_${randomUUID().slice(0, 8).toUpperCase()}`;
  while (await db.tipoActo.findFirst({ where: { codigo_catalogo: candidate }, select: { id: true } })) candidate = `${base}_${randomUUID().slice(0, 8).toUpperCase()}`;
  return candidate;
}

async function assertMembership(actor: Actor, userId?: string | null) {
  if (!userId) return;
  const member = await prisma.organizationMembership.findFirst({ where: { organization_id: actor.organizationId, user_id: userId, status: 'ACTIVE' }, select: { id: true } });
  if (!member) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_OUTSIDE_TENANT', 'El responsable debe pertenecer a la organización activa.');
}

async function assertOwner(actor: Actor, ownerType: CatalogoPropietarioTipo, ownerId: string) {
  if (ownerType === 'NOTARIA') {
    const item = await prisma.notaria.findFirst({ where: { id: ownerId, organization_id: actor.organizationId, archived_at: null }, select: { id: true, nombre: true } });
    if (!item) throw new CatalogConfigurationError(400, 'NOTARIA_OUTSIDE_TENANT', 'La Notaría no pertenece a la organización activa.');
    return item;
  }
  const item = await prisma.catalogoInstitucion.findFirst({ where: { id: ownerId, organization_id: actor.organizationId, activa: true }, select: { id: true, nombre: true, tipo: true } });
  if (!item) throw new CatalogConfigurationError(400, 'INSTITUTION_OUTSIDE_TENANT', 'La institución no pertenece a la organización activa.');
  return item;
}

export const actsAndTimesService = {
  async list(actor: Actor, search = '') {
    const acts = await prisma.tipoActo.findMany({
      where: {
        archived_at: null,
        OR: [{ organization_id: actor.organizationId }, { organization_id: null }],
      },
      select: {
        id: true, organization_id: true, codigo_catalogo: true, nombre: true, descripcion: true, activo: true, created_at: true, updated_at: true,
        configuracionesOperativas: { where: { organization_id: actor.organizationId }, include: actInclude },
      },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
    const normalizedSearch = search.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
    const data = acts.map(effectiveAct).filter((act) => !normalizedSearch || `${act.nombre} ${act.descripcion || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').includes(normalizedSearch));
    return {
      data,
      metrics: catalogActMetrics(data),
    };
  },

  async get(actor: Actor, actId: string) {
    const act = await prisma.tipoActo.findFirst({
      where: { id: actId, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] },
      select: {
        id: true, organization_id: true, codigo_catalogo: true, nombre: true, descripcion: true, activo: true, created_at: true, updated_at: true,
        configuracionesOperativas: { where: { organization_id: actor.organizationId }, include: actInclude },
      },
    });
    if (!act) throw new CatalogConfigurationError(404, 'ACT_NOT_FOUND', 'Acto no encontrado.');
    const effective = effectiveAct(act);
    const ownConfiguration = effective.configuration;
    if (!ownConfiguration) return effective;
    const chain: any[] = []; const visited = new Set<string>(); let current: any = ownConfiguration;
    while (current) {
      if (visited.has(current.id)) throw new CatalogConfigurationError(409, 'CFG_INHERITANCE_CYCLE', 'La herencia del acto contiene un ciclo.');
      visited.add(current.id); chain.unshift(current);
      current = current.hereda_configuracion_id ? await prisma.configuracionActo.findFirst({ where: { id: current.hereda_configuracion_id, organization_id: actor.organizationId }, include: actInclude }) : null;
    }
    const all = chain.flatMap((configuration) => configuration.etapas.flatMap((stage: any) => stage.actividades.map((activity: any) => ({ activity, stage, source_configuration_id: configuration.id }))));
    const conceptIds = [...new Set(all.map((item) => item.activity.concepto_maestro_id).filter(Boolean))] as string[];
    const concepts = conceptIds.length ? await prisma.configuracionConceptoActividad.findMany({ where: { id: { in: conceptIds }, organization_id: actor.organizationId } }) : [];
    const byConcept = new Map(concepts.map((item) => [item.id, item]));
    const exclusions = new Set(Array.isArray(ownConfiguration.exclusiones_conceptos) ? ownConfiguration.exclusiones_conceptos as string[] : []);
    const effectiveByIdentity = new Map<string, any>();
    for (const item of all) {
      const resolved = {
        ...resolveInheritedActivity(item.activity, item.activity.concepto_maestro_id ? byConcept.get(item.activity.concepto_maestro_id) || null : null),
        etapa: { id: item.stage.id, nombre: item.stage.nombre, orden: item.stage.orden },
        heredada_del_acto: item.source_configuration_id !== ownConfiguration.id,
        source_configuration_id: item.source_configuration_id,
      };
      if (!exclusions.has(resolved.concepto_maestro?.codigo)) {
        effectiveByIdentity.set(String(resolved.concepto_maestro_id || resolved.id), resolved);
      }
    }
    const effectiveActivities = [...effectiveByIdentity.values()];
    const stageByName = new Map<string, any>();
    for (const configuration of chain) {
      for (const stage of configuration.etapas) {
        const key = normalized(stage.nombre);
        const previous = stageByName.get(key);
        stageByName.set(key, {
          id: stage.id, nombre: stage.nombre, orden: stage.orden, activa: stage.activa,
          inherited: configuration.id !== ownConfiguration.id,
          actividades: previous?.actividades || [],
        });
      }
    }
    for (const activity of effectiveActivities) {
      const key = normalized(activity.etapa.nombre);
      const stage = stageByName.get(key) || { ...activity.etapa, activa: true, inherited: activity.heredada_del_acto, actividades: [] };
      stage.actividades.push(activity);
      stage.inherited = stage.inherited && activity.heredada_del_acto;
      stageByName.set(key, stage);
    }
    const effectiveStages = [...stageByName.values()]
      .map((stage) => ({ ...stage, actividades: stage.actividades.sort((a: any, b: any) => a.orden_operativo - b.orden_operativo || String(a.id).localeCompare(String(b.id))) }))
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));
    return { ...effective, effective_activities: effectiveActivities, effective_stages: effectiveStages, inheritance_chain: chain.map((item) => item.id) };
  },

  async create(actor: Actor, input: any) {
    const nombre = requiredText(input.nombre, 'Nombre del acto');
    const descripcion = optionalText(input.descripcion);
    return prisma.$transaction(async (tx) => {
      const duplicate = await tx.tipoActo.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' }, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] }, select: { id: true } });
      if (duplicate) throw new CatalogConfigurationError(409, 'ACT_ALREADY_EXISTS', 'Ya existe un acto con ese nombre.');
      const act = await tx.tipoActo.create({ data: { organization_id: actor.organizationId, codigo_catalogo: await uniqueActCode(tx, nombre), nombre, descripcion, activo: true } });
      const configuration = await tx.configuracionActo.create({ data: { organization_id: actor.organizationId, tipo_acto_id: act.id, creado_por_id: actor.id, actualizado_por_id: actor.id, activa: booleanValue(input.activo, true), etapas: { create: ['Prefirma', 'Firma', 'Postfirma', 'Registro', 'Cierre'].map((stage, index) => ({ organization_id: actor.organizationId, nombre: stage, orden: index + 1 })) } }, include: actInclude });
      await audit(tx, actor, 'CFG_ACT_CREATED', 'TipoActo', act.id, undefined, { nombre, descripcion, configuracion_id: configuration.id });
      return { ...act, configuration, complete: false };
    });
  },

  async ensureConfiguration(actor: Actor, actId: string) {
    const act = await prisma.tipoActo.findFirst({ where: { id: actId, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] }, select: { id: true } });
    if (!act) throw new CatalogConfigurationError(404, 'ACT_NOT_FOUND', 'Acto no encontrado.');
    const existing = await prisma.configuracionActo.findFirst({ where: { organization_id: actor.organizationId, tipo_acto_id: actId }, include: actInclude });
    if (existing) return existing;
    return prisma.$transaction(async (tx) => {
      const configuration = await tx.configuracionActo.create({ data: { organization_id: actor.organizationId, tipo_acto_id: actId, creado_por_id: actor.id, actualizado_por_id: actor.id, etapas: { create: ['Prefirma', 'Firma', 'Postfirma', 'Registro', 'Cierre'].map((nombre, index) => ({ organization_id: actor.organizationId, nombre, orden: index + 1 })) } }, include: actInclude });
      await audit(tx, actor, 'CFG_ACT_CONFIGURATION_CREATED', 'ConfiguracionActo', configuration.id, undefined, { tipo_acto_id: actId });
      return configuration;
    });
  },

  async update(actor: Actor, actId: string, input: any) {
    const before = await this.get(actor, actId);
    const config = before.configuration || await this.ensureConfiguration(actor, actId);
    await prisma.$transaction(async (tx) => {
      const identity: Prisma.TipoActoUpdateInput = {};
      const isTenantOwned = before.organization_id === actor.organizationId;
      if (isTenantOwned && input.nombre !== undefined) identity.nombre = requiredText(input.nombre, 'Nombre del acto');
      if (isTenantOwned && input.descripcion !== undefined) identity.descripcion = optionalText(input.descripcion);
      if (Object.keys(identity).length) await tx.tipoActo.updateMany({ where: { id: actId }, data: identity });
      const functionalChange = ['nombre', 'descripcion', 'activo', 'config_activa', 'requiere_revision'].some((key) => input[key] !== undefined);
      const configuration = await tx.configuracionActo.update({ where: { id: config.id }, data: {
        ...(!isTenantOwned && input.nombre !== undefined ? { nombre_personalizado: requiredText(input.nombre, 'Nombre del acto') } : {}),
        ...(!isTenantOwned && input.descripcion !== undefined ? { descripcion_personalizada: optionalText(input.descripcion) } : {}),
        ...(input.activo !== undefined ? { activa: Boolean(input.activo) } : input.config_activa !== undefined ? { activa: Boolean(input.config_activa) } : {}),
        ...(input.requiere_revision !== undefined ? { requiere_revision: Boolean(input.requiere_revision) } : {}),
        actualizado_por_id: actor.id,
        ...(functionalChange ? { revision: { increment: 1 } } : {}),
      } });
      await audit(tx, actor, 'CFG_ACT_UPDATED', 'ConfiguracionActo', config.id, before, { ...identity, ...configuration });
    });
    return this.get(actor, actId);
  },

  async createStage(actor: Actor, actId: string, input: any) {
    const configuration = await this.ensureConfiguration(actor, actId);
    const name = requiredText(input.nombre, 'Nombre de la etapa');
    const max = await prisma.configuracionEtapa.aggregate({ where: { configuracion_id: configuration.id }, _max: { orden: true } });
    return prisma.$transaction(async (tx) => {
      const stage = await tx.configuracionEtapa.create({ data: { organization_id: actor.organizationId, configuracion_id: configuration.id, nombre: name, orden: input.orden === undefined ? (max._max.orden || 0) + 1 : positive(input.orden, 'Orden'), activa: booleanValue(input.activa, true) } });
      await touchConfiguration(tx, actor, configuration.id);
      await audit(tx, actor, 'CFG_STAGE_CREATED', 'ConfiguracionEtapa', stage.id, undefined, stage);
      return stage;
    });
  },

  async updateStage(actor: Actor, stageId: string, input: any) {
    const before = await prisma.configuracionEtapa.findFirst({ where: { id: stageId, organization_id: actor.organizationId }, select: { id: true, configuracion_id: true, nombre: true, orden: true, activa: true } });
    if (!before) throw new CatalogConfigurationError(404, 'STAGE_NOT_FOUND', 'Etapa no encontrada.');
    const data = { ...(input.nombre !== undefined ? { nombre: requiredText(input.nombre, 'Nombre de la etapa') } : {}), ...(input.orden !== undefined ? { orden: positive(input.orden, 'Orden') } : {}), ...(input.activa !== undefined ? { activa: Boolean(input.activa) } : {}) };
    return prisma.$transaction(async (tx) => {
      if (data.orden && data.orden !== before.orden) {
        const occupied = await tx.configuracionEtapa.findFirst({ where: { configuracion_id: before.configuracion_id, orden: data.orden, id: { not: stageId } }, select: { id: true } });
        if (occupied) await tx.configuracionEtapa.update({ where: { id: occupied.id }, data: { orden: before.orden } });
      }
      const stage = await tx.configuracionEtapa.update({ where: { id: stageId }, data });
      await touchConfiguration(tx, actor, before.configuracion_id);
      await audit(tx, actor, 'CFG_STAGE_UPDATED', 'ConfiguracionEtapa', stageId, before, stage);
      return stage;
    });
  },

  async deleteStage(actor: Actor, stageId: string) {
    const stage = await prisma.configuracionEtapa.findFirst({ where: { id: stageId, organization_id: actor.organizationId }, include: { _count: { select: { actividades: true } } } });
    if (!stage) throw new CatalogConfigurationError(404, 'STAGE_NOT_FOUND', 'Etapa no encontrada.');
    if (stage._count.actividades) throw new CatalogConfigurationError(409, 'STAGE_HAS_ACTIVITIES', 'Desactiva la etapa o elimina primero sus actividades; no se borró ninguna configuración relacionada.');
    await prisma.$transaction(async (tx) => { await tx.configuracionEtapa.delete({ where: { id: stageId } }); await touchConfiguration(tx, actor, stage.configuracion_id); await audit(tx, actor, 'CFG_STAGE_DELETED', 'ConfiguracionEtapa', stageId, stage, undefined); });
  },

  async createActivity(actor: Actor, stageId: string, input: any) {
    const stage = await prisma.configuracionEtapa.findFirst({ where: { id: stageId, organization_id: actor.organizationId }, select: { id: true, configuracion_id: true } });
    if (!stage) throw new CatalogConfigurationError(404, 'STAGE_NOT_FOUND', 'Etapa no encontrada.');
    const userId = optionalText(input.responsable_usuario_id, 64);
    await assertMembership(actor, userId);
    const role = input.responsable_rol ? enumValue(Role, input.responsable_rol, 'Rol responsable') : null;
    if (role && userId) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_AMBIGUOUS', 'Selecciona un rol o un usuario, no ambos.');
    return prisma.$transaction(async (tx) => {
      const activityName = requiredText(input.nombre, 'Nombre de la actividad');
      const concept = await tx.configuracionConceptoActividad.create({ data: {
        organization_id: actor.organizationId,
        codigo: `CUSTOM_${randomUUID().replace(/-/g, '').toUpperCase()}`,
        nombre: activityName,
        descripcion: optionalText(input.descripcion),
        duracion_estimada: nonNegative(input.duracion_estimada, 'Duración estimada'),
        tipo_dias: enumValue(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días'),
        margen_seguridad: nonNegative(input.margen_seguridad ?? 0, 'Margen de seguridad'),
        responsable_rol: role,
        responsable_usuario_id: userId,
        aplica_por_defecto: booleanValue(input.aplica_por_defecto, true),
        naturaleza: enumValue(ConfiguracionActividadNaturaleza, input.naturaleza || 'INTERNA', 'Naturaleza'),
        unidad_tiempo: enumValue(ConfiguracionUnidadTiempo, input.unidad_tiempo || 'DIAS', 'Unidad de tiempo'),
        fuente_tiempo: enumValue(ConfiguracionFuenteTiempo, input.fuente_tiempo || 'GENERAL', 'Fuente del tiempo'),
        condicion_json: validateDeclarativeCondition(input.condicion_json),
      } });
      const activity = await tx.configuracionActividad.create({ data: {
        organization_id: actor.organizationId, etapa_id: stageId, concepto_maestro_id: concept.id, nombre: activityName, descripcion: optionalText(input.descripcion),
        duracion_estimada: nonNegative(input.duracion_estimada, 'Duración estimada'), tipo_dias: enumValue(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días'),
        margen_seguridad: nonNegative(input.margen_seguridad ?? 0, 'Margen de seguridad'), responsable_rol: role, responsable_usuario_id: userId,
        aplica_por_defecto: booleanValue(input.aplica_por_defecto, true), activa: booleanValue(input.activa, true), atributos_heredados: [],
        naturaleza: enumValue(ConfiguracionActividadNaturaleza, input.naturaleza || 'INTERNA', 'Naturaleza'),
        unidad_tiempo: enumValue(ConfiguracionUnidadTiempo, input.unidad_tiempo || 'DIAS', 'Unidad de tiempo'),
        fuente_tiempo: enumValue(ConfiguracionFuenteTiempo, input.fuente_tiempo || 'GENERAL', 'Fuente del tiempo'),
        alcance_instancia: enumValue(ConfiguracionAlcanceInstancia, input.alcance_instancia || 'ACTO', 'Alcance de instancia'), condicion_json: validateDeclarativeCondition(input.condicion_json),
        grupo_paralelo: optionalText(input.grupo_paralelo, 80), orden_operativo: nonNegative(input.orden_operativo ?? 0, 'Orden operativo'),
      } });
      await touchConfiguration(tx, actor, stage.configuracion_id);
      await audit(tx, actor, 'CFG_ACTIVITY_CREATED', 'ConfiguracionActividad', activity.id, undefined, activity);
      return activity;
    });
  },

  async updateActivity(actor: Actor, activityId: string, input: any) {
    const before = await prisma.configuracionActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId }, include: { etapa: { select: { configuracion_id: true } } } });
    if (!before) throw new CatalogConfigurationError(404, 'ACTIVITY_NOT_FOUND', 'Actividad no encontrada.');
    const userId = input.responsable_usuario_id === undefined ? undefined : optionalText(input.responsable_usuario_id, 64);
    if (userId !== undefined) await assertMembership(actor, userId);
    const role = input.responsable_rol === undefined ? undefined : input.responsable_rol ? enumValue(Role, input.responsable_rol, 'Rol responsable') : null;
    const effectiveRole = role !== undefined ? role : before.responsable_rol;
    const effectiveUserId = userId !== undefined ? userId : before.responsable_usuario_id;
    if (effectiveRole && effectiveUserId) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_AMBIGUOUS', 'Selecciona un rol o un usuario, no ambos.');
    const inherited = new Set(Array.isArray(before.atributos_heredados) ? before.atributos_heredados as string[] : []);
    inheritableActivityAttributes.forEach((key) => { if (input[key] !== undefined) inherited.delete(key); });
    const data: Prisma.ConfiguracionActividadUpdateInput = {
      ...(input.nombre !== undefined ? { nombre: requiredText(input.nombre, 'Nombre de la actividad') } : {}),
      ...(input.descripcion !== undefined ? { descripcion: optionalText(input.descripcion) } : {}),
      ...(input.duracion_estimada !== undefined ? { duracion_estimada: nonNegative(input.duracion_estimada, 'Duración estimada') } : {}),
      ...(input.tipo_dias !== undefined ? { tipo_dias: enumValue(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días') } : {}),
      ...(input.margen_seguridad !== undefined ? { margen_seguridad: nonNegative(input.margen_seguridad, 'Margen de seguridad') } : {}),
      ...(role !== undefined ? { responsable_rol: role } : {}), ...(userId !== undefined ? { responsable_usuario_id: userId } : {}),
      ...(input.aplica_por_defecto !== undefined ? { aplica_por_defecto: Boolean(input.aplica_por_defecto) } : {}),
      ...(input.activa !== undefined ? { activa: Boolean(input.activa) } : {}),
      ...(input.naturaleza !== undefined ? { naturaleza: enumValue(ConfiguracionActividadNaturaleza, input.naturaleza, 'Naturaleza') } : {}),
      ...(input.unidad_tiempo !== undefined ? { unidad_tiempo: enumValue(ConfiguracionUnidadTiempo, input.unidad_tiempo, 'Unidad de tiempo') } : {}),
      ...(input.fuente_tiempo !== undefined ? { fuente_tiempo: enumValue(ConfiguracionFuenteTiempo, input.fuente_tiempo, 'Fuente del tiempo') } : {}),
      ...(input.alcance_instancia !== undefined ? { alcance_instancia: enumValue(ConfiguracionAlcanceInstancia, input.alcance_instancia, 'Alcance de instancia') } : {}),
      ...(input.grupo_paralelo !== undefined ? { grupo_paralelo: optionalText(input.grupo_paralelo, 80) } : {}),
      ...(input.orden_operativo !== undefined ? { orden_operativo: nonNegative(input.orden_operativo, 'Orden operativo') } : {}),
      ...(input.condicion_json !== undefined ? { condicion_json: validateDeclarativeCondition(input.condicion_json) ?? Prisma.JsonNull } : {}),
      atributos_heredados: [...inherited],
    };
    return prisma.$transaction(async (tx) => {
      const activity = await tx.configuracionActividad.update({ where: { id: activityId }, data });
      await touchConfiguration(tx, actor, before.etapa.configuracion_id);
      await audit(tx, actor, 'CFG_ACTIVITY_UPDATED', 'ConfiguracionActividad', activityId, before, activity);
      return activity;
    });
  },

  async setDependencies(actor: Actor, activityId: string, input: any) {
    const activity = await prisma.configuracionActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId }, include: { etapa: { select: { configuracion_id: true } }, dependencias: true } });
    if (!activity) throw new CatalogConfigurationError(404, 'ACTIVITY_NOT_FOUND', 'Actividad no encontrada.');
    const dependencyIds = idList(input.dependency_ids);
    if (dependencyIds.includes(activityId)) throw new CatalogConfigurationError(400, 'DEPENDENCY_SELF_REFERENCE', 'Una actividad no puede depender de sí misma.');
    const configurationIds = [activity.etapa.configuracion_id];
    let inheritedConfiguration = await prisma.configuracionActo.findFirst({ where: { id: activity.etapa.configuracion_id, organization_id: actor.organizationId }, select: { hereda_configuracion_id: true } });
    const visited = new Set(configurationIds);
    while (inheritedConfiguration?.hereda_configuracion_id) {
      if (visited.has(inheritedConfiguration.hereda_configuracion_id)) throw new CatalogConfigurationError(409, 'CFG_INHERITANCE_CYCLE', 'La herencia del acto contiene un ciclo.');
      visited.add(inheritedConfiguration.hereda_configuracion_id); configurationIds.push(inheritedConfiguration.hereda_configuracion_id);
      inheritedConfiguration = await prisma.configuracionActo.findFirst({ where: { id: inheritedConfiguration.hereda_configuracion_id, organization_id: actor.organizationId }, select: { hereda_configuracion_id: true } });
    }
    const candidates = dependencyIds.length ? await prisma.configuracionActividad.findMany({ where: { id: { in: dependencyIds }, organization_id: actor.organizationId, etapa: { configuracion_id: { in: configurationIds } } }, select: { id: true } }) : [];
    if (candidates.length !== dependencyIds.length) throw new CatalogConfigurationError(400, 'DEPENDENCY_OUTSIDE_CONFIGURATION', 'Todas las dependencias deben pertenecer al mismo acto y organización.');
    const graphRows = await prisma.configuracionDependencia.findMany({ where: { organization_id: actor.organizationId, actividad: { etapa: { configuracion_id: { in: configurationIds } } }, actividad_id: { not: activityId } }, select: { actividad_id: true, depende_actividad_id: true } });
    if (dependencyGraphHasCycle([...graphRows, ...dependencyIds.map((id) => ({ actividad_id: activityId, depende_actividad_id: id }))])) throw new CatalogConfigurationError(409, 'DEPENDENCY_CYCLE', 'La selección crea un ciclo de dependencias.');
    return prisma.$transaction(async (tx) => {
      await tx.configuracionDependencia.deleteMany({ where: { actividad_id: activityId } });
      if (dependencyIds.length) await tx.configuracionDependencia.createMany({ data: dependencyIds.map((id) => ({ organization_id: actor.organizationId, actividad_id: activityId, depende_actividad_id: id, bloqueante: booleanValue(input.bloqueante, true) })) });
      await touchConfiguration(tx, actor, activity.etapa.configuracion_id);
      await audit(tx, actor, 'CFG_DEPENDENCIES_UPDATED', 'ConfiguracionActividad', activityId, activity.dependencias.map((item) => item.depende_actividad_id), dependencyIds);
      return tx.configuracionDependencia.findMany({ where: { actividad_id: activityId }, orderBy: { created_at: 'asc' } });
    });
  },

  async createException(actor: Actor, activityId: string, input: any) {
    const activity = await prisma.configuracionActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId }, include: { etapa: { select: { configuracion_id: true } } } });
    if (!activity) throw new CatalogConfigurationError(404, 'ACTIVITY_NOT_FOUND', 'Actividad no encontrada.');
    const selector = enumValue(ConfiguracionSelectorExcepcion, input.selector_tipo, 'Tipo de excepción');
    const institutionId = selector === 'INSTITUCION' ? requiredText(input.institucion_id, 'Institución', 64) : null;
    const notariaId = selector === 'NOTARIA' ? requiredText(input.notaria_id, 'Notaría', 64) : null;
    const jurisdiction = selector === 'JURISDICCION' ? requiredText(input.jurisdiccion, 'Estado o jurisdicción', 120) : null;
    if (institutionId) await assertOwner(actor, 'INSTITUCION', institutionId);
    if (notariaId) await assertOwner(actor, 'NOTARIA', notariaId);
    const dependencyIds = idList(input.dependency_ids);
    if (dependencyIds.includes(activityId)) throw new CatalogConfigurationError(400, 'EXCEPTION_DEPENDENCY_SELF_REFERENCE', 'Una excepción no puede agregar la propia actividad como dependencia.');
    if (dependencyIds.length) {
      const dependencies = await prisma.configuracionActividad.findMany({ where: { id: { in: dependencyIds }, organization_id: actor.organizationId, etapa: { configuracion_id: activity.etapa.configuracion_id } }, select: { id: true } });
      if (dependencies.length !== dependencyIds.length) throw new CatalogConfigurationError(400, 'EXCEPTION_DEPENDENCY_OUTSIDE_CONFIGURATION', 'Las dependencias adicionales deben pertenecer al mismo acto.');
      const baseGraph = await prisma.configuracionDependencia.findMany({ where: { organization_id: actor.organizationId, actividad: { etapa: { configuracion_id: activity.etapa.configuracion_id } } }, select: { actividad_id: true, depende_actividad_id: true } });
      if (dependencyGraphHasCycle([...baseGraph, ...dependencyIds.map((id) => ({ actividad_id: activityId, depende_actividad_id: id }))])) throw new CatalogConfigurationError(409, 'EXCEPTION_DEPENDENCY_CYCLE', 'Las dependencias adicionales crean un ciclo.');
    }
    return prisma.$transaction(async (tx) => {
      const exception = await tx.configuracionExcepcion.create({ data: {
        organization_id: actor.organizationId, actividad_id: activityId, selector_tipo: selector, institucion_id: institutionId, notaria_id: notariaId, jurisdiccion: jurisdiction,
        duracion: nonNegative(input.duracion, 'Duración'), tipo_dias: enumValue(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días'), margen_seguridad: nonNegative(input.margen_seguridad ?? 0, 'Margen de seguridad'), activa: booleanValue(input.activa, true),
        dependencias_adicionales: dependencyIds.length ? { create: dependencyIds.map((id) => ({ organization_id: actor.organizationId, depende_actividad_id: id, bloqueante: true })) } : undefined,
      }, include: { dependencias_adicionales: true } });
      await touchConfiguration(tx, actor, activity.etapa.configuracion_id);
      await audit(tx, actor, 'CFG_EXCEPTION_CREATED', 'ConfiguracionExcepcion', exception.id, undefined, exception);
      return exception;
    });
  },

  async updateException(actor: Actor, exceptionId: string, input: any) {
    const before = await prisma.configuracionExcepcion.findFirst({ where: { id: exceptionId, organization_id: actor.organizationId }, include: { actividad: { include: { etapa: { select: { configuracion_id: true } } } }, dependencias_adicionales: true } });
    if (!before) throw new CatalogConfigurationError(404, 'EXCEPTION_NOT_FOUND', 'Excepción no encontrada.');
    const data = {
      ...(input.duracion !== undefined ? { duracion: nonNegative(input.duracion, 'Duración') } : {}),
      ...(input.tipo_dias !== undefined ? { tipo_dias: enumValue(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días') } : {}),
      ...(input.margen_seguridad !== undefined ? { margen_seguridad: nonNegative(input.margen_seguridad, 'Margen de seguridad') } : {}),
      ...(input.activa !== undefined ? { activa: Boolean(input.activa) } : {}),
    };
    return prisma.$transaction(async (tx) => {
      const after = await tx.configuracionExcepcion.update({ where: { id: exceptionId }, data, include: { dependencias_adicionales: true } });
      await touchConfiguration(tx, actor, before.actividad.etapa.configuracion_id);
      await audit(tx, actor, 'CFG_EXCEPTION_UPDATED', 'ConfiguracionExcepcion', exceptionId, before, after);
      return after;
    });
  },

  async resolveTiming(actor: Actor, activityId: string, selector: { type?: string; id?: string }) {
    const activity = await prisma.configuracionActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId }, include: { excepciones: { where: { activa: true }, include: { dependencias_adicionales: true } } } });
    if (!activity) throw new CatalogConfigurationError(404, 'ACTIVITY_NOT_FOUND', 'Actividad no encontrada.');
    return resolveActivityTiming(activity, selector);
  },
};

const artifactInclude = {
  versiones: { orderBy: { version: 'desc' as const } },
  actos: { orderBy: { created_at: 'asc' as const } },
  reglas: { include: { normativaRevision: true }, orderBy: { created_at: 'asc' as const } },
  revisionesNormativas: { orderBy: { revision: 'desc' as const } },
};

async function validateFolder(actor: Actor, folderId: string | null, ownerType: CatalogoPropietarioTipo, ownerId: string, type: CatalogoArtefactoTipo) {
  if (!folderId) return null;
  const folder = await prisma.catalogoCarpeta.findFirst({ where: { id: folderId, organization_id: actor.organizationId, activa: true }, select: { id: true, tipo: true, propietario_tipo: true, notaria_id: true, institucion_id: true } });
  if (!folder || folder.tipo !== type || folder.propietario_tipo !== ownerType || (ownerType === 'NOTARIA' ? folder.notaria_id : folder.institucion_id) !== ownerId) throw new CatalogConfigurationError(400, 'FOLDER_OWNER_MISMATCH', 'La carpeta no pertenece al propietario y tipo seleccionados.');
  return folder;
}

async function validateRulesAndActs(actor: Actor, actIds: string[], rules: any[]) {
  if (!actIds.length) throw new CatalogConfigurationError(400, 'ARTIFACT_ACT_REQUIRED', 'Selecciona al menos un acto aplicable.');
  const acts = await prisma.tipoActo.findMany({ where: { id: { in: actIds }, activo: true, archived_at: null }, select: { id: true } });
  if (acts.length !== actIds.length) throw new CatalogConfigurationError(400, 'ARTIFACT_ACT_INVALID', 'Uno o más actos no son válidos.');
  const stageIds = Array.from(new Set(rules.flatMap((rule) => [rule.etapa_requerida_id, rule.momento_limite_etapa_id]).filter(Boolean).map(String)));
  if (stageIds.length) {
    const stages = await prisma.configuracionEtapa.findMany({ where: { id: { in: stageIds }, organization_id: actor.organizationId, configuracion: { tipo_acto_id: { in: actIds } } }, select: { id: true } });
    if (stages.length !== stageIds.length) throw new CatalogConfigurationError(400, 'ARTIFACT_STAGE_INVALID', 'Las etapas deben pertenecer a una configuración de los actos seleccionados.');
  }
  const characterIds = Array.from(new Set(rules.map((rule) => rule.caracter_compareciente_id).filter(Boolean).map(String)));
  if (characterIds.length) {
    const characters = await prisma.caracterCompareciente.findMany({ where: { id: { in: characterIds }, activo: true }, select: { id: true } });
    if (characters.length !== characterIds.length) throw new CatalogConfigurationError(400, 'ARTIFACT_PARTY_ROLE_INVALID', 'Uno o más roles de compareciente no son válidos.');
  }
}

const ruleData = (actor: Actor, rule: any) => {
  const multiplicity = enumValue(CatalogoMultiplicidad, rule.multiplicidad || 'EXPEDIENTE', 'Multiplicidad');
  const fixed = multiplicity === 'CANTIDAD_FIJA' ? positive(rule.cantidad_fija, 'Cantidad fija') : null;
  return {
    organization_id: actor.organizationId,
    tipo_persona: rule.tipo_persona ? enumValue({ FISICA: 'FISICA', MORAL: 'MORAL' } as const, rule.tipo_persona, 'Tipo de persona') : null,
    caracter_compareciente_id: optionalText(rule.caracter_compareciente_id, 64),
    etapa_requerida_id: optionalText(rule.etapa_requerida_id, 64),
    momento_limite_etapa_id: optionalText(rule.momento_limite_etapa_id, 64),
    obligatoria: booleanValue(rule.obligatoria, false), multiplicidad: multiplicity, cantidad_fija: fixed,
    condiciones_json: rule.condiciones && typeof rule.condiciones === 'object' ? rule.condiciones as Prisma.InputJsonValue : undefined,
    activa: booleanValue(rule.activa, true),
  };
};

export const templatesAndFormatsService = {
  async root(actor: Actor) {
    const [notarias, institutions] = await Promise.all([
      prisma.notaria.findMany({ where: { organization_id: actor.organizationId, archived_at: null }, select: { id: true, nombre: true, numero_notaria: true, activa: true, predeterminada: true, created_at: true }, orderBy: [{ predeterminada: 'desc' }, { activa: 'desc' }, { created_at: 'asc' }] }),
      prisma.catalogoInstitucion.findMany({ where: { organization_id: actor.organizationId }, select: { id: true, nombre: true, tipo: true, activa: true }, orderBy: { nombre: 'asc' } }),
    ]);
    return { notaria: notarias[0] || null, institutions, legacy_notaries_hidden: Math.max(0, notarias.length - 1) };
  },

  async supportingCatalogs(actor: Actor) {
    const [acts, notarias, institutions, stages, memberships, characters] = await Promise.all([
      prisma.tipoActo.findMany({
        where: { activo: true, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] },
        select: {
          id: true, nombre: true, codigo_catalogo: true,
          configuracionesOperativas: {
            where: { organization_id: actor.organizationId, activa: true },
            select: { nombre_personalizado: true },
            take: 1,
          },
        },
        orderBy: { nombre: 'asc' },
      }),
      prisma.notaria.findMany({ where: { organization_id: actor.organizationId, archived_at: null, activa: true }, select: { id: true, nombre: true, numero_notaria: true, predeterminada: true, created_at: true }, orderBy: [{ predeterminada: 'desc' }, { created_at: 'asc' }] }),
      prisma.catalogoInstitucion.findMany({ where: { organization_id: actor.organizationId, activa: true }, select: { id: true, nombre: true, tipo: true, tipos_respuesta: { orderBy: { nombre: 'asc' } } }, orderBy: { nombre: 'asc' } }),
      prisma.configuracionEtapa.findMany({ where: { organization_id: actor.organizationId, activa: true }, select: { id: true, nombre: true, configuracion: { select: { tipo_acto_id: true } } }, orderBy: [{ configuracion_id: 'asc' }, { orden: 'asc' }] }),
      prisma.organizationMembership.findMany({ where: { organization_id: actor.organizationId, status: 'ACTIVE', user: { activo: true } }, select: { user: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { created_at: 'asc' } }),
      prisma.caracterCompareciente.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
    ]);
    return {
      acts: acts.map(({ configuracionesOperativas, ...act }) => ({
        ...act,
        nombre: configuracionesOperativas[0]?.nombre_personalizado || act.nombre,
      })),
      notaria: notarias[0] || null, notarias, institutions, stages, users: memberships.map((item) => item.user), roles: Object.values(Role), characters,
    };
  },

  async createInstitution(actor: Actor, input: any) {
    const data = { organization_id: actor.organizationId, nombre: requiredText(input.nombre, 'Nombre de la institución'), tipo: enumValue(CatalogoInstitucionTipo, input.tipo, 'Tipo de institución'), activa: booleanValue(input.activa, true) };
    return prisma.$transaction(async (tx) => { const item = await tx.catalogoInstitucion.create({ data }); await audit(tx, actor, 'CFG_INSTITUTION_CREATED', 'CatalogoInstitucion', item.id, undefined, item); return item; });
  },

  async explorer(actor: Actor, ownerTypeRaw: unknown, ownerIdRaw: unknown, typeRaw: unknown, folderIdRaw?: unknown) {
    const ownerType = enumValue(CatalogoPropietarioTipo, ownerTypeRaw, 'Tipo de propietario');
    const type = enumValue(CatalogoArtefactoTipo, typeRaw, 'Tipo de archivo maestro');
    if (type === 'PLANTILLA' && ownerType !== 'NOTARIA') throw new CatalogConfigurationError(400, 'BANK_TEMPLATE_FORBIDDEN', 'Las Plantillas pertenecen exclusivamente a una Notaría.');
    const ownerId = requiredText(ownerIdRaw, 'Propietario', 64);
    await assertOwner(actor, ownerType, ownerId);
    const folderId = optionalText(folderIdRaw, 64);
    const folder = folderId ? await prisma.catalogoCarpeta.findFirst({ where: { id: folderId, organization_id: actor.organizationId }, select: { id: true, nombre: true, parent_id: true, tipo: true, propietario_tipo: true, notaria_id: true, institucion_id: true } }) : null;
    if (folderId && !folder) throw new CatalogConfigurationError(404, 'FOLDER_NOT_FOUND', 'Carpeta no encontrada.');
    await validateFolder(actor, folderId, ownerType, ownerId, type);
    const ownerWhere = ownerType === 'NOTARIA' ? { notaria_id: ownerId } : { institucion_id: ownerId };
    const [folders, artifacts] = await Promise.all([
      prisma.catalogoCarpeta.findMany({ where: { organization_id: actor.organizationId, propietario_tipo: ownerType, tipo: type, ...ownerWhere, parent_id: folderId, activa: true }, select: { id: true, tipo: true, nombre: true, parent_id: true, created_at: true }, orderBy: { nombre: 'asc' } }),
      prisma.catalogoArtefacto.findMany({ where: { organization_id: actor.organizationId, propietario_tipo: ownerType, tipo: type, ...ownerWhere, carpeta_id: folderId, activo: true }, include: artifactInclude, orderBy: { nombre: 'asc' } }),
    ]);
    const breadcrumbs: Array<{ id: string | null; name: string }> = [];
    let current = folder;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id)) throw new CatalogConfigurationError(409, 'FOLDER_HIERARCHY_CYCLE', 'La jerarquía de carpetas contiene un ciclo y no puede navegarse.');
      visited.add(current.id);
      if (current.tipo !== type || current.propietario_tipo !== ownerType || (ownerType === 'NOTARIA' ? current.notaria_id : current.institucion_id) !== ownerId) throw new CatalogConfigurationError(409, 'FOLDER_HIERARCHY_INVALID', 'La jerarquía de carpetas no coincide con el propietario y tipo seleccionados.');
      breadcrumbs.unshift({ id: current.id, name: current.nombre });
      current = current.parent_id ? await prisma.catalogoCarpeta.findFirst({ where: { id: current.parent_id, organization_id: actor.organizationId }, select: { id: true, nombre: true, parent_id: true, tipo: true, propietario_tipo: true, notaria_id: true, institucion_id: true } }) : null;
    }
    return { owner_type: ownerType, owner_id: ownerId, type, folder, breadcrumbs, folders, artifacts, allows_templates: ownerType === 'NOTARIA' };
  },

  async createFolder(actor: Actor, input: any) {
    const ownerType = enumValue(CatalogoPropietarioTipo, input.propietario_tipo, 'Tipo de propietario');
    const type = enumValue(CatalogoArtefactoTipo, input.tipo, 'Tipo de archivo maestro');
    if (type === 'PLANTILLA' && ownerType !== 'NOTARIA') throw new CatalogConfigurationError(400, 'BANK_TEMPLATE_FORBIDDEN', 'Las Plantillas pertenecen exclusivamente a una Notaría.');
    const ownerId = requiredText(ownerType === 'NOTARIA' ? input.notaria_id : input.institucion_id, 'Propietario', 64);
    await assertOwner(actor, ownerType, ownerId);
    const parentId = optionalText(input.parent_id, 64);
    await validateFolder(actor, parentId, ownerType, ownerId, type);
    const data = { organization_id: actor.organizationId, propietario_tipo: ownerType, tipo: type, notaria_id: ownerType === 'NOTARIA' ? ownerId : null, institucion_id: ownerType === 'INSTITUCION' ? ownerId : null, parent_id: parentId, nombre: requiredText(input.nombre, 'Nombre de la carpeta'), activa: true };
    return prisma.$transaction(async (tx) => { const folder = await tx.catalogoCarpeta.create({ data }); await audit(tx, actor, 'CFG_FOLDER_CREATED', 'CatalogoCarpeta', folder.id, undefined, folder); return folder; });
  },

  async createArtifact(actor: Actor, input: any, file: Express.Multer.File) {
    const type = enumValue(CatalogoArtefactoTipo, input.tipo, 'Tipo de archivo maestro');
    const ownerType = enumValue(CatalogoPropietarioTipo, input.propietario_tipo, 'Tipo de propietario');
    if (type === 'PLANTILLA' && ownerType !== 'NOTARIA') throw new CatalogConfigurationError(400, 'BANK_TEMPLATE_FORBIDDEN', 'Las Plantillas pertenecen exclusivamente a una Notaría.');
    const ownerId = requiredText(ownerType === 'NOTARIA' ? input.notaria_id : input.institucion_id, 'Propietario', 64);
    await assertOwner(actor, ownerType, ownerId);
    const folderId = optionalText(input.carpeta_id, 64);
    await validateFolder(actor, folderId, ownerType, ownerId, type);
    const actIds = idList(input.act_ids); const rules = Array.isArray(input.rules) ? input.rules : [];
    await validateRulesAndActs(actor, actIds, rules);
    const version = positive(input.version || 1, 'Versión');
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storageKey = `organizations/${actor.organizationId}/catalogos/plantillas-formatos/${randomUUID()}_${safeName}`;
    await uploadFile(file.buffer, storageKey, file.mimetype);
    try {
      return await prisma.$transaction(async (tx) => {
        const artifact = await tx.catalogoArtefacto.create({ data: {
          organization_id: actor.organizationId, tipo: type, propietario_tipo: ownerType, notaria_id: ownerType === 'NOTARIA' ? ownerId : null, institucion_id: ownerType === 'INSTITUCION' ? ownerId : null,
          carpeta_id: folderId, nombre: requiredText(input.nombre, 'Nombre'), descripcion: optionalText(input.descripcion), activo: booleanValue(input.activo, true), creado_por_id: actor.id, actualizado_por_id: actor.id,
          versiones: { create: { organization_id: actor.organizationId, version, nombre_original: file.originalname, storage_key: storageKey, mime_type: file.mimetype || 'application/octet-stream', size_bytes: file.size, checksum_sha256: checksum, origen: 'CARGA_USUARIO', creado_por_id: actor.id } },
          actos: { create: actIds.map((tipoActoId) => ({ organization_id: actor.organizationId, tipo_acto_id: tipoActoId })) },
          reglas: rules.length ? { create: rules.map((rule: any) => ruleData(actor, rule)) } : undefined,
        }, include: artifactInclude });
        await audit(tx, actor, 'CFG_ARTIFACT_CREATED', 'CatalogoArtefacto', artifact.id, undefined, redactPrivateArtifactData(artifact));
        return artifact;
      });
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  },

  async addVersion(actor: Actor, artifactId: string, input: any, file: Express.Multer.File) {
    const artifact = await prisma.catalogoArtefacto.findFirst({ where: { id: artifactId, organization_id: actor.organizationId }, include: { versiones: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!artifact) throw new CatalogConfigurationError(404, 'ARTIFACT_NOT_FOUND', 'Archivo maestro no encontrado.');
    const version = input.version ? positive(input.version, 'Versión') : (artifact.versiones[0]?.version || 0) + 1;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `organizations/${actor.organizationId}/catalogos/plantillas-formatos/${randomUUID()}_${file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    await uploadFile(file.buffer, storageKey, file.mimetype);
    try {
      return await prisma.$transaction(async (tx) => {
        const record = await tx.catalogoArtefactoVersion.create({ data: { organization_id: actor.organizationId, artefacto_id: artifactId, version, nombre_original: file.originalname, storage_key: storageKey, mime_type: file.mimetype || 'application/octet-stream', size_bytes: file.size, checksum_sha256: checksum, origen: 'NUEVA_VERSION_USUARIO', creado_por_id: actor.id } });
        await tx.catalogoArtefacto.update({ where: { id: artifactId }, data: { actualizado_por_id: actor.id } });
        await audit(tx, actor, 'CFG_ARTIFACT_VERSION_CREATED', 'CatalogoArtefactoVersion', record.id, undefined, { ...record, storage_key: '[PRIVATE]' });
        return record;
      });
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  },

  async updateArtifact(actor: Actor, artifactId: string, input: any) {
    const before = await prisma.catalogoArtefacto.findFirst({ where: { id: artifactId, organization_id: actor.organizationId }, include: artifactInclude });
    if (!before) throw new CatalogConfigurationError(404, 'ARTIFACT_NOT_FOUND', 'Archivo maestro no encontrado.');
    const actIds = input.act_ids === undefined ? before.actos.map((item) => item.tipo_acto_id) : idList(input.act_ids);
    const rules = input.rules === undefined ? null : Array.isArray(input.rules) ? input.rules : [];
    if (rules !== null) await validateRulesAndActs(actor, actIds, rules);
    else await validateRulesAndActs(actor, actIds, before.reglas);
    return prisma.$transaction(async (tx) => {
      await tx.catalogoArtefacto.update({ where: { id: artifactId }, data: { ...(input.nombre !== undefined ? { nombre: requiredText(input.nombre, 'Nombre') } : {}), ...(input.descripcion !== undefined ? { descripcion: optionalText(input.descripcion) } : {}), ...(input.activo !== undefined ? { activo: Boolean(input.activo) } : {}), actualizado_por_id: actor.id } });
      if (input.act_ids !== undefined) { await tx.catalogoArtefactoActo.deleteMany({ where: { artefacto_id: artifactId } }); await tx.catalogoArtefactoActo.createMany({ data: actIds.map((id) => ({ organization_id: actor.organizationId, artefacto_id: artifactId, tipo_acto_id: id })) }); }
      if (rules !== null) { await tx.catalogoArtefactoRegla.deleteMany({ where: { artefacto_id: artifactId } }); if (rules.length) await tx.catalogoArtefactoRegla.createMany({ data: rules.map((rule: any) => ({ artefacto_id: artifactId, ...ruleData(actor, rule) })) }); }
      const after = await tx.catalogoArtefacto.findUniqueOrThrow({ where: { id: artifactId }, include: artifactInclude });
      await audit(tx, actor, 'CFG_ARTIFACT_UPDATED', 'CatalogoArtefacto', artifactId, redactPrivateArtifactData(before), redactPrivateArtifactData(after));
      return after;
    });
  },

  async signedUrl(actor: Actor, versionId: string) {
    const version = await prisma.catalogoArtefactoVersion.findFirst({ where: { id: versionId, organization_id: actor.organizationId, activa: true, artefacto: { activo: true } }, select: { id: true, storage_key: true, nombre_original: true, mime_type: true, version: true } });
    if (!version) throw new CatalogConfigurationError(404, 'ARTIFACT_VERSION_NOT_FOUND', 'Versión no encontrada.');
    if (!version.storage_key || !version.nombre_original || !version.mime_type) throw new CatalogConfigurationError(404, 'ARTIFACT_FILE_VERSION_NOT_FOUND', 'La versión de archivo no está disponible.');
    return { url: await getSignedUrl(version.storage_key, 600), expires_in: 600, file_name: version.nombre_original, mime_type: version.mime_type, version: version.version };
  },
};
