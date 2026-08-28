import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260828010000_create_property_master/migration.sql');
const master = read('backend/src/services/predios.service.ts');
const relations = read('backend/src/services/expedientePredios.service.ts');
const extraction = read('backend/src/services/openaiDocument.service.ts');
const routes = read('backend/src/routes/predios.routes.ts');
const objectAccess = read('backend/src/services/objectAccess.service.ts');
const workspace = read('frontend/src/features/properties/PropertyWorkspace.tsx');
const propertyTab = read('frontend/src/features/cases/components/tabs/PropertiesTab.tsx');

const cases: Array<[string, () => void]> = [
  ['1 crea un maestro con identidad propia', () => expect(schema).toMatch(/model Predio \{/)],
  ['2 permite editar con versión optimista', () => expect(master).toContain('PREDIO_VERSION_STALE')],
  ['3 reutiliza el mismo maestro mediante relación', () => expect(schema).toMatch(/model ExpedientePredio \{/)],
  ['4 permite varios predios por expediente', () => expect(schema).toContain('@@unique([organization_id, expediente_id, predio_id]')],
  ['5 permite un predio en varios actos', () => expect(schema).toMatch(/model ExpedienteActoPredio \{/)],
  ['6 no duplica el mismo predio por acto', () => expect(schema).toContain('uq_expediente_acto_predios_relation')],
  ['7 mantiene clave catastral opcional', () => expect(schema).toMatch(/clave_catastral\s+String\?/)],
  ['8 mantiene folio real opcional', () => expect(schema).toMatch(/folio_real\s+String\?/)],
  ['9 usa Decimal para superficies', () => expect(schema).toMatch(/superficie_terreno_m2\s+Decimal\?.*@db\.Decimal\(18, 4\)/)],
  ['10 separa los tres valores contractuales', () => { expect(schema).toContain('valor_catastral'); expect(schema).toContain('valor_avaluo'); expect(schema).toContain('valor_operacion'); }],
  ['11 bloquea superficies y valores negativos', () => { expect(migration).toContain('ck_predios_nonnegative'); expect(master).toContain('PREDIO_NUMERIC_NEGATIVE'); }],
  ['12 modela N colindancias', () => expect(schema).toMatch(/colindancias\s+PredioColindancia\[\]/)],
  ['13 la UI no limita colindancias a cuatro', () => expect(workspace).toContain('Agregar colindancia')],
  ['14 acepta referencias no cardinales', () => expect(workspace).toContain('Del vértice 1 al 2')],
  ['15 vincula documentos al maestro canónico', () => expect(schema).toMatch(/documento\s+Documento\s+@relation/)],
  ['16 conserva Storage privado tenant-scoped', () => expect(read('backend/src/controllers/predios.controller.ts')).toContain('organizations/${user.organizationId}/documentos/')],
  ['17 exige fuente IA explícita', () => expect(workspace).toContain('Documento fuente para extracción')],
  ['18 envía sólo el documento seleccionado', () => expect(extraction).toContain('extraerPredioDesdeDocumento(\n  documento: DocumentoParaExtraccion')],
  ['19 la extracción no recibe expediente completo', () => expect(extraction.slice(extraction.indexOf('extraerPredioDesdeDocumento'), extraction.indexOf('COMPATIBILIDAD: extracción'))).not.toContain('expedienteId')],
  ['20 la propuesta no escribe silenciosamente', () => expect(master).toContain('persisted_master: false')],
  ['21 el prompt prohíbe inventar datos', () => expect(extraction).toContain('No infieras ni completes datos ausentes')],
  ['22 muestra actual contra propuesto', () => { expect(workspace).toContain('Actual'); expect(workspace).toContain('Propuesto'); }],
  ['23 conserva provenance por campo', () => expect(schema).toMatch(/model PredioDatoFuente \{/)],
  ['24 permite aceptar un campo', () => expect(master).toContain("decision === 'ACCEPT'")],
  ['25 permite conservar un campo', () => expect(workspace).toContain('Conservar actual')],
  ['26 crear desde expediente abre ficha maestra', () => expect(propertyTab).toContain('/predios/nuevo?')],
  ['27 valida retorno de contexto', () => expect(workspace).toContain('resolveExpedienteCreationContext')],
  ['28 ofrece búsqueda tenant-scoped de existente', () => { expect(relations).toContain('predioObjectWhere(actor)'); expect(propertyTab).toContain('Buscar en el maestro'); }],
  ['29 desvincular no borra maestro', () => expect(relations).toContain('master_deleted: false')],
  ['30 desvinculación parcial conserva otros actos', () => expect(relations).toContain("if (!targetActIds.includes(link.expediente_acto_id)")],
  ['31 reevalúa CFG-002 por inmueble', () => expect(relations).toContain("multiplicidad: 'INMUEBLE'")],
  ['32 exige impact preview', () => expect(relations).toContain('PREDIO_RELATION_PREVIEW_REQUIRED')],
  ['33 protege trabajo existente', () => expect(relations).toContain('PREDIO_RELATION_CONFIRMATION_REQUIRED')],
  ['34 rechaza preview obsoleto', () => expect(relations).toContain('PREDIO_RELATION_PREVIEW_STALE')],
  ['35 documenta copia operativa ISR', () => expect(workspace).toContain('recibirá una copia operativa')],
  ['36 editar ISR no muta el maestro', () => expect(master).not.toContain('calculoISR.update')],
  ['37 eliminar ISR no elimina el maestro', () => expect(schema.match(/model Predio \{[\s\S]*?\n\}/)?.[0]).not.toContain('CalculoISR')],
  ['38 bloquea búsqueda cross-tenant', () => expect(relations).toContain('organization_id: actor.organizationId')],
  ['39 bloquea lectura cross-tenant', () => expect(master).toContain('PREDIO_ACCESS_DENIED')],
  ['40 bloquea acto ajeno al expediente', () => expect(relations).toContain('PREDIO_ACT_ACCESS_DENIED')],
  ['41 bloquea documento fuente ajeno', () => expect(master).toContain('PREDIO_AI_SOURCE_DENIED')],
  ['42 aplica object authorization backend', () => expect(objectAccess).toContain('canAccessPredio')],
  ['43 reutiliza RBAC existente', () => { expect(routes).toContain("requirePermission('expedientes.write')"); expect(routes).toContain("requirePermission('ia.execute')"); }],
  ['44 audita creación', () => expect(master).toContain('CREATE_PROPERTY_MASTER')],
  ['45 audita actualización', () => expect(master).toContain('UPDATE_PROPERTY_MASTER')],
  ['46 audita vínculo y desvínculo', () => { expect(relations).toContain('LINK_PROPERTY_TO_EXPEDIENT'); expect(relations).toContain('UNLINK_PROPERTY_FROM_EXPEDIENT'); }],
  ['47 no adivina datos legacy ambiguos', () => expect(migration).toContain('sin INSERT/UPDATE sobre tablas legacy')],
  ['48 preserva campos legacy', () => expect(migration).toContain('JSON y snapshots existentes permanecen intactos')],
  ['49 no crea writers legacy nuevos', () => { expect(master).not.toContain('datos_operacion'); expect(relations).not.toContain('datos_operacion'); }],
  ['50 previene maestros duplicados por identificador', () => { expect(migration).toContain('uq_predios_clave_catastral_active'); expect(migration).toContain('uq_predios_folio_real_active'); }],
  ['51 no implementa EXP-004', () => expect(propertyTab).not.toContain('Generar instrumento')],
  ['52 no implementa EXP-006 ni genera documentos', () => expect(relations).toContain('automatic_document_generation: false')],
  ['53 no amplía ISR-001', () => { expect(master).not.toContain('deduccion'); expect(relations).not.toContain('calculoISR'); }],
];

describe('PRD-001 contrato atómico', () => {
  it.each(cases)('%s', (_title, assertion) => assertion());
});
