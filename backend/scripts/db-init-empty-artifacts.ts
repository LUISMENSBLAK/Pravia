import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export type HistoricalArtifactKind =
  | 'EXTENSION'
  | 'FUNCTION'
  | 'TRIGGER'
  | 'DYNAMIC_TRIGGER_BLOCK'
  | 'INDEX'
  | 'CHECK'
  | 'SEQUENCE'
  | 'RLS';

export interface HistoricalArtifact {
  migration: string;
  kind: HistoricalArtifactKind;
  sql: string;
}

export interface HistoricalArtifactPlan {
  artifacts: HistoricalArtifact[];
  sql: string;
  expected: {
    extensions: string[];
    functions: string[];
    triggers: string[];
    checks: string[];
    indexes: string[];
    sequences: string[];
    rlsTables: string[];
  };
}

export const emptyBootstrapConfirmation = 'INITIALIZE_EMPTY_PRAVIA_TARGET';

export function assertEmptyBootstrapConfirmation(value: string | undefined) {
  if (value !== emptyBootstrapConfirmation) {
    throw new Error(`INIT_CONFIRMATION debe ser ${emptyBootstrapConfirmation}.`);
  }
}

export function validateEmptyBootstrapTarget(rawValue: string | undefined) {
  const raw = String(rawValue || '').trim();
  if (!raw) throw new Error('INIT_DATABASE_URL es obligatoria y debe apuntar a una base nueva.');
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('INIT_DATABASE_URL debe usar PostgreSQL.');
  }
  if (url.searchParams.get('schema') !== 'pravia_os') {
    throw new Error('INIT_DATABASE_URL debe incluir schema=pravia_os.');
  }
  if (!new Set(['127.0.0.1', 'localhost', '[::1]']).has(url.hostname)) {
    throw new Error('INIT_DATABASE_URL sólo admite un destino PostgreSQL local aislado.');
  }
  return url;
}

