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
echo "Migraciones incluidas: ${#migrations[@]} (9 aplicadas + 9 pendientes)."
