import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_OPERATION_CODES, CURRENT_AI_BILLING_CLASS_BY_OPERATION } from './aiBillingPolicy';

const root = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(__dirname, '../../../frontend/src');
const runtimeFiles = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const target = path.join(directory, name);
  if (statSync(target).isDirectory()) return runtimeFiles(target);
  return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [target] : [];
});

const providerPattern = /https:\/\/(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com)/g;

describe('AI provider boundary', () => {
  it('AIG01-AIG02 keeps provider endpoints out of domain and frontend code', () => {
    const backendMatches = runtimeFiles(root).flatMap((file) => {
      const matches = readFileSync(file, 'utf8').match(providerPattern) || [];
      return matches.map(() => path.relative(root, file));
    });
    const frontendMatches = runtimeFiles(frontendRoot).flatMap((file) => {
      const matches = readFileSync(file, 'utf8').match(providerPattern) || [];
      return matches.map(() => path.relative(frontendRoot, file));
    });
    expect(frontendMatches).toEqual([]);
    expect(backendMatches).toEqual(['platform/openaiProvider.adapter.ts']);
  });

  it('records an approved billing class and operation code for every inventoried provider call site', () => {
    const calls = runtimeFiles(root).flatMap((file) => {
      if (file.endsWith('platform/openaiResponsesGateway.adapter.ts')) return [];
      const source = readFileSync(file, 'utf8');
      return Array.from(source.matchAll(/\bawait openAiProviderFetch\s*\(/g), () => path.relative(root, file));
    });
    // The remaining count is explicit until each domain call is moved behind
    // AiGateway. Migrated services must never regress to this network-only
    // boundary.
    expect(calls).toEqual([]);
    expect(calls).not.toContain('services/openaiDocument.service.ts');
    expect(calls).not.toContain('services/quoteEmailAI.service.ts');
    expect(calls).not.toContain('services/prospectDocumentReview.service.ts');
    expect(calls).not.toContain('services/complianceH9.ai.ts');
    expect(calls).not.toContain('services/assistantChat.service.ts');
    expect(calls).not.toContain('services/assistantTranscription.service.ts');
    expect(Object.values(AI_OPERATION_CODES).every((code) => Boolean(CURRENT_AI_BILLING_CLASS_BY_OPERATION[code]))).toBe(true);
    expect(Object.values(CURRENT_AI_BILLING_CLASS_BY_OPERATION).filter((value) => value === 'PLAN_INCLUDED')).toEqual([]);
  });
});
