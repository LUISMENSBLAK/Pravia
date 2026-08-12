import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function getFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Split SQL text into separate executable statements for Prisma
function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let currentStmt = '';
  let inDollarBlock = false;

  const lines = sqlText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      continue;
    }

    if (trimmed.includes('$$')) {
      const occurrences = (trimmed.match(/\$\$/g) || []).length;
      if (occurrences % 2 !== 0) {
        inDollarBlock = !inDollarBlock;
      }
    }

    currentStmt += line + '\n';

    if (!inDollarBlock && trimmed.endsWith(';')) {
      statements.push(currentStmt.trim());
      currentStmt = '';
    }
  }

  if (currentStmt.trim().length > 0) {
    statements.push(currentStmt.trim());
  }

  return statements;
}

async function executeSqlFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  const stmts = splitSqlStatements(content);
  for (const stmt of stmts) {
    const clean = stmt.trim();
    if (clean.length > 0 && clean !== 'BEGIN;' && clean !== 'COMMIT;') {
      await prisma.$executeRawUnsafe(clean);
    }
  }
}

async function runVerification() {
  console.log('====================================================');
  console.log('🔬 REPORTE DE INTEGRIDAD Y VERIFICACIÓN DE MIGRACIÓN');
  console.log('====================================================\n');

  const migrationPath = path.join(__dirname, '../prisma/migrations/20260731_comparecientes_maestro/migration.sql');
  const rollbackPath = path.join(__dirname, '../prisma/migrations/20260731_comparecientes_maestro/rollback.sql');
  const schemaPath = path.join(__dirname, '../prisma/schema.prisma');

  // 1. HASHES SHA-256
  const hashMigration = getFileHash(migrationPath);
  const hashRollback = getFileHash(rollbackPath);
  const hashSchema = getFileHash(schemaPath);

  console.log('🔑 HASHES SHA-256 DE ARCHIVOS DEFINITIVOS:');
  console.log(`- schema.prisma:  ${hashSchema}`);
  console.log(`- migration.sql:  ${hashMigration}`);
  console.log(`- rollback.sql:   ${hashRollback}\n`);

  // 2. CONTEO ANTES DE LA MIGRACIÓN
  console.log('📊 CONTEO DE FILAS ANTES DE MIGRACIÓN:');
  const tables = [
    'users',
    'prospectos',
    'cotizaciones',
    'expedientes',
    'documentos',
    'expediente_documentos',
    'movimientos_financieros',
    'notarias'
  ];

  const countsBefore: Record<string, number> = {};
  for (const table of tables) {
    const res: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}";`);
    countsBefore[table] = res[0].count;
    console.log(`  - ${table}: ${countsBefore[table]}`);
  }

  // 3. DIAGNÓSTICO PREVIO DE DUPLICADOS EN TABLAS EXISTENTES DE PERSONAS
  console.log('\n🔎 DIAGNÓSTICO PREVIO DE DUPLICADOS EN TABLAS EXISTENTES:');
  const checkPersonasTable: any = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'personas_fisicas'
    ) as exists;
  `);

  if (checkPersonasTable[0].exists) {
    const curpDupes: any = await prisma.$queryRawUnsafe(`
      SELECT UPPER(TRIM(curp)) as curp, COUNT(*)::int as count
      FROM personas_fisicas
      WHERE curp IS NOT NULL AND TRIM(curp) <> '' AND archived_at IS NULL
      GROUP BY UPPER(TRIM(curp))
      HAVING COUNT(*) > 1;
    `);
    console.log(`  - Coincidencias duplicadas de CURP activa: ${curpDupes.length}`);

    const rfcDupes: any = await prisma.$queryRawUnsafe(`
      SELECT UPPER(TRIM(rfc)) as rfc, COUNT(*)::int as count
      FROM personas_fisicas
      WHERE rfc IS NOT NULL AND TRIM(rfc) <> '' AND archived_at IS NULL
      GROUP BY UPPER(TRIM(rfc))
      HAVING COUNT(*) > 1;
    `);
    console.log(`  - Coincidencias duplicadas de RFC física activa: ${rfcDupes.length}`);
  } else {
    console.log('  - Las tablas de comparecientes no existen aún (0 duplicados).');
  }

  // 4. EJECUCIÓN DE MIGRACIÓN DDL EN BASE TEMPORAL/SESIÓN
  console.log('\n⚡ EJECUTANDO MIGRACIÓN DDL SQL DE PRUEBA...');
  await executeSqlFile(migrationPath);
  console.log('✅ Migración DDL SQL ejecutada correctamente.');

  // 5. CONTEO DESPUÉS DE MIGRACIÓN
  console.log('\n📊 CONTEO DE FILAS DESPUÉS DE MIGRACIÓN:');
  const countsAfterMigration: Record<string, number> = {};
  for (const table of tables) {
    const res: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}";`);
    countsAfterMigration[table] = res[0].count;
    console.log(`  - ${table}: ${countsAfterMigration[table]} (Diferencia: ${countsAfterMigration[table] - countsBefore[table]})`);
  }

  // 6. EJECUCIÓN DE ROLLBACK SQL
  console.log('\n🔄 EJECUTANDO ROLLBACK SQL DE PRUEBA...');
  await executeSqlFile(rollbackPath);
  console.log('✅ Rollback SQL ejecutado correctamente.');

  // 7. CONTEO DESPUÉS DE ROLLBACK
  console.log('\n📊 CONTEO DE FILAS DESPUÉS DE ROLLBACK:');
  const countsAfterRollback: Record<string, number> = {};
  let totalDiferencia = 0;
  for (const table of tables) {
    const res: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}";`);
    countsAfterRollback[table] = res[0].count;
    const diff = countsAfterRollback[table] - countsBefore[table];
    totalDiferencia += Math.abs(diff);
    console.log(`  - ${table}: ${countsAfterRollback[table]} (Diff respecto a inicio: ${diff})`);
  }

  console.log(`\nPERDIDA DE DATOS REGISTRADA: ${totalDiferencia} registros.`);
  if (totalDiferencia === 0) {
    console.log('🎉 VERIFICACIÓN EXITOSA: CERO PÉRDIDA DE DATOS (0 REGISTROS AFECTADOS).\n');
  } else {
    console.error('❌ PÉRDIDA DE DATOS DETECTADA EN ROLLBACK!');
  }
}

runVerification()
  .catch((e) => {
    console.error('❌ Error en script de verificación:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
