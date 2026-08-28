import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260826020000_expand_expediente_comparecientes/migration.sql');
const service = read('backend/src/services/expedienteParties.service.ts');
const controller = read('backend/src/controllers/expedienteParties.controller.ts');
const routes = read('backend/src/routes/expedientes.routes.ts');
const retiredRoutes = read('backend/src/routes/compareciente.routes.ts');
const opening = read('backend/src/services/expedienteOpening.service.ts');
const navigation = read('frontend/src/features/cases/expedienteNavigation.ts');
const workspace = read('frontend/src/features/comparecientes/ComparecienteWorkspace.tsx');
const ui = read('frontend/src/features/cases/components/tabs/PartiesTab.tsx');

const checks: Array<[string, () => boolean]> = [
  ['EXP-003-01 · vínculo a persona existente', () => service.includes('db.compareciente.findFirst') && service.includes('tx.expedienteCompareciente.create')],
  ['EXP-003-02 · no duplica persona', () => !service.includes('tx.compareciente.create') && !ui.includes('nombre:')],
  ['EXP-003-03 · persona vinculada a Acto 1', () => service.includes('expediente_acto_id: preview.proposed.expediente_acto_id')],
  ['EXP-003-04 · misma persona puede participar en Acto 2', () => !migration.includes('UNIQUE ("organization_id", "expediente_id", "compareciente_id")')],
  ['EXP-003-05 · identidad maestra única', () => /compareciente\s+Compareciente\s+@relation\(fields: \[compareciente_id\]/.test(schema)],
  ['EXP-003-06 · participación opcional y fiscalmente precisa', () => /participacion_porcentaje\s+Decimal\?\s+@db\.Decimal\(9, 6\)/.test(schema) && migration.includes('> 0 AND "participacion_porcentaje" <= 100')],
  ['EXP-003-07 · propio derecho estructurado', () => service.includes('FormaComparecencia.PROPIO_DERECHO') && ui.includes('Por propio derecho')],
  ['EXP-003-08 · representación reutiliza entidad actual', () => service.includes('tx.expedienteRepresentacion.create') && !schema.includes('ExpedientePartyRepresentationNew')],
  ['EXP-003-09 · editar rol no modifica maestro', () => service.includes("command.operation === 'UPDATE'") && !service.includes('compareciente.update')],
  ['EXP-003-10 · editar participación no modifica maestro', () => service.includes('participacion_porcentaje: preview.proposed.participacion_porcentaje') && !service.includes('compareciente.update')],
  ['EXP-003-11 · búsqueda tenant scoped', () => service.includes('organization_id: actor.organizationId') && service.includes('comparecienteObjectWhere(actor)')],
  ['EXP-003-12 · persona cross-tenant bloqueada', () => service.includes('EXPEDIENTE_PARTY_MASTER_ACCESS_DENIED')],
  ['EXP-003-13 · acto cross-tenant bloqueado', () => service.includes('EXPEDIENTE_PARTY_ACT_ACCESS_DENIED') && migration.includes('exp_comparecientes_acto_tenant_fkey')],
  ['EXP-003-14 · relación IDOR bloqueada', () => service.includes('EXPEDIENTE_PARTY_RELATION_ACCESS_DENIED') && service.includes('expedienteAccessWhere(actor)')],
  ['EXP-003-15 · RBAC lectura', () => routes.includes("requirePermission('comparecientes.read'), listExpedienteParties")],
  ['EXP-003-16 · RBAC vínculo', () => routes.includes("requirePermission('expedientes.write'), requirePermission('comparecientes.write'), previewExpedientePartyChange")],
  ['EXP-003-17 · RBAC edición', () => routes.includes("router.post('/:id/comparecientes/aplicar'")],
  ['EXP-003-18 · RBAC desvinculación', () => routes.includes("requirePermission('comparecientes.write'), applyExpedientePartyChange")],
  ['EXP-003-19 · crear nuevo abre ficha maestra completa', () => ui.includes("navigate(`/comparecientes/nuevo?") && workspace.includes('startAssisted')],
  ['EXP-003-20 · contexto seguro preservado', () => navigation.includes('resolveExpedienteCreationContext') && navigation.includes('safeId.test')],
  ['EXP-003-21 · retorno al expediente correcto', () => workspace.includes('navigate(safeReturn') && workspace.includes('exp003NewComparecienteId') && navigation.includes("#${section}")],
  ['EXP-003-22 · reevaluación CFG-002', () => service.includes('resolveCfg002Impact') && service.includes('db.catalogoArtefacto.findMany')],
  ['EXP-003-23 · preview de impacto', () => routes.includes("router.post('/:id/comparecientes/preview'") && ui.includes('Revisar impacto')],
  ['EXP-003-24 · trabajo protegido no se borra', () => !service.includes('expedienteDocumento.delete') && !service.includes('expedienteRequisitoDoc.delete') && service.includes('EXPEDIENTE_PARTY_CONFIRMATION_REQUIRED')],
  ['EXP-003-25 · stale preview bloqueado', () => service.includes('EXPEDIENTE_PARTY_PREVIEW_STALE')],
  ['EXP-003-26 · unlink sólo desactiva relación', () => service.includes("estatus: 'INACTIVO'") && !service.includes('expedienteCompareciente.delete')],
  ['EXP-003-27 · unlink parcial por relation_id', () => service.includes('where: { id: before!.id }') && service.includes('relation_id?: string')],
  ['EXP-003-28 · cascade no borra maestro', () => migration.includes('REFERENCES "pravia_os"."comparecientes"("id", "organization_id") ON DELETE RESTRICT') && !service.includes('compareciente.delete')],
  ['EXP-003-29 · AuditLog vínculo', () => service.includes("'LINK_EXPEDIENTE_PARTY'") && service.includes('tx.auditLog.create')],
  ['EXP-003-30 · AuditLog cambio', () => service.includes("'UPDATE_EXPEDIENTE_PARTY_RELATION'")],
  ['EXP-003-31 · AuditLog desvinculación', () => service.includes("'UNLINK_EXPEDIENTE_PARTY'")],
  ['EXP-003-32 · ISR puede consumir rol por acto', () => /expediente_acto_id\s+String\?/.test(schema) && /caracter_id\s+String/.test(schema) && schema.includes('participacion_porcentaje')],
  ['EXP-003-33 · EXP-004 no implementado', () => !service.includes('comparecienteDocumento.create') && !service.includes('storage.')],
  ['EXP-003-34 · EXP-006 no implementado', () => service.includes('db.catalogoArtefacto.findMany') && !service.includes('catalogoArtefacto.create') && !service.includes('expedienteRequisitoDoc.create')],
  ['EXP-003-35 · legacy preservado sin adivinar', () => migration.includes('HAVING count(*) = 1') && migration.includes('NULL is reserved for ambiguous legacy links') && !/DELETE FROM "pravia_os"\."(comparecientes|expediente_comparecientes)"/.test(migration)],
];

describe('EXP-003 contrato atómico', () => {
  it.each(checks)('%s', (_name, check) => expect(check()).toBe(true));

  it('retira por completo los endpoints legacy inseguros sin crear una segunda arquitectura', () => {
    expect(retiredRoutes).not.toContain('/vincular-expediente');
    expect(controller).toContain('ExpedientePartiesService');
    expect(opening).toContain('expediente_acto_id: initialAct.id');
  });
});
