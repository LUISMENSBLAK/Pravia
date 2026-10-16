export type ProcessCardKey = 'MY_PENDING' | 'OVERDUE_PROCESSES' | 'DUE_TODAY' | 'UPCOMING_DUE'
  | 'CATASTRO_PENDING' | 'RPP_PENDING' | 'TESTIMONIES_PENDING' | 'CAN_ADVANCE_TODAY';
export type CaseCardKey = 'CASES_INACTIVE' | 'CASES_DELAYED' | 'CASES_BLOCKED' | 'POSTSIGN_PENDING' | 'DELIVERIES_PENDING' | 'MY_ACTIVE_CASES' | 'READY_TO_SIGN' | 'NOT_READY_TO_SIGN' | 'SIGNED_TODAY' | 'SIGNED_PERIOD' | 'SIGNED_CASES';
export type CommercialCardKey = 'PROSPECTS_ACTIVE' | 'PROSPECTS_NEW' | 'PROSPECTS_STALE' | 'PROSPECTS_READY' | 'QUOTES_ACTIVE' | 'QUOTES_TO_SEND' | 'QUOTES_NO_RESPONSE' | 'QUOTES_FOLLOWUP' | 'QUOTES_ACCEPTED' | 'QUOTES_CONVERSION' | 'CASES_CONVERSION' | 'QUOTES_ACTIVE_VALUE' | 'QUOTES_ACCEPTED_VALUE';
export type FinanceCardKey = 'INCOME_COLLECTED' | 'COLLECTED_TODAY' | 'FEES_SCHEDULED_SIGN' | 'FEES_SIGNED'
  | 'ADVANCES_PENDING' | 'PRODUCTION_VALUE'
  | 'PAYMENTS_DUE' | 'PAYMENTS_UNPROVEN' | 'COLLECTION_SCHEDULED' | 'CLIENT_RESOURCES' | 'REP_PENDING'
  | 'INVOICES_PENDING' | 'CFDI_TO_STAMP';
export type DocumentCardKey = 'MISSING_DOCUMENTS' | 'DOCUMENTS_TO_REVIEW' | 'EXPIRED_DOCUMENTS'
  | 'FORMATS_TO_GENERATE' | 'FORMATS_TO_SIGN' | 'DOCUMENT_INCONSISTENCIES';
export type ComplianceCardKey = 'PLD_INCOMPLETE' | 'NOTICES_PENDING' | 'NOTICES_UPCOMING' | 'NOTICES_OVERDUE' | 'CRITICAL_ALERTS';
export type ArchiveCardKey = 'NEXT_DEED' | 'NEXT_FOLIO' | 'DEEDS_TODAY'
  | 'CURRENT_BOOK' | 'FOLIOS_LEFT' | 'APPENDIX_PENDING';
export type WidgetSection = 'kpis' | 'agenda' | 'todaySignings' | 'upcomingAppointments' | 'signatures' | 'recentFiles' | 'recommendation' | 'reminders' | 'tasks' | 'finance' | 'USER_LOAD' | 'AVERAGE_PROCESS' | 'AVERAGE_TO_SIGN' | ProcessCardKey | CaseCardKey | CommercialCardKey | FinanceCardKey | DocumentCardKey | ComplianceCardKey | ArchiveCardKey;

export type MiDiaCardDetailItem = {
  id: string;
  folio?: string;
  nombre?: string;
  concepto?: string;
  cliente?: string;
  estado?: string;
  contexto?: string | null;
  amount?: string;
  fecha?: string | null;
  received_at?: string;
  href?: string;
};

export type MiDiaCardDetail = {
  key: string;
  title: string;
  scope: string;
  parameters: Record<string, string | number>;
  totalCount: number;
  totalAmount?: string;
  available: boolean;
  message: string | null;
  page: number;
  pageSize: number;
  totalPages: number;
  items: MiDiaCardDetailItem[];
};

export type ProcessCardItem = {
  id: string; expediente_id: string; folio: string; nombre: string;
  estado: string; responsable_id: string | null; fecha_objetivo: string | null;
  dias_restantes: number | null; href: string;
};
export type ProcessCardData = { count: number; items: ProcessCardItem[] };
export type CaseCardData = { count: number; items: Array<{ id: string; folio: string; cliente: string | null;
  estado: string; contexto: string | null; href: string }> };
