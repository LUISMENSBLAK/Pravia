import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260828040000_create_exp006_operational_artifacts/migration.sql');
const domain = read('src/domain/expedienteArtifacts.ts');
const service = read('src/services/expedienteArtifacts.service.ts');
const controller = read('src/controllers/expedienteArtifacts.controller.ts');
const routes = read('src/routes/expedientes.routes.ts');
const openai = read('src/services/openaiDocument.service.ts');
const aiUsage = read('src/services/aiUsage.service.ts');
const acts = read('src/services/expedienteActos.service.ts');
const parties = read('src/services/expedienteParties.service.ts');
const properties = read('src/services/expedientePredios.service.ts');
const tracking = read('src/services/expedienteSeguimiento.service.ts');
const headers = read('src/controllers/expedientes.controller.ts');
const ui = read('../frontend/src/features/cases/components/tabs/TemplatesFormatsTab.tsx');
const workspace = read('../frontend/src/features/cases/ExpedienteWorkspace.tsx');
const api = read('../frontend/src/features/cases/expedientes.service.ts');

const checks: Array<[string, () => void]> = [
  ['01 consume CFG-002', () => expect(service).toContain('catalogoArtefacto.findMany')],
  ['02 no administra CFG-002 desde expediente', () => { expect(service).not.toContain('catalogoArtefacto.update'); expect(ui).toContain('Aquí no se editan reglas ni archivos maestros'); }],
  ['03 no duplica reglas maestras', () => expect(schema).not.toMatch(/model ExpedienteArtefactoRegla/)],
  ['04 resolver por acto', () => expect(domain).toContain('activeActTypes')],
  ['05 resolver por Notaría', () => expect(domain).toContain("artifact.notaria_id === context.notariaId")],
  ['06 resolver por Banco', () => expect(domain).toContain('context.institutionIds.includes')],
  ['07 Banco sólo Formato', () => expect(domain).toContain("artifact.tipo === 'FORMATO'")],
  ['08 Plantilla bancaria imposible', () => expect(domain).toContain("artifact.propietario_tipo === 'INSTITUCION' && artifact.tipo !== 'FORMATO'")],
  ['09 resolver tipo persona', () => expect(domain).toContain('item.personType === rule.tipo_persona')],
  ['10 resolver rol por acto', () => expect(domain).toContain('item.roleId === rule.caracter_compareciente_id')],
  ['11 misma persona distinto rol/acto', () => { expect(domain).toContain('party.relationId'); expect(domain).toContain('party.actId'); }],
  ['12 resolver por etapa', () => { expect(domain).toContain('rule.etapa_requerida_id'); expect(domain).toContain('context.currentStageId'); }],
  ['13 obligatorio', () => expect(domain).toContain('mandatory: rule.obligatoria')],
  ['14 opcional', () => expect(schema).toMatch(/obligatoria\s+Boolean\s+@default\(false\)/)],
  ['15 una vez por expediente', () => expect(domain).toContain("push('EXPEDIENTE', context.expedienteId, 1")],
  ['16 una vez por compareciente', () => expect(domain).toContain("push('COMPARECIENTE', party.relationId")],
  ['17 filtro compareciente', () => expect(domain).toContain("rule.multiplicidad === 'COMPARECIENTE'")],
  ['18 una vez por inmueble', () => expect(domain).toContain("push('INMUEBLE', property.relationId")],
  ['19 cantidad fija', () => expect(domain).toContain('ordinal <= count')],
  ['20 misma regla produce N instancias', () => { expect(domain).toContain('exp006Identity'); expect(schema).toContain('identity_key'); }],
  ['21 materialización idempotente', () => { expect(schema).toContain('@@unique([organization_id, expediente_id, identity_key]'); expect(service).toContain('idempotent: Object.values(changes)'); }],
  ['22 agregar persona crea delta', () => { expect(parties).toContain("'EXPEDIENTE_PARTY_CHANGE'"); expect(service).toContain('if (!existing)'); }],
  ['23 agregar inmueble crea delta', () => expect(properties).toContain("'EXPEDIENTE_PROPERTY_CHANGE'")],
  ['24 retirar sujeto reevalúa', () => expect(service).toContain('const obsolete = await tx.expedienteArtefactoPendiente.findMany')],
  ['25 trabajo protegido', () => expect(service).toContain('el trabajo se conserva para decisión humana')],
  ['26 stale preview', () => expect(service).toContain('EXP006_STALE_PREVIEW')],
  ['27 abrir no genera documento', () => { expect(service.slice(service.indexOf('async read'), service.indexOf('async materialize'))).not.toContain('generateOperationalArtifactWithOpenAI'); expect(ui).toContain('no genera documentos ni llama a IA'); }],
  ['28 acción IA', () => expect(ui).toContain('Generar con IA')],
  ['29 upload externo', () => { expect(ui).toContain('Cargar externo'); expect(routes).toContain('uploadExpedienteArtifact'); }],
  ['30 sin allowAI', () => expect(service).not.toContain('allowAI')],
  ['31 sin allowExternal', () => expect(service).not.toContain('allowExternal')],
  ['32 generar deja revisión', () => expect(service).toContain("estado: 'PENDIENTE_REVISION'")],
  ['33 upload deja revisión', () => expect(service).toContain("via: 'CARGA_EXTERNA'")],
  ['34 IA usa datos estructurados del sujeto', () => expect(service).toContain('structuredData')],
  ['35 IA usa documentos vigentes del sujeto', () => expect(service).toContain("documentos: { where: { estatus: 'ACTIVO', archived_at: null }")],
  ['36 históricos excluidos', () => expect(service).toContain("excluded: ['HISTORICAL_PARTY'")],
  ['37 documentos generales excluidos', () => expect(service).toContain("'GENERAL_EXPEDIENTE'")],
  ['38 documentos de otra persona excluidos', () => expect(service).toContain("'OTHER_PARTY'")],
  ['39 documentos de inmueble excluidos', () => expect(service).toContain("'PROPERTY'")],
  ['40 documentos banco excluidos', () => expect(service).toContain("'BANK'")],
  ['41 documentos Notaría excluidos', () => expect(service).toContain("'NOTARY'")],
  ['42 inyección frontend bloqueada', () => expect(domain).toContain('EXP006_FRONTEND_SOURCE_INJECTION')],
  ['43 fuente cross-tenant bloqueada', () => expect(service).toContain('link.documento.organization_id === actor.organizationId')],
  ['44 source manifest completo', () => ['subjectComparecienteId', 'structuredFieldsUsed', 'currentDocumentIds', 'masterArtifactId', 'masterVersionId'].forEach((field) => expect(service).toContain(field))],
  ['45 faltantes no inventados', () => { expect(openai).toContain('No inventes datos'); expect(ui).toContain('Faltan:'); }],
  ['46 conflictos requieren revisión', () => expect(service).toContain('Se detectaron datos contradictorios; requiere revisión humana.')],
  ['47 maestro compareciente no muta', () => expect(service).not.toContain('compareciente.update')],
  ['48 maestro artifact no muta', () => { expect(service).not.toContain('catalogoArtefacto.update'); expect(service).not.toContain('catalogoArtefactoVersion.update'); }],
  ['49 provenance versión maestra', () => expect(service).toContain('cfg002_master_version_id')],
  ['50 documento generado canónico', () => expect(service).toContain('tx.documento.create')],
  ['51 Storage privado', () => { expect(service).toContain('getSignedUrl'); expect(service).not.toContain('publicUrl'); }],
  ['52 externo documento canónico', () => expect(service).toContain("file.via === 'IA' ? 'EXP006_GENERATE_AI' : 'EXP006_UPLOAD_EXTERNAL'")],
  ['53 reemplazo preserva historia', () => { expect(service).toContain('updateMany'); expect(service).toContain('vigente: false'); expect(service).not.toContain('expedienteArtefactoDocumento.delete'); }],
  ['54 validación explícita', () => { expect(ui).toContain('>Validar<'); expect(service).toContain('EXP006_VALIDATE_DOCUMENT'); }],
  ['55 validación repetida idempotente', () => expect(service).toContain("pending.estado === 'VALIDADO'")],
  ['56 valida contra Seguimiento estructurado', () => expect(service).toContain("conditionObject(conditions).actividad_id")],
  ['57 no completa actividad ajena', () => expect(service).toContain('actividad_maestra_id: activityMasterId')],
  ['58 múltiples requisitos evitan completion prematuro', () => expect(service).toContain('const remaining = await tx.expedienteArtefactoPendiente.count')],
  ['59 etapa y límite expuestos', () => { expect(domain).toContain('required_stage_id'); expect(domain).toContain('deadline_stage_id'); }],
  ['60 opcional no bloquea', () => expect(service).toContain('obligatoria: true')],
  ['61 integración EXP-004', () => { expect(service).toContain('tx.expedienteDocumento.create'); expect(service).toContain("origen: 'CFG002'"); }],
  ['62 snapshot firma conserva integración', () => expect(service).not.toContain('expedienteDocumentoSnapshot.update')],
  ['63 post-firma no altera snapshot', () => { expect(service).not.toContain('ExpedienteDocumentoSnapshot'); expect(service).toContain('EXP006_RESULTADO'); }],
  ['64 cambio compareciente reevalúa', () => expect(parties).toContain('reconcileContextChangeInTransaction')],
  ['65 cambio predio reevalúa', () => expect(properties).toContain('reconcileContextChangeInTransaction')],
  ['66 cambio acto reevalúa', () => expect(acts).toContain('reconcileContextChangeInTransaction')],
  ['67 cambio institución/notaría reevalúa', () => { expect(headers).toContain("'EXPEDIENTE_NOTARY_CHANGE'"); expect(service).toContain('institutionIdsFrom'); }],
  ['68 cambio CFG-002 preserva trabajo', () => expect(service).toContain('La regla o el contexto cambió; el trabajo existente se preservó')],
  ['69 resolución concurrente', () => { expect(service).toContain('pg_advisory_xact_lock'); expect(migration).toContain('uq_exp006_pending_identity'); }],
  ['70 generación concurrente', () => { expect(service).toContain('idempotency_key: input.idempotency_key'); expect(migration).toContain('uq_exp006_document_idempotency'); }],
  ['71 validación concurrente', () => expect(service).toContain('pravia:exp006-validate')],
  ['72 generación stale bloqueada', () => { expect(service).toContain('EXP006_GENERATION_SOURCES_STALE'); expect(service).toContain('EXP006_GENERATION_SOURCES_CHANGED'); }],
  ['73 provenance versión de fuente', () => { expect(service).toContain('source_revision'); expect(service).toContain('source_manifest'); }],
  ['74 fallo IA seguro', () => { expect(service).toContain('recordAIFailure'); expect(controller).toContain('No pudimos completar la operación de Plantillas y formatos'); }],
  ['75 fallo Storage seguro', () => { expect(service).toContain('deleteFile(storageKey)'); expect(service).toContain('try {'); }],
  ['76 fallo Seguimiento transaccional', () => { expect(service).toContain('completeLinkedTracking(tx'); expect(service).toContain('this.prisma.$transaction'); }],
  ['77 legacy preservado', () => { expect(migration).not.toContain('DELETE FROM "pravia_os"."expedientes"'); expect(migration).not.toContain('UPDATE "pravia_os"."expedientes"'); }],
  ['78 no inventa pendientes históricos', () => expect(migration).toContain('No historical pending instances are invented')],
  ['79 RBAC', () => ["requirePermission('documentos.read')", "requirePermission('documentos.write')", "requirePermission('ia.execute')"].forEach((value) => expect(routes).toContain(value))],
  ['80 object authorization', () => { expect(service).toContain('expedienteAccessWhere'); expect(service).toContain('EXP006_PENDING_ACCESS_DENIED'); }],
  ['81 aislamiento tenant', () => { expect(schema).toContain('organization_id'); expect(service).toContain('organization_id: actor.organizationId'); expect(migration).toContain('ENABLE ROW LEVEL SECURITY'); }],
  ['82 AuditLog', () => { expect(service).toContain('EXP006_MATERIALIZE'); expect(service).toContain('EXP006_VALIDATE_DOCUMENT'); }],
  ['83 AIUsage canónico', () => { expect(service).toContain('recordAIUsageInDb'); expect(aiUsage).toContain('db.aIUsageLog.upsert'); }],
  ['84 EXP-007 no implementado', () => expect(service).not.toContain('EXP-007')],
  ['85 EXP-008 no implementado', () => expect(service).not.toContain('EXP-008')],
  ['86 ISR-001 no ampliado', () => expect(service).not.toContain('CalculoISR')],
  ['87 EXP-009 no implementado', () => expect(ui).not.toContain('EXP-009')],
  ['88 MID final no implementado', () => { expect(workspace).toContain('Plantillas y formatos'); expect(api).not.toContain('mid-final'); }],
];

describe('EXP-006 · matriz contractual focalizada', () => {
  it('contiene exactamente los 88 controles obligatorios', () => expect(checks).toHaveLength(88));
  it.each(checks)('%s', (_name, assertion) => assertion());
});
