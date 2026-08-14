import fs from 'node:fs';
import path from 'node:path';

const phaseRoot = path.resolve(__dirname, '../../docs/release/phase-15a');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(phaseRoot, 'artifacts', name), 'utf8'));
const local = read('local-readonly.json');
const production = read('production-readonly.json');
const staging = read('staging-readonly.json');
const localMigrationMetadata = read('local-migrations.json');

const migrationMap = (inventory: any) => new Map(inventory.migrations.map((row: any) => [row.migration_name, row]));
const localHistory = migrationMap(local);
const productionHistory = migrationMap(production);
const stagingHistory = migrationMap(staging);
const names = [...new Set([...localHistory.keys(), ...productionHistory.keys(), ...stagingHistory.keys()] as string[])].sort();

const matrix = names.map((migration) => {
  const localRow: any = localHistory.get(migration);
  const productionRow: any = productionHistory.get(migration);
  const stagingRow: any = stagingHistory.get(migration);
  let classification = 'UNKNOWN_STATE';
  if (stagingRow && !stagingRow.finished_at && !stagingRow.rolled_back_at) classification = 'PARTIALLY_APPLIED';
  else if (productionRow?.rolled_back_at) classification = 'ROLLED_BACK_REMOTE';
  else if (localRow && productionRow && localRow.checksum !== productionRow.checksum) classification = 'CHECKSUM_MISMATCH';
  else if (localRow && productionRow) classification = 'MATCH_EXACT';
  else if (localRow && !productionRow) classification = 'LOCAL_ONLY';
  else if (!localRow && productionRow) classification = 'REMOTE_ONLY';

  const metadata = localMigrationMetadata.find((row: any) => row.migration === migration);
  return {
    migration,
    local: Boolean(localRow), production: Boolean(productionRow), staging: Boolean(stagingRow),
    local_checksum: localRow?.checksum || metadata?.checksum || null,
    production_checksum: productionRow?.checksum || null,
    staging_checksum: stagingRow?.checksum || null,
    classification,
    production_applied_steps: productionRow?.applied_steps_count ?? null,
    production_finished_at: productionRow?.finished_at || null,
    staging_finished_at: stagingRow?.finished_at || null,
    staging_logs: stagingRow?.logs || null,
    risk: metadata?.risk || (classification === 'REMOTE_ONLY' ? 'CRITICAL' : 'UNKNOWN'),
  };
});

const normalizeSql = (value: unknown) => value == null ? null : String(value)
  .replace(/pravia_os\./g, '')
  .replace(/CURRENT_TIMESTAMP/g, 'now()')
  .replace(/\s+/g, ' ')
  .trim();
const scalar = (value: unknown) => value == null ? null : String(value);

const structureSpecs: Record<string, { key: (row: any) => string; filter?: (row: any) => boolean; value: (row: any) => unknown }> = {
  tables: { key: (row) => `${row.table_schema}.${row.table_name}`, filter: (row) => row.table_schema === 'pravia_os', value: (row) => row.table_type },
  columns: {
    key: (row) => `${row.table_name}.${row.column_name}`,
    filter: (row) => row.table_name !== '_prisma_migrations',
    value: (row) => ({ data_type: row.data_type, udt_schema: row.udt_schema, udt_name: row.udt_name, nullable: row.is_nullable, default: normalizeSql(row.column_default), max_length: scalar(row.character_maximum_length), precision: scalar(row.numeric_precision), scale: scalar(row.numeric_scale) }),
  },
  constraints: { key: (row) => `${row.table_name}.${row.constraint_name}`, value: (row) => ({ type: row.constraint_type, definition: normalizeSql(row.definition) }) },
  indexes: { key: (row) => `${row.table_name}.${row.index_name}`, value: (row) => normalizeSql(row.definition) },
  enums: { key: (row) => `${row.enum_name}.${row.enumlabel}`, value: () => true },
  sequences: { key: (row) => `${row.sequence_schema}.${row.sequence_name}`, value: (row) => ({ type: row.data_type, start: row.start_value, min: row.minimum_value, max: row.maximum_value, increment: row.increment }) },
  triggers: { key: (row) => `${row.table_name}.${row.trigger_name}.${row.event_manipulation}`, value: (row) => ({ timing: row.action_timing, statement: row.action_statement }) },
  functions: { key: (row) => `${row.function_name}(${row.arguments})`, value: (row) => ({ result: row.result_type, volatility: row.volatility }) },
};

const normalize = (value: any) => JSON.stringify(value, Object.keys(value).sort());
function structuralDiff(left: any, right: any) {
  return Object.fromEntries(Object.entries(structureSpecs).map(([section, spec]) => {
    const leftRows = (left.structure[section] || []).filter(spec.filter || (() => true));
    const rightRows = (right.structure[section] || []).filter(spec.filter || (() => true));
    const leftMap = new Map(leftRows.map((row: any) => [spec.key(row), spec.value(row)]));
    const rightMap = new Map(rightRows.map((row: any) => [spec.key(row), spec.value(row)]));
    const leftOnly = [...leftMap.keys()].filter((key) => !rightMap.has(key)).sort();
    const rightOnly = [...rightMap.keys()].filter((key) => !leftMap.has(key)).sort();
    const changed = [...leftMap.keys()].filter((key) => rightMap.has(key) && normalize(leftMap.get(key)) !== normalize(rightMap.get(key))).sort();
    return [section, { left_count: leftRows.length, right_count: rightRows.length, left_only: leftOnly, right_only: rightOnly, changed }];
  }));
}

const counts = matrix.reduce((result: Record<string, number>, row) => {
  result[row.classification] = (result[row.classification] || 0) + 1;
  return result;
}, {});

const report = {
  generated_at: new Date().toISOString(),
  migration_counts: { local: local.migrations.length, staging: staging.migrations.length, production: production.migrations.length, classifications: counts },
  migration_matrix: matrix,
  schema_diffs: {
    production_to_local: structuralDiff(production, local),
    production_to_staging: structuralDiff(production, staging),
    local_to_staging: structuralDiff(local, staging),
  },
};

fs.writeFileSync(path.join(phaseRoot, 'artifacts/comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.migration_counts));
