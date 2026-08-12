export type AssistantStatus = 'idle' | 'thinking' | 'processing' | 'success' | 'error' | 'confirmation-required';
export type AssistantViewState = 'closed' | AssistantStatus;
export type AssistantModule = 'mi-dia' | 'prospectos' | 'cotizaciones' | 'expedientes' | 'notarias' | 'comparecientes' | 'finanzas' | 'agenda' | 'reportes' | 'riesgos' | 'configuracion' | 'unknown';

export type AssistantContext = {
  route: string;
  module: AssistantModule;
  label: string;
  entityType?: 'expediente' | 'compareciente' | 'notaria' | 'prospecto' | 'cotizacion';
  entityId?: string;
  subview?: string;
};

export type AssistantSource = {
  id: string;
  type?: string;
  label: string;
  document?: string;
  page?: number;
  reference?: string;
};

export type AssistantConfirmation = {
  id: string;
  title: string;
  summary?: string;
  details: Array<{ label: string; value: string }>;
  confirmLabel?: string;
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: AssistantSource[];
  confirmation?: AssistantConfirmation;
};

export type AssistantSuggestion = {
  id: string;
  type: string;
  title: string;
  message: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  entity?: { type: string; id: string; label?: string };
  cta: { label: string; prompt?: string; actionId?: string };
  timestamp: string;
};

export type AssistantAction = {
  id: string;
  label: string;
  prompt: string;
};

export type AssistantReply = {
  status: AssistantStatus;
  message?: string;
  processLabel?: string;
  sources?: AssistantSource[];
  confirmation?: AssistantConfirmation;
};

export type AssistantOpenOptions = {
  prefill?: string;
  suggestion?: AssistantSuggestion;
  seedMessage?: Pick<AssistantMessage, 'content' | 'sources'>;
};
