import { describe, expect, it } from 'vitest';
import { urlWithSchema } from './prismaSafe';

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
});
