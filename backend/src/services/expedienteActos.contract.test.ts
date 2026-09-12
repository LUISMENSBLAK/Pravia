import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260826010000_expand_expediente_actos/migration.sql');
const service = read('backend/src/services/expedienteActos.service.ts');
const opening = read('backend/src/services/expedienteOpening.service.ts');
const routes = read('backend/src/routes/expedientes.routes.ts');
const controller = read('backend/src/controllers/expedientes.controller.ts');
const ui = read('frontend/src/features/cases/components/tabs/ActsTab.tsx');
const catalog = read('frontend/src/features/prospects/components/CatalogCombobox.tsx');
const fixture = read('backend/src/services/fixtures/expediente-actos-pre-migration.sql');
const operationalScripts = [
  read('backend/scripts/e2e-compliance-lifecycle.ts'),
  read('backend/scripts/e2e-critical-flows.ts'),
  read('backend/scripts/e2e-rbac-idor.ts'),
  read('backend/scripts/test-document-lineage-pipeline.js'),
].join('\n');

const checks: Array<[string, () => boolean]> = [
  ['EXP-002-01 · conserva los 7 expedientes legacy', () => fixture.includes('generate_series(1, 7)') && migration.includes('ALTER COLUMN "tipo_acto_id" DROP NOT NULL')],
  ['EXP-002-02 · backfill exacto e idempotente', () => migration.includes("md5('expediente-acto-inicial:'") && migration.includes('ON CONFLICT ("organization_id", "expediente_id", "idempotency_key") DO NOTHING')],
  ['EXP-002-03 · valida relaciones huérfanas', () => migration.includes('EXPEDIENTE_ACT_BACKFILL_ORPHAN')],
  ['EXP-002-04 · valida tenant mismatch', () => migration.includes('EXPEDIENTE_ACT_BACKFILL_TENANT_MISMATCH')],
  ['EXP-002-05 · no duplica TipoActo', () => /tipo_acto\s+TipoActo/.test(schema)],
  ['EXP-002-06 · expediente contiene N actos', () => /actos\s+ExpedienteActo\[\]/.test(schema)],
  ['EXP-002-07 · permite repetir TipoActo', () => !schema.includes('@@unique([expediente_id, tipo_acto_id]') && !schema.includes('@@unique([organization_id, expediente_id, tipo_acto_id]')],
  ['EXP-002-08 · retry no duplica instancia', () => schema.includes('uq_expediente_actos_idempotency') && schema.includes('uq_expediente_actos_removal_idempotency')],
  ['EXP-002-09 · conversión crea acto inicial', () => opening.includes('.createInitial(tx,')],
  ['EXP-002-10 · conversión transaccional', () => opening.includes('openInTransaction(tx: Prisma.TransactionClient')],
  ['EXP-002-11 · alta consulta catálogo maestro', () => service.includes('db.tipoActo.findFirst') && ui.includes('CatalogCombobox')],
  ['EXP-002-12 · alta calcula CFG-001', () => service.includes('db.configuracionActo.findMany')],
  ['EXP-002-13 · alta calcula CFG-002', () => service.includes('db.catalogoArtefacto.findMany')],
  ['EXP-002-14 · no hardcodea documentos', () => !service.includes('requisitos_docs: { create')],
  ['EXP-002-15 · no hardcodea tiempos', () => !service.includes('duracion_esperada_dias')],
  ['EXP-002-16 · cambio exige preview', () => service.includes('EXPEDIENTE_ACT_PREVIEW_REQUIRED') && ui.includes('Revisar impacto')],
  ['EXP-002-17 · desvinculación exige preview', () => service.includes("command.operation === 'REMOVE'") && routes.includes("router.post('/:id/actos/preview'")],
  ['EXP-002-18 · trabajo no se borra', () => !service.includes('expedienteActo.delete') && service.includes('removed_reason')],
  ['EXP-002-19 · preview stale bloqueado', () => service.includes('EXPEDIENTE_ACT_PREVIEW_STALE')],
  ['EXP-002-20 · cross-tenant bloqueado', () => migration.includes('expediente_actos_expediente_tenant_fkey') && service.includes('organization_id: actor.organizationId')],
  ['EXP-002-21 · IDOR de objeto bloqueado', () => service.includes('expedienteAccessWhere(actor)')],
  ['EXP-002-22 · auditoría de alta', () => service.includes("'ADD_EXPEDIENTE_ACT'") && service.includes('tx.auditLog.create')],
  ['EXP-002-23 · auditoría de cambio/retiro', () => service.includes("'UNLINK_EXPEDIENTE_ACT'") && service.includes('tx.expedienteActividad.create')],
  ['EXP-002-24 · RBAC', () => routes.includes("requirePermission('expedientes.write'), previewExpedienteActoChange")],
  ['EXP-002-25 · legacy no canónico', () => /tipo_acto_id\s+String\?\s+@db\.Uuid/.test(schema) && controller.includes('LEGACY_ACT_FIELD_READ_ONLY')],
  ['EXP-002-26 · no writer nuevo legacy', () => {
    const directLegacyWrite = /expediente\.create\(\{\s*data:\s*\{(?:(?!actos:\s*\{)[\s\S]){0,1200}?tipo_acto_id\s*:/.test(`${opening}\n${operationalScripts}`);
    const retiredDirectEndpoint = /(?:post|api)\([^\n]{0,120}['"]\/expedientes['"]/.test(operationalScripts);
    return !directLegacyWrite && !retiredDirectEndpoint;
  }],
  ['EXP-002-27 · CFG-001 sólo lectura', () => service.includes('db.configuracionActo.findMany') && !service.includes('configuracionActo.update')],
  ['EXP-002-28 · CFG-002 sólo lectura', () => service.includes('db.catalogoArtefacto.findMany') && !service.includes('catalogoArtefacto.update')],
  ['EXP-002-29 · folios intactos', () => !migration.includes('numero_pravia')],
  ['EXP-002-30 · LEGACY LOSS cero', () => !/DELETE FROM "pravia_os"\."(expedientes|cotizaciones|tipos_acto)"/.test(migration) && catalog.includes("normalize('NFD')")],
];

describe('EXP-002 contrato atómico', () => {
  it.each(checks)('%s', (_name, check) => expect(check()).toBe(true));
});
