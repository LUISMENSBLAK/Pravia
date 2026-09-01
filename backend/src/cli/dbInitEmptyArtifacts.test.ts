import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertEmptyBootstrapConfirmation,
  buildHistoricalArtifactPlan,
  isObsoleteHistoricalArtifactError,
  splitPostgresStatements,
  validateEmptyBootstrapTarget,
} from '../../scripts/db-init-empty-artifacts';

const migrationsRoot = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
const preH1 = [
  '20260726000000_expedientes_core_engine',
  '20260731_comparecientes_alta_session_ia',
  '20260731_comparecientes_maestro',
  '20260811000000_extend_compareciente_profile_fields',
  '20260811010000_extend_operational_agenda_fields',
  '20260811011000_extend_agenda_event_types',
  '20260811020000_create_ai_usage_logs',
  '20260811030000_create_compliance_engine',
  '20260811031000_seed_verified_compliance_references',
  '20260811040000_create_secure_auth_sessions',
  '20260811041000_harden_legacy_public_api',
  '20260811042000_define_legacy_data_api_deny_policies',
  '20260811050000_add_operational_fk_indexes',
  '20260811051000_complete_operational_fk_indexes',
  '20260811052000_add_compareciente_link_validation',
  '20260812010000_add_granular_delivery_postfirma',
  '20260812020000_persist_project_templates',
  '20260812030000_create_canonical_finance_ledger',
  '20260813010000_immutable_compliance_snapshots',
  '20260813020000_create_reporting_targets',
  '20260813030000_settings_and_access',
  '20260813040000_harden_session_persistence',
  '20260814010000_align_future_schema_and_indexes',
  '20260816010000_prospect_client_catalogs',
  '20260816020000_notaria_client_requirements',
  '20260817010000_compareciente_workspace',
  '20260817020000_enforce_finance_distribution_ceiling',
  '20260817030000_create_isr_calculation_module',
  '20260817040000_expand_compliance_uif_module',
  '20260817045000_create_multitenancy_foundation',
  '20260817050000_create_assistant_conversations',
  '20260817060000_add_missing_operational_fk_indexes',
  '20260824010000_phase_a_cfg_catalogs',
  '20260826010000_expand_expediente_actos',
  '20260826020000_expand_expediente_comparecientes',
  '20260828010000_create_property_master',
  '20260828020000_create_exp004_document_snapshot',
  '20260828030000_create_exp005_operational_follow_up',
  '20260828040000_create_exp006_operational_artifacts',
  '20260829010000_create_exp007_case_budget',
  '20260829020000_create_exp008_case_finance',
  '20260829030000_expand_exp009_case_activity',
  '20260831010000_harden_isr001_contract',
  '20260831020000_create_pro001_source_prerequisites',
  '20260831030000_create_cot001_source_prerequisites',
  '20260831040000_create_g0c_configurable_timing_policies',
];

describe('db:init-empty historical artifacts', () => {
  it('preserves PostgreSQL function bodies while splitting statements', () => {
    const sql = `CREATE FUNCTION x() RETURNS trigger AS $$ BEGIN RAISE NOTICE 'a;b'; RETURN NEW; END $$ LANGUAGE plpgsql; CREATE TRIGGER y BEFORE INSERT ON z FOR EACH ROW EXECUTE FUNCTION x();`;
    expect(splitPostgresStatements(sql)).toHaveLength(2);
  });

  it('builds a pre-H1 plan from all 46 authoritative migrations', async () => {
    const plan = await buildHistoricalArtifactPlan(migrationsRoot, preH1);
    expect(plan.expected.functions).toContain('enforce_same_organization');
    expect(plan.expected.extensions).toContain('pgcrypto');
    expect(plan.expected.functions).toContain('enforce_organization_membership');
    expect(plan.expected.triggers).toContain('trg_auth_session_membership_context');
    expect(plan.expected.checks).toContain('assistant_attachments_storage_source_check');
    expect(plan.expected.indexes).toContain('uq_timing_policy_current');
    expect(plan.expected.rlsTables).toContain('expediente_presupuestos');
    expect(plan.expected.indexes).toContain('conciliaciones_financieras_movimiento_id_transaccion_bancaria_i');
    expect(plan.expected.indexes).not.toContain('conciliaciones_financieras_movimiento_id_transaccion_bancaria_id_key');
    expect(plan.sql.indexOf('enforce_same_organization')).toBeLessThan(plan.sql.indexOf('trg_tenant_assistant_messages_conversation'));
    expect(plan.sql).not.toContain('CREATE POLICY legacy_data_api_denied');
  });

  it('fails closed when the multitenant foundation is not in the plan', async () => {
    await expect(buildHistoricalArtifactPlan(migrationsRoot, ['20260831040000_create_g0c_configurable_timing_policies']))
      .rejects.toThrow('enforce_same_organization');
  });

  it('requires the exact destructive-operation confirmation', () => {
    expect(() => assertEmptyBootstrapConfirmation(undefined)).toThrow('INIT_CONFIRMATION');
    expect(() => assertEmptyBootstrapConfirmation('YES')).toThrow('INIT_CONFIRMATION');
    expect(() => assertEmptyBootstrapConfirmation('INITIALIZE_EMPTY_PRAVIA_TARGET')).not.toThrow();
  });

  it('allows only an explicit isolated local PostgreSQL target', () => {
    expect(validateEmptyBootstrapTarget('postgresql://postgres@127.0.0.1:55449/pravia_os?schema=pravia_os').port).toBe('55449');
    expect(() => validateEmptyBootstrapTarget('postgresql://postgres@example.test/pravia_os?schema=pravia_os')).toThrow('local aislado');
    expect(() => validateEmptyBootstrapTarget('postgresql://postgres@localhost/pravia_os')).toThrow('schema=pravia_os');
  });

  it('skips only references proven obsolete and fails closed for other SQL errors', () => {
    expect(isObsoleteHistoricalArtifactError({ meta: { code: '42P01' } })).toBe(true);
    expect(isObsoleteHistoricalArtifactError({ meta: { code: '42703' } })).toBe(true);
    expect(isObsoleteHistoricalArtifactError({ meta: { code: '42883' } })).toBe(false);
    expect(isObsoleteHistoricalArtifactError(new Error('syntax error'))).toBe(false);
  });
});
