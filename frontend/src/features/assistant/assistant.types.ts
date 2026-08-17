export type AssistantStatus = 'idle' | 'thinking' | 'processing' | 'success' | 'error' | 'confirmation-required';
export type AssistantViewState = 'closed' | AssistantStatus;
export type AssistantModule = 'mi-dia' | 'prospectos' | 'cotizaciones' | 'expedientes' | 'notarias' | 'comparecientes' | 'finanzas' | 'agenda' | 'reportes' | 'isr' | 'compliance' | 'configuracion' | 'unknown';

export type AssistantContext = {
  route: string;
  module: AssistantModule;
  label: string;
  entityType?: 'expediente' | 'compareciente' | 'notaria' | 'prospecto' | 'cotizacion' | 'evento' | 'isrCalculation' | 'complianceReview';
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
  attachments?: AssistantAttachment[];
};

export type AssistantConversationStatus = 'ACTIVE' | 'ARCHIVED' | 'TRASHED';

export type AssistantAttachment = {
  id: string;
  message_id?: string | null;
  source: 'TEMPORARY_UPLOAD' | 'OFFICIAL_DOCUMENT';
  documento_id?: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: 'AVAILABLE' | 'LINKED' | 'ARCHIVED' | 'FAILED';
  transcription?: string | null;
  transcribed_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  duplicate?: boolean;
};

export type AssistantConversation = {
  id: string;
  title: string;
  status: AssistantConversationStatus;
  context?: Partial<AssistantContext> | null;
  last_message_at: string;
  message_count: number;
  archived_at?: string | null;
  trashed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type AssistantConversationDetail = AssistantConversation & {
  messages: Array<{
    id: string;
    role: 'USER' | 'ASSISTANT';
    content: string;
    sources?: AssistantSource[] | null;
    status: 'COMPLETE' | 'FAILED';
    created_at: string;
    attachments?: AssistantAttachment[];
  }>;
  attachments: AssistantAttachment[];
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
  conversationId?: string;
  messageId?: string;
};

export type AssistantOpenOptions = {
  prefill?: string;
  suggestion?: AssistantSuggestion;
  seedMessage?: Pick<AssistantMessage, 'content' | 'sources'>;
};
