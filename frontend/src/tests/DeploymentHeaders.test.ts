/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production document viewer policy', () => {
  it('allows authenticated object URLs to be parsed without making storage public', () => {
    const headers = readFileSync(`${process.cwd()}/public/_headers`, 'utf8');
    const policy = headers.split('\n').find((line) => line.includes('Content-Security-Policy:')) ?? '';

    expect(policy).toContain("connect-src 'self' https: blob:");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("object-src 'none'");
  });
});
