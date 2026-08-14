# Propuesta de historia canónica

```text
17 migraciones LEGACY (evidencia inmutable)
  -> 20260812000000_canonical_production_baseline (S0)
  -> 20260812010000_add_granular_delivery_postfirma
  -> 20260812020000_persist_project_templates
  -> 20260812030000_create_canonical_finance_ledger
  -> 20260813010000_immutable_compliance_snapshots
  -> 20260813020000_create_reporting_targets
  -> 20260813030000_settings_and_access
  -> 20260813040000_harden_session_persistence (S1)
```

Para instalaciones nuevas, la cadena candidata vive en `artifacts/canonical-prisma/migrations`. Para instalaciones legacy, la metadata anterior se conserva en un schema técnico separado, se registra el baseline sólo después de validar fingerprint y se despliegan los siete deltas. `backend/prisma/migrations` permanece intacto.

No se recomienda mover aún migraciones a `migrations_legacy`: CI, Render, Prisma CLI y scripts consumen la ubicación actual. La adopción queda bloqueada hasta reconciliar `schema.prisma`, añadir los 16 índices FK y repetir todas las validaciones. No se autoriza ninguna ejecución productiva con este documento.
