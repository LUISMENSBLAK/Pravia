export type ScreeningRequest = {
  reviewId: string;
  comparecienteId: string;
  name: string;
  birthDate?: string;
  country?: string;
};

export type ScreeningResponse = {
  provider: string;
  status: 'NOT_CONFIGURED' | 'NO_MATCH' | 'POTENTIAL_MATCH' | 'ERROR';
  queriedAt: string | null;
  matches: Array<{ reference: string; source: string; score?: number }>;
  evidence: Record<string, unknown>;
};

export type H3IdentitySnapshot = {
  tipo_persona: 'FISICA' | 'MORAL';
  primary_name: string;
  aliases: string[];
  birth_date: string | null;
  birth_place: string | null;
  birth_country: string | null;
  nationality: string | null;
  curp: string | null;
  rfc: string | null;
  identification: { type: string | null; number: string | null; country: string | null } | null;
  incorporation_date: string | null;
  commercial_name: string | null;
  commercial_folio: string | null;
  corporate_type: string | null;
};

export type H3ProviderCandidate = {
  stableId: string;
  sourceReference: string;
  displayName: string;
  aliases?: string[];
  identifiers?: string[];
  score?: number;
  evidence: Record<string, unknown>;
};

export type H3ProviderResult = {
  status: 'SUCCEEDED' | 'PARTIAL';
  candidates: H3ProviderCandidate[];
  summary?: Record<string, unknown>;
};

export interface H3ScreeningProvider {
  readonly key: string;
  execute(input: { queryId: string; sourceVersionId: string; identity: H3IdentitySnapshot }): Promise<H3ProviderResult>;
}

const normalized = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es-MX');

export function screeningIdentityFingerprint(snapshot: H3IdentitySnapshot): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(JSON.stringify({
    ...snapshot,
    primary_name: normalized(snapshot.primary_name),
    aliases: snapshot.aliases.map(normalized).sort(),
    rfc: normalized(snapshot.rfc), curp: normalized(snapshot.curp),
    identification: snapshot.identification ? { ...snapshot.identification, type: normalized(snapshot.identification.type), number: normalized(snapshot.identification.number), country: normalized(snapshot.identification.country) } : null,
  })).digest('hex');
}

export function screeningCandidateScore(identity: H3IdentitySnapshot, candidate: H3ProviderCandidate): { score: number; fields: string[] } {
  const fields: string[] = [];
  const identifiers = new Set((candidate.identifiers || []).map(normalized).filter(Boolean));
  const ownIdentifiers = [identity.curp, identity.rfc, identity.identification?.number].map(normalized).filter(Boolean);
  if (ownIdentifiers.some((value) => identifiers.has(value))) fields.push('IDENTIFIER');
  const names = [candidate.displayName, ...(candidate.aliases || [])].map(normalized);
  const ownNames = [identity.primary_name, ...identity.aliases].map(normalized);
  if (ownNames.some((value) => names.includes(value))) fields.push('NAME_EXACT');
  const ownTokens = new Set(ownNames.flatMap((value) => value.split(/\s+/)).filter(Boolean));
  const candidateTokens = new Set(names.flatMap((value) => value.split(/\s+/)).filter(Boolean));
  const intersection = [...ownTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...ownTokens, ...candidateTokens]).size || 1;
  const fuzzy = intersection / union;
  if (fuzzy > 0 && !fields.includes('NAME_EXACT')) fields.push('NAME_FUZZY');
  const score = fields.includes('IDENTIFIER') ? 1 : fields.includes('NAME_EXACT') ? 0.96 : Number(fuzzy.toFixed(6));
  return { score: Math.max(0, Math.min(1, candidate.score ?? score)), fields };
}

export function deriveScreeningExecutionState(states: Array<'NOT_CONFIGURED' | 'SUCCEEDED' | 'PARTIAL' | 'ERROR'>) {
  if (!states.length || states.every((state) => state === 'NOT_CONFIGURED')) return 'NOT_CONFIGURED' as const;
  if (states.every((state) => state === 'SUCCEEDED')) return 'SUCCEEDED' as const;
  if (states.every((state) => state === 'ERROR')) return 'ERROR' as const;
  return 'PARTIAL' as const;
}

export function requirementStateFromScreening(input: {
  executionState: string;
  candidates: Array<{ latestDecision?: string | null }>;
}) {
  if (['NOT_EXECUTED', 'NOT_CONFIGURED', 'ERROR'].includes(input.executionState)) return 'PENDIENTE' as const;
  if (['QUEUED', 'RUNNING', 'PARTIAL'].includes(input.executionState)) return 'EN_PROCESO' as const;
  if (input.candidates.some((candidate) => !candidate.latestDecision || candidate.latestDecision === 'REVISION_ADICIONAL')) return 'EN_PROCESO' as const;
  return 'CUMPLIDO' as const;
}

/**
 * Boundary for a future official PEP/list provider. A provider must return its
 * original references and evidence. Business code must never manufacture a
 * NO_MATCH when the integration is absent or unavailable.
 */
export interface ComplianceScreeningProvider {
  readonly name: string;
  readonly configured: boolean;
  screen(request: ScreeningRequest): Promise<ScreeningResponse>;
}

export class NotConfiguredScreeningProvider implements ComplianceScreeningProvider {
  readonly name = 'OFFICIAL_UIF_PEP_QUERY';
  readonly configured = false;

  async screen(): Promise<ScreeningResponse> {
    return {
      provider: this.name,
      status: 'NOT_CONFIGURED',
      queriedAt: null,
      matches: [],
      evidence: { message: 'Consulta oficial PEP no configurada' },
    };
  }
}
