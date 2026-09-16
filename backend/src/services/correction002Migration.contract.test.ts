import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../prisma/migrations/20260912010000_correction002_cfg001_questionnaires/migration.sql',
), 'utf8');

describe('Correction 002 migration backfill', () => {
  it('generates primary keys for every imported quotation concept', () => {
    expect(migration).toMatch(/INSERT INTO "cotizacion_version_conceptos"\s*\(\s*"id"/);
    expect(migration).toMatch(/SELECT gen_random_uuid\(\), organization_id, version_id/);
    expect(migration).toMatch(/INSERT INTO "cotizacion_conceptos"\s*\(\s*"id"/);
    expect(migration).toMatch(/SELECT gen_random_uuid\(\), cvc\."organization_id", lv\."cotizacion_id"/);
  });
});
