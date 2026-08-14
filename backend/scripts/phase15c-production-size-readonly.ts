import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const rawUrl = String(process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const output = String(process.env.AUDIT_OUTPUT_PATH || '').trim();
if (!rawUrl || !output || process.env.AUDIT_ENVIRONMENT !== 'production') throw new Error('Requiere URL, output y AUDIT_ENVIRONMENT=production.');
const url = new URL(rawUrl);
url.searchParams.set('schema', 'pravia_os');
url.searchParams.set('options', `${url.searchParams.get('options') || ''} -c default_transaction_read_only=on`.trim());
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

const affected = [
  'compliance_decisions', 'comprobantes_financieros', 'conciliaciones_financieras', 'cuentas_financieras', 'documentos',
  'expediente_entregas', 'honorarios_generados', 'metas_honorarios', 'movimientos_financieros', 'notifications',
  'tareas_externas', 'transacciones_estado_cuenta', 'user_invitations',
];

async function main() {
  const identity = (await prisma.$queryRawUnsafe<Array<{ transaction_read_only: string }>>(`SELECT current_setting('transaction_read_only') AS transaction_read_only`))[0];
  if (identity.transaction_read_only !== 'on') throw new Error('REFUSED_PRODUCTION_WRITE: la sesión no quedó read-only.');
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT c.relname AS table_name, c.reltuples::bigint AS estimated_rows,
      pg_relation_size(c.oid)::bigint AS table_bytes,
      pg_indexes_size(c.oid)::bigint AS index_bytes,
      pg_total_relation_size(c.oid)::bigint AS total_bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='pravia_os' AND c.relkind='r' AND c.relname = ANY($1::text[])
    ORDER BY c.relname
  `, affected);
  const report = { generated_at: new Date().toISOString(), environment: 'production', transaction_read_only: 'on', source: 'PostgreSQL catalog estimates; no EXPLAIN ANALYZE', tables: rows };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
  console.log(JSON.stringify({ ok: true, read_only: true, tables: rows.length, output }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
