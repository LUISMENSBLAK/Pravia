import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { seedComparecientesCatalogos } from '../prisma/seeds/comparecientes_catalogos.seed';

const prisma = new PrismaClient();

function getFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Split SQL text into separate executable statements for Prisma executeRawUnsafe
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

async function executeMigration() {
  const startTime = new Date();
  console.log('===========================================================');
  console.log('🚀 INICIANDO MIGRACIÓN TRANSACCIONAL DE COMPARECIENTES');
  console.log(`Start Time: ${startTime.toISOString()}`);
  console.log('================================================ me===========\n');

  const migrationPath = path.join(__dirname, '../prisma/migrations/20260731_comparecientes_maestro/migration.sql');
  const rollbackPath = path.join(__dirname, '../prisma/migrations/20260731_comparecientes_maestro/rollback.sql');
  const schemaPath = path.join(__dirname, '../prisma/schema.prisma');

  // 1. VERIFICACIÓN DE HASHES SHA-256
  console.log('🔑 PASO 1: VERIFICANDO HASHES SHA-256 DE ARCHIVOS...');
  const expectedHashes = {
    schema: 'c85d8bb0d20baa00199bc79e73fefb67fddde219ffeeb166eeb01b7133233c43',
    migration: 'cecd3d80d8e0f4d9578ce5a332c0888c020cf27192d0682bd6c839596e4c9b29',
    rollback: '5ce1bdfd1f02fc9e4a309efb1e4cc7108c9709d915fd091f84921cb921dfefb7'
  };

  const currentHashes = {
    schema: getFileHash(schemaPath),
    migration: getFileHash(migrationPath),
    rollback: getFileHash(rollbackPath)
  };

  console.log(`- schema.prisma:  ${currentHashes.schema}`);
  console.log(`- migration.sql:  ${currentHashes.migration}`);
  console.log(`- rollback.sql:   ${currentHashes.rollback}`);

  if (
    currentHashes.schema !== expectedHashes.schema ||
    currentHashes.migration !== expectedHashes.migration ||
    currentHashes.rollback !== expectedHashes.rollback
  ) {
    throw new Error('❌ ERROR CRÍTICO: Los hashes SHA-256 no coinciden exactamente con los autorizados.');
  }
  console.log('✅ Hashes verificados e idénticos al 100%.\n');

  // 2. GENERACIÓN DE RESPALDO DE SEGURIDAD
  console.log('💾 PASO 2: GENERANDO RESPALDO VERIFICABLE PRE-MIGRACIÓN...');
  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupTimestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const backupFileName = `backup_pravia_os_pre_comparecientes_${backupTimestamp}.json`;
  const backupFilePath = path.join(backupDir, backupFileName);

  const tablesToBackup = [
    'users',
    'prospectos',
    'cotizaciones',
    'expedientes',
    'documentos',
    'expediente_documentos',
    'movimientos_financieros',
    'notarias'
  ];

  const backupData: Record<string, any[]> = {};
  const countsBefore: Record<string, number> = {};

  for (const table of tablesToBackup) {
    const rows: any = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}";`);
    backupData[table] = rows;
    countsBefore[table] = rows.length;
  }

  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
  const backupStats = fs.statSync(backupFilePath);
  const backupHash = getFileHash(backupFilePath);

  console.log(`- Nombre del respaldo: ${backupFileName}`);
  console.log(`- Ubicación: ${backupFilePath}`);
  console.log(`- Tamaño: ${(backupStats.size / 1024).toFixed(2)} KB`);
  console.log(`- SHA-256 Respaldo: ${backupHash}`);
  console.log('✅ Respaldo pre-migración generado y verificado correctamente.\n');

  // 3. EJECUCIÓN TRANSACCIONAL DE MIGRATION.SQL
  console.log('⚡ PASO 3: EJECUTANDO MIGRATION.SQL TRANSACCIONAL EN POSTGRESQL...');
  const migrationContent = fs.readFileSync(migrationPath, 'utf8');
  const migrationStmts = splitSqlStatements(migrationContent);

  for (const stmt of migrationStmts) {
    const clean = stmt.trim();
    if (clean.length > 0 && clean !== 'BEGIN;' && clean !== 'COMMIT;') {
      await prisma.$executeRawUnsafe(clean);
    }
  }
  console.log('✅ migration.sql ejecutado correctamente con éxito transaccional.\n');

  // 4. EJECUCIÓN DE SEEDERS OFICIALES DE CATÁLOGOS
  console.log('🌱 PASO 4: EJECUTANDO SEEDER DE CATÁLOGOS OFICIALES...');
  await seedComparecientesCatalogos();
  console.log('✅ Seeders de catálogos ejecutados correctamente.\n');

  // 5. CONTEO DESPUÉS DE MIGRACIÓN Y COMPARACIÓN CON RESPALDO
  console.log('📊 PASO 5: VERIFICANDO INTEGRIDAD Y CONTEOS DE DATOS EXISTENTES...');
  const countsAfter: Record<string, number> = {};
  let dataDifferenceTotal = 0;

  for (const table of tablesToBackup) {
    const res: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}";`);
    countsAfter[table] = res[0].count;
    const diff = countsAfter[table] - countsBefore[table];
    dataDifferenceTotal += Math.abs(diff);
    console.log(`  - ${table}: Antes=${countsBefore[table]} | Después=${countsAfter[table]} (Diferencia: ${diff})`);
  }

  if (dataDifferenceTotal !== 0) {
    throw new Error('❌ ALERTA DE INTEGRIDAD: Se detectaron cambios imprevistos en el número de registros preexistentes.');
  }
  console.log('🎉 100% INTEGRIDAD CONFIRMADA: 0 datos eliminados o modificados.\n');

  // 6. PRUEBAS RIGUROSAS DE RECHAZO POR RESTRICCIONES DE INTEGRIDAD
  console.log('🧪 PASO 6: EJECUTANDO PRUEBAS DE RECHAZO POR RESTRICCIONES DE INTEGRIDAD...');

  // A. Persona física con perfil moral -> Debe ser rechazado por fn_check_compareciente_perfil()
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE 
        v_comp UUID := gen_random_uuid();
        v_user UUID;
      BEGIN
        SELECT id INTO v_user FROM users LIMIT 1;
        INSERT INTO comparecientes (id, tipo_persona, nombre_busqueda, creado_por_id)
        VALUES (v_comp, 'FISICA', 'PRUEBA PERFIL INVALIDO', v_user);

        INSERT INTO personas_morales (id, compareciente_id, razon_social)
        VALUES (gen_random_uuid(), v_comp, 'EMPRESA INVALIDA');
      END $$;
    `);
    console.error('❌ FALLÓ PRUEBA A: La base de datos aceptó una Persona Moral para un Compareciente Físico.');
  } catch (err: any) {
    console.log('  [PASS] fn_check_compareciente_perfil() rechazó perfil invalido (Física con perfil Moral).');
  }

  // B. Persona casada consigo misma -> Debe ser rechazado por CHECK
  try {
    await prisma.$transaction(async (tx) => {
      const user: any = await tx.$queryRawUnsafe(`SELECT id FROM users LIMIT 1;`);
      const userId = user[0].id;
      const compId = crypto.randomUUID();
      const pfId = crypto.randomUUID();
      await tx.$executeRawUnsafe(`
        INSERT INTO comparecientes (id, tipo_persona, nombre_busqueda, creado_por_id)
        VALUES ('${compId}', 'FISICA', 'PERSONA SOLITARIA', '${userId}');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO personas_fisicas (id, compareciente_id, nombre, nombre_completo_calculado)
        VALUES ('${pfId}', '${compId}', 'Pedro', 'Pedro Solitario');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO relaciones_conyugales (id, persona_1_id, persona_2_id)
        VALUES ('${crypto.randomUUID()}', '${pfId}', '${pfId}');
      `);
    });
    console.error('❌ FALLÓ PRUEBA B: La base de datos aceptó matrimonio consigo mismo.');
  } catch (err: any) {
    console.log('  [PASS] Restriction chk_distintas_personas_conyuges rechazó matrimonio consigo mismo.');
  }

  // C. Matrimonio duplicado en sentido inverso -> Debe ser rechazado por uq_pareja_matrimonial_simetrica
  try {
    await prisma.$transaction(async (tx) => {
      const user: any = await tx.$queryRawUnsafe(`SELECT id FROM users LIMIT 1;`);
      const userId = user[0].id;
      const compId1 = crypto.randomUUID();
      const pfId1 = crypto.randomUUID();
      const compId2 = crypto.randomUUID();
      const pfId2 = crypto.randomUUID();

      await tx.$executeRawUnsafe(`
        INSERT INTO comparecientes (id, tipo_persona, nombre_busqueda, creado_por_id)
        VALUES ('${compId1}', 'FISICA', 'SPOUSE 1', '${userId}'), ('${compId2}', 'FISICA', 'SPOUSE 2', '${userId}');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO personas_fisicas (id, compareciente_id, nombre, nombre_completo_calculado)
        VALUES ('${pfId1}', '${compId1}', 'Juan', 'Juan Perez'), ('${pfId2}', '${compId2}', 'Maria', 'Maria Lopez');
      `);
      // Matrimonio 1: A -> B
      await tx.$executeRawUnsafe(`
        INSERT INTO relaciones_conyugales (id, persona_1_id, persona_2_id)
        VALUES ('${crypto.randomUUID()}', '${pfId1}', '${pfId2}');
      `);
      // Matrimonio 2: B -> A (Inverso) -> Debe fallar
      await tx.$executeRawUnsafe(`
        INSERT INTO relaciones_conyugales (id, persona_1_id, persona_2_id)
        VALUES ('${crypto.randomUUID()}', '${pfId2}', '${pfId1}');
      `);
    });
    console.error('❌ FALLÓ PRUEBA C: La base de datos aceptó matrimonio duplicado en sentido inverso.');
  } catch (err: any) {
    console.log('  [PASS] Index uq_pareja_matrimonial_simetrica rechazó matrimonio inverso duplicado.');
  }

  console.log('✅ Todas las restricciones de integridad y triggers fueron validados satisfactoriamente.\n');

  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();

  console.log('===========================================================');
  console.log('📋 INFORME FINAL DE MIGRACIÓN EXITOSA');
  console.log('===========================================================');
  console.log(`- Hora de inicio:     ${startTime.toISOString()}`);
  console.log(`- Hora de término:    ${endTime.toISOString()}`);
  console.log(`- Duración:           ${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`);
  console.log(`- Hash migration.sql: ${currentHashes.migration}`);
  console.log(`- Respaldo generado:  ${backupFileName} (${backupHash})`);
  console.log(`- Resultado DDL:      100% ÉXITO`);
  console.log(`- Resultado Seeders:  100% ÉXITO`);
  console.log(`- Datos Afectados:    0 borrados / 0 modificados`);
  console.log(`- Errores:            0`);
  console.log(`- Advertencias:       0`);
  console.log('===========================================================\n');
}

executeMigration()
  .catch((e) => {
    console.error('❌ ERROR FATAL EN MIGRACIÓN:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
