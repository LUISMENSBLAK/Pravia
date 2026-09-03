import { describe, expect, it } from 'vitest';
import { calculateBcOwnership, evaluateBcRegime, validateBcGraph, type BcGraphInput } from './beneficialController';

// Executable acceptance probes retained after the single-pass self-review.
// Failures are findings, not permission for a second implementation pass.
const graph = (percentage: string | null): BcGraphInput => ({
  nodes: [
    { id: '00000000-0000-4000-8000-000000000001', party_kind: 'PM', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic root', metadata: { root: true } },
    { id: '00000000-0000-4000-8000-000000000002', party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic owner' },
  ],
  edges: [{ id: '00000000-0000-4000-8000-000000000003', owner_node_id: '00000000-0000-4000-8000-000000000002', owned_node_id: '00000000-0000-4000-8000-000000000001', percentage }],
  controls: [],
});

describe('H4 single-pass adversarial acceptance probes', () => {
  it('marks a known partial total as structural incompleteness', () => {
    expect(validateBcGraph(graph('40')).incomplete_markers.length).toBeGreaterThan(0);
  });
  it('does not silently omit an owner whose percentage is unknown', () => {
    const input = graph(null);
    expect(calculateBcOwnership(input, input.nodes[0].id).some(row => row.subject_node_id === input.nodes[1].id)).toBe(true);
  });
  it('does not call an evaluation verified merely because rule metadata exists', () => {
    const input = graph('100');
    const result = evaluateBcRegime({ regime: 'LFPIORPI', graph: input, target_node_id: input.nodes[0].id, configured_rule: { checksum: 'synthetic-only', revision: 'not-an-executable-rule' } });
    expect(result.status).not.toBe('EVALUATED');
  });
  it('rejects malformed node identifiers before persistence', () => {
    const input = graph('100');
    input.nodes[1].id = 'not-a-uuid'; input.edges[0].owner_node_id = 'not-a-uuid';
    expect(validateBcGraph(input).hard_errors.length).toBeGreaterThan(0);
  });
  it('requires a factual description for OTHER control', () => {
    const input = graph('100');
    input.controls.push({ id: '00000000-0000-4000-8000-000000000004', subject_node_id: input.nodes[1].id, kind: 'OTHER', description: '' });
    expect(validateBcGraph(input).hard_errors.length).toBeGreaterThan(0);
  });
  it('keeps sub-display precision through an indirect path', () => {
    const input = graph('0.000001');
    const holding = { id: '00000000-0000-4000-8000-000000000005', party_kind: 'PM' as const, identity_mode: 'STRUCTURED_ONLY' as const, display_name: 'Synthetic holding' };
    input.edges[0].owner_node_id = holding.id;
    input.nodes.push(holding);
    input.edges.push({ id: '00000000-0000-4000-8000-000000000006', owner_node_id: input.nodes[1].id, owned_node_id: holding.id, percentage: '0.000001' });
    const owner = calculateBcOwnership(input, input.nodes[0].id).find(row => row.subject_node_id === input.nodes[1].id);
    expect(Number(owner?.total_percentage)).toBeGreaterThan(0);
  });
  it('never returns a legal result with no configured rule', () => {
    const input = graph('100');
    for (const regime of ['LFPIORPI', 'CFF_RMF'] as const) {
      expect(evaluateBcRegime({ regime, graph: input, target_node_id: input.nodes[0].id })).toMatchObject({ status: 'NOT_CONFIGURED', results: [] });
    }
  });
});
