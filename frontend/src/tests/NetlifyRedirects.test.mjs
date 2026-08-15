import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const redirectsPath = resolve(process.cwd(), 'public/_redirects');

const loadRules = () => readFileSync(redirectsPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [source, destination, status] = line.split(/\s+/);
    return { source, destination, status };
  });

const matches = (source, pathname) => {
  if (source === '/*') return true;
  if (source.endsWith('/*')) return pathname.startsWith(source.slice(0, -1));
  return source === pathname;
};

describe('Netlify production redirects', () => {
  it('routes /api/health to Render before the SPA fallback', () => {
    const firstMatch = loadRules().find((rule) => matches(rule.source, '/api/health'));

    expect(firstMatch).toEqual({
      source: '/api/*',
      destination: 'https://pravia-api.onrender.com/api/:splat',
      status: '200',
    });
  });
});
