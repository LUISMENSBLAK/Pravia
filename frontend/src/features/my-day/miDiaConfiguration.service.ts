import { apiRequest } from '../../services/api/client';

export type MiDiaScope = 'OWN' | 'ORGANIZATION';
export type MiDiaSize = 'S' | 'M' | 'L' | 'V';
export type MiDiaLayoutItem = {
  key: string;
  size: MiDiaSize;
  scope: MiDiaScope;
  parameters: Record<string, string | number>;
  fixed?: boolean;
};
export type MiDiaCard = {
  key: string;
  name: string;
  family: string;
  sourceModule: string;
  allowedSizes: MiDiaSize[];
  allowedScopes: MiDiaScope[];
  defaultSize: MiDiaSize;
  drillDown: string;
  parameters: string[];
  maxScope: MiDiaScope;
  recommended: boolean;
};
export type MiDiaConfiguration = {
  catalog: MiDiaCard[];
  layout: MiDiaLayoutItem[];
  layoutVersion: number;
  tenantVersion: number;
  personalized: boolean;
  tenantAdministration?: {
    version: number;
    catalog: MiDiaCard[];
    enabledCards: string[];
    defaultLayout: MiDiaLayoutItem[];
    recommendedCards: string[];
  };
};

type Envelope<T> = { success: true; data: T };

export const miDiaConfigurationService = {
  async get(signal?: AbortSignal) {
    const response = await apiRequest<Envelope<MiDiaConfiguration>>('/mi-dia/config', { signal });
    return response.data;
  },
  async save(layout: MiDiaLayoutItem[], version: number) {
    const response = await apiRequest<Envelope<{ version: number; layout: MiDiaLayoutItem[] }>>('/mi-dia/layout', {
      method: 'PUT', body: JSON.stringify({ version, layout }),
    });
    return response.data;
  },
  async reset() {
    const response = await apiRequest<Envelope<MiDiaConfiguration>>('/mi-dia/layout', { method: 'DELETE' });
    return response.data;
  },
  async saveTenant(input: { version: number; enabled_cards: string[]; default_layout: MiDiaLayoutItem[]; fixed_cards: string[]; recommended_cards: string[] }) {
    const response = await apiRequest<Envelope<{ version: number }>>('/mi-dia/tenant-config', {
      method: 'PUT', body: JSON.stringify(input),
    });
    return response.data;
  },
};
