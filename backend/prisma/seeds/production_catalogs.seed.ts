import { readFileSync } from 'node:fs';
import path from 'node:path';
import prisma from '../../src/config/prisma';

const migrationSql = (name: string) => readFileSync(
  path.resolve(__dirname, '..', 'migrations', name, 'migration.sql'),
  'utf8',
);

export async function seedProductionCatalogs() {
  const finance = migrationSql('20260812030000_create_canonical_finance_ledger')
    .match(/INSERT INTO "categorias_financieras"[\s\S]*?ON CONFLICT \("clave"\) DO NOTHING;/)?.[0];
  if (!finance) throw new Error('No se encontró el catálogo financiero canónico en su migración.');
  await prisma.$executeRawUnsafe(finance);

  const compliance = migrationSql('20260811031000_seed_verified_compliance_references');
  const statements = compliance.match(/INSERT INTO pravia_os\.compliance_rule_sets[\s\S]*?ON CONFLICT \(tipo, clave, version\) DO NOTHING;/g) || [];
  if (statements.length !== 2) throw new Error('No se encontraron las dos referencias normativas verificadas.');
  for (const statement of statements) {
    const compatibleStatement = statement
      .replace('notas, creado_por_id\n)', 'notas, creado_por_id, updated_at\n)')
      .replace('\n  u.id\nFROM', '\n  u.id,\n  CURRENT_TIMESTAMP\nFROM');
    await prisma.$executeRawUnsafe(compatibleStatement);
  }
}
