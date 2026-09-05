import { describe, expect, it } from 'vitest';
import { deriveH7Closure } from './complianceH7';

const requirement = (status: string, provider = 'LEGAL', deadline: Date | null = null, missingAction: string | null = null) => ({
  id: `${provider}:${status}:${deadline?.toISOString() || 'none'}`,
  provider,
  status,
  deadline,
  missing_action: missingAction,
});

describe('H7 derived compliance closure', () => {
  it('does not invent completion when no requirement applies', () => {
    expect(deriveH7Closure([])).toMatchObject({ state: 'NO_APLICA', pendingCount: 0, complete: false });
  });

  it('derives no aplica when every requirement is explicitly not applicable', () => {
    expect(deriveH7Closure([requirement('NO_APLICA')])).toMatchObject({ state: 'NO_APLICA', complete: false });
  });

  it('keeps one pending requirement outside completion and counts its action', () => {
    expect(deriveH7Closure([requirement('PENDIENTE', 'DOC', null, 'UPLOAD_DOCUMENT')])).toMatchObject({ state: 'PENDIENTE', pendingCount: 1, actionableCount: 1, complete: false });
  });

  it('makes any overdue unresolved provider vencido', () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    expect(deriveH7Closure([requirement('EN_PROCESO', 'AVI', new Date('2026-09-04T12:00:00.000Z'))], now).state).toBe('VENCIDO');
  });

  it('ignores an old deadline after its exact requirement is fulfilled', () => {
    const closure = deriveH7Closure([
      requirement('CUMPLIDO', 'DOC', new Date('2026-01-01T00:00:00.000Z')),
      requirement('PENDIENTE', 'AVI', new Date('2027-01-01T00:00:00.000Z')),
    ], new Date('2026-09-05T00:00:00.000Z'));
    expect(closure).toMatchObject({ state: 'PENDIENTE', pendingCount: 1, nextDeadline: new Date('2027-01-01T00:00:00.000Z') });
  });

  it('does not treat documental completion plus AVI pending as complete', () => {
    expect(deriveH7Closure([requirement('CUMPLIDO', 'DOC'), requirement('PENDIENTE', 'AVI')])).toMatchObject({ state: 'PENDIENTE', complete: false });
  });

  it('does not treat a presented notice without final evidence as complete', () => {
    expect(deriveH7Closure([requirement('CUMPLIDO', 'FIR'), requirement('EN_PROCESO', 'AVI')])).toMatchObject({ state: 'EN_PROCESO', complete: false });
  });

  it('includes every provider rather than a superficial satisfied count', () => {
    const statuses = ['CUE', 'BC', 'PAG', 'AVI'].map((provider) => requirement('CUMPLIDO', provider));
    statuses.push(requirement('PENDIENTE', 'LST'));
    expect(deriveH7Closure(statuses)).toMatchObject({ state: 'PENDIENTE', pendingCount: 1, complete: false });
  });

  it('keeps listo distinct from complete', () => {
    expect(deriveH7Closure([requirement('LISTO', 'AVI')])).toMatchObject({ state: 'LISTO', complete: false });
  });

  it('derives complete only when every current applicable requirement is satisfied', () => {
    const all = ['LEGAL', 'LST', 'CUE', 'BC', 'PAG', 'DOC', 'FIR', 'AVI'].map((provider, index) => requirement(index === 7 ? 'NO_APLICA' : 'CUMPLIDO', provider));
    expect(deriveH7Closure(all)).toMatchObject({ state: 'CUMPLIMIENTO_COMPLETO', pendingCount: 0, actionableCount: 0, complete: true });
  });
});
