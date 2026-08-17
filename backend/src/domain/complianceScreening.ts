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
