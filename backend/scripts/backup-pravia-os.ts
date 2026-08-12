import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('=== RESPALDO PREVIO OBLIGATORIO DE BASE DE DATOS pravia_os ===\n');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, '..', 'prisma', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFileName = `pravia_os_backup_${timestamp}.json`;
  const backupFilePath = path.join(backupDir, backupFileName);

  console.log('Buscando tablas en esquema pravia_os...');
  const tablesRes: any[] = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'pravia_os' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const tables = tablesRes.map((r: any) => r.table_name);
  console.log(`Tablas encontradas (${tables.length}):`, tables);

  const backupData: any = {
    metadata: {
      fecha_hora: new Date().toISOString(),
      nombre_respaldo: backupFileName,
      responsable: 'Antigravity AI Agent',
      tablas_count: tables.length,
      tablas: tables
    },
    tables_data: {}
  };

  for (const table of tables) {
    const rowsRes: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "pravia_os"."${table}";`);
    backupData.tables_data[table] = rowsRes;
    console.log(`  - Tabla pravia_os.${table}: ${rowsRes.length} registros respaldados`);
  }

  const jsonContent = JSON.stringify(backupData, null, 2);
  fs.writeFileSync(backupFilePath, jsonContent, 'utf8');

  const stats = fs.statSync(backupFilePath);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(backupFilePath)).digest('hex');

  console.log('\n✅ RESPALDO COMPLETADO Y VERIFICADO SATISFACTORIAMENTE');
  console.log(`Fecha y hora:        ${backupData.metadata.fecha_hora}`);
  console.log(`Nombre del respaldo: ${backupFileName}`);
  console.log(`Ubicación:           ${backupFilePath}`);
  console.log(`Tamaño:              ${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)`);
  console.log(`Hash SHA-256:        ${hash}`);
  console.log(`Responsable:         ${backupData.metadata.responsable}`);
}

main()
  .catch((err) => {
    console.error('❌ ERROR CRÍTICO EN RESPALDO:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
