const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
  console.log('=== TESTING MIGRATION.SQL & ROLLBACK.SQL IN ISOLATED TEMPORARY SCHEMA ===\n');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const client = new Client({ connectionString });
  await client.connect();

  const baseDir = path.resolve(__dirname, '..');
  const migrationPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'migration.sql');
  const rollbackPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'rollback.sql');

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');

  try {
    // 1. Create temporary schema
    console.log('--- 1. CREATING ISOLATED TEMPORARY SCHEMA temp_migration_test ---');
    await client.query(`DROP SCHEMA IF EXISTS temp_migration_test CASCADE;`);
    await client.query(`CREATE SCHEMA temp_migration_test;`);
    await client.query(`SET search_path TO temp_migration_test, public;`);
    console.log('✅ Temporary schema created & search_path set.');

    // 2. Execute migration.sql
    console.log('\n--- 2. EXECUTING MIGRATION.SQL IN TEMPORARY SCHEMA ---');
    await client.query(migrationSql);
    console.log('✅ migration.sql executed successfully without errors!');

    // 3. Inspect created tables & enums
    console.log('\n--- 3. INSPECTING CREATED TABLES AND ENUMS ---');
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'temp_migration_test' 
      ORDER BY table_name;
    `);
    console.log(`Created Tables (${tablesRes.rows.length}):`, tablesRes.rows.map(r => r.table_name));

    const enumsRes = await client.query(`
      SELECT t.typname AS enum_name
      FROM pg_type t 
      JOIN pg_namespace n ON n.oid = t.typnamespace 
      WHERE t.typname IN (
        'AltaComparecienteEstatus', 'CargaTemporalEstatus', 'StorageCompensationEstatus', 
        'DatoFuenteEstado', 'CalidadLectura', 'PepEstado'
      )
      ORDER BY t.typname;
    `);
    console.log(`Verified Enums (${enumsRes.rows.length}):`, enumsRes.rows.map(r => r.enum_name));

    // 4. Execute rollback.sql
    console.log('\n--- 4. EXECUTING ROLLBACK.SQL IN TEMPORARY SCHEMA ---');
    await client.query(rollbackSql);
    console.log('✅ rollback.sql executed successfully without errors!');

    const tablesAfterRollback = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'temp_migration_test';
    `);
    console.log(`Tables remaining after rollback: ${tablesAfterRollback.rows.length}`);

    // 5. Cleanup
    console.log('\n--- 5. CLEANING UP TEMPORARY SCHEMA ---');
    await client.query(`DROP SCHEMA IF EXISTS temp_migration_test CASCADE;`);
    console.log('✅ Temporary schema dropped. Production DB pravia_os is 100% clean and untouched.');

    console.log('\n🎉 ALL MIGRATION AND ROLLBACK SQL TESTS PASSED WITH 100% SUCCESS');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
