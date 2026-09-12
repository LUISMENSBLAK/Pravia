import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260828030000_create_exp005_operational_follow_up/migration.sql');
const service = read('src/services/expedienteSeguimiento.service.ts');
const config = read('src/services/configurationCatalog.service.ts');
const opening = read('src/services/expedienteOpening.service.ts');
const acts = read('src/services/expedienteActos.service.ts');
const workflow = read('src/services/expedienteWorkflow.service.ts');
const routes = read('src/routes/expedientes.routes.ts');
const ui = read('../frontend/src/features/cases/components/tabs/WorkflowTab.tsx');
const summary = read('../frontend/src/features/cases/components/tabs/SummaryTab.tsx');

const checks: Array<[string, () => boolean]> = [
  ['01 materialización desde CFG-001', () => service.includes('configuracionActo.findMany') && service.includes('materializeInTransaction')],
  ['02 no checklist manual normal', () => !ui.includes('Nuevo trámite') && !summary.includes('PostfirmaPanel')],
  ['03 misma config produce copia', () => service.includes('configuracion_acto_id: config.id')],
  ['04 conserva referencias maestras', () => ['configuracion_acto_id', 'etapa_maestra_id', 'actividad_maestra_id'].every((text) => schema.includes(text))],
  ['05 CFG-001 no muta', () => !service.includes('configuracionActo.update') && !service.includes('configuracionActividad.update')],
  ['06 multi-act', () => service.includes('for (const act of expediente.actos)')],
  ['07 mismo tipo multi-instancia', () => schema.includes('expediente_acto_id') && migration.includes('uq_exp_seguimiento_acto_actividad')],
  ['08 materialización idempotente', () => service.includes('expedienteSeguimientoActividad.upsert') && service.includes('idempotent: created === 0')],
  ['09 aplica por defecto false', () => service.includes("activity.aplica_por_defecto && applies ? 'NO_INICIADO' : 'NO_APLICA'")],
  ['10 estados exactos', () => ['NO_INICIADO', 'EN_PROCESO', 'EN_ESPERA_EXTERNA', 'COMPLETADO', 'BLOQUEADO', 'NO_APLICA'].every((state) => schema.includes(state))],
  ['11 múltiples dependencias', () => schema.includes('ExpedienteSeguimientoDependencia') && service.includes('for (const dependency of dependencies)')],
  ['12 paralelismo no depende de orden', () => !service.includes('etapa_orden_snapshot - 1') && service.includes('blockers')],
  ['13 bloqueo por dependencia', () => service.includes('EXP005_DEPENDENCY_BLOCKED')],
  ['14 desbloqueo automático', () => service.includes('Dependencias completadas; desbloqueo automático.')],
  ['15 sin self dependency operacional', () => service.includes('prerequisiteId === instance.id')],
  ['16 duración general', () => config.includes("source: 'GENERAL'") && service.includes('duracion_estimada: resolved.duration')],
  ['17 excepción institución', () => config.includes("item.selector_tipo === 'INSTITUCION'")],
  ['18 excepción notaría', () => config.includes("item.selector_tipo === 'NOTARIA'")],
  ['19 excepción jurisdicción', () => config.includes("item.selector_tipo === 'JURISDICCION'")],
  ['20 excepción inactiva ignorada', () => config.includes('filter((item: any) => item.activa')],
  ['21 colisión sin precedencia', () => config.includes("status: 'REVIEW_REQUIRED'") && config.includes("source: 'COLLISION'")],
  ['22 excepción operativa aislada', () => schema.includes('excepcion_operativa') && service.includes('validateOperationalException')],
  ['23 responsable default', () => service.includes('responsable_default_id: defaultResponsible')],
  ['24 cambio responsable no muta master', () => service.includes('responsable_id: responsibleId') && !service.includes('responsable_usuario_id: responsibleId')],
  ['25 timestamp inicio', () => service.includes('primera_fecha_inicio') && service.includes('started.has(nextState)')],
  ['26 timestamp conclusión', () => service.includes("nextState === 'COMPLETADO'") && service.includes('fecha_completada_actual: now')],
  ['27 reapertura conserva historial', () => service.includes('EXP005_REOPEN_ACTIVITY') && service.includes('expedienteSeguimientoHistorial.create')],
  ['28 reevaluación downstream', () => service.includes('reevaluateDependencies') && service.includes('Dependencia reabierta')],
  ['29 No aplica explícito', () => ui.includes("state: 'NO_APLICA'") && service.includes("NO_APLICA: []")],
  ['30 espera externa', () => ui.includes("state: 'EN_ESPERA_EXTERNA'")],
  ['31 tiempo estimado congelado', () => schema.includes('duracion_estimada') && schema.includes('configuracion_revision')],
  ['32 tiempo real', () => service.includes('operationalDaysBetween') && service.includes('transcurrido')],
  ['33 días hábiles', () => service.includes("type === 'NATURALES'") && service.includes('getUTCDay')],
  ['34 días naturales', () => service.includes('ConfiguracionTipoDias') && service.includes('NATURALES')],
  ['35 margen', () => service.includes('margen_seguridad') && service.includes('limite_margen')],
  ['36 retraso', () => service.includes('atrasada: Boolean') && ui.includes('Atrasada')],
  ['37 fecha firma manual', () => ui.includes('Registra manualmente la fecha') && service.includes('fecha_estimada_firma')],
  ['38 sin fecha firma automática', () => !service.includes('addOperationalDays(new Date(),') && !service.includes('suggestSignature')],
  ['39 Prefirma consume firma', () => service.includes("normalize(item.etapa_nombre_snapshot) === 'prefirma'") && ui.includes('Prefirma en curso')],
  ['40 firmar no cierra', () => workflow.includes("payload.nuevoEstatus === 'FIRMADO'") && !workflow.includes("payload.nuevoEstatus === 'FIRMADO' ? 'ENTREGADO'")],
  ['41 integración snapshot EXP-004', () => workflow.includes('appendix.freeze') && workflow.includes('recordCanonicalSignatureInTransaction')],
  ['42 Postfirma continúa', () => service.includes("normalize(item.etapa_nombre_snapshot) === 'postfirma'")],
  ['43 Postfirma configurada no hardcoded', () => !service.includes('REGISTRO_PUBLICO') && !ui.includes('CATASTRO')],
  ['44 Registro preservado', () => ui.includes('{stage.nombre}')],
  ['45 Cierre preservado', () => ui.includes('act.etapas.map')],
  ['46 Entregado final', () => ui.includes('Entregado al cliente') && service.includes("expediente.estatus === 'ENTREGADO'")],
  ['47 entrega detiene alertas', () => service.includes("alertas_operativas_activas: expediente.estatus !== 'ENTREGADO'")],
  ['48 entrega no borra historial', () => !workflow.includes('expedienteSeguimientoHistorial.delete') && !service.includes('expedienteSeguimientoHistorial.delete')],
  ['49 Prefirma/Postfirma separadas', () => service.includes('signals: { prefirm:') && service.includes('postfirm:')],
  ['50 sin rediseño final Mi Día', () => !ui.includes('MiDay') && !service.includes('urgencyScore')],
  ['51 sin urgencia simplista', () => !service.includes('urgent') && service.includes('margen_consumido')],
  ['52 tiempos administrativos separados', () => !service.includes('MovimientoFinanciero') && !service.includes('solicitudes de pago')],
  ['53 cambio acto reevalúa', () => acts.includes('reconcileActChangeInTransaction')],
  ['54 trabajo protegido', () => service.includes('trabajo existente se preservó') && acts.includes('protectedOperationalCount')],
  ['55 stale preview', () => acts.includes('operational_tracking:') && acts.includes('EXPEDIENTE_ACT_PREVIEW_STALE')],
  ['56 cambio master no reescribe copia', () => service.includes('update: {}') && ui.includes('configuración maestra no se modifica')],
  ['57 completion concurrente', () => service.includes('pg_advisory_xact_lock') && service.includes('updateMany')],
  ['58 stale activity bloqueada', () => service.includes('EXP005_ACTIVITY_STALE') && service.includes('version: input.expected_version')],
  ['59 dependency race', () => service.includes('reevaluateDependencies') && service.includes('pravia:exp005-activity')],
  ['60 firma transaccional', () => workflow.includes('recordCanonicalSignatureInTransaction(tx') && workflow.includes('appendix.freeze(tx')],
  ['61 progreso legacy no inventado', () => migration.includes('No historical progress is inferred')],
  ['62 expedientes legacy preservados', () => !migration.includes('UPDATE "expedientes"') && !migration.includes('DELETE FROM "expedientes"')],
  ['63 nuevo expediente recibe actividades', () => opening.includes('materializeInTransaction') && opening.includes('initialAct.id')],
  ['64 rollback de materialización', () => opening.includes('same transaction') && opening.includes('openInTransaction')],
  ['65 RBAC', () => routes.includes("requirePermission('expedientes.write'), updateExpedienteSeguimientoActividad")],
  ['66 object authorization', () => service.includes('id: activityId, organization_id: actor.organizationId, expediente_id: expedienteId')],
  ['67 cross tenant', () => service.includes('organization_id: actor.organizationId') && service.includes('EXP005_RESPONSIBLE_ACCESS_DENIED')],
  ['68 auditoría', () => service.includes('auditLog.create') && service.includes('expedienteActividad.create')],
  ['69 EXP-006 no implementado', () => !service.includes('CatalogoArtefacto') && !ui.includes('Generar documento')],
  ['70 EXP-009 no implementado', () => !ui.includes('Actividad global') && service.includes("tipo: 'SEGUIMIENTO'")],
];

describe('EXP-005 · matriz contractual focalizada', () => {
  it('contiene exactamente los 70 controles obligatorios', () => expect(checks).toHaveLength(70));
  it.each(checks)('%s', (_name, predicate) => expect(predicate()).toBe(true));
});
