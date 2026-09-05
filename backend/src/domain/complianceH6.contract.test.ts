import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260905010000_create_h6_signature_notices/migration.sql');
const h6 = read('src/services/complianceH6.service.ts');
const workflow = read('src/services/expedienteWorkflow.service.ts');
const controller = read('src/controllers/expedientes.controller.ts');
const complianceController = read('src/controllers/compliance.controller.ts');
const routes = read('src/routes/compliance.routes.ts');
const events = read('src/events/complianceH6EventHandlers.ts');
const h5 = read('src/services/complianceH5.service.ts');
const projects = read('src/controllers/proyectos.controller.ts');
const ui = read('../frontend/src/features/cases/components/tabs/H6NoticeWorkspace.tsx');
const workflowUi = read('../frontend/src/features/cases/components/tabs/WorkflowTab.tsx');
const css = read('../frontend/src/features/cases/Expedientes.module.css');
const traceability = read('../docs/requirements/h6-cum-fir-avi-traceability.md');
const fingerprint = read('scripts/h6-db-fingerprint.ts');

const models = ['ComplianceOfficialDefinition', 'ComplianceOfficialDefinitionRevision', 'ComplianceOfficialDefinitionActivation', 'ComplianceObligationTrigger', 'ComplianceNoticeFicheRevision', 'ComplianceOfficialProduct', 'ComplianceNoticePresentation', 'ComplianceNoticeAcknowledgement'];

