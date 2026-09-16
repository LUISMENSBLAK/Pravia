import { describe, expect, it } from 'vitest';
import { requiresMigrationConfirmation, urlWithSchema } from './prismaSafe';

describe('Prisma CLI seguro', () => {
  it('fuerza el esquema operativo aunque la URL contenga otro', () => {
    const value = urlWithSchema('postgresql://user:secret@db.example.test:5432/postgres?schema=public&sslmode=require', 'pravia_os');
    const parsed = new URL(value);
    expect(parsed.searchParams.get('schema')).toBe('pravia_os');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
  });

  it('rechaza protocolos ajenos a PostgreSQL', () => {
    expect(() => urlWithSchema('https://example.test', 'pravia_os')).toThrow('PostgreSQL');
  });

  it('exige confirmación también cuando migrate deploy recibe --schema', () => {
    expect(requiresMigrationConfirmation(['migrate', 'deploy'])).toBe(true);
    expect(requiresMigrationConfirmation(['migrate', 'deploy', '--schema', '/tmp/schema.prisma'])).toBe(true);
    expect(requiresMigrationConfirmation(['migrate', 'status', '--schema', '/tmp/schema.prisma'])).toBe(false);
  });
});
