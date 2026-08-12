export type WidgetSection = 'kpis' | 'agenda' | 'signatures' | 'recentFiles' | 'recommendation' | 'reminders' | 'tasks' | 'finance';

export type KpiMetric = {
  value: number | string;
  label: string;
  context?: string;
};

export type AgendaItem = {
  id: string;
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
  permissions: { canViewFinance: boolean };
  kpis: {
    activeFiles?: KpiMetric;
    signaturesToday?: KpiMetric;
    urgentPending?: KpiMetric;
    financial?: KpiMetric;
    operationalFallback?: KpiMetric;
  };
  agenda: AgendaItem[];
  urgentSignatures: UrgentSignature[];
  recentFiles: RecentFile[];
  recommendation?: Recommendation | null;
  reminders: Reminder[];
  urgentTasks: UrgentTask[];
  finance?: {
    metrics: FinancialMetric[];
    months?: FinancialMonth[];
  } | null;
  errors: Partial<Record<WidgetSection, string>>;
};
