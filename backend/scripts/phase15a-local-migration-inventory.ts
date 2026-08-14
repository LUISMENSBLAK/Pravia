import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname, '../prisma/migrations');
const output = path.resolve(__dirname, '../../docs/release/phase-15a');

const unique = (values: string[]) => [...new Set(values)].sort();
const matches = (sql: string, expression: RegExp) => unique([...sql.matchAll(expression)].map((match) => match[1]).filter(Boolean));

const rows = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const file = path.join(root, entry.name, 'migration.sql');
    const sql = fs.readFileSync(file, 'utf8');
    const destructive = /\b(DROP\s+(?:TABLE|COLUMN|TYPE|INDEX)|TRUNCATE|DELETE\s+FROM)\b/i.test(sql);
    const dataMutation = /\b(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i.test(sql);
    const tables = unique([
      ...matches(sql, /(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?/gi),
      ...matches(sql, /REFERENCES\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?/gi),
      ...matches(sql, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?/gi),
      ...matches(sql, /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"?[A-Za-z0-9_]+"?\s+ON\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?/gi),
      ...matches(sql, /CREATE\s+TRIGGER\s+"?[A-Za-z0-9_]+"?[\s\S]{0,400}?\sON\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?/gi),
    ]);
    const columns = matches(sql, /(?:ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+COLUMN(?:\s+IF\s+EXISTS)?|ALTER\s+COLUMN)\s+"?([A-Za-z0-9_]+)"?/gi);
    const indexes = matches(sql, /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z0-9_]+)"?/gi);
    const constraints = matches(sql, /(?:ADD\s+CONSTRAINT|CONSTRAINT)\s+"?([A-Za-z0-9_]+)"?/gi);
    const enums = unique([
      ...matches(sql, /CREATE\s+TYPE\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?\s+AS\s+ENUM/gi),
      ...matches(sql, /ALTER\s+TYPE\s+(?:"?pravia_os"?\.)?"?([A-Za-z0-9_]+)"?/gi),
    ]);
    const date = entry.name.match(/^(\d{8,14})/)?.[1] || 'sin-fecha';
    return {
      migration: entry.name,
      inferred_date: date,
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      type: destructive ? 'POTENTIALLY_DESTRUCTIVE' : dataMutation ? 'ADDITIVE_WITH_DATA' : 'ADDITIVE_OR_CONSTRAINT',
      tables, columns, indexes, constraints, enums,
      has_foreign_keys: /\bFOREIGN\s+KEY\b/i.test(sql),
      has_data_migration: dataMutation,
      risk: destructive ? 'CRITICAL' : dataMutation ? 'HIGH' : /ALTER\s+TABLE/i.test(sql) ? 'MEDIUM' : 'LOW',
      dependency: 'Orden lexicográfico; requiere todos los objetos referenciados de migraciones anteriores/baseline.',
    };
  })
  .sort((left, right) => left.migration.localeCompare(right.migration));

const escape = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const markdown = [
  '# Inventario local de migraciones — Fase 15A', '',
  `Generado: ${new Date().toISOString()}. Total: **${rows.length}** migraciones.`, '',
  'Ningún `migration.sql` fue modificado por este inventario.', '',
  '| Migration | Checksum SHA-256 | Tipo | Objetos afectados | Dependencias | Riesgo | Comentario |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((row) => `| \`${row.migration}\` | \`${row.checksum}\` | ${row.type} | tablas: ${escape(row.tables.join(', ') || '—')}; columnas: ${escape(row.columns.join(', ') || '—')}; índices: ${row.indexes.length}; constraints: ${row.constraints.length}; enums: ${row.enums.length}; FK: ${row.has_foreign_keys ? 'sí' : 'no'} | ${row.dependency} | ${row.risk} | fecha inferida: ${row.inferred_date}; data migration: ${row.has_data_migration ? 'sí' : 'no'} |`),
  '',
  'La clasificación es estática y conservadora. La evaluación semántica y de lock/backfill se encuentra en `MIGRATION_DIVERGENCE_MATRIX.md` y `PRODUCTION_MIGRATION_EXECUTION_PLAN.md`.',
].join('\n');

fs.mkdirSync(path.join(output, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(output, 'LOCAL_MIGRATION_INVENTORY.md'), `${markdown}\n`);
fs.writeFileSync(path.join(output, 'artifacts/local-migrations.json'), `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, migrations: rows.length }));
