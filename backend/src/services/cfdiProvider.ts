export type CfdiProviderDraft = {
  version: '4.0';
  tipo: 'I' | 'E' | 'P' | 'T' | 'N' | 'RET';
  emisorRfc: string;
  receptorRfc: string;
  total: string;
  metodoPago?: 'PUE' | 'PPD' | null;
};

export type CfdiProviderStampResult = {
  uuid: string;
  xml: Buffer;
  pdf?: Buffer;
  providerReference: string;
};

export type CfdiProviderCancellationResult = {
  accepted: boolean;
  providerReference: string;
};

/**
 * Frontera canónica con un PAC. La implementación productiva se inyecta; el
 * dominio local nunca fabrica UUID, XML timbrado o acuses fiscales.
 */
export interface CfdiProvider {
  readonly id: string;
  readonly configured: boolean;
  stamp(draft: CfdiProviderDraft): Promise<CfdiProviderStampResult>;
  cancel(uuid: string, reason: string): Promise<CfdiProviderCancellationResult>;
}

export class CfdiProviderUnavailableError extends Error {
  readonly code = 'CFDI_PROVIDER_NOT_CONFIGURED';
  readonly status = 503;

  constructor() {
    super('El PAC no está configurado. Puedes continuar con borradores y carga manual de XML/PDF.');
  }
}

export class DisabledCfdiProvider implements CfdiProvider {
  readonly id = 'NONE';
  readonly configured = false;

  async stamp(_draft: CfdiProviderDraft): Promise<CfdiProviderStampResult> {
    throw new CfdiProviderUnavailableError();
  }

  async cancel(_uuid: string, _reason: string): Promise<CfdiProviderCancellationResult> {
    throw new CfdiProviderUnavailableError();
  }
}

/** Sólo para pruebas contractuales locales; nunca se selecciona en runtime. */
export class ContractTestCfdiProvider implements CfdiProvider {
  readonly id = 'CONTRACT_TEST_ONLY';
  readonly configured = true;

  constructor(
    private readonly stampResult: CfdiProviderStampResult,
    private readonly cancellationResult: CfdiProviderCancellationResult = { accepted: true, providerReference: 'contract-test' },
  ) {}

  async stamp(_draft: CfdiProviderDraft) { return this.stampResult; }
  async cancel(_uuid: string, _reason: string) { return this.cancellationResult; }
}

export const runtimeCfdiProvider: CfdiProvider = new DisabledCfdiProvider();
