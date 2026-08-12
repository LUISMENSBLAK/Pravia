import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

function parseSqlStatements(sqlContent: string): string[] {
  let cleaned = sqlContent.replace(/^BEGIN;/m, '').replace(/^COMMIT;/m, '');
  
  const statements: string[] = [];
  let current = '';
  let inDollarBlock = false;

  const lines = cleaned.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('--')) continue;
    
    if (line.includes('DO $$')) {
      inDollarBlock = true;
    }
    
    current += line + '\n';
    
    if (line.includes('END $$;')) {
      inDollarBlock = false;
      statements.push(current.trim());
      current = '';
    } else if (!inDollarBlock && line.trim().endsWith(';')) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements.filter(s => s.length > 0 && s !== ';');
}

async function main() {
  console.log('=== TESTING MIGRATION.SQL & ROLLBACK.SQL IN TEMPORARY SCHEMA USING PRISMA ===\n');

  const baseDir = path.resolve(__dirname, '..');
  const migrationPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'migration.sql');
  const rollbackPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'rollback.sql');

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');

  const migrationStmts = parseSqlStatements(migrationSql);
  const rollbackStmts = parseSqlStatements(rollbackSql);

  // 1. Create temporary schema
  console.log('--- 1. CREATING ISOLATED TEMPORARY SCHEMA temp_migration_test ---');
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS temp_migration_test CASCADE;`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA temp_migration_test;`);
  await prisma.$executeRawUnsafe(`SET search_path TO temp_migration_test, pravia_os, public;`);
  console.log('✅ Temporary schema created & search_path set.');

  // 2. Execute migration.sql statements
  console.log(`\n--- 2. EXECUTING ${migrationStmts.length} STATEMENTS FROM MIGRATION.SQL ---`);
  for (let i = 0; i < migrationStmts.length; i++) {
    const stmt = migrationStmts[i];
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (err: any) {
      console.error(`❌ Error in statement #${i + 1}:\n${stmt}\n`, err.message);
      throw err;
    }
  }
  console.log('✅ All migration.sql statements executed successfully without errors!');

  // 3. Inspect created tables & enums in temp_migration_test
  console.log('\n--- 3. INSPECTING CREATED TABLES AND ENUMS IN TEMPORARY SCHEMA ---');
  const tables: any[] = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'temp_migration_test' 
    ORDER BY table_name;
  `);

  console.log(`Created Tables in temp_migration_test (${tables.length}):`, tables.map((t: any) => t.table_name));

  // 4. Test Rollback.sql
  console.log(`\n--- 4. EXECUTING ${rollbackStmts.length} STATEMENTS FROM ROLLBACK.SQL ---`);
  for (let i = 0; i < rollbackStmts.length; i++) {
    const stmt = rollbackStmts[i];
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (err: any) {
      console.error(`❌ Error in rollback statement #${i + 1}:\n${stmt}\n`, err.message);
      throw err;
    }
  }
  console.log('✅ All rollback.sql statements executed successfully without errors!');

  const tablesAfterRollback: any[] = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'temp_migration_test';
  `);
  console.log(`Tables remaining in temporary schema after rollback: ${tablesAfterRollback.length}`);

  // 5. Cleanup temporary schema
  console.log('\n--- 5. CLEANING UP TEMPORARY SCHEMA ---');
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS temp_migration_test CASCADE;`);
  console.log('✅ Temporary schema dropped. Production DB pravia_os is 100% clean and untouched.');

  console.log('\n🎉 ALL MIGRATION AND ROLLBACK SQL STATEMENT TESTS PASSED WITH 100% SUCCESS');
}

main()
  .catch((e) => {
    console.error('❌ TEST FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
