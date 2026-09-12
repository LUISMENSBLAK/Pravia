import { randomUUID } from 'crypto';
import {
  ConfiguracionActividadNaturaleza,
  ConfiguracionAlcanceInstancia,
  ConfiguracionFuenteTiempo,
  ConfiguracionTipoDias,
  ConfiguracionUnidadTiempo,
  Prisma,
  Role,
} from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { CatalogConfigurationError } from './configurationCatalogError';
import {
  inheritableActivityAttributes,
  resolveInheritedActivity,
  validateDeclarativeCondition,
  type InheritableActivityAttribute,
} from './configurationCatalogV2.domain';

export { inheritableActivityAttributes, resolveInheritedActivity, validateDeclarativeCondition } from './configurationCatalogV2.domain';

type Actor = NonNullable<Request['user']>;
type Db = typeof prisma | Prisma.TransactionClient;

const clean = (value: unknown, max = 240) => String(value || '').trim().slice(0, max);
const code = (value: unknown) => clean(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const enumInput = <T extends Record<string, string>>(values: T, value: unknown, label: string): T[keyof T] => {
  if (!Object.values(values).includes(value as T[keyof T])) throw new CatalogConfigurationError(400, 'CFG_ENUM_INVALID', `${label} no es válido.`);
  return value as T[keyof T];
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const audit = (db: Db, actor: Actor, action: string, entity: string, id: string, before?: unknown, after?: unknown) => db.auditLog.create({ data: {
  organization_id: actor.organizationId, user_id: actor.id, accion: action, entidad: entity, entidad_id: id,
  valores_anteriores: before === undefined ? undefined : json(before), valores_nuevos: after === undefined ? undefined : json(after), session_id: actor.sessionId,
} });

const graphHasCycle = (rows: Array<{ actividad_id: string; depende_actividad_id: string }>) => {
  const graph = new Map<string, string[]>(); rows.forEach((row) => graph.set(row.actividad_id, [...(graph.get(row.actividad_id) || []), row.depende_actividad_id]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); if ((graph.get(id) || []).some(visit)) return true; visiting.delete(id); visited.add(id); return false; };
  return [...graph.keys()].some(visit);
};

export type CriticalPathNode = { id: string; duration: number; margin?: number; dependencyIds: string[]; scopeKey?: string; completedAt?: Date | null };
export function calculateCriticalPath(nodes: CriticalPathNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const edges = nodes.flatMap((node) => node.dependencyIds.filter((dependencyId) => ids.has(dependencyId)).map((dependencyId) => ({ actividad_id: node.id, depende_actividad_id: dependencyId })));
  if (graphHasCycle(edges)) throw new CatalogConfigurationError(409, 'CFG_CRITICAL_PATH_CYCLE', 'No se puede calcular la ruta crítica porque existe un ciclo.');
  const pending = new Map(nodes.map((node) => [node.id, node])); const result = new Map<string, { start: number; end: number }>();
  while (pending.size) {
    let progressed = false;
    for (const [id, node] of pending) {
      const dependencies = node.dependencyIds.filter((dep) => ids.has(dep));
      if (!dependencies.every((dep) => result.has(dep))) continue;
      const start = dependencies.length ? Math.max(...dependencies.map((dep) => result.get(dep)!.end)) : 0;
      const end = start + Math.max(0, node.duration) + Math.max(0, node.margin || 0);
      result.set(id, { start, end }); pending.delete(id); progressed = true;
    }
    if (!progressed) throw new CatalogConfigurationError(409, 'CFG_CRITICAL_PATH_UNRESOLVED', 'No se pudo resolver la ruta crítica.');
  }
  const total = result.size ? Math.max(...[...result.values()].map((item) => item.end)) : 0;
  return { total, nodes: Object.fromEntries(result), parallel_semantics: 'MAX' as const };
}

type StandardConcept = { code: string; name: string; duration: number; nature?: ConfiguracionActividadNaturaleza; dayType?: ConfiguracionTipoDias; source?: ConfiguracionFuenteTiempo };
export const standardConcepts: StandardConcept[] = [
  { code: 'REVISION_INICIAL', name: 'Revisión de expediente', duration: 3 },
  { code: 'SOLICITUD_CLG', name: 'Solicitud aviso preventivo y CLG', duration: 2, nature: 'INGRESO_A_EXTERNO' },
  { code: 'INGRESO_CLG', name: 'Ingreso aviso preventivo y CLG a RPP', duration: 1, nature: 'INGRESO_A_EXTERNO' },
  { code: 'OBTENCION_CLG', name: 'Recepción CLG', duration: 10, nature: 'ESPERA_EXTERNA' },
  { code: 'ENTREGA_CLG', name: 'Entrega CLG al responsable', duration: 1 },
  { code: 'SOLICITUD_AVALUO', name: 'Solicitud de avalúo', duration: 2, nature: 'INGRESO_A_EXTERNO' },
  { code: 'OBTENCION_AVALUO', name: 'Recepción de avalúo', duration: 0, nature: 'ESPERA_EXTERNA' },
  { code: 'PROYECCION_INSTRUMENTO', name: 'Elaboración / Proyección', duration: 1 },
  { code: 'FIRMA', name: 'Firma', duration: 0, nature: 'CLIENTE_HITO' },
  { code: 'SOLVENCIA_INGRESO', name: 'Ingreso a Solvencia / Catastro', duration: 10, nature: 'INGRESO_A_EXTERNO' },
  { code: 'SOLVENCIA_OBTENCION', name: 'Recepción Solvencia', duration: 30, nature: 'ESPERA_EXTERNA' },
  { code: 'RPP_INGRESO', name: 'Ingreso a Registro Público', duration: 2, nature: 'INGRESO_A_EXTERNO' },
  { code: 'RPP_OBTENCION', name: 'Recepción Registro Público', duration: 45, nature: 'ESPERA_EXTERNA' },
  { code: 'ARMADO_TESTIMONIO', name: 'Armado de testimonio', duration: 2 },
  { code: 'ARCHIVO', name: 'Entrega a Archivo', duration: 5 },
  { code: 'ENTREGA_CLIENTE', name: 'Entrega testimonio al cliente', duration: 0, nature: 'CLIENTE_HITO' },
  { code: 'ENVIO_ACREEDOR', name: 'Envío a revisión del acreedor', duration: 1, nature: 'INGRESO_A_EXTERNO' },
  { code: 'VOBO_ACREEDOR', name: 'Vo.Bo. acreedor', duration: 15, nature: 'ESPERA_EXTERNA', source: 'INSTITUCION' },
  { code: 'VOBO_BANCO', name: 'Vo.Bo. del banco', duration: 0, nature: 'ESPERA_EXTERNA', source: 'INSTITUCION' },
  { code: 'SRE_SOLICITUD', name: 'Solicitud SRE', duration: 2, nature: 'INGRESO_A_EXTERNO' },
  { code: 'SRE_OBTENCION', name: 'Obtención SRE', duration: 10, nature: 'ESPERA_EXTERNA' },
  { code: 'REVISION_BANCO', name: 'Envío / solicitud de revisión al banco', duration: 1, nature: 'INGRESO_A_EXTERNO' },
  { code: 'FIRMA_BANCO', name: 'Firmado por el banco', duration: 10, nature: 'CLIENTE_HITO' },
  { code: 'AVISO_DIRECCION', name: 'Aviso a la Dirección del Notariado', duration: 3, nature: 'INGRESO_A_EXTERNO' },
  { code: 'AVISO_DOMINIO', name: 'Aviso de dominio', duration: 3, nature: 'INGRESO_A_EXTERNO' },
];

export const standardActInheritance = [
  { act: 'Donación', base: 'Compraventa', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Adjudicación', base: 'Compraventa', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Permuta', base: 'Compraventa', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Dación en pago', base: 'Compraventa', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Compraventa con reserva de dominio', base: 'Compraventa', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Cancelación de hipoteca', base: 'Compraventa', family: 'INMOBILIARIO', exclusions: ['SOLICITUD_AVALUO', 'OBTENCION_AVALUO', 'SOLVENCIA_INGRESO', 'SOLVENCIA_OBTENCION', 'UIF'] },
  { act: 'Cesión de derechos fideicomisarios', base: 'Constitución de fideicomiso', family: 'FIDUCIARIO', exclusions: [] },
  { act: 'Reversión de fideicomiso', base: 'Constitución de fideicomiso', family: 'FIDUCIARIO', exclusions: ['SRE_SOLICITUD', 'SRE_OBTENCION'] },
  { act: 'Extinción / ejecución de fines de fideicomiso', base: 'Constitución de fideicomiso', family: 'FIDUCIARIO', exclusions: ['SRE_SOLICITUD', 'SRE_OBTENCION'] },
  { act: 'Transmisión en ejecución de fideicomiso', base: 'Constitución de fideicomiso', family: 'FIDUCIARIO', exclusions: ['SRE_SOLICITUD', 'SRE_OBTENCION'] },
  { act: 'Transmisión en ejecución de fideicomiso + constitución de nuevo fideicomiso', base: 'Constitución de fideicomiso', family: 'FIDUCIARIO', exclusions: [] },
  { act: 'Compraventa con crédito sin garantía hipotecaria', base: 'Compraventa con crédito y garantía hipotecaria', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Protocolización de subdivisión', base: 'Protocolización inmobiliaria', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Protocolización de fusión', base: 'Protocolización inmobiliaria', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Protocolización de homologación', base: 'Protocolización inmobiliaria', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Protocolización de documentos cuando corresponda', base: 'Protocolización inmobiliaria', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Rectificación de escritura de medidas', base: 'Protocolización inmobiliaria', family: 'INMOBILIARIO', exclusions: [] },
  { act: 'Rectificación de escritura de otros datos', base: 'Protocolización inmobiliaria', family: 'INMOBILIARIO', exclusions: ['SOLICITUD_CLG', 'INGRESO_CLG', 'OBTENCION_CLG', 'ENTREGA_CLG', 'SOLVENCIA_INGRESO', 'SOLVENCIA_OBTENCION'] },
  { act: 'Testamento', base: 'Poder sin registro', family: 'CORTO', exclusions: [] },
  { act: 'Ratificación de firmas', base: 'Poder sin registro', family: 'CORTO', exclusions: ['AVISO_DIRECCION'] },
  { act: 'Testimonial', base: 'Poder sin registro', family: 'CORTO', exclusions: ['AVISO_DIRECCION'] },
  { act: 'Poder para actos de dominio limitado', base: 'Poder sin registro', family: 'CORTO_REGISTRABLE', exclusions: [] },
  { act: 'Poder para actos de dominio', base: 'Poder sin registro', family: 'CORTO', exclusions: [] },
  { act: 'Poder de persona moral', base: 'Poder para actos de dominio limitado', family: 'SOCIETARIO', exclusions: ['AVISO_DOMINIO'] },
  { act: 'Protocolización del acta de asamblea no vulnerable', base: 'Poder de persona moral', family: 'SOCIETARIO', exclusions: [] },
  { act: 'Protocolización del acta de asamblea vulnerable', base: 'Protocolización del acta de asamblea no vulnerable', family: 'SOCIETARIO', exclusions: [] },
] as const;

type FlowStep = { concept: string; stage: string; dependsOn?: string[]; parallel?: string; durationOverride?: number };
export const standardFlowSpecs: Record<string, FlowStep[]> = {
  Compraventa: [
    { concept: 'REVISION_INICIAL', stage: 'Prefirma' },
    { concept: 'SOLICITUD_CLG', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'INGRESO_CLG', stage: 'Prefirma', dependsOn: ['SOLICITUD_CLG'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'OBTENCION_CLG', stage: 'Prefirma', dependsOn: ['INGRESO_CLG'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'ENTREGA_CLG', stage: 'Prefirma', dependsOn: ['OBTENCION_CLG'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'SOLICITUD_AVALUO', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'OBTENCION_AVALUO', stage: 'Prefirma', dependsOn: ['SOLICITUD_AVALUO'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'PROYECCION_INSTRUMENTO', stage: 'Prefirma', dependsOn: ['ENTREGA_CLG', 'OBTENCION_AVALUO'] },
    { concept: 'FIRMA', stage: 'Firma', dependsOn: ['PROYECCION_INSTRUMENTO'] },
    { concept: 'SOLVENCIA_INGRESO', stage: 'Postfirma', dependsOn: ['FIRMA'] },
    { concept: 'SOLVENCIA_OBTENCION', stage: 'Postfirma', dependsOn: ['SOLVENCIA_INGRESO'] },
    { concept: 'RPP_INGRESO', stage: 'Registro', dependsOn: ['SOLVENCIA_OBTENCION'] },
    { concept: 'RPP_OBTENCION', stage: 'Registro', dependsOn: ['RPP_INGRESO'] },
    { concept: 'ARMADO_TESTIMONIO', stage: 'Cierre', dependsOn: ['RPP_OBTENCION'] },
    { concept: 'ARCHIVO', stage: 'Cierre', dependsOn: ['ARMADO_TESTIMONIO'] },
    { concept: 'ENTREGA_CLIENTE', stage: 'Cierre', dependsOn: ['ARMADO_TESTIMONIO'] },
  ],
  'Constitución de fideicomiso': [
    { concept: 'SRE_SOLICITUD', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'SRE_OBTENCION', stage: 'Prefirma', dependsOn: ['SRE_SOLICITUD'], parallel: 'DOCUMENTOS_EXTERNOS' },
    { concept: 'REVISION_BANCO', stage: 'Prefirma', dependsOn: ['PROYECCION_INSTRUMENTO'] },
    { concept: 'VOBO_BANCO', stage: 'Prefirma', dependsOn: ['REVISION_BANCO'] },
    { concept: 'FIRMA', stage: 'Firma', dependsOn: ['PROYECCION_INSTRUMENTO', 'VOBO_BANCO', 'SRE_OBTENCION'] },
    { concept: 'FIRMA_BANCO', stage: 'Firma', dependsOn: ['FIRMA'] },
    { concept: 'SOLVENCIA_INGRESO', stage: 'Postfirma', dependsOn: ['FIRMA_BANCO'] },
  ],
  'Compraventa con crédito y garantía hipotecaria': [
    { concept: 'ENVIO_ACREEDOR', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'] },
    { concept: 'VOBO_ACREEDOR', stage: 'Prefirma', dependsOn: ['ENVIO_ACREEDOR'] },
    { concept: 'FIRMA', stage: 'Firma', dependsOn: ['PROYECCION_INSTRUMENTO', 'VOBO_ACREEDOR'] },
  ],
  'Protocolización inmobiliaria': [
    { concept: 'REVISION_INICIAL', stage: 'Prefirma', durationOverride: 5 },
    { concept: 'SOLICITUD_CLG', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'] },
    { concept: 'INGRESO_CLG', stage: 'Prefirma', dependsOn: ['SOLICITUD_CLG'] },
    { concept: 'OBTENCION_CLG', stage: 'Prefirma', dependsOn: ['INGRESO_CLG'] },
    { concept: 'ENTREGA_CLG', stage: 'Prefirma', dependsOn: ['OBTENCION_CLG'] },
    { concept: 'SOLICITUD_AVALUO', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'] },
    { concept: 'OBTENCION_AVALUO', stage: 'Prefirma', dependsOn: ['SOLICITUD_AVALUO'] },
    { concept: 'PROYECCION_INSTRUMENTO', stage: 'Prefirma', dependsOn: ['ENTREGA_CLG', 'OBTENCION_AVALUO'] },
    { concept: 'FIRMA', stage: 'Firma', dependsOn: ['PROYECCION_INSTRUMENTO'] },
    { concept: 'SOLVENCIA_INGRESO', stage: 'Postfirma', dependsOn: ['FIRMA'] },
    { concept: 'SOLVENCIA_OBTENCION', stage: 'Postfirma', dependsOn: ['SOLVENCIA_INGRESO'], durationOverride: 90 },
    { concept: 'RPP_INGRESO', stage: 'Registro', dependsOn: ['SOLVENCIA_OBTENCION'] },
    { concept: 'RPP_OBTENCION', stage: 'Registro', dependsOn: ['RPP_INGRESO'], durationOverride: 50 },
    { concept: 'ARMADO_TESTIMONIO', stage: 'Cierre', dependsOn: ['RPP_OBTENCION'] },
    { concept: 'ENTREGA_CLIENTE', stage: 'Cierre', dependsOn: ['ARMADO_TESTIMONIO'] },
    { concept: 'ARCHIVO', stage: 'Cierre', dependsOn: ['ARMADO_TESTIMONIO'] },
  ],
  'Poder sin registro': [
    { concept: 'REVISION_INICIAL', stage: 'Prefirma', durationOverride: 2 },
    { concept: 'PROYECCION_INSTRUMENTO', stage: 'Prefirma', dependsOn: ['REVISION_INICIAL'] },
    { concept: 'FIRMA', stage: 'Firma', dependsOn: ['PROYECCION_INSTRUMENTO'], durationOverride: 3 },
    { concept: 'AVISO_DIRECCION', stage: 'Postfirma', dependsOn: ['FIRMA'], parallel: 'CIERRE_CORTO' },
    { concept: 'ARMADO_TESTIMONIO', stage: 'Postfirma', dependsOn: ['FIRMA'], parallel: 'CIERRE_CORTO' },
    { concept: 'ENTREGA_CLIENTE', stage: 'Cierre', dependsOn: ['ARMADO_TESTIMONIO'], durationOverride: 1 },
    { concept: 'ARCHIVO', stage: 'Cierre', dependsOn: ['ARMADO_TESTIMONIO'] },
  ],
  'Poder para actos de dominio limitado': [
    { concept: 'AVISO_DOMINIO', stage: 'Postfirma', dependsOn: ['FIRMA'], parallel: 'CIERRE_DOMINIO' },
    { concept: 'RPP_INGRESO', stage: 'Registro', dependsOn: ['FIRMA'], parallel: 'CIERRE_DOMINIO' },
    { concept: 'RPP_OBTENCION', stage: 'Registro', dependsOn: ['RPP_INGRESO'] },
    { concept: 'ARMADO_TESTIMONIO', stage: 'Cierre', dependsOn: ['RPP_OBTENCION'] },
  ],
  'Poder para actos de dominio': [
    { concept: 'AVISO_DOMINIO', stage: 'Postfirma', dependsOn: ['FIRMA'], parallel: 'CIERRE_DOMINIO' },
  ],
  'Protocolización del acta de asamblea no vulnerable': [
    { concept: 'REVISION_INICIAL', stage: 'Prefirma', durationOverride: 5 },
  ],
};

export class ConfigurationCatalogV2Service {
  async listConcepts(actor: Actor) {
    return prisma.configuracionConceptoActividad.findMany({ where: { organization_id: actor.organizationId }, orderBy: [{ activa: 'desc' }, { nombre: 'asc' }] });
  }

  async createConcept(actor: Actor, input: any) {
    const name = clean(input.nombre); if (!name) throw new CatalogConfigurationError(400, 'CFG_CONCEPT_NAME_REQUIRED', 'El nombre del concepto es obligatorio.');
    const duration = Number(input.duracion_estimada ?? 0); const margin = Number(input.margen_seguridad ?? 0);
    if (!Number.isInteger(duration) || duration < 0 || !Number.isInteger(margin) || margin < 0) throw new CatalogConfigurationError(400, 'CFG_CONCEPT_TIME_INVALID', 'Duración y margen deben ser enteros iguales o mayores a cero.');
    const condition = validateDeclarativeCondition(input.condicion_json);
    const responsibleUserId = clean(input.responsable_usuario_id, 64) || null;
    const responsibleRole = input.responsable_rol ? enumInput(Role, input.responsable_rol, 'Rol responsable') : null;
    if (responsibleRole && responsibleUserId) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_AMBIGUOUS', 'Selecciona un rol o un usuario, no ambos.');
    if (responsibleUserId && !(await prisma.organizationMembership.findFirst({ where: { organization_id: actor.organizationId, user_id: responsibleUserId, status: 'ACTIVE', user: { activo: true } }, select: { id: true } }))) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_OUTSIDE_TENANT', 'El responsable debe pertenecer a la organización activa.');
    return prisma.$transaction(async (tx) => {
      const item = await tx.configuracionConceptoActividad.create({ data: {
        organization_id: actor.organizationId, codigo: code(input.codigo || name), nombre: name, descripcion: clean(input.descripcion, 600) || null,
        naturaleza: enumInput(ConfiguracionActividadNaturaleza, input.naturaleza || 'INTERNA', 'Naturaleza'), duracion_estimada: duration,
        unidad_tiempo: enumInput(ConfiguracionUnidadTiempo, input.unidad_tiempo || 'DIAS', 'Unidad'), tipo_dias: enumInput(ConfiguracionTipoDias, input.tipo_dias || 'HABILES', 'Tipo de días'),
        margen_seguridad: margin, responsable_rol: responsibleRole, responsable_usuario_id: responsibleUserId,
        aplica_por_defecto: input.aplica_por_defecto !== false, fuente_tiempo: enumInput(ConfiguracionFuenteTiempo, input.fuente_tiempo || 'GENERAL', 'Fuente del tiempo'), condicion_json: condition,
      } });
      await audit(tx, actor, 'CFG_V2_CONCEPT_CREATED', 'ConfiguracionConceptoActividad', item.id, undefined, item); return item;
    });
  }

  async updateConcept(actor: Actor, id: string, input: any) {
    const before = await prisma.configuracionConceptoActividad.findFirst({ where: { id, organization_id: actor.organizationId } });
    if (!before) throw new CatalogConfigurationError(404, 'CFG_CONCEPT_NOT_FOUND', 'Concepto maestro no encontrado.');
    if (input.expected_revision !== undefined && (!Number.isInteger(input.expected_revision) || input.expected_revision !== before.revision)) {
      throw new CatalogConfigurationError(409, 'CFG_CONCEPT_VERSION_CONFLICT', 'El concepto cambió en otra sesión. Recarga antes de guardar.');
    }
    const data: Prisma.ConfiguracionConceptoActividadUpdateInput = { revision: { increment: 1 } };
    if (input.nombre !== undefined) { const name = clean(input.nombre); if (!name) throw new CatalogConfigurationError(400, 'CFG_CONCEPT_NAME_REQUIRED', 'El nombre del concepto es obligatorio.'); data.nombre = name; }
    if (input.descripcion !== undefined) data.descripcion = clean(input.descripcion, 600) || null;
    for (const key of ['duracion_estimada', 'margen_seguridad'] as const) if (input[key] !== undefined) {
      const value = Number(input[key]);
      if (!Number.isInteger(value) || value < 0) throw new CatalogConfigurationError(400, 'CFG_CONCEPT_TIME_INVALID', 'Duración y margen deben ser enteros iguales o mayores a cero.');
      data[key] = value;
    }
    if (input.naturaleza !== undefined) data.naturaleza = enumInput(ConfiguracionActividadNaturaleza, input.naturaleza, 'Naturaleza');
    if (input.unidad_tiempo !== undefined) data.unidad_tiempo = enumInput(ConfiguracionUnidadTiempo, input.unidad_tiempo, 'Unidad');
    if (input.tipo_dias !== undefined) data.tipo_dias = enumInput(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días');
    if (input.fuente_tiempo !== undefined) data.fuente_tiempo = enumInput(ConfiguracionFuenteTiempo, input.fuente_tiempo, 'Fuente del tiempo');
    if (input.responsable_rol !== undefined) data.responsable_rol = input.responsable_rol ? enumInput(Role, input.responsable_rol, 'Rol responsable') : null;
    if (input.responsable_usuario_id !== undefined) {
      const userId = clean(input.responsable_usuario_id, 64) || null;
      if (userId && !(await prisma.organizationMembership.findFirst({ where: { organization_id: actor.organizationId, user_id: userId, status: 'ACTIVE', user: { activo: true } }, select: { id: true } }))) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_OUTSIDE_TENANT', 'El responsable debe pertenecer a la organización activa.');
      (data as any).responsable_usuario_id = userId;
    }
    const effectiveRole = input.responsable_rol !== undefined ? (data.responsable_rol as Role | null) : before.responsable_rol;
    const effectiveUserId = input.responsable_usuario_id !== undefined ? (data as any).responsable_usuario_id : before.responsable_usuario_id;
    if (effectiveRole && effectiveUserId) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_AMBIGUOUS', 'Selecciona un rol o un usuario, no ambos.');
    for (const key of ['aplica_por_defecto', 'activa'] as const) if (input[key] !== undefined) (data as any)[key] = Boolean(input[key]);
    if (input.condicion_json !== undefined) data.condicion_json = validateDeclarativeCondition(input.condicion_json) ?? Prisma.JsonNull;
    return prisma.$transaction(async (tx) => {
      const updated = await tx.configuracionConceptoActividad.updateMany({ where: { id, organization_id: actor.organizationId, revision: before.revision }, data });
      if (updated.count !== 1) throw new CatalogConfigurationError(409, 'CFG_CONCEPT_VERSION_CONFLICT', 'El concepto cambió en otra sesión. Recarga antes de guardar.');
      const item = await tx.configuracionConceptoActividad.findUniqueOrThrow({ where: { id } });
      await audit(tx, actor, 'CFG_V2_CONCEPT_UPDATED', 'ConfiguracionConceptoActividad', id, before, item); return item;
    });
  }

  async createApplication(actor: Actor, stageId: string, input: any) {
    const stage = await prisma.configuracionEtapa.findFirst({ where: { id: stageId, organization_id: actor.organizationId }, select: { id: true, configuracion_id: true } });
    const concept = await prisma.configuracionConceptoActividad.findFirst({ where: { id: String(input.concepto_maestro_id || ''), organization_id: actor.organizationId, activa: true } });
    if (!stage || !concept) throw new CatalogConfigurationError(404, 'CFG_APPLICATION_SOURCE_NOT_FOUND', 'No se encontró la etapa o el concepto maestro.');
    const inherited = Array.isArray(input.atributos_heredados) ? input.atributos_heredados.filter((item: unknown) => inheritableActivityAttributes.includes(item as any)) : [...inheritableActivityAttributes];
    return prisma.$transaction(async (tx) => {
      const item = await tx.configuracionActividad.create({ data: {
        organization_id: actor.organizationId, etapa_id: stage.id, concepto_maestro_id: concept.id, nombre: concept.nombre, descripcion: concept.descripcion,
        duracion_estimada: concept.duracion_estimada, tipo_dias: concept.tipo_dias, margen_seguridad: concept.margen_seguridad,
        responsable_rol: concept.responsable_rol, responsable_usuario_id: concept.responsable_usuario_id, aplica_por_defecto: concept.aplica_por_defecto,
        naturaleza: concept.naturaleza, unidad_tiempo: concept.unidad_tiempo, fuente_tiempo: concept.fuente_tiempo, condicion_json: concept.condicion_json ?? undefined,
        alcance_instancia: input.alcance_instancia || 'ACTO', atributos_heredados: inherited, grupo_paralelo: clean(input.grupo_paralelo, 80) || null,
        orden_operativo: Number.isInteger(input.orden_operativo) ? input.orden_operativo : 0,
      } });
      const configuration = await tx.configuracionActo.findUniqueOrThrow({ where: { id: stage.configuracion_id }, select: { exclusiones_conceptos: true } });
      const exclusions = (Array.isArray(configuration.exclusiones_conceptos) ? configuration.exclusiones_conceptos as string[] : []).filter((item) => item !== concept.codigo);
      await tx.configuracionActo.update({ where: { id: stage.configuracion_id }, data: { revision: { increment: 1 }, requiere_revision: true, actualizado_por_id: actor.id, exclusiones_conceptos: exclusions } });
      await audit(tx, actor, 'CFG_V2_APPLICATION_CREATED', 'ConfiguracionActividad', item.id, undefined, { ...item, source: 'MASTER_CONCEPT' }); return item;
    });
  }

  async revertAttribute(actor: Actor, activityId: string, attribute: string) {
    if (!inheritableActivityAttributes.includes(attribute as InheritableActivityAttribute)) throw new CatalogConfigurationError(400, 'CFG_INHERITANCE_ATTRIBUTE_INVALID', 'El atributo no admite herencia.');
    const before = await prisma.configuracionActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId }, include: { etapa: true } });
    if (!before?.concepto_maestro_id) throw new CatalogConfigurationError(409, 'CFG_INHERITANCE_SOURCE_REQUIRED', 'La actividad no tiene concepto maestro al cual volver.');
    const inherited = new Set(Array.isArray(before.atributos_heredados) ? before.atributos_heredados as string[] : []); inherited.add(attribute);
    return prisma.$transaction(async (tx) => { const item = await tx.configuracionActividad.update({ where: { id: activityId }, data: { atributos_heredados: [...inherited] } }); await tx.configuracionActo.update({ where: { id: before.etapa.configuracion_id }, data: { revision: { increment: 1 }, requiere_revision: true, actualizado_por_id: actor.id } }); await audit(tx, actor, 'CFG_V2_ATTRIBUTE_REVERTED', 'ConfiguracionActividad', activityId, before, { attribute, inherited: true }); return item; });
  }

  async upsertInstitutionResponse(actor: Actor, institutionId: string, input: any) {
    const institution = await prisma.catalogoInstitucion.findFirst({ where: { id: institutionId, organization_id: actor.organizationId } });
    if (!institution) throw new CatalogConfigurationError(404, 'CFG_INSTITUTION_NOT_FOUND', 'Institución no encontrada.');
    const responseName = clean(input.nombre); const responseCode = code(input.codigo || responseName); const duration = Number(input.duracion); const margin = Number(input.margen_seguridad || 0);
    if (!responseName || !responseCode || !Number.isInteger(duration) || duration < 0 || !Number.isInteger(margin) || margin < 0) throw new CatalogConfigurationError(400, 'CFG_INSTITUTION_TIME_INVALID', 'Tipo de respuesta, duración y margen válidos son obligatorios.');
    const dayType = enumInput(ConfiguracionTipoDias, input.tipo_dias || 'HABILES', 'Tipo de días');
    return prisma.$transaction(async (tx) => {
      const item = await tx.catalogoInstitucionTipoRespuesta.upsert({ where: { organization_id_institucion_id_codigo: { organization_id: actor.organizationId, institucion_id: institutionId, codigo: responseCode } }, update: { nombre: responseName, duracion: duration, tipo_dias: dayType, margen_seguridad: margin, activa: input.activa !== false, revision: { increment: 1 } }, create: { organization_id: actor.organizationId, institucion_id: institutionId, codigo: responseCode, nombre: responseName, duracion: duration, tipo_dias: dayType, margen_seguridad: margin } });
      await audit(tx, actor, 'CFG_V2_INSTITUTION_TIME_UPSERTED', 'CatalogoInstitucionTipoRespuesta', item.id, undefined, item); return item;
    });
  }

  async duplicateAct(actor: Actor, actId: string, input: any) {
    const source = await prisma.tipoActo.findFirst({ where: { id: actId, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] }, include: { configuracionesOperativas: { where: { organization_id: actor.organizationId }, include: { etapas: { include: { actividades: { include: { dependencias: true, excepciones: { include: { dependencias_adicionales: true } } } } } } } } } });
    if (!source) throw new CatalogConfigurationError(404, 'ACT_NOT_FOUND', 'Acto no encontrado.');
    const name = clean(input.nombre || `${source.nombre} (copia)`); if (!name) throw new CatalogConfigurationError(400, 'ACT_NAME_REQUIRED', 'El nombre es obligatorio.');
    return prisma.$transaction(async (tx) => {
      const duplicate = await tx.tipoActo.findFirst({ where: { organization_id: actor.organizationId, nombre: { equals: name, mode: 'insensitive' }, archived_at: null }, select: { id: true } });
      if (duplicate) throw new CatalogConfigurationError(409, 'ACT_ALREADY_EXISTS', 'Ya existe un acto con ese nombre.');
      const act = await tx.tipoActo.create({ data: { organization_id: actor.organizationId, codigo_catalogo: `${code(name).slice(0, 60)}_${randomUUID().slice(0, 8).toUpperCase()}`, nombre: name, descripcion: source.descripcion, activo: true } });
      const base = source.configuracionesOperativas[0];
      const configuration = await tx.configuracionActo.create({ data: { organization_id: actor.organizationId, tipo_acto_id: act.id, activa: base?.activa ?? true, requiere_revision: true, revision: 1, familia: base?.familia, hereda_configuracion_id: null, exclusiones_conceptos: [], creado_por_id: actor.id, actualizado_por_id: actor.id } });
      if (base) {
        const chain: any[] = []; const visited = new Set<string>(); let current: any = base;
        while (current) {
          if (visited.has(current.id)) throw new CatalogConfigurationError(409, 'CFG_INHERITANCE_CYCLE', 'La herencia del acto contiene un ciclo.');
          visited.add(current.id); chain.unshift(current);
          current = current.hereda_configuracion_id ? await tx.configuracionActo.findFirst({ where: { id: current.hereda_configuracion_id, organization_id: actor.organizationId }, include: { etapas: { include: { actividades: { include: { dependencias: true, excepciones: { include: { dependencias_adicionales: true } } } } } } } }) : null;
        }
        const exclusions = new Set(Array.isArray(base.exclusiones_conceptos) ? base.exclusiones_conceptos as string[] : []);
        const raw = chain.flatMap((cfg) => cfg.etapas.flatMap((stage: any) => stage.actividades.map((activity: any) => ({ stage, activity }))));
        const conceptIds = [...new Set(raw.map((item) => item.activity.concepto_maestro_id).filter(Boolean))] as string[];
        const masters = conceptIds.length ? await tx.configuracionConceptoActividad.findMany({ where: { organization_id: actor.organizationId, id: { in: conceptIds } } }) : [];
        const masterById = new Map(masters.map((item) => [item.id, item]));
        const effective = new Map<string, any>();
        for (const item of raw) {
          const master = item.activity.concepto_maestro_id ? masterById.get(item.activity.concepto_maestro_id) || null : null;
          if (!master || !exclusions.has(master.codigo)) effective.set(String(item.activity.concepto_maestro_id || item.activity.id), { ...item, activity: resolveInheritedActivity(item.activity, master) });
        }
        const effectiveStages = new Map<string, any>();
        for (const configuration of chain) {
          for (const stage of configuration.etapas) effectiveStages.set(code(stage.nombre), stage);
        }
        const stageMap = new Map<string, string>(); const activityMap = new Map<string, string>();
        for (const stage of [...effectiveStages.values()].sort((left, right) => left.orden - right.orden || left.nombre.localeCompare(right.nombre, 'es'))) {
          const targetStage = await tx.configuracionEtapa.create({ data: { organization_id: actor.organizationId, configuracion_id: configuration.id, nombre: stage.nombre, orden: stage.orden, activa: stage.activa } });
          stageMap.set(code(stage.nombre), targetStage.id);
        }
        for (const { stage, activity } of effective.values()) {
          const stageKey = code(stage.nombre);
          let targetStageId = stageMap.get(stageKey);
          if (!targetStageId) {
            const targetStage = await tx.configuracionEtapa.create({ data: { organization_id: actor.organizationId, configuracion_id: configuration.id, nombre: stage.nombre, orden: stage.orden, activa: stage.activa } });
            targetStageId = targetStage.id; stageMap.set(stageKey, targetStageId);
          }
          const cloned = await tx.configuracionActividad.create({ data: {
            organization_id: actor.organizationId, etapa_id: targetStageId, concepto_maestro_id: activity.concepto_maestro_id,
            nombre: activity.nombre, descripcion: activity.descripcion, duracion_estimada: activity.duracion_estimada, tipo_dias: activity.tipo_dias,
            margen_seguridad: activity.margen_seguridad, responsable_rol: activity.responsable_rol, responsable_usuario_id: activity.responsable_usuario_id,
            aplica_por_defecto: activity.aplica_por_defecto, activa: activity.activa, naturaleza: activity.naturaleza, unidad_tiempo: activity.unidad_tiempo,
            fuente_tiempo: activity.fuente_tiempo, condicion_json: activity.condicion_json ?? undefined, alcance_instancia: activity.alcance_instancia,
            atributos_heredados: activity.atributos_heredados || [], grupo_paralelo: activity.grupo_paralelo, orden_operativo: activity.orden_operativo,
          } });
          activityMap.set(activity.id, cloned.id);
        }
        for (const item of raw) {
          const identity = String(item.activity.concepto_maestro_id || item.activity.id);
          const effectiveItem = effective.get(identity); const targetId = effectiveItem ? activityMap.get(effectiveItem.activity.id) : null;
          if (targetId) activityMap.set(item.activity.id, targetId);
        }
        for (const { activity } of effective.values()) {
          const targetActivityId = activityMap.get(activity.id); if (!targetActivityId) continue;
          for (const dependency of activity.dependencias || []) {
            const targetDependencyId = activityMap.get(dependency.depende_actividad_id); if (!targetDependencyId) continue;
            await tx.configuracionDependencia.create({ data: { organization_id: actor.organizationId, actividad_id: targetActivityId, depende_actividad_id: targetDependencyId, bloqueante: dependency.bloqueante } });
          }
          for (const exception of activity.excepciones || []) {
            await tx.configuracionExcepcion.create({ data: {
              organization_id: actor.organizationId, actividad_id: targetActivityId, selector_tipo: exception.selector_tipo,
              institucion_id: exception.institucion_id, tipo_respuesta_id: exception.tipo_respuesta_id, notaria_id: exception.notaria_id, jurisdiccion: exception.jurisdiccion,
              duracion: exception.duracion, tipo_dias: exception.tipo_dias, margen_seguridad: exception.margen_seguridad, activa: exception.activa,
              dependencias_adicionales: { create: (exception.dependencias_adicionales || []).flatMap((dependency: any) => {
                const targetDependencyId = activityMap.get(dependency.depende_actividad_id);
                return targetDependencyId ? [{ organization_id: actor.organizationId, depende_actividad_id: targetDependencyId, bloqueante: dependency.bloqueante }] : [];
              }) },
            } });
          }
        }
      }
      await audit(tx, actor, 'CFG_V2_ACT_DUPLICATED', 'TipoActo', act.id, undefined, { source_act_id: source.id, configuration_id: configuration.id, mode: 'SNAPSHOT' }); return { ...act, configuration };
    });
  }

  async overrideInheritedApplication(actor: Actor, actId: string, sourceActivityId: string, input: any) {
    const target = await prisma.configuracionActo.findFirst({ where: { organization_id: actor.organizationId, tipo_acto_id: actId }, include: { etapas: { include: { actividades: true } } } });
    const source = await prisma.configuracionActividad.findFirst({ where: { id: sourceActivityId, organization_id: actor.organizationId }, include: { etapa: true, dependencias: true, excepciones: { include: { dependencias_adicionales: true } }, concepto_maestro: true } });
    if (!target || !source?.concepto_maestro_id) throw new CatalogConfigurationError(404, 'CFG_INHERITED_APPLICATION_NOT_FOUND', 'No se encontró la aplicación heredada.');
    const ancestors = new Set<string>(); let parentId = target.hereda_configuracion_id;
    while (parentId) {
      if (ancestors.has(parentId)) throw new CatalogConfigurationError(409, 'CFG_INHERITANCE_CYCLE', 'La herencia del acto contiene un ciclo.');
      ancestors.add(parentId);
      const parent = await prisma.configuracionActo.findFirst({ where: { id: parentId, organization_id: actor.organizationId }, select: { hereda_configuracion_id: true } });
      parentId = parent?.hereda_configuracion_id || null;
    }
    if (!ancestors.has(source.etapa.configuracion_id)) throw new CatalogConfigurationError(409, 'CFG_APPLICATION_IS_NOT_INHERITED', 'La actividad no pertenece a un flujo heredado de este acto.');
    const duration = input.duracion_estimada === undefined ? undefined : Number(input.duracion_estimada);
    const margin = input.margen_seguridad === undefined ? undefined : Number(input.margen_seguridad);
    const order = input.orden_operativo === undefined ? undefined : Number(input.orden_operativo);
    if ((duration !== undefined && (!Number.isInteger(duration) || duration < 0)) || (margin !== undefined && (!Number.isInteger(margin) || margin < 0)) || (order !== undefined && (!Number.isInteger(order) || order < 0))) {
      throw new CatalogConfigurationError(400, 'CFG_APPLICATION_NUMBER_INVALID', 'Duración, margen y orden deben ser enteros iguales o mayores a cero.');
    }
    const requestedUserId = input.responsable_usuario_id === undefined ? undefined : clean(input.responsable_usuario_id, 64) || null;
    if (requestedUserId && !(await prisma.organizationMembership.findFirst({ where: { organization_id: actor.organizationId, user_id: requestedUserId, status: 'ACTIVE', user: { activo: true } }, select: { id: true } }))) {
      throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_OUTSIDE_TENANT', 'El responsable debe pertenecer a la organización activa.');
    }
    const requestedRole = input.responsable_rol === undefined ? undefined : input.responsable_rol ? enumInput(Role, input.responsable_rol, 'Rol responsable') : null;
    const resolvedSource = resolveInheritedActivity(source, source.concepto_maestro);
    const effectiveRole = requestedRole !== undefined ? requestedRole : resolvedSource.responsable_rol;
    const effectiveUserId = requestedUserId !== undefined ? requestedUserId : resolvedSource.responsable_usuario_id;
    if (effectiveRole && effectiveUserId) throw new CatalogConfigurationError(400, 'DEFAULT_RESPONSIBLE_AMBIGUOUS', 'Selecciona un rol o un usuario, no ambos.');
    return prisma.$transaction(async (tx) => {
      let stage = target.etapas.find((item) => clean(item.nombre).toLocaleLowerCase('es-MX') === clean(source.etapa.nombre).toLocaleLowerCase('es-MX'));
      if (!stage) stage = await tx.configuracionEtapa.create({ data: { organization_id: actor.organizationId, configuracion_id: target.id, nombre: source.etapa.nombre, orden: source.etapa.orden, activa: source.etapa.activa }, include: { actividades: true } });
      const existing = stage.actividades.find((item) => item.concepto_maestro_id === source.concepto_maestro_id);
      const resolved = resolvedSource;
      const inherited = new Set(Array.isArray(source.atributos_heredados) ? source.atributos_heredados as string[] : []);
      inheritableActivityAttributes.forEach((attribute) => { if (input[attribute] !== undefined) inherited.delete(attribute); });
      const data: any = {
        nombre: input.nombre ?? resolved.nombre, descripcion: input.descripcion ?? resolved.descripcion,
        duracion_estimada: duration ?? resolved.duracion_estimada,
        tipo_dias: input.tipo_dias === undefined ? resolved.tipo_dias : enumInput(ConfiguracionTipoDias, input.tipo_dias, 'Tipo de días'),
        margen_seguridad: margin ?? resolved.margen_seguridad,
        responsable_rol: effectiveRole, responsable_usuario_id: effectiveUserId,
        aplica_por_defecto: input.aplica_por_defecto ?? resolved.aplica_por_defecto,
        activa: input.activa ?? resolved.activa,
        naturaleza: input.naturaleza === undefined ? resolved.naturaleza : enumInput(ConfiguracionActividadNaturaleza, input.naturaleza, 'Naturaleza'),
        unidad_tiempo: input.unidad_tiempo === undefined ? resolved.unidad_tiempo : enumInput(ConfiguracionUnidadTiempo, input.unidad_tiempo, 'Unidad'),
        fuente_tiempo: input.fuente_tiempo === undefined ? resolved.fuente_tiempo : enumInput(ConfiguracionFuenteTiempo, input.fuente_tiempo, 'Fuente del tiempo'),
        condicion_json: input.condicion_json !== undefined ? validateDeclarativeCondition(input.condicion_json) ?? Prisma.JsonNull : resolved.condicion_json ?? Prisma.JsonNull,
        alcance_instancia: input.alcance_instancia === undefined ? resolved.alcance_instancia : enumInput(ConfiguracionAlcanceInstancia, input.alcance_instancia, 'Alcance de instancia'),
        atributos_heredados: [...inherited], grupo_paralelo: input.grupo_paralelo ?? resolved.grupo_paralelo,
        orden_operativo: order ?? resolved.orden_operativo,
      };
      const application = existing
        ? await tx.configuracionActividad.update({ where: { id: existing.id }, data })
        : await tx.configuracionActividad.create({ data: { organization_id: actor.organizationId, etapa_id: stage.id, concepto_maestro_id: source.concepto_maestro_id, ...data } });
      if (!existing) {
        for (const dependency of source.dependencias) await tx.configuracionDependencia.create({ data: { organization_id: actor.organizationId, actividad_id: application.id, depende_actividad_id: dependency.depende_actividad_id, bloqueante: dependency.bloqueante } });
        for (const exception of source.excepciones) await tx.configuracionExcepcion.create({ data: {
          organization_id: actor.organizationId, actividad_id: application.id, selector_tipo: exception.selector_tipo,
          institucion_id: exception.institucion_id, tipo_respuesta_id: exception.tipo_respuesta_id, notaria_id: exception.notaria_id, jurisdiccion: exception.jurisdiccion,
          duracion: exception.duracion, tipo_dias: exception.tipo_dias, margen_seguridad: exception.margen_seguridad, activa: exception.activa,
          dependencias_adicionales: { create: exception.dependencias_adicionales.map((dependency) => ({ organization_id: actor.organizationId, depende_actividad_id: dependency.depende_actividad_id, bloqueante: dependency.bloqueante })) },
        } });
      }
      const exclusions = (Array.isArray(target.exclusiones_conceptos) ? target.exclusiones_conceptos as string[] : []).filter((item) => item !== source.concepto_maestro!.codigo);
      await tx.configuracionActo.update({ where: { id: target.id }, data: { exclusiones_conceptos: exclusions, revision: { increment: 1 }, requiere_revision: true, actualizado_por_id: actor.id } });
      await audit(tx, actor, 'CFG_V2_INHERITED_APPLICATION_OVERRIDDEN', 'ConfiguracionActividad', application.id, source, { ...application, target_act_id: actId });
      return application;
    });
  }

  async removeConceptFromAct(actor: Actor, actId: string, activityId: string) {
    const configuration = await prisma.configuracionActo.findFirst({ where: { organization_id: actor.organizationId, tipo_acto_id: actId } });
    const activity = await prisma.configuracionActividad.findFirst({ where: { id: activityId, organization_id: actor.organizationId }, include: { concepto_maestro: true, etapa: true } });
    if (!configuration || !activity?.concepto_maestro) throw new CatalogConfigurationError(404, 'CFG_APPLICATION_NOT_FOUND', 'No se encontró la aplicación del concepto.');
    const chain = new Set([configuration.id]); let parentId = configuration.hereda_configuracion_id;
    while (parentId) {
      if (chain.has(parentId)) throw new CatalogConfigurationError(409, 'CFG_INHERITANCE_CYCLE', 'La herencia del acto contiene un ciclo.');
      chain.add(parentId);
      parentId = (await prisma.configuracionActo.findFirst({ where: { id: parentId, organization_id: actor.organizationId }, select: { hereda_configuracion_id: true } }))?.hereda_configuracion_id || null;
    }
    if (!chain.has(activity.etapa.configuracion_id)) throw new CatalogConfigurationError(404, 'CFG_APPLICATION_NOT_FOUND', 'El concepto no pertenece a este acto.');
    const exclusions = new Set(Array.isArray(configuration.exclusiones_conceptos) ? configuration.exclusiones_conceptos as string[] : []); exclusions.add(activity.concepto_maestro.codigo);
    return prisma.$transaction(async (tx) => {
      const item = await tx.configuracionActo.update({ where: { id: configuration.id }, data: { exclusiones_conceptos: [...exclusions], revision: { increment: 1 }, requiere_revision: true, actualizado_por_id: actor.id } });
      await audit(tx, actor, 'CFG_V2_CONCEPT_REMOVED_FROM_ACT', 'ConfiguracionActo', configuration.id, configuration.exclusiones_conceptos, { concept_code: activity.concepto_maestro!.codigo }); return item;
    });
  }

  async bootstrap(actor: Actor) {
    return prisma.$transaction(async (tx) => {
      let conceptsCreated = 0;
      let actsCreated = 0;
      for (const concept of standardConcepts) {
        const existing = await tx.configuracionConceptoActividad.findUnique({ where: { organization_id_codigo: { organization_id: actor.organizationId, codigo: concept.code } } });
        if (!existing) { await tx.configuracionConceptoActividad.create({ data: { organization_id: actor.organizationId, codigo: concept.code, nombre: concept.name, duracion_estimada: concept.duration, naturaleza: concept.nature || 'INTERNA', tipo_dias: concept.dayType || 'HABILES', fuente_tiempo: concept.source || 'GENERAL' } }); conceptsCreated += 1; }
      }
      let acts = await tx.tipoActo.findMany({ where: { archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] }, include: { configuracionesOperativas: { where: { organization_id: actor.organizationId }, include: { etapas: { include: { actividades: true } } } } } });
      const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX');
      const requiredActNames = [...new Set([
        ...Object.keys(standardFlowSpecs),
        ...standardActInheritance.flatMap((rule) => [rule.act, rule.base]),
      ])];
      for (const name of requiredActNames) {
        if (acts.some((item) => normalized(item.nombre) === normalized(name))) continue;
        const act = await tx.tipoActo.create({ data: {
          organization_id: actor.organizationId,
          codigo_catalogo: `CFG001_${code(name).slice(0, 55)}_${actor.organizationId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          nombre: name,
          descripcion: 'Biblioteca estándar CFG-001 v2.0.',
          activo: true,
        }, include: { configuracionesOperativas: { where: { organization_id: actor.organizationId }, include: { etapas: { include: { actividades: true } } } } } });
        acts.push(act); actsCreated += 1;
      }
      const concepts = await tx.configuracionConceptoActividad.findMany({ where: { organization_id: actor.organizationId } });
      const conceptByCode = new Map(concepts.map((item) => [item.codigo, item]));
      const configByActName = new Map<string, any>();
      for (const [actName, steps] of Object.entries(standardFlowSpecs)) {
        const act = acts.find((item) => normalized(item.nombre) === normalized(actName)); if (!act) continue;
        let configuration: any = act.configuracionesOperativas[0];
        if (!configuration) configuration = await tx.configuracionActo.create({ data: { organization_id: actor.organizationId, tipo_acto_id: act.id, activa: true, requiere_revision: true, familia: actName === 'Poder sin registro' ? 'CORTO' : actName === 'Constitución de fideicomiso' ? 'FIDUCIARIO' : 'INMOBILIARIO', creado_por_id: actor.id, actualizado_por_id: actor.id }, include: { etapas: { include: { actividades: true } } } });
        configByActName.set(actName, configuration);
        const stageByName = new Map<string, any>(configuration.etapas.map((item: any) => [item.nombre, item]));
        for (const stageName of [...new Set(steps.map((item) => item.stage))]) if (!stageByName.has(stageName)) {
          const stage = await tx.configuracionEtapa.create({ data: { organization_id: actor.organizationId, configuracion_id: configuration.id, nombre: stageName, orden: ['Prefirma', 'Firma', 'Postfirma', 'Registro', 'Cierre'].indexOf(stageName) + 1 } }); stageByName.set(stageName, stage);
        }
        const applicationByCode = new Map<string, any>();
        for (const stage of configuration.etapas) for (const activity of stage.actividades) {
          const concept = concepts.find((item) => item.id === activity.concepto_maestro_id); if (concept) applicationByCode.set(concept.codigo, activity);
        }
        for (const [index, step] of steps.entries()) {
          if (applicationByCode.has(step.concept)) continue;
          const concept = conceptByCode.get(step.concept); const stage = stageByName.get(step.stage); if (!concept || !stage) continue;
          const inherited = [...inheritableActivityAttributes]; if (step.durationOverride !== undefined) inherited.splice(inherited.indexOf('duracion_estimada'), 1);
          const activity = await tx.configuracionActividad.create({ data: { organization_id: actor.organizationId, etapa_id: stage.id, concepto_maestro_id: concept.id, nombre: concept.nombre, descripcion: concept.descripcion, duracion_estimada: step.durationOverride ?? concept.duracion_estimada, tipo_dias: concept.tipo_dias, margen_seguridad: concept.margen_seguridad, responsable_rol: concept.responsable_rol, responsable_usuario_id: concept.responsable_usuario_id, aplica_por_defecto: concept.aplica_por_defecto, naturaleza: concept.naturaleza, unidad_tiempo: concept.unidad_tiempo, fuente_tiempo: concept.fuente_tiempo, atributos_heredados: inherited, grupo_paralelo: step.parallel || null, orden_operativo: index + 1 } });
          applicationByCode.set(step.concept, activity);
        }
        for (const step of steps) {
          const activity = applicationByCode.get(step.concept); if (!activity) continue;
          for (const dependencyCode of step.dependsOn || []) {
            const baseName = actName === 'Constitución de fideicomiso' || actName === 'Compraventa con crédito y garantía hipotecaria'
              ? 'Compraventa'
              : actName === 'Poder para actos de dominio limitado' || actName === 'Poder para actos de dominio'
                ? 'Poder sin registro'
                : null;
            const baseConfig = baseName ? configByActName.get(baseName) : null;
            const dependency = applicationByCode.get(dependencyCode) || (baseConfig && conceptByCode.get(dependencyCode) ? await tx.configuracionActividad.findFirst({ where: { organization_id: actor.organizationId, concepto_maestro_id: conceptByCode.get(dependencyCode)!.id, etapa: { configuracion_id: baseConfig.id } } }) : null);
            if (dependency) await tx.configuracionDependencia.upsert({ where: { actividad_id_depende_actividad_id: { actividad_id: activity.id, depende_actividad_id: dependency.id } }, update: {}, create: { organization_id: actor.organizationId, actividad_id: activity.id, depende_actividad_id: dependency.id, bloqueante: true } });
          }
        }
      }
      const purchaseConfig = configByActName.get('Compraventa'); const trustConfig = configByActName.get('Constitución de fideicomiso');
      if (trustConfig && purchaseConfig && !trustConfig.hereda_configuracion_id) await tx.configuracionActo.update({ where: { id: trustConfig.id }, data: { hereda_configuracion_id: purchaseConfig.id, familia: 'FIDUCIARIO' } });
      const creditConfig = configByActName.get('Compraventa con crédito y garantía hipotecaria'); if (creditConfig && purchaseConfig && !creditConfig.hereda_configuracion_id) await tx.configuracionActo.update({ where: { id: creditConfig.id }, data: { hereda_configuracion_id: purchaseConfig.id, familia: 'INMOBILIARIO' } });
      for (const rule of standardActInheritance) {
        const variant = acts.find((item) => normalized(item.nombre) === normalized(rule.act)); const baseAct = acts.find((item) => normalized(item.nombre) === normalized(rule.base));
        let variantCfg: any = configByActName.get(rule.act) || variant?.configuracionesOperativas[0]; const baseCfg: any = configByActName.get(rule.base) || baseAct?.configuracionesOperativas[0];
        if (variant && !variantCfg) {
          variantCfg = await tx.configuracionActo.create({ data: { organization_id: actor.organizationId, tipo_acto_id: variant.id, activa: true, requiere_revision: true, familia: rule.family, creado_por_id: actor.id, actualizado_por_id: actor.id } });
          configByActName.set(rule.act, variantCfg);
        }
        if (variantCfg && baseCfg && !variantCfg.hereda_configuracion_id) await tx.configuracionActo.update({ where: { id: variantCfg.id }, data: { familia: rule.family, hereda_configuracion_id: baseCfg.id, exclusiones_conceptos: [...rule.exclusions], requiere_revision: true, actualizado_por_id: actor.id } });
      }
      const createdTotal = conceptsCreated + actsCreated;
      await audit(tx, actor, 'CFG_V2_LIBRARY_BOOTSTRAPPED', 'Organization', actor.organizationId, undefined, { concepts_created: conceptsCreated, acts_created: actsCreated, destructive: false, idempotent: createdTotal === 0 });
      return { concepts_created: conceptsCreated, acts_created: actsCreated, idempotent: createdTotal === 0, acts_duplicated: 0, destructive: false };
    }, { timeout: 30_000 });
  }
}

export const configurationCatalogV2Service = new ConfigurationCatalogV2Service();
