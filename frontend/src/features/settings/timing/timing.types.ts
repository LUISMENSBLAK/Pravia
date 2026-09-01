export type TimingPolicyDomain = 'COMMERCIAL' | 'ADMINISTRATIVE';
export type TimingPolicyType =
  | 'PROSPECT_INFO_COLLECTION'
  | 'PROSPECT_READY_TO_REQUEST'
  | 'PROSPECT_NOTARY_WAIT'
  | 'ADMIN_PAYMENT_REQUEST_PENDING'
  | 'ADMIN_RECEIPT_PENDING_APPLICATION';
export type TimingPolicyUnit = 'HOURS' | 'DAYS';
export type TimingCalendarSemantics = 'ELAPSED_UTC';

export type TimingPolicyRevision = {
  id: string;
  domain: TimingPolicyDomain;
  type: TimingPolicyType;
  revision: number;
  duration: number;
  unit: TimingPolicyUnit;
  calendarSemantics: TimingCalendarSemantics;
  provenance: { source?: string; contract?: string; configuredByHuman?: boolean };
  createdById: string;
  createdAt: string;
  publishedAt: string;
  supersededAt: string | null;
};

export type TimingPolicyDefinition = {
  type: TimingPolicyType;
  domain: TimingPolicyDomain;
  label: string;
  description: string;
  status: 'CONFIGURED' | 'NOT_CONFIGURED';
  current: TimingPolicyRevision | null;
  history: TimingPolicyRevision[];
};

export type PublishTimingPolicyInput = {
  policyType: TimingPolicyType;
  duration: number;
  unit: TimingPolicyUnit;
  calendarSemantics: TimingCalendarSemantics;
  provenance: string;
};
