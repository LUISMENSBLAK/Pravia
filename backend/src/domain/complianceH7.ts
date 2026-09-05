import { deriveComplianceState } from './complianceLegalEngine';

export type H7RequirementProjection = {
  id: string;
  provider: string;
  status: string;
  deadline: Date | null;
  blocks_completion?: boolean;
  missing_action?: string | null;
};

const satisfied = new Set(['CUMPLIDO', 'NO_APLICA']);

export function deriveH7Closure(requirements: H7RequirementProjection[], now = new Date()) {
  const statuses = requirements.map((item) => item.status);
  const unresolved = requirements.filter((item) => !satisfied.has(item.status));
  const unresolvedDeadlines = requirements.map((item) => satisfied.has(item.status) ? null : item.deadline);
  return {
    state: deriveComplianceState(statuses, unresolvedDeadlines, now),
    pendingCount: unresolved.length,
    actionableCount: unresolved.filter((item) => Boolean(item.missing_action)).length,
    nextDeadline: unresolvedDeadlines.filter((item): item is Date => Boolean(item)).sort((left, right) => left.getTime() - right.getTime())[0] || null,
    complete: requirements.length > 0 && unresolved.length === 0 && statuses.some((status) => status === 'CUMPLIDO'),
  };
}

export const H7_EXCEPTION_RESOLUTION = 'NO_APLICA_BY_AUTHORIZED_EXCEPTION' as const;
export const H7_EXCEPTION_PERMISSION = 'compliance.review' as const;
