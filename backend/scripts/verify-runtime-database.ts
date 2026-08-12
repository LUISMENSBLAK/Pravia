import 'dotenv/config';
import { configuredDatabaseSchema, prisma } from '../src/config/prisma';
import { resolveRuntimeConfig } from '../src/config/runtime';
import { checkStorageHealth, getStorageInfo } from '../src/storage/storage.service';

async function verifyRuntimeDatabase() {
  try {
    const rows = await prisma.$queryRaw<Array<{ current_schema: string }>>`
      SELECT current_schema() AS current_schema
    `;
    const currentSchema = rows[0]?.current_schema;

    if (currentSchema !== configuredDatabaseSchema) {
      throw new Error(
        `Prisma conectó al esquema ${currentSchema || 'desconocido'}; se esperaba ${configuredDatabaseSchema}.`
      );
    }

    const [userCount, expedienteCount, documentCount, migrationTables, storage] = await Promise.all([
      prisma.user.count(),
      prisma.expediente.count(),
      prisma.documento.count(),
      prisma.$queryRaw<Array<{ schema_name: string }>>`
        SELECT n.nspname AS schema_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = '_prisma_migrations'
          AND n.nspname IN ('public', 'pravia_os')
        ORDER BY n.nspname
      `,
      checkStorageHealth(),
    ]);
    const runtime = resolveRuntimeConfig();
    const storageInfo = getStorageInfo();
    console.log(JSON.stringify({
      database: 'ok',
      database_mode: runtime.database.mode,
      database_primary: runtime.database.primary,
      schema: currentSchema,
      users_table_accessible: true,
      users_count: userCount,
      expedientes_count: expedienteCount,
      documentos_count: documentCount,
      migration_history_schemas: migrationTables.map((table) => table.schema_name),
      storage,
      storage_mode: storageInfo.mode,
      storage_primary: storageInfo.primary,
      replication_enabled: false,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

verifyRuntimeDatabase().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
