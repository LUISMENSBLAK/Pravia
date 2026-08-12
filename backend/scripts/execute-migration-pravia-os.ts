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
  console.log('=== EJECUCIÓN AUTORIZADA DE MIGRATION.SQL EN pravia_os ===\n');

  const startTime = Date.now();
  const baseDir = path.resolve(__dirname, '..');
  const migrationPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'migration.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  const migrationStmts = parseSqlStatements(migrationSql);

  // Set search path to pravia_os, public
  await prisma.$executeRawUnsafe(`SET search_path TO pravia_os, public;`);

  console.log(`Ejecutando ${migrationStmts.length} sentencias dentro de pravia_os...`);
  for (let i = 0; i < migrationStmts.length; i++) {
    const stmt = migrationStmts[i];
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  [${i + 1}/${migrationStmts.length}] Sentencia ejecutada con éxito.`);
    } catch (err: any) {
      console.error(`❌ ERROR CRÍTICO en sentencia #${i + 1}:\n${stmt}\n`, err.message);
      throw err;
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n🎉 MIGRATION.SQL APLICADA EXITOSAMENTE EN pravia_os EN ${durationMs} ms`);
}

main()
  .catch((e) => {
    console.error('❌ MIGRACIÓN ABORTADA:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