export function isObsoleteHistoricalArtifactError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { meta?: { code?: unknown }; code?: unknown; message?: unknown };
  const metaCode = typeof candidate.meta?.code === 'string' ? candidate.meta.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const code = metaCode || message.match(/(?:SQLSTATE|code)[: ]+[`'"]?([0-9A-Z]{5})/i)?.[1] || '';
  return code === '42P01' || code === '42703';
}

const identifier = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)';
const qualifiedIdentifier = `${identifier}(?:\\.${identifier})?`;

function withoutLeadingComments(statement: string) {
  return statement.replace(/^\s*(?:--[^\n]*(?:\n|$)\s*)+/, '').trim();
}

/** Splits PostgreSQL statements while preserving strings and dollar-quoted bodies. */
export function splitPostgresStatements(sql: string) {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let dollarQuote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote && next === quote) {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarQuote = match[0];
        index += dollarQuote.length - 1;
        continue;
      }
    }
    if (char === ';') {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const remainder = sql.slice(start).trim();
  if (remainder) statements.push(remainder);
  return statements;
}

function matchingParenthesis(sql: string, opening: number) {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = opening; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (char === quote && next === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('CHECK histórico incompleto: falta paréntesis de cierre.');
}

function embeddedChecks(statement: string, migration: string): HistoricalArtifact[] {
  const normalized = withoutLeadingComments(statement);
  const tableMatch = normalized.match(new RegExp(`^CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${qualifiedIdentifier})`, 'i'));
  if (!tableMatch) return [];
  const artifacts: HistoricalArtifact[] = [];
  const checkPattern = new RegExp(`CONSTRAINT\\s+(${identifier})\\s+CHECK\\s*\\(`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = checkPattern.exec(normalized))) {
    const opening = normalized.indexOf('(', match.index + match[0].length - 1);
    const closing = matchingParenthesis(normalized, opening);
    const expression = normalized.slice(opening + 1, closing);
    artifacts.push({
      migration,
      kind: 'CHECK',
      sql: `ALTER TABLE ${tableMatch[1]} ADD CONSTRAINT ${match[1]} CHECK (${expression});`,
    });
    checkPattern.lastIndex = closing + 1;
  }
  return artifacts;
}

function classify(statement: string, migration: string): HistoricalArtifact[] {
  const normalized = withoutLeadingComments(statement);
  const artifacts = embeddedChecks(statement, migration);
  if (/^CREATE\s+EXTENSION\b/i.test(normalized)) artifacts.push({ migration, kind: 'EXTENSION', sql: normalized });
  else if (/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(normalized)) artifacts.push({ migration, kind: 'FUNCTION', sql: normalized });
  else if (/^DO\s+\$/i.test(normalized) && /CREATE\s+TRIGGER/i.test(normalized)) artifacts.push({ migration, kind: 'DYNAMIC_TRIGGER_BLOCK', sql: normalized });
  else if (/^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/i.test(normalized)) artifacts.push({ migration, kind: 'TRIGGER', sql: normalized });
  else if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(normalized)) {
    const idempotent = normalized.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS)/i, '$1 IF NOT EXISTS ');
    artifacts.push({ migration, kind: 'INDEX', sql: idempotent });
  } else if (/^ALTER\s+TABLE\b/i.test(normalized) && /ADD\s+CONSTRAINT[\s\S]*\bCHECK\s*\(/i.test(normalized)) {
    artifacts.push({ migration, kind: 'CHECK', sql: normalized });
  } else if (/^CREATE\s+SEQUENCE\b/i.test(normalized)) artifacts.push({ migration, kind: 'SEQUENCE', sql: normalized });
  else if (/^ALTER\s+TABLE\b/i.test(normalized) && /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(normalized) && !/ALTER\s+TABLE\s+public\./i.test(normalized)) {
    artifacts.push({ migration, kind: 'RLS', sql: normalized });
  }
  return artifacts;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function postgresIdentifier(value: string) {
  return value.replace(/"/g, '').slice(0, 63);
}

export function historicalArtifactObjectNames(artifacts: HistoricalArtifact[]) {
  const extensions: string[] = [];
  const functions: string[] = [];
  const triggers: string[] = [];
  const checks: string[] = [];
  const indexes: string[] = [];
  const sequences: string[] = [];
  const rlsTables: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === 'EXTENSION') {
      const match = artifact.sql.match(new RegExp(`^CREATE\\s+EXTENSION(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${identifier})`, 'i'));
      if (match) extensions.push(postgresIdentifier(match[1]));
    } else if (artifact.kind === 'FUNCTION') {
      const match = artifact.sql.match(new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(${qualifiedIdentifier})`, 'i'));
      if (match) functions.push(postgresIdentifier(match[1].split('.').at(-1)!));
    } else if (artifact.kind === 'TRIGGER') {
      const match = artifact.sql.match(new RegExp(`^CREATE\\s+(?:CONSTRAINT\\s+)?TRIGGER\\s+(${identifier})`, 'i'));
      if (match) triggers.push(postgresIdentifier(match[1]));
    } else if (artifact.kind === 'CHECK') {
      const match = artifact.sql.match(new RegExp(`ADD\\s+CONSTRAINT\\s+(${identifier})`, 'i'));
      if (match) checks.push(postgresIdentifier(match[1]));
    } else if (artifact.kind === 'INDEX') {
      const match = artifact.sql.match(new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${identifier})`, 'i'));
      if (match) indexes.push(postgresIdentifier(match[1]));
    } else if (artifact.kind === 'SEQUENCE') {
      const match = artifact.sql.match(new RegExp(`^CREATE\\s+SEQUENCE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${qualifiedIdentifier})`, 'i'));
      if (match) sequences.push(postgresIdentifier(match[1].split('.').at(-1)!));
    } else if (artifact.kind === 'RLS') {
      const match = artifact.sql.match(new RegExp(`^ALTER\\s+TABLE\\s+(${qualifiedIdentifier})\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
      if (match) rlsTables.push(postgresIdentifier(match[1].split('.').at(-1)!));
    }
  }
  return {
    extensions: uniqueSorted(extensions),
    functions: uniqueSorted(functions),
    triggers: uniqueSorted(triggers),
    checks: uniqueSorted(checks),
    indexes: uniqueSorted(indexes),
    sequences: uniqueSorted(sequences),
    rlsTables: uniqueSorted(rlsTables),
  };
}

export async function buildHistoricalArtifactPlan(migrationsRoot: string, migrationNames: string[]): Promise<HistoricalArtifactPlan> {
  const available = new Set((await readdir(migrationsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const artifacts: HistoricalArtifact[] = [];
  for (const migration of migrationNames) {
    if (!available.has(migration)) throw new Error(`Migración histórica ausente: ${migration}.`);
    const sql = await readFile(path.join(migrationsRoot, migration, 'migration.sql'), 'utf8');
    for (const statement of splitPostgresStatements(sql)) artifacts.push(...classify(statement, migration));
  }
  const expected = historicalArtifactObjectNames(artifacts);
  if (!expected.functions.includes('enforce_same_organization')) {
    throw new Error('El inventario histórico no contiene enforce_same_organization.');
  }
  const sql = [
    'BEGIN;',
    'SET LOCAL search_path TO pravia_os, public;',
    ...artifacts.map((artifact) => `-- ${artifact.migration} · ${artifact.kind}\n${artifact.sql}`),
    'COMMIT;',
    '',
  ].join('\n');
  return { artifacts, sql, expected };
}

export function planFromHistoricalArtifacts(artifacts: HistoricalArtifact[]): HistoricalArtifactPlan {
  const expected = historicalArtifactObjectNames(artifacts);
  return {
    artifacts,
    expected,
    sql: [
      'BEGIN;',
      'SET LOCAL search_path TO pravia_os, public;',
      ...artifacts.map((artifact) => `-- ${artifact.migration} · ${artifact.kind}\n${artifact.sql}`),
      'COMMIT;',
      '',
    ].join('\n'),
  };
}
