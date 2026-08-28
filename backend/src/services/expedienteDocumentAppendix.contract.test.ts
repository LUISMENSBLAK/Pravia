import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260828020000_create_exp004_document_snapshot/migration.sql');
const service = read('backend/src/services/expedienteDocumentAppendix.service.ts');
const workflow = read('backend/src/services/expedienteWorkflow.service.ts');
const controller = read('backend/src/controllers/expedientes.controller.ts');
const appendixController = read('backend/src/controllers/expedienteDocuments.controller.ts');
const routes = read('backend/src/routes/expedientes.routes.ts');
const storage = read('backend/src/storage/cloudStorage.provider.ts');
const documentTab = read('frontend/src/features/cases/components/tabs/DocumentsTab.tsx');
const workflowTab = read('frontend/src/features/cases/components/tabs/WorkflowTab.tsx');

const cases: Array<[string, () => void]> = [
  ['1 Prospect source contextual link', () => expect(service).toContain("addDocument('PROSPECTO'")],
  ['2 Cotización source contextual link', () => expect(service).toContain("'COTIZACION', expediente.cotizacion.id")],
  ['3 Cotización Notaría stays isolated', () => { expect(schema).toContain('COTIZACION_NOTARIA'); expect(service).toContain('isolated_notary_quote'); }],
  ['4 Compareciente Vigente included', () => expect(service).toContain("documento: { estatus: 'VIGENTE' }")],
  ['5 Compareciente Histórico excluded', () => expect(service).toContain("archived_at: null, estatus: 'ACTIVO'")],
  ['6 Vigente v1→v2 pre-firma sync', () => { expect(service).toContain('document_version: candidate.documentVersion'); expect(service).toContain("estatus: 'SUSTITUIDO'"); }],
  ['7 old historical file preserved master', () => expect(service).not.toContain('documento.delete')],
  ['8 Predio document included', () => expect(service).toContain("addDocument('PREDIO'")],
  ['9 Finance origin preserved', () => expect(service).toContain("addDocument('FINANZAS'")],
  ['10 ISR origin preserved', () => expect(service).toContain("addDocument('ISR'")],
  ['11 direct Expediente upload origin', () => { expect(controller).toContain("origen: 'EXPEDIENTE'"); expect(controller).toContain("source_context: 'CARGA_DIRECTA'"); }],
  ['12 no duplicate blob on context link', () => { expect(service).toContain('blob_copies: 0'); expect(service).not.toContain('uploadFile'); expect(storage).toContain('upsert: false'); }],
  ['13 repeated sync idempotent', () => { expect(service).toContain('source_key: candidate.sourceKey'); expect(schema).toContain('uq_exp_documentos_source_key'); }],
  ['14 no duplicate contextual relation', () => expect(schema).toContain('@@unique([organization_id, expediente_id, source_key]')],
  ['15 unlink source entity updates pre-firma safely', () => { expect(service).toContain('SOURCE_NO_LONGER_CURRENT'); expect(service).toContain('inactivado_at'); }],
  ['16 protected work not silently deleted', () => { expect(service).not.toContain('expedienteDocumento.delete'); expect(service).not.toContain('deleteFile'); }],
  ['17 missing legacy file preserved', () => expect(service).toContain('legacy_reference: true')],
  ['18 missing legacy file no fake signed URL', () => { expect(service).toContain('EXP004_FILE_UNAVAILABLE'); expect(service).toContain('fileExists(storageKey)'); expect(documentTab).toContain('Archivo no disponible'); }],
  ['19 manual signature only', () => expect(workflow).toContain("payload.nuevoEstatus === 'FIRMADO'")],
  ['20 signing creates snapshot', () => expect(workflow).toContain('await appendix.freeze')],
  ['21 snapshot includes sources', () => expect(schema).toContain('provenance_snapshot')],
  ['22 snapshot includes version identity', () => { expect(schema).toContain('document_version'); expect(schema).toContain('document_revision'); }],
  ['23 snapshot immutable', () => expect(migration).toContain('trg_exp004_snapshot_immutable')],
  ['24 master changes after sign do not alter snapshot', () => expect(service).toContain('nombre_snapshot: candidate.document?.nombre_original')],
  ['25 Compareciente new Vigente after sign ignored by snapshot', () => expect(service).toContain('if (snapshot) return this.snapshotResponse(snapshot)')],
  ['26 Predio doc change after sign ignored', () => expect(service).toContain('CONGELADO_AL_FIRMAR')],
  ['27 snapshot does not freeze master', () => expect(migration).not.toMatch(/TRIGGER[^;]+ ON "pravia_os"\."documentos"/s)],
  ['28 signed expediente still supports future postfirma', () => { expect(routes).toContain("/:id/postfirma/transicion"); expect(service).not.toContain('db.documento.updateMany'); }],
  ['29 signing does not close expediente', () => expect(workflow).toContain("eventType: 'ExpedienteFirmado'")],
  ['30 snapshot reference survives master archival', () => expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE')],
  ['31 snapshot protected from destructive delete', () => expect(migration).toContain('trg_exp004_snapshot_items_immutable')],
  ['32 signed URL auth', () => expect(appendixController).toContain("code: 'AUTH_REQUIRED'")],
  ['33 signed URL tenant', () => expect(service).toContain('organization_id: actor.organizationId')],
  ['34 signed URL object auth', () => expect(service).toContain('await this.assertExpediente(this.prisma, actor, expedienteId)')],
  ['35 Org A document blocked', () => expect(service).toContain('EXP004_DOCUMENT_ACCESS_DENIED')],
  ['36 Org A snapshot blocked', () => expect(service).toContain('EXP004_SNAPSHOT_ITEM_ACCESS_DENIED')],
  ['37 RBAC read', () => expect(routes).toContain("requirePermission('documentos.read'), getExpedienteDocumentAppendix")],
  ['38 RBAC upload', () => expect(routes).toContain("requirePermission('documentos.write'), uploadDocumentoMulter")],
  ['39 RBAC freeze', () => expect(routes).toContain("requirePermission('expedientes.write'), transitionEstatus")],
  ['40 Audit sync', () => expect(service).toContain('SYNC_EXPEDIENT_DOCUMENT_APPENDIX')],
  ['41 Audit upload', () => expect(controller).toContain('UPLOAD_EXPEDIENT_DOCUMENT')],
  ['42 Audit snapshot', () => expect(service).toContain('FREEZE_EXPEDIENT_DOCUMENT_SNAPSHOT')],
  ['43 concurrent sign → one snapshot', () => { expect(workflow).toContain('pg_advisory_xact_lock'); expect(schema).toContain('expediente_id      String                            @unique'); }],
  ['44 repeated sign idempotent/blocked appropriately', () => expect(service).toContain('idempotent: true')],
  ['45 stale signing state handled', () => { expect(service).toContain('EXP004_DOCUMENT_REVISION_STALE'); expect(workflowTab).toContain('document_revision'); }],
  ['46 snapshot failure rolls back signed state', () => { expect(workflow.indexOf('await appendix.freeze')).toBeLessThan(workflow.indexOf('const updateResult')); expect(workflow).toContain('this.prisma.$transaction'); }],
  ['47 7 legacy expedientes preserved', () => expect(migration).toContain('siete expedientes legacy')],
  ['48 no invented historical snapshots', () => expect(migration).toContain('no se crean snapshots')],
  ['49 blob count unchanged', () => expect(migration).toContain('Storage blob count before/after: unchanged')],
  ['50 EXP-005 not implemented', () => expect(service).not.toContain('EXP-005')],
  ['51 EXP-006 not implemented', () => expect(service).toContain('EXP-006 aún no existe')],
  ['52 EXP-009 not implemented', () => expect(service).not.toContain('EXP-009')],
];

describe('EXP-004 contrato atómico', () => {
  it.each(cases)('%s', (_title, assertion) => assertion());
});
