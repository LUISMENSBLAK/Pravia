/** Commercial classification is explicit; an absent value must fail closed. */
export const AI_BILLING_CLASSES = [
  'CUSTOMER_WALLET',
  'MIGRATION_INCLUDED',
  'PLATFORM_INCLUDED',
  'PLAN_INCLUDED',
] as const;

export type AiBillingClass = typeof AI_BILLING_CLASSES[number];

export const isAiBillingClass = (value: unknown): value is AiBillingClass =>
  typeof value === 'string' && (AI_BILLING_CLASSES as readonly string[]).includes(value);

/** Runtime provider entrypoints. Prices and exact models are never defined here. */
export const AI_OPERATION_CODES = {
  assistantChat: 'ASSISTANT_CHAT',
  assistantTranscription: 'ASSISTANT_TRANSCRIPTION',
  complianceReview: 'COMPLIANCE_ASSISTED_REVIEW',
  prospectDocumentReview: 'PROSPECT_DOCUMENT_REVIEW',
  quoteEmailDraft: 'QUOTE_EMAIL_DRAFT',
  literalProjectPatches: 'PROJECT_LITERAL_PATCH_PLAN',
  operationalArtifact: 'OPERATIONAL_ARTIFACT_DRAFT',
  documentExtraction: 'DOCUMENT_STRUCTURED_EXTRACTION',
  projectReview: 'PROJECT_LEGAL_REVIEW',
  propertyExtraction: 'PROPERTY_DOCUMENT_EXTRACTION',
  financialExtraction: 'FINANCIAL_DOCUMENT_EXTRACTION',
  providerHealth: 'PROVIDER_MODEL_HEALTH',
} as const;

export const CURRENT_AI_BILLING_CLASS_BY_OPERATION: Readonly<Record<string, AiBillingClass>> = {
  [AI_OPERATION_CODES.assistantChat]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.assistantTranscription]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.complianceReview]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.prospectDocumentReview]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.quoteEmailDraft]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.literalProjectPatches]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.operationalArtifact]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.documentExtraction]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.projectReview]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.propertyExtraction]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.financialExtraction]: 'CUSTOMER_WALLET',
  [AI_OPERATION_CODES.providerHealth]: 'PLATFORM_INCLUDED',
};

export const MIGRATION_INCLUDED_OPERATION_CODES = new Set<string>([
  AI_OPERATION_CODES.documentExtraction,
  AI_OPERATION_CODES.propertyExtraction,
]);
