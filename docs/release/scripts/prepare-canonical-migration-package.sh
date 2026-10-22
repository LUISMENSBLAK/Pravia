#!/usr/bin/env bash
set -euo pipefail

# Construye, únicamente en una ruta nueva, el árbol Prisma canónico que coincide
# con el rebaseline ya registrado en producción. No conecta a ninguna base.

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 /ruta/nueva/paquete"
  exit 64
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
output_dir="$1"

if [[ -e "$output_dir" ]]; then
  echo "La ruta de salida ya existe; elige una ruta nueva y acotada."
  exit 65
fi

mkdir -p "$output_dir/migrations"
cp "$repo_root/backend/prisma/schema.prisma" "$output_dir/schema.prisma"
printf 'provider = "postgresql"\n' > "$output_dir/migrations/migration_lock.toml"

migrations=(
  20260726000000_expedientes_core_engine
  20260731_comparecientes_alta_session_ia
  20260731_comparecientes_maestro
  20260811000000_extend_compareciente_profile_fields
  20260811010000_extend_operational_agenda_fields
  20260811011000_extend_agenda_event_types
  20260811020000_create_ai_usage_logs
  20260811030000_create_compliance_engine
  20260811031000_seed_verified_compliance_references
  20260811040000_create_secure_auth_sessions
  20260811041000_harden_legacy_public_api
  20260811042000_define_legacy_data_api_deny_policies
  20260811050000_add_operational_fk_indexes
  20260811051000_complete_operational_fk_indexes
  20260811052000_add_compareciente_link_validation
  20260812000000_canonical_production_baseline
  20260812010000_add_granular_delivery_postfirma
  20260812020000_persist_project_templates
  20260812030000_create_canonical_finance_ledger
  20260813010000_immutable_compliance_snapshots
  20260813020000_create_reporting_targets
  20260813030000_settings_and_access
  20260813040000_harden_session_persistence
  20260814010000_align_future_schema_and_indexes
  20260816010000_prospect_client_catalogs
  20260816020000_notaria_client_requirements
  20260817010000_compareciente_workspace
  20260817020000_enforce_finance_distribution_ceiling
  20260817030000_create_isr_calculation_module
  20260817040000_expand_compliance_uif_module
  20260817045000_create_multitenancy_foundation
  20260817050000_create_assistant_conversations
  20260817060000_add_missing_operational_fk_indexes
  20260824010000_phase_a_cfg_catalogs
  20260826010000_expand_expediente_actos
  20260826020000_expand_expediente_comparecientes
  20260828010000_create_property_master
  20260828020000_create_exp004_document_snapshot
  20260828030000_create_exp005_operational_follow_up
  20260828040000_create_exp006_operational_artifacts
  20260829010000_create_exp007_case_budget
  20260829020000_create_exp008_case_finance
  20260829030000_expand_exp009_case_activity
  20260831010000_harden_isr001_contract
  20260831020000_create_pro001_source_prerequisites
  20260831030000_create_cot001_source_prerequisites
  20260831040000_create_g0c_configurable_timing_policies
  20260831050000_create_h1_compliance_legal_engine
  20260901010000_create_h2_compliance_document_evidence
  20260901020000_create_h3_compliance_screening
  20260902010000_create_h4_beneficial_controller
  20260903005000_prepare_h5_pgcrypto_compatibility
  20260903010000_create_h5_questionnaires_payments_provider
  20260905005000_prepare_legacy_index_compatibility
  20260905010000_create_h6_signature_notices
  20260905011000_cleanup_pgcrypto_compatibility
  20260905020000_create_h7_compliance_closure
  20260905030000_create_h9_assisted_compliance_review
  20260905040000_add_h10_compliance_fk_indexes
  20260905041000_index_rebaseline_legacy_foreign_keys
  20260906010000_correct_prospect_quote_workflow
  20260910010000_cfg001_v2_master_inheritance
  20260911010000_cfg002_v4_legal_library
  20260912010000_correction002_cfg001_questionnaires
  20260915010000_corrections004005006
  20260916010000_corrections003v2_007_expediente_header
  20260919010000_corrections008_009_010_cmp_document_vigencia
  20260920010000_corrections011_012_014
  20260922015000_exp010_project_idempotency
  20260923010000_ai2_quote_document_idempotency
  20260925010000_projection_knowledge_quote_ai_isr_parity
  20260926010000_postal_code_catalog
  20260926011000_postal_code_source_keys
  20260926012000_harden_new_lot_tenant_memberships
  20260926013000_version_fiscal_export_profiles
  20260926014500_index_new_lot_foreign_keys
  20260926020000_correction017_canonical_followup
  20260927010000_correction015_process_catalog
  20260927011000_correction015_prospect_quote_acts
  20260927012000_correction015_act_object_percentage
  20260927013000_correction015_tenant_party_roles
  20260927014000_correction015_audit_tenant_backfill
  20260928010000_act_project_template_correction
  20260929010000_pravia_ia3_finance_projection
  20260929020000_predeploy_operational_roles
  20260929021000_rename_contadora_to_financiero
  20260929030000_intelligent_notification_center
  20260929031000_notification_reminder_tenant_fk
  20260929040000_exp008_invoice_workflow
  20261005010000_agenda_visibility
  20261005020000_document_folder_destinations
  20261005030000_compareciente_document_source
  20261005040000_prospect_quote_assignee
  20261005050000_prospect_document_review
  20261005060000_agenda_creator_membership
  20261005070000_archivo_canonical_protocol
  20261005080000_archivo_appendix_integrity
  20261005090000_archivo_cfg002_destination
  20261005100000_archivo_notes_integrity
  20261006010000_finance_cfdi_local_domain
  20261010010000_act_complete_creation
  20261011010000_cfdi_income_balance
  20261011020000_cfdi_receiver_profile
  20261011030000_cfdi_fiscal_concepts
  20261012010000_mi_dia_modular
  20261016010000_saas_control_plane_foundation
  20261017120000_ai_billing_classification
  20261017121000_ai_usage_migration_tenant_fk
  20261017122000_pricing_override_platform_fk
  20261018010000_migration_provenance_source_row
  20261020090000_organization_institutional_profile
  20261020100000_cfg002_organization_owner_enum
  20261020101000_cfg002_organization_owner_backfill
  20261020230000_quote_budget_tax_correction
)

for migration in "${migrations[@]}"; do
  if [[ "$migration" == "20260812000000_canonical_production_baseline" ]]; then
    source_dir="$repo_root/docs/release/phase-15b/artifacts/canonical-baseline/$migration"
  else
    source_dir="$repo_root/backend/prisma/migrations/$migration"
  fi
  [[ -f "$source_dir/migration.sql" ]] || {
    echo "Falta migration.sql para $migration"
    exit 66
  }
  mkdir "$output_dir/migrations/$migration"
  cp "$source_dir/migration.sql" "$output_dir/migrations/$migration/migration.sql"
done

(
  cd "$output_dir"
  shasum -a 256 schema.prisma migrations/migration_lock.toml migrations/*/migration.sql > SHA256SUMS
)

baseline_hash="$(shasum -a 256 "$output_dir/migrations/20260812000000_canonical_production_baseline/migration.sql" | awk '{print $1}')"
if [[ "$baseline_hash" != "51526bb12228a0c5f4fd02f9baec77ae696f601c2c6f5ff70c2fa9b9cf5f7b49" ]]; then
  echo "El checksum del baseline canónico no coincide."
  exit 67
fi

echo "Paquete canónico preparado localmente: $output_dir"
echo "Migraciones incluidas: ${#migrations[@]}."
