import { describe, expect, it } from 'vitest';
import { bcConfirmedContext, bcGraphFingerprint, bcLogicalHash, calculateBcOwnership, evaluateBcRegime, validateBcGraph, type BcGraphInput, type BcRulePack, type BcRegime, type BcVerifiedRevision } from './beneficialController';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const graph = (): BcGraphInput => ({
  root_node_id: id(1),
  nodes: [
    { id: id(1), party_kind: 'PM', identity_mode: 'LINKED', linked_compareciente_id: id(101) },
    { id: id(2), party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic A' },
    { id: id(3), party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic B' },
  ],
  edges: [
    { id: id(11), owner_node_id: id(2), owned_node_id: id(1), percentage: '40' },
    { id: id(12), owner_node_id: id(3), owned_node_id: id(1), percentage: '60' },
  ], controls: [],
});
const rule = (n: number, regime: BcRegime, purpose: 'APPLICABILITY' | 'DETERMINATION', conditions: any): BcVerifiedRevision => ({
  id: id(n), rule_id: id(n + 100), stable_key: `SYNTHETIC_ONLY_${n}`, family: 'CUM_MAT_002', version: 1,
  checksum: String(n).padStart(64, '0'), legal_basis: 'SYNTHETIC TEST ONLY — NOT A LEGAL RULE',
  status: 'ACTIVE', verified_at: '2026-01-01', source_name: 'Synthetic fixture', source_url: 'https://example.invalid/test',
  source_checksum: 'f'.repeat(64), source_published_at: '2026-01-01', conditions,
  outcome: { bc: { regime, purpose }, when_true: { applicability: 'APLICA_SIN_AVISO', vulnerable_activity: true } },
});
const pack = (regime: BcRegime = 'LFPIORPI', minimum = 35): BcRulePack => ({
  regime, applicability: rule(20, regime, 'APPLICABILITY', { op: 'equals', path: 'enabled', value: true }),
  determination: [rule(21, regime, 'DETERMINATION', { op: 'all', rules: [
    { op: 'equals', path: 'subject.party_kind', value: 'PF' }, { op: 'gte', path: 'ownership.total', value: minimum },
  ] })],
});
const evaluate = (input = graph(), rules: BcRulePack | null = pack(), context = { enabled: true }) =>
  evaluateBcRegime({ regime: rules?.regime || 'LFPIORPI', graph: input, target_node_id: id(1), rule_pack: rules, context });

describe('CUM-BC-001 executable remediation', () => {
  it('requires the explicit canonical root and validates all UUIDs', () => {
    expect(validateBcGraph(graph(), id(101)).hard_errors).toEqual([]);
    expect(validateBcGraph({ ...graph(), root_node_id: id(2) }, id(101)).hard_errors).toContain('ROOT_TARGET_MISMATCH');
    expect(validateBcGraph(graph(), id(999)).hard_errors).toContain('ROOT_TARGET_MISMATCH');
    const bad = graph(); bad.nodes[1].id = 'arbitrary';
    expect(validateBcGraph(bad).hard_errors).toContain('INVALID_OR_DUPLICATE_NODE_ID');
  });
  it('saves partial aggregates as incomplete rather than normalizing them', () => {
    const partial = graph(); partial.edges.pop();
    const result = validateBcGraph(partial);
    expect(result.hard_errors).toEqual([]);
    expect(result.incomplete_markers).toContain(`PARTIAL_OWNERSHIP:${id(1)}`);
    expect(evaluate(partial)).toMatchObject({ status: 'REQUIRES_REVIEW', results: [] });
  });
  it('distinguishes aggregate >100 from a hard-invalid individual percentage', () => {
    const input = graph(); input.edges[0].percentage = '70';
    expect(validateBcGraph(input)).toMatchObject({ hard_errors: [], incomplete_markers: [`AGGREGATE_OVER_100:${id(1)}`] });
    input.edges[0].percentage = '101';
    expect(validateBcGraph(input).hard_errors).toContain(`INVALID_PERCENTAGE:${id(11)}`);
  });
  it('rejects self edges, duplicate pairs and identity XOR violations', () => {
    const input = graph(); input.nodes[1].linked_compareciente_id = id(105);
    input.edges.push({ ...input.edges[0], id: id(13) }, { id: id(14), owner_node_id: id(1), owned_node_id: id(1), percentage: '1' });
    expect(validateBcGraph(input).hard_errors).toEqual(expect.arrayContaining([
      `NODE_IDENTITY_XOR:${id(2)}`, `DUPLICATE_OWNERSHIP:${id(13)}`, `SELF_OWNERSHIP:${id(14)}`,
    ]));
  });
  it('keeps cycles savable but emits no legal result', () => {
    const input = graph(); input.edges.push({ id: id(13), owner_node_id: id(1), owned_node_id: id(2), percentage: '100' });
    expect(validateBcGraph(input).hard_errors).toEqual([]);
    expect(validateBcGraph(input).cycles.length).toBeGreaterThan(0);
    expect(evaluate(input)).toMatchObject({ status: 'REQUIRES_REVIEW', results: [] });
  });
  it('requires description + evidence + human confirmation for OTHER', () => {
    const input = graph(); input.controls.push({ id: id(30), subject_node_id: id(2), kind: 'OTHER', description: 'Synthetic control' });
    expect(validateBcGraph(input).hard_errors).toContain(`OTHER_REQUIRES_CONFIRMED_EVIDENCE:${id(30)}`);
    Object.assign(input.controls[0], { evidence_document_id: id(31), human_confirmed: true });
    expect(validateBcGraph(input).hard_errors).toEqual([]);
  });
  it('preserves a tiny positive indirect amount without display rounding', () => {
    const input = graph(); input.nodes[2].party_kind = 'PM';
    input.edges = [{ id: id(11), owner_node_id: id(3), owned_node_id: id(1), percentage: '0.000001' },
      { id: id(12), owner_node_id: id(2), owned_node_id: id(3), percentage: '0.000001' }];
    expect(calculateBcOwnership(input, id(1)).find(row => row.subject_node_id === id(2))?.total_percentage).toBe('0.00000000000001');
  });
  it('sums distinct direct/indirect paths deterministically', () => {
    const input = graph(); input.nodes[2].party_kind = 'PM';
    input.edges[0].percentage = '20'; input.edges[1].percentage = '80';
    input.edges.push({ id: id(13), owner_node_id: id(2), owned_node_id: id(3), percentage: '100' });
    const row = calculateBcOwnership(input, id(1)).find(item => item.subject_node_id === id(2))!;
    expect(row).toMatchObject({ known_minimum: '100', total_percentage: '100', incomplete: false });
    expect(row.paths).toHaveLength(2);
  });
  it('retains known+unknown paths and never presents a lower bound as an exact total', () => {
    const input = graph(); input.nodes[2].party_kind = 'PM';
    input.edges.push({ id: id(13), owner_node_id: id(2), owned_node_id: id(3), percentage: null });
    const row = calculateBcOwnership(input, id(1)).find(item => item.subject_node_id === id(2))!;
    expect(row).toMatchObject({ known_minimum: '40', total_percentage: null, incomplete: true });
    expect(row.paths).toHaveLength(2);
  });
  it('has permutation-invariant semantic fingerprints, excluding volatile metadata', () => {
    const input = graph();
    expect(bcGraphFingerprint(input)).toBe(bcGraphFingerprint({ ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }));
    input.nodes[1].metadata = { request: 'different', root: true, time: 'later' };
    expect(bcGraphFingerprint(input)).toBe(bcGraphFingerprint(graph()));
  });
  it('includes document identity, version and checksum in the snapshot fingerprint', () => {
    const input = graph(); Object.assign(input.edges[0], { evidence_document_id: id(31), evidence_document_version: 'v1', evidence_document_checksum: 'a'.repeat(64) });
    const first = bcGraphFingerprint(input); input.edges[0].evidence_document_version = 'v2';
    expect(bcGraphFingerprint(input)).not.toBe(first);
    input.edges[0].evidence_document_version = 'v1'; input.edges[0].evidence_document_checksum = 'b'.repeat(64);
    expect(bcGraphFingerprint(input)).not.toBe(first);
  });
  it('does not elevate metadata-only or absent rules into BC/no-BC conclusions', () => {
    expect(evaluate(graph(), null)).toMatchObject({ status: 'NOT_CONFIGURED', results: [] });
    expect(evaluateBcRegime({ regime: 'LFPIORPI', graph: graph(), target_node_id: id(1), configured_rule: { checksum: 'metadata', revision: 'v1' } })).toMatchObject({ status: 'NOT_CONFIGURED', results: [] });
  });
  it.each(['DRAFT', 'VERIFIED'])('requires activated verified H1 rules, not %s', status => {
    const rules = pack(); rules.applicability.status = status;
    expect(evaluate(graph(), rules)).toMatchObject({ status: 'NOT_CONFIGURED', results: [] });
  });
  it('executes two synthetic regimes independently and supports several subjects', () => {
    expect(evaluate(graph(), pack('LFPIORPI', 35)).results).toHaveLength(2);
    const second = evaluate(graph(), pack('CFF_RMF', 60));
    expect(second.status).toBe('EVALUATED'); expect(second.results).toHaveLength(1);
    expect(second.results[0].subject_node_id).toBe(id(3));
  });
  it('reports zero identified only after verified actual determination execution', () => {
    const result = evaluate(graph(), pack('LFPIORPI', 101));
    expect(result).toMatchObject({ status: 'EVALUATED', results: [] });
    expect(result.executed_rules).toHaveLength(3);
  });
  it('uses qualitative controls as facts consumed by the canonical evaluator', () => {
    const input = graph(); input.controls.push({ id: id(30), subject_node_id: id(2), kind: 'VOTE', description: 'Synthetic factual control' });
    const rules = pack(); rules.determination[0].conditions = { op: 'array_some', path: 'controls', rule: { op: 'equals', path: 'kind', value: 'VOTE' } };
    expect(evaluate(input, rules).results.map(row => row.subject_node_id)).toEqual([id(2)]);
  });
  it('canonicalizes rule order and separates applicability from determination', () => {
    const rules = pack(); rules.determination.push(rule(22, 'LFPIORPI', 'DETERMINATION', { op: 'equals', path: 'subject.party_kind', value: 'PM' }));
    const first = evaluate(graph(), rules);
    expect(evaluate(graph(), { ...rules, determination: [...rules.determination].reverse() })).toEqual(first);
    rules.applicability.outcome.bc!.purpose = 'DETERMINATION';
    expect(evaluate(graph(), rules).status).toBe('NOT_CONFIGURED');
  });
  it('does not emit results when an actual rule has unknown input', () => {
    const rules = pack(); rules.determination[0].conditions = { op: 'gte', path: 'not_confirmed', value: 1 };
    expect(evaluate(graph(), rules)).toMatchObject({ status: 'REQUIRES_REVIEW', results: [] });
  });
  it('preserves historical S1 independently of a mutable S2', () => {
    const input = graph(), first = evaluate(input), frozen = JSON.stringify(first);
    input.edges[0].percentage = '30'; input.edges[1].percentage = '70';
    expect(JSON.stringify(first)).toBe(frozen);
    expect(evaluate(input)).not.toEqual(first);
  });
  it('excludes transport timing but retains legal dates in logical identities', () => {
    const before = { legal_date: new Date('2026-01-01'), updated_at: 't1', actor_id: id(1), facts: { a: 1 } };
    expect(bcLogicalHash(bcConfirmedContext(before))).toBe(bcLogicalHash(bcConfirmedContext({ ...before, updated_at: 't2', actor_id: id(2) })));
    expect(bcLogicalHash(bcConfirmedContext(before))).not.toBe(bcLogicalHash(bcConfirmedContext({ ...before, legal_date: new Date('2026-02-01') })));
  });
});