describe('H6 frozen contract integration', () => {
  it('congela 86 IDs exactos en las cuatro particiones aprobadas', () => {
    const expected = [...Array.from({ length: 25 }, (_, i) => `H6-FIR-${String(i + 1).padStart(3, '0')}`), ...Array.from({ length: 38 }, (_, i) => `H6-AVI-${String(i + 1).padStart(3, '0')}`), ...Array.from({ length: 15 }, (_, i) => `H6-OFF-${String(i + 1).padStart(3, '0')}`), ...Array.from({ length: 8 }, (_, i) => `H6-XINT-${String(i + 1).padStart(3, '0')}`)];
    const ids = Array.from(traceability.matchAll(/^\| (H6-(?:FIR|AVI|OFF|XINT)-\d{3}) \|/gm), (match) => match[1]);
    expect(expected).toHaveLength(86);
    expect(ids).toEqual(expected);
    expect((traceability.match(/^\| H6-.*\| IMPLEMENTED\+TESTED \|/gm) || [])).toHaveLength(77);
    for (const id of ['H6-OFF-013', 'H6-OFF-014']) expect(traceability).toMatch(new RegExp(`\\| ${id} \\| DEFERRED \\|`));
    for (const id of ['H6-AVI-008', 'H6-AVI-009', 'H6-AVI-010']) expect(traceability).toMatch(new RegExp(`\\| ${id} \\| BLOCKED LEGAL DATA \\|`));
    for (const id of ['H6-OFF-006', 'H6-OFF-007', 'H6-OFF-008', 'H6-OFF-009']) expect(traceability).toMatch(new RegExp(`\\| ${id} \\| BLOCKED OFFICIAL FORMAT DATA \\|`));
  });

  it('mapea exactamente las 57 familias congeladas a pruebas y aserciones', () => {
    const families = Array.from(traceability.matchAll(/^\| (H6-TF-\d{3}) \|/gm), (match) => match[1]);
    expect(families).toEqual(Array.from({ length: 57 }, (_, index) => `H6-TF-${String(index + 1).padStart(3, '0')}`));
    expect(traceability).toContain('PREVIOUS SELF-REVIEW NOT RECONSTRUCTIBLE');
  });

  it('crea exactamente los ocho modelos H6 y una sola migración H6', () => {
    for (const model of models) expect(schema).toContain(`model ${model} {`);
    expect(models).toHaveLength(8);
    expect(readdirSync(resolve(process.cwd(), 'prisma/migrations')).filter((name) => name.includes('h6_'))).toEqual(['20260905010000_create_h6_signature_notices']);
  });

  it('integra FIR en la autoridad existente, con preview/confirm, tenant, transacción e idempotencia', () => {
    expect(controller).toContain("String(mode || 'CONFIRM').toUpperCase() === 'PREVIEW'");
    expect(workflow).toContain('ComplianceH6Service.firPreflightTx');
    expect(workflow).toContain('payload.preflightHash !== preflight.hash');
    expect(workflow).toContain('organization_id: actorContext.organizationId');
    expect(workflow).toContain('H6:FIR:');
    expect(workflow).toContain("eventType: 'ExpedienteFirmado'");
    expect(routes).not.toMatch(/\/firmar["']/);
  });

  it('separa PRE_FIRMA/POST_FIRMA/CONTINUA y no persiste un noveno estado AVI', () => {
    expect(schema).toContain("enum ComplianceRequirementPhase");
    for (const value of ['PRE_FIRMA', 'POST_FIRMA', 'CONTINUA']) expect(schema).toContain(value);
    const block = schema.slice(schema.indexOf('enum ComplianceAviState'), schema.indexOf('enum ComplianceFreshness'));
    expect(block.match(/^\s+[A-Z_]+$/gm)).toHaveLength(8);
    expect(block).not.toContain('DESACTUALIZADO');
  });

  it('mantiene identidad estable y provenance N:M sin review/fecha/label en el hash', () => {
    for (const field of ['legal_obligation_key', 'channel_code', 'obligation_type_code', 'canonical_scope_kind', 'canonical_scope_key', 'stable_identity_hash']) expect(schema).toContain(field);
    expect(schema).toContain('model ComplianceObligationTrigger');
    expect(h6).toContain('stableObligationIdentity');
    expect(h6).toContain('complianceObligationTrigger.upsert');
    for (const token of ['h6_obligation_trigger_review_fkey', 'h6_obligation_trigger_result_fkey', 'h6_obligation_trigger_revision_fkey', 'h6_obligation_trigger_act_fkey']) expect(migration).toContain(token);
  });

  it('valida pertenencia canónica antes de persistir scope y aplica acceso de expediente', () => {
    const materialization = h6.slice(h6.indexOf('static async materializeObligationTx'));
    expect(materialization.indexOf('validateCanonicalScopeTx')).toBeLessThan(materialization.indexOf('stableObligationIdentity'));
    for (const token of ['H6_SCOPE_ACT_MEMBERSHIP_INVALID', 'H6_SCOPE_SUBJECT_MEMBERSHIP_INVALID', 'H6_SCOPE_INSTRUMENT_MEMBERSHIP_INVALID', 'expedienteAccessWhere(user)']) expect(h6).toContain(token);
  });

  it('implementa catálogo híbrido, selector fail-closed, activación y retiro auditados', () => {
    expect(schema.slice(schema.indexOf('model ComplianceOfficialDefinition {'), schema.indexOf('model ComplianceOfficialDefinitionRevision {'))).not.toContain('organization_id');
    expect(schema.slice(schema.indexOf('model ComplianceOfficialDefinitionActivation {'), schema.indexOf('model ComplianceObligationTrigger {'))).toContain('organization_id');
    for (const token of ['NOT_CONFIGURED', 'CONFIGURATION_CONFLICT', 'retireOfficialRevision', 'H6_ACTIVATE_OFFICIAL_REVISION', 'H6_RETIRE_OFFICIAL_REVISION']) expect(h6 + read('src/domain/complianceH6.ts')).toContain(token);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"compliance_official_/i);
  });

  it('protege fichas validadas y revisiones verificadas físicamente', () => {
    for (const token of ['h6_guard_validated_fiche_immutability', 'H6_VALIDATED_FICHE_IMMUTABLE', 'h6_guard_official_revision_immutability', 'H6_OFFICIAL_REVISION_IMMUTABLE']) expect(migration).toContain(token);
    expect(h6).toContain('H6_FICHE_VERSION_CONFLICT');
    expect(h6).toContain("authority === 'NOTICE_LOCAL_FIELD'");
    expect(h6).toContain("authority === 'MASTER_SOURCE'");
    expect(migration).toContain('h6_one_active_official_revision_per_org_definition');
    expect(migration).toContain('h6_notice_acknowledgement_append_only');
  });

  it('reusa sources canónicas y sólo marca stale por fuentes consumidas', () => {
    expect(h6).toContain('ComplianceH5Service.currentPaymentSourcesTx');
    expect(h5).toContain('currentPaymentSourcesTx');
    for (const token of ['calculosisr', 'predios', 'comparecientes', 'actos', 'complianceBcStructureSnapshot']) expect(h6.toLowerCase()).toContain(token.toLowerCase());
    expect(h6).toContain('normalized_value_hash');
    expect(h6).toContain('markSourceChangedTx');
    expect(h6).toContain('sourceManifestMatches(entry, input.sourceType, input.stableId)');
    expect(h6).toContain('resolveOfficialRevision(tx, user');
    expect(projects).toContain('markSourceChangedTx');
  });

  it('limita el paquete FIR a evidencia firmable y artefactos EXP-006 vigentes', () => {
    expect(h6).toContain("requires_signed_document: true");
    expect(h6).toContain("status: { not: 'NO_APLICA' }");
    expect(h6).toContain("artefacto: { purpose: 'FIR_SIGNATURE_RELEVANT' }");
    expect(h6).toContain('filter(isSignatureRelevantArtifact)');
    expect(h6).toContain('selectCanonicalDeed(projects)');
  });

  it('preserva las cuatro desigualdades y la historia append-only', () => {
    expect(h6).toContain('generated: true, signed: false, presented: false');
    expect(h6).toContain("fulfillmentPolicy === 'VALIDATED_ACKNOWLEDGEMENT'");
    expect(h6).toContain('previous_presentation_id');
    expect(schema).toContain('acknowledgements      ComplianceNoticeAcknowledgement[]');
    expect(schema).toContain('noticeAcknowledgements     ComplianceNoticeAcknowledgement[]');
    expect(schema).toContain('h6_notice_ack_evidence_fkey');
    expect(migration).toContain('h6_notice_presentation_previous_fkey');
    expect(migration).toContain('h6_notice_ack_evidence_fkey');
    expect(migration).toContain('h6_notice_ack_idempotency_key');
    for (const token of ['h6_official_product_append_only', 'h6_notice_presentation_append_only', 'h6_notice_acknowledgement_append_only', 'H6_APPEND_ONLY_RECORD_IMMUTABLE']) expect(migration).toContain(token);
  });

  it('mantiene la IA de acuse PREPARE_ONLY separada de la confirmación humana', () => {
    expect(h6).toContain('H6_ACK_EXTRACTION_PREPARE_ONLY');
    expect(h6).toContain('PROPUESTA_REQUIERE_CONFIRMACION');
    expect(h6).toContain('CONFIRMADA_POR_HUMANO');
    expect(routes).toContain('/acuses/propuestas');
    expect(routes).toContain('compliance.notice.confirm');
  });

  it('corta el writer legacy sin dual-write y preserva external_*', () => {
    expect(complianceController).toContain('H6_LEGACY_NOTICE_WRITER_RETIRED');
    const h6Operational = h6.slice(h6.indexOf('export class ComplianceH6Service'));
    expect(h6Operational).not.toMatch(/external_filed_at\s*:/);
    expect(h6Operational).not.toMatch(/external_receipt_id\s*:/);
    expect(schema).toContain('external_filed_at');
    expect(migration).toContain('C_AMBIGUOUS_INCOMPLETE');
    expect(migration).toContain('D_HISTORICAL_ONLY_INCOMPATIBLE');
    expect(migration).toContain('A_PRESENTATION_ACK_READY');
    expect(migration).toContain('B_PRESENTATION_READY');
    expect(migration).toContain("'H6:LEGACY:PRESENTATION:' || o.\"id\"::text");
    expect(migration).toContain("'H6:LEGACY:ACK:' || o.\"id\"::text");
  });

  it('usa un handler postfirma H6 independiente y el motor H1 existente', () => {
    expect(events).toContain("DomainEventBus.register('ExpedienteFirmado', 'H6_MATERIALIZE_POST_SIGN_AVI'");
    expect(events).toContain('ComplianceLegalEngineService.evaluateCase');
    expect(events).toContain('fecha_real_firma');
  });

  it('integra UI en Workflow y Cumplimiento con 0/1/N y breakpoints requeridos', () => {
    for (const token of ['Generar formatos pendientes', 'Descargar paquete', 'Ir a Cumplimiento']) expect(workflowUi).toContain(token);
    for (const token of ['Avisos / Declaraciones', 'No hay avisos', 'freshness']) expect(ui).toContain(token);
    for (const width of ['320px', '390px', '768px']) expect(css).toContain(width);
    expect(css).toContain('min-height:44px');
  });

  it('versiona un fingerprint lógico común para fresh e incremental', () => {
    expect(fingerprint).toContain("H6_DB_FINGERPRINT_ALGORITHM");
    expect(fingerprint).toContain('canonicalDatabaseFingerprint');
    expect(fingerprint).not.toContain('ordinal_position');
  });
});
