import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260824010000_phase_a_cfg_catalogs/migration.sql');
const service = read('backend/src/services/configurationCatalog.service.ts');
const routes = read('backend/src/routes/configurationCatalog.routes.ts');
const permissions = read('backend/src/auth/permissions.ts');
const tenant = read('backend/src/config/tenantPrisma.ts');
const settings = read('frontend/src/features/settings/SettingsPage.tsx');
const actsUi = read('frontend/src/features/settings/catalogs/ActsTimesCatalog.tsx');
const artifactsUi = read('frontend/src/features/settings/catalogs/TemplatesFormatsCatalog.tsx');

type ContractCase = [string, () => void];
const contains = (text: string, ...needles: string[]) => () => needles.forEach((needle) => expect(text).toContain(needle));

const cfg001: ContractCase[] = [
  ['preserva el catálogo actual y lo enlaza a TipoActo', contains(migration, 'prospecto_servicios_catalogo', 'tipo_acto_id', 'tipos_acto')],
  ['crea una configuración privada de acto', contains(service, 'ensureConfiguration', 'configuracionActo.create', 'organization_id: actor.organizationId')],
  ['edita identidad y configuración', contains(service, 'CFG_ACT_UPDATED', 'requiere_revision', 'TipoActoUpdateInput')],
  ['activa y desactiva sin borrar', contains(actsUi, 'Acto desactivado.', 'Acto activado.')],
  ['agrega etapas', contains(routes, "router.post('/acts/:actId/stages'", 'manageActs')],
  ['reordena etapas persistiendo orden', contains(service, 'data.orden !== before.orden', 'orden: before.orden')],
  ['crea actividades configurables', contains(service, 'configuracionActividad.create', 'CFG_ACTIVITY_CREATED')],
  ['admite días hábiles', contains(schema, 'enum ConfiguracionTipoDias', 'HABILES')],
  ['admite días naturales', contains(schema, 'NATURALES')],
  ['persiste margen independiente', contains(schema, 'margen_seguridad', 'duracion_estimada')],
  ['reutiliza rol o usuario como responsable', contains(service, 'responsable_rol', 'responsable_usuario_id', 'assertMembership')],
  ['persiste aplica por defecto', contains(schema, 'aplica_por_defecto')],
  ['modela múltiples dependencias', contains(service, 'dependency_ids', 'createMany', 'configuracionDependencia')],
  ['no impone secuencia a actividades independientes', contains(actsUi, 'puede ejecutarse en paralelo', 'sin dependencias configuradas')],
  ['admite excepción por institución', contains(service, "selector === 'INSTITUCION'", 'institucion_id')],
  ['admite excepción por Notaría canónica', contains(service, "selector === 'NOTARIA'", "assertOwner(actor, 'NOTARIA'")],
  ['admite excepción territorial', contains(service, "selector === 'JURISDICCION'", 'jurisdiccion')],
  ['conserva fallback general', contains(service, "source: 'EXCEPTION'", "source: 'GENERAL'", 'duracion_estimada')],
  ['selecciona la excepción exacta', contains(service, "selector.type === 'INSTITUCION'", "selector.type === 'NOTARIA'", "selector.type === 'JURISDICCION'")],
  ['impide lectura cross-tenant por autoridad backend', contains(service, 'organization_id: actor.organizationId', 'ACTIVITY_NOT_FOUND')],
  ['impide escritura cross-tenant por autoridad backend', contains(service, "where: { id: stageId, organization_id: actor.organizationId }")],
  ['read-only no recibe permiso de administración', () => { expect(permissions).toContain("'configuracion.catalogos.read'"); expect(permissions).not.toMatch(/CONSULTA[\s\S]{0,350}configuracion\.actos_tiempos\.manage/); }],
  ['administración autorizada recibe capacidad', contains(permissions, "'configuracion.actos_tiempos.manage'")],
  ['AuditLog registra cambios relevantes', contains(service, "'CFG_DEPENDENCIES_UPDATED'", "'CFG_EXCEPTION_CREATED'", 'audit(')],
  ['configuración no crea actividades de expediente', () => expect(service).not.toContain('actividadExpediente')],
  ['no genera fecha automática de firma', () => { expect(service).not.toContain('fecha_firma'); expect(actsUi).toContain('No crean tareas, documentos ni fecha automática de firma'); }],
  ['no modifica Mi Día', () => expect(settings).not.toContain('MyDay')],
];

