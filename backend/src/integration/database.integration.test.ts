import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma, { configuredDatabaseSchema } from '../config/prisma';

const legacyTables = [
  '_prisma_migrations',
  'documentos_cargados',
  'documentos_requeridos',
  'expedientes',
  'fichas_datos_generales',
  'hallazgos',
  'proyectos_escritura',
  'tipos_acto',
];

describe.sequential('Supabase: contrato de integración de solo lectura', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria para la prueba de integración.');
    await prisma.$connect();
  });

  afterAll(async () => prisma.$disconnect());

  it('usa el esquema operativo correcto y responde', async () => {
    const rows = await prisma.$queryRaw<Array<{ schema: string; alive: number }>>`
      SELECT current_schema() AS schema, 1 AS alive
    `;
    expect(configuredDatabaseSchema).toBe('pravia_os');
    expect(rows).toEqual([{ schema: configuredDatabaseSchema, alive: 1 }]);
  });

  it('conserva las entidades críticas y permite leer sus conteos', async () => {
    const rows = await prisma.$queryRaw<Array<{ users: bigint; expedientes: bigint; documentos: bigint }>>`
      SELECT
        (SELECT count(*) FROM pravia_os.users) AS users,
        (SELECT count(*) FROM pravia_os.expedientes) AS expedientes,
        (SELECT count(*) FROM pravia_os.documentos) AS documentos
    `;
    expect(Number(rows[0].users)).toBeGreaterThanOrEqual(1);
    expect(Number(rows[0].expedientes)).toBeGreaterThanOrEqual(1);
    expect(Number(rows[0].documentos)).toBeGreaterThanOrEqual(1);
  });

  it('no contiene claves de almacenamiento vacías', async () => {
    const rows = await prisma.$queryRaw<Array<{ invalid: bigint }>>`
      SELECT count(*) AS invalid
      FROM pravia_os.documentos
      WHERE storage_key IS NULL OR btrim(storage_key) = ''
    `;
    expect(Number(rows[0].invalid)).toBe(0);
  });

  it('mantiene al menos dos conjuntos normativos versionados', async () => {
    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total FROM pravia_os.compliance_rule_sets
    `;
    expect(Number(rows[0].total)).toBeGreaterThanOrEqual(2);
  });

  it('conserva los hitos estructurales de autenticación, IA, agenda y comparecientes', async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'pravia_os'
        AND table_name = ANY(${[
          'auth_sessions',
          'password_reset_tokens',
          'compareciente_alta_sessions',
          'ai_usage_logs',
          'compliance_rule_sets',
          'domain_event_outbox',
        ]}::text[])
      ORDER BY table_name
    `;
    expect(tables).toHaveLength(6);

    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'pravia_os'
        AND (table_name, column_name) IN (
          ('users', 'password_changed_at'),
          ('eventos_agenda', 'cancelado_at'),
          ('expediente_comparecientes', 'datos_validados'),
          ('expediente_comparecientes', 'validado_por_id'),
          ('expediente_comparecientes', 'validado_at')
        )
    `;
    expect(columns).toHaveLength(5);
  });

  it('mantiene bloqueados con RLS los ocho objetos legados de public', async () => {
    const rls = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${legacyTables}::text[])
      ORDER BY c.relname
    `;
    expect(rls).toHaveLength(legacyTables.length);
    expect(rls.every((row) => row.relrowsecurity)).toBe(true);

    const policies = await prisma.$queryRaw<Array<{ tablename: string; policy_count: bigint }>>`
      SELECT tablename, count(*) AS policy_count
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${legacyTables}::text[])
      GROUP BY tablename
      ORDER BY tablename
    `;
    expect(policies).toHaveLength(legacyTables.length);
    expect(policies.every((row) => Number(row.policy_count) >= 1)).toBe(true);
  });

  it('tiene los índices de las rutas operativas de mayor tráfico', async () => {
    const required = [
      'idx_documentos_expediente_fk',
      'idx_cotizaciones_user_fk',
      'idx_expedientes_abogado_fk',
      'idx_movimientos_expediente_fk',
      'idx_tareas_expediente_fk',
      'idx_compliance_reviews_rule_fk',
      'idx_comp_actividades_actividad_fk',
      'idx_exp_comparecientes_validador_fk',
      'idx_pm_representantes_persona_fk',
    ];
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'pravia_os' AND indexname = ANY(${required}::text[])
    `;
    expect(rows.map((row) => row.indexname).sort()).toEqual([...required].sort());
  });

  it('no deja llaves foráneas operativas sin un índice utilizable', async () => {
    const rows = await prisma.$queryRaw<Array<{ missing: bigint }>>`
      SELECT count(*) AS missing
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f'
        AND n.nspname = 'pravia_os'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indisvalid
            AND i.indisready
            AND c.conkey <@ i.indkey::smallint[]
        )
    `;
    expect(Number(rows[0].missing)).toBe(0);
  });
});
