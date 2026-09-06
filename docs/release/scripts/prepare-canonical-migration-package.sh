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
echo "Migraciones incluidas: ${#migrations[@]} (18 aplicadas + 27 pendientes)."