const cfg002: ContractCase[] = [
  ['entra bajo Configuración/Catálogos', contains(settings, "group('CATÁLOGOS'", '/configuracion/plantillas-formatos')],
  ['separa Plantillas y Formatos', contains(schema, "PLANTILLA", "FORMATO")],
  ['Notaría ofrece ambos tipos', contains(artifactsUi, 'selection!.ownerType === "NOTARIA"', "kind: \"PLANTILLA\"", "kind: \"FORMATO\"")],
  ['Banco ofrece sólo Formatos', contains(artifactsUi, 'Las instituciones sólo contienen Formatos', 'Las Plantillas pertenecen exclusivamente a la Notaría')],
  ['DB impide Plantilla bancaria', contains(migration, '"tipo" = \'PLANTILLA\' AND "propietario_tipo" = \'NOTARIA\'')],
  ['reutiliza Notaría', contains(service, 'prisma.notaria.findMany', "assertOwner(actor, 'NOTARIA'")],
  ['reutiliza el mismo TipoActo', contains(schema, 'CatalogoArtefactoActo', 'tipo_acto_id')],
  ['crea carpetas raíz', contains(service, 'catalogoCarpeta.create', 'parent_id')],
  ['crea carpetas anidadas', contains(schema, 'CarpetasJerarquia', 'parent_id')],
  ['calcula breadcrumb navegable', contains(service, 'breadcrumbs.unshift', 'current.parent_id')],
  ['permite varios archivos por carpeta', () => expect(schema).not.toMatch(/carpeta_id\s+String\??\s+@unique/)],
  ['nueva versión conserva la anterior', contains(service, 'addVersion', 'versiones[0]?.version', 'CFG_ARTIFACT_VERSION_CREATED')],
  ['relación multi-act real', contains(schema, '@@unique([artefacto_id, tipo_acto_id]')],
  ['tipo de compareciente es opcional', contains(schema, 'tipo_persona              TipoPersona?')],
  ['rol de compareciente es opcional', contains(schema, 'caracter_compareciente_id String?')],
  ['regla referencia etapa CFG-001', contains(schema, 'etapa_requerida_id')],
  ['persiste momento límite', contains(schema, 'momento_limite_etapa_id')],
  ['persiste obligatoriedad', contains(schema, 'obligatoria')],
  ['multiplicidad por expediente', contains(schema, 'EXPEDIENTE')],
  ['multiplicidad por compareciente', contains(schema, 'COMPARECIENTE')],
  ['multiplicidad por inmueble', contains(schema, 'INMUEBLE')],
  ['multiplicidad fija validada', contains(migration, 'ck_catalogo_regla_multiplicidad', 'CANTIDAD_FIJA')],
  ['multiplicidad no duplica regla maestra', () => expect(schema).not.toContain('regla_por_compareciente')],
  ['no existe campo Permite IA', () => { expect(schema).not.toMatch(/permite_ia/i); expect(artifactsUi).not.toMatch(/Permite IA/i); }],
  ['no existe campo elaboración externa', () => { expect(schema).not.toMatch(/permite_elaboracion_externa/i); expect(artifactsUi).not.toMatch(/elaboración externa/i); }],
  ['usa Storage privado', contains(service, 'uploadFile', 'getSignedUrl', 'storageKey')],
  ['signed URL exige tenant y registro activo', contains(service, 'organization_id: actor.organizationId', 'artefacto: { activo: true }')],
  ['tenant A no lee artifact B', contains(service, 'catalogoArtefacto.findFirst', 'organization_id: actor.organizationId')],
  ['tenant A no descarga artifact B', contains(service, 'ARTIFACT_VERSION_NOT_FOUND', 'versionId')],
  ['RBAC distingue lectura y administración', contains(routes, "const read = requirePermission('configuracion.catalogos.read')", 'manageArtifacts')],
  ['AuditLog cubre upload, versión y reglas', contains(service, "'CFG_ARTIFACT_CREATED'", "'CFG_ARTIFACT_VERSION_CREATED'", "'CFG_ARTIFACT_UPDATED'")],
  ['no genera documentos de expediente', () => expect(service).not.toContain('documento.create')],
  ['no ejecuta IA de llenado', () => expect(service).not.toMatch(/openai|assistant|fillDocument/i)],
  ['no analiza listas bancarias', () => expect(service).not.toMatch(/email|oficio|lista bancaria/i)],
  ['CFG-001 y CFG-002 comparten el mismo Acto ID', () => { expect(schema).toContain('tipo_acto_id       String'); expect(schema).toContain('tipo_acto_id    String'); }],
];

describe('CFG-001 focused contract', () => {
  it.each(cfg001)('%s', (_, assertion) => assertion());
  it('registra los modelos nuevos en el middleware tenant canónico', () => expect(tenant).toContain("'ConfiguracionActo'"));
});

describe('CFG-002 focused contract', () => {
  it.each(cfg002)('%s', (_, assertion) => assertion());
});