export type CommercialCardData = { count: number; denominator?: number; rate?: number | null; amount?: string | null; items: Array<{ id: string; folio: string; cliente: string;
  estado: string; contexto: string | null; href: string }> };
export type FinanceCardData = { count: number; amount: string; available?: boolean; message?: string; items: Array<{ id: string; folio: string;
  concepto: string; amount: string; received_at: string; href: string }> };
export type DocumentCardData = { count: number; items: Array<{ id: string; folio: string; nombre: string;
  estado: string; href: string }> };
export type ArchiveCardData = { value: string | null; href: '/archivo'; source: 'Archivo'; available: boolean; message: string | null;
  items?: Array<{ id: string; folio: string; numero_escritura: string; cliente: string | null;
    assigned_at: string; href: string }> };
export type UserLoadData = { count: number; items: Array<{ id: string; nombre: string;
  expedientes: number; procesos: number; href: string }> };
export type ProcessAverageData = { count: number; items: Array<{ key: string; nombre: string;
  unidad: 'HABILES' | 'NATURALES'; promedio_dias: number; procesos: number; href: string }> };
export type SigningAverageData = { count: number; promedio_dias_naturales: number | null;
  items: Array<{ id: string; folio: string; dias_naturales: number; href: string }> };

export type KpiMetric = {
  value: number | string;
  label: string;
  context?: string;
};

export type AgendaItem = {
  id: string;
  href?: string;
  startsAt: string;
  title: string;
  type?: string;
  fileNumber?: string;
  context?: string;
  status?: string;
  tone?: 'blue' | 'gold' | 'purple' | 'green';
};

export type UrgentSignature = {
  id: string;
  fileNumber: string;
  act?: string;
  context?: string;
  signatureType?: string;
  dueAt?: string;
};

export type RecentFile = {
  id: string;
  fileNumber: string;
  act?: string;
  summary?: string;
  status?: string;
  updatedAt?: string;
  href?: string;
};

export type Recommendation = {
  title: string;
  description?: string;
  href?: string;
};

export type Reminder = {
  id: string;
  title: string;
  context?: string;
  dueAt?: string;
  href?: string;
  kind?: 'document' | 'call' | 'person';
};

export type UrgentTask = {
  id: string;
  title: string;
  context?: string;
  reference?: string;
  priority?: 'urgent' | 'pending';
  href?: string;
};

export type FinancialMetric = {
  key: 'invoiced' | 'collected' | 'receivable' | 'overdue';
  label: string;
  value: number;
  currency?: string;
};

export type FinancialMonth = {
  label: string;
  invoiced?: number;
  collected?: number;
  receivable?: number;
};

export type MyDayData = {
  date?: string;
  permissions: { canViewCases: boolean; canViewFinance: boolean };
  kpis: {
    activeFiles?: KpiMetric;
    signaturesToday?: KpiMetric;
    todaySignings?: KpiMetric;
    upcomingAppointments?: KpiMetric;
    urgentPending?: KpiMetric;
    financial?: KpiMetric;
    operationalFallback?: KpiMetric;
  };
  agenda: AgendaItem[];
  agendaCount?: number;
  todaySignings: AgendaItem[];
  upcomingAppointments: AgendaItem[];
  urgentSignatures: UrgentSignature[];
  recentFiles: RecentFile[];
  recommendation?: Recommendation | null;
  reminders: Reminder[];
  reminderCount?: number;
  urgentTasks: UrgentTask[];
  processCards: Partial<Record<ProcessCardKey, ProcessCardData | null>>;
  caseCards: Partial<Record<CaseCardKey, CaseCardData | null>>;
  commercialCards: Partial<Record<CommercialCardKey, CommercialCardData | null>>;
  financeCards: Partial<Record<FinanceCardKey, FinanceCardData | null>>;
  documentCards: Partial<Record<DocumentCardKey, DocumentCardData | null>>;
  complianceCards: Partial<Record<ComplianceCardKey, DocumentCardData | null>>;
  archiveCards: Partial<Record<ArchiveCardKey, ArchiveCardData | null>>;
  userLoad?: UserLoadData | null;
  processAverage?: ProcessAverageData | null;
  signingAverage?: SigningAverageData | null;
  finance?: {
    metrics: FinancialMetric[];
    months?: FinancialMonth[];
  } | null;
  errors: Partial<Record<WidgetSection, string>>;
};
