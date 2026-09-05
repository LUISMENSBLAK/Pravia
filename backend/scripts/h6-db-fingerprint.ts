import { PrismaClient } from '@prisma/client';
import { canonicalDatabaseFingerprint, H6_DB_FINGERPRINT_ALGORITHM } from '../src/domain/complianceH6';

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'pravia_os'
      AND (table_name LIKE 'compliance_notice_%'
        OR table_name LIKE 'compliance_official_%'
        OR table_name = 'compliance_obligation_triggers'
        OR table_name IN ('compliance_obligations', 'compliance_requirements', 'expediente_documentos'))
    ORDER BY table_name, column_name
  `);
  const constraints = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE n.nspname = 'pravia_os'
      AND (t.relname LIKE 'compliance_notice_%'
        OR t.relname LIKE 'compliance_official_%'
        OR t.relname = 'compliance_obligation_triggers'
        OR t.relname IN ('compliance_obligations', 'compliance_requirements', 'expediente_documentos'))
    ORDER BY c.conname
  `);
  const indexes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'pravia_os'
      AND (tablename LIKE 'compliance_notice_%'
        OR tablename LIKE 'compliance_official_%'
        OR tablename = 'compliance_obligation_triggers'
        OR tablename IN ('compliance_obligations', 'compliance_requirements', 'expediente_documentos'))
    ORDER BY indexname
  `);
  const enums = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT t.typname AS enum_name, e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pravia_os'
      AND (t.typname LIKE 'Compliance%' OR t.typname = 'ExpedienteDocumentoRole' OR t.typname = 'CatalogoArtefactoPurpose')
    ORDER BY t.typname, e.enumsortorder
  `);
  const fingerprint = canonicalDatabaseFingerprint({ columns, constraints, indexes, enums });
  process.stdout.write(`${JSON.stringify({ algorithm: H6_DB_FINGERPRINT_ALGORITHM, fingerprint, counts: { columns: columns.length, constraints: constraints.length, indexes: indexes.length, enums: enums.length } })}\n`);
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
