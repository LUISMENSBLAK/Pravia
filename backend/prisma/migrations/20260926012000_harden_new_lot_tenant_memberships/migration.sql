-- Enforce that every actor referenced by the projection, knowledge, quote-AI,
-- and fiscal parity models belongs to the row's organization. The canonical
-- function was introduced by the multitenancy foundation migration.
DO $$
DECLARE relation RECORD; trigger_name TEXT;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('knowledge_sources','created_by_id'),
    ('knowledge_source_versions','created_by_id'),
    ('knowledge_source_versions','verified_by_id'),
    ('knowledge_criteria','created_by_id'),
    ('cotizacion_ia_proposals','created_by_id'),
    ('cotizacion_ia_proposals','decided_by_id'),
    ('project_fact_snapshots','created_by_id'),
    ('project_instruction_applications','created_by_id'),
    ('fiscal_reference_revisions','created_by_id'),
    ('fiscal_reference_revisions','verified_by_id'),
    ('fiscal_export_profiles','created_by_id')
  ) AS relations(child_table, user_column)
  LOOP
    trigger_name := 'trg_new_lot_member_' || substr(md5(relation.child_table || ':' || relation.user_column), 1, 20);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON pravia_os.%I', trigger_name, relation.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON pravia_os.%I FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership(%L)',
      trigger_name,
      relation.child_table,
      relation.user_column
    );
  END LOOP;
END $$;
