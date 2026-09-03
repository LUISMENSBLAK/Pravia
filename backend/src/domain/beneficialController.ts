import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { evaluateLegalRule, type LegalRuleRevisionInput, type RuleEvaluation } from './complianceLegalEngine';

export const BC_ENGINE_VERSION = 'H4-CUM-BC-001.3';
const Decimal = Prisma.Decimal.clone({ precision: 256, toExpNeg: -1000, toExpPos: 1000 });
export const bcDecimal = (value: string | number) => new Decimal(value);
export const isBcUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type BcPartyKind = 'PF' | 'PM';
export type BcIdentityMode = 'LINKED' | 'STRUCTURED_ONLY';
export type BcControlKind = 'VOTE' | 'APPOINTMENT' | 'MANAGEMENT' | 'AGREEMENT' | 'OTHER';

export type BcNodeInput = {
  id: string;
  party_kind: BcPartyKind;
  identity_mode: BcIdentityMode;
  linked_compareciente_id?: string | null;
  display_name?: string | null;
  canonical_label?: string | null;
  incomplete?: boolean;
  source?: { structure_id: string; node_id: string; persona_moral_id: string };
  metadata?: Record<string, unknown>;
};
export type BcEdgeInput = {
  id: string;
  owner_node_id: string;
  owned_node_id: string;
  percentage?: string | number | null;
  evidence_document_id?: string | null;
  evidence_document_version?: string | null;
  evidence_document_checksum?: string | null;
};
export type BcControlInput = {
  id: string;
  subject_node_id: string;
  kind: BcControlKind;
  description?: string | null;
  evidence_document_id?: string | null;
  evidence_document_version?: string | null;
  evidence_document_checksum?: string | null;
  human_confirmed?: boolean;
};
export type BcGraphInput = { root_node_id?: string; nodes: BcNodeInput[]; edges: BcEdgeInput[]; controls: BcControlInput[]; incomplete_markers?: string[] };

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
};

const byId = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
export const bcLogicalHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Keep dated legal facts, but not transport/audit timing, in the evaluation identity. */
export function bcConfirmedContext(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map(bcConfirmedContext);
  if (!value || typeof value !== 'object') return value;
  const volatile = new Set(['created_at', 'updated_at', 'captured_at', 'confirmed_at', 'created_by_id', 'updated_by_id',
    'confirmed_by_id', 'creado_por_id', 'actor_id', 'correlation_id', 'idempotency_key', 'metadata']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !volatile.has(key)).map(([key, item]) => [key, bcConfirmedContext(item)]));
}

export function canonicalBcGraph(graph: BcGraphInput) {
  return canonical({
    root_node_id: graph.root_node_id,
    incomplete_markers: [...new Set(graph.incomplete_markers || [])].sort(),
    nodes: byId(graph.nodes).map((node) => ({
      id: node.id,
      party_kind: node.party_kind,
      identity_mode: node.identity_mode,
      linked_compareciente_id: node.linked_compareciente_id || null,
      display_name: node.display_name?.trim() || null,
      incomplete: Boolean(node.incomplete),
      ...(node.source ? { source: canonical(node.source) } : {}),
    })),
    edges: byId(graph.edges).map((edge) => ({
      id: edge.id,
      owner_node_id: edge.owner_node_id,
      owned_node_id: edge.owned_node_id,
      percentage: edge.percentage == null || edge.percentage === '' ? null : bcDecimal(edge.percentage).toString(),
      evidence_document_id: edge.evidence_document_id || null,
      evidence_document_version: edge.evidence_document_version || null,
      evidence_document_checksum: edge.evidence_document_checksum || null,
    })),
    controls: byId(graph.controls).map((control) => ({
      id: control.id,
      subject_node_id: control.subject_node_id,
      kind: control.kind,
      description: control.description?.trim() || null,
      evidence_document_id: control.evidence_document_id || null,
      evidence_document_version: control.evidence_document_version || null,
      evidence_document_checksum: control.evidence_document_checksum || null,
      human_confirmed: Boolean(control.human_confirmed),
    })),
  });
}

export function bcGraphFingerprint(graph: BcGraphInput) {
  return createHash('sha256').update(JSON.stringify(canonicalBcGraph(graph))).digest('hex');
}

/** A pending branch is a proposal only. Stable remapping avoids stealing another structure's row IDs. */
export function bcReconciliationGraph(local: BcGraphInput, current: BcGraphInput, proposalId: string): BcGraphInput {
  const mapped = new Map<string, string>([[local.root_node_id!, current.root_node_id!]]);
  const remap = (id: string) => {
    if (mapped.has(id)) return mapped.get(id)!;
    const hash = bcLogicalHash({ proposalId, id });
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
  const nodes = [...current.nodes];
  for (const node of local.nodes.filter(node => node.id !== local.root_node_id)) {
    const existing = node.identity_mode === 'LINKED' ? nodes.find(item => item.identity_mode === 'LINKED' && item.linked_compareciente_id === node.linked_compareciente_id) : null;
    mapped.set(node.id, existing?.id || remap(node.id));
    if (!existing) nodes.push({ ...node, id: mapped.get(node.id)! });
  }
  // Replace only the ownership branch being reconciled. Unrelated target facts stay intact and visible.
  const replacedTargets = new Set(local.edges.map(edge => remap(edge.owned_node_id)));
  return { root_node_id: current.root_node_id, nodes,
    edges: [...current.edges.filter(edge => !replacedTargets.has(edge.owned_node_id)),
      ...local.edges.map(edge => ({ ...edge, id: remap(edge.id), owner_node_id: remap(edge.owner_node_id), owned_node_id: remap(edge.owned_node_id) }))],
    controls: [...current.controls, ...local.controls.map(fact => ({ ...fact, id: remap(fact.id), subject_node_id: remap(fact.subject_node_id) }))],
  };
}

export type BcGraphValidation = {
  hard_errors: string[];
  warnings: string[];
  incomplete_markers: string[];
  cycles: string[][];
};

export function validateBcGraph(graph: BcGraphInput, rootComparecienteId?: string): BcGraphValidation {
  const hard = new Set<string>();
  const warnings = new Set<string>();
  const incomplete = new Set<string>(graph.incomplete_markers || []);
  const ids = new Set<string>();
  const nodes = new Map<string, BcNodeInput>();
  for (const node of graph.nodes || []) {
    if (!isBcUuid(node.id) || ids.has(node.id)) hard.add('INVALID_OR_DUPLICATE_NODE_ID');
    ids.add(node.id); nodes.set(node.id, node);
    const linked = Boolean(node.linked_compareciente_id);
    const structured = Boolean(node.display_name?.trim());
    if (node.identity_mode === 'LINKED' ? !linked || structured : linked || !structured) hard.add(`NODE_IDENTITY_XOR:${node.id}`);
    if (!['PF', 'PM'].includes(node.party_kind) || !['LINKED', 'STRUCTURED_ONLY'].includes(node.identity_mode)) hard.add(`INVALID_NODE_KIND:${node.id}`);
    if (linked && !isBcUuid(node.linked_compareciente_id)) hard.add(`INVALID_LINKED_UUID:${node.id}`);
    if (node.incomplete) incomplete.add(`NODE_INCOMPLETE:${node.id}`);
  }
  const edgeIds = new Set<string>();
  if (rootComparecienteId !== undefined || graph.root_node_id !== undefined) {
    const root = graph.root_node_id ? nodes.get(graph.root_node_id) : undefined;
    if (!root || root.party_kind !== 'PM' || root.identity_mode !== 'LINKED'
      || (rootComparecienteId !== undefined && root.linked_compareciente_id !== rootComparecienteId)) hard.add('ROOT_TARGET_MISMATCH');
  }
  const aggregate = new Map<string, Prisma.Decimal>();
  const pairs = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges || []) {
    if (!isBcUuid(edge.id) || edgeIds.has(edge.id)) hard.add('INVALID_OR_DUPLICATE_EDGE_ID');
    edgeIds.add(edge.id);
    if (!nodes.has(edge.owner_node_id) || !nodes.has(edge.owned_node_id)) hard.add(`EDGE_NODE_NOT_FOUND:${edge.id}`);
    if (edge.owner_node_id === edge.owned_node_id) hard.add(`SELF_OWNERSHIP:${edge.id}`);
    const pair = `${edge.owner_node_id}:${edge.owned_node_id}`;
    if (pairs.has(pair)) hard.add(`DUPLICATE_OWNERSHIP:${edge.id}`); pairs.add(pair);
    if (edge.evidence_document_id && !isBcUuid(edge.evidence_document_id)) hard.add(`INVALID_DOCUMENT_UUID:${edge.id}`);
    if (edge.percentage == null || edge.percentage === '') incomplete.add(`UNKNOWN_PERCENTAGE:${edge.id}`);
    else {
      try {
        const value = bcDecimal(edge.percentage);
        if (!value.isFinite() || value.lt(0) || value.gt(100) || value.decimalPlaces() > 6) hard.add(`INVALID_PERCENTAGE:${edge.id}`);
        else aggregate.set(edge.owned_node_id, (aggregate.get(edge.owned_node_id) || bcDecimal(0)).add(value));
      } catch { hard.add(`INVALID_PERCENTAGE:${edge.id}`); }
    }
    adjacency.set(edge.owner_node_id, [...(adjacency.get(edge.owner_node_id) || []), edge.owned_node_id]);
  }
  for (const [owned, total] of aggregate) {
    if (total.lt(100)) incomplete.add(`PARTIAL_OWNERSHIP:${owned}`);
    if (total.gt(100)) { warnings.add(`AGGREGATE_OVER_100:${owned}`); incomplete.add(`AGGREGATE_OVER_100:${owned}`); }
  }
  for (const node of nodes.values()) if (node.party_kind === 'PM' && !graph.edges.some(edge => edge.owned_node_id === node.id)) incomplete.add(`UNKNOWN_BRANCH:${node.id}`);
  const controlIds = new Set<string>();
  for (const control of graph.controls || []) {
    if (!isBcUuid(control.id) || controlIds.has(control.id)) hard.add('INVALID_OR_DUPLICATE_CONTROL_ID');
    controlIds.add(control.id);
    if (!nodes.has(control.subject_node_id)) hard.add(`CONTROL_NODE_NOT_FOUND:${control.id}`);
    if (!['VOTE', 'APPOINTMENT', 'MANAGEMENT', 'AGREEMENT', 'OTHER'].includes(control.kind)) hard.add(`INVALID_CONTROL_KIND:${control.id}`);
    if (control.evidence_document_id && !isBcUuid(control.evidence_document_id)) hard.add(`INVALID_DOCUMENT_UUID:${control.id}`);
    if (control.kind === 'OTHER' && (!control.description?.trim() || !control.human_confirmed || !control.evidence_document_id)) hard.add(`OTHER_REQUIRES_CONFIRMED_EVIDENCE:${control.id}`);
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (nodeId: string, path: string[]) => {
    if (visiting.has(nodeId)) {
      const start = path.indexOf(nodeId);
      cycles.push([...path.slice(start), nodeId]);
      return;
    }
    if (path.length >= 20) { incomplete.add(`DEPTH_LIMIT:${nodeId}`); return; }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const next of [...(adjacency.get(nodeId) || [])].sort()) walk(next, [...path, nodeId]);
    visiting.delete(nodeId); visited.add(nodeId);
  };
  [...nodes.keys()].sort().forEach((id) => walk(id, []));
  if (cycles.length) { warnings.add('OWNERSHIP_CYCLE_REQUIRES_REVIEW'); incomplete.add('OWNERSHIP_CYCLE_REQUIRES_REVIEW'); }
  if (!graph.nodes?.length) incomplete.add('EMPTY_STRUCTURE');
  return { hard_errors: [...hard].sort(), warnings: [...warnings].sort(), incomplete_markers: [...incomplete].sort(), cycles };
}

export type BcOwnershipPath = { path: string[]; edge_ids: string[]; percentage: string | null };
export type BcOwnershipCalculation = { subject_node_id: string; known_minimum: string; total_percentage: string | null; incomplete: boolean; paths: BcOwnershipPath[]; truncated: boolean };

export function calculateBcOwnership(graph: BcGraphInput, targetNodeId: string, maxDepth = 20): BcOwnershipCalculation[] {
  const incoming = new Map<string, BcEdgeInput[]>();
  for (const edge of graph.edges || []) incoming.set(edge.owned_node_id, [...(incoming.get(edge.owned_node_id) || []), edge]);
  const result = new Map<string, { total: Prisma.Decimal; paths: BcOwnershipPath[]; incomplete: boolean }>();
  let unsafe = false;
  const visit = (current: string, factor: Prisma.Decimal | null, path: string[], edgePath: string[], seen: Set<string>, depth: number) => {
    if (depth >= maxDepth) {
      if (incoming.has(current)) unsafe = true;
      return;
    }
    for (const edge of [...(incoming.get(current) || [])].sort((a, b) => a.id.localeCompare(b.id))) {
      const owner = edge.owner_node_id;
      if (seen.has(owner)) { unsafe = true; continue; }
      const nextFactor = factor === null || edge.percentage == null || edge.percentage === '' ? null : factor.mul(bcDecimal(edge.percentage)).div(100);
      const nextPath = [owner, ...path];
      const nextEdges = [edge.id, ...edgePath];
      const item = result.get(owner) || { total: bcDecimal(0), paths: [], incomplete: false };
      if (nextFactor === null) item.incomplete = true; else item.total = item.total.add(nextFactor);
      item.paths.push({ path: nextPath, edge_ids: nextEdges, percentage: nextFactor?.toString() ?? null });
      result.set(owner, item);
      visit(owner, nextFactor, nextPath, nextEdges, new Set([...seen, owner]), depth + 1);
    }
  };
  visit(targetNodeId, bcDecimal(100), [targetNodeId], [], new Set([targetNodeId]), 0);
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subject_node_id, value]) => ({
    subject_node_id,
    known_minimum: value.total.toString(),
    total_percentage: value.incomplete || unsafe ? null : value.total.toString(),
    incomplete: value.incomplete || unsafe,
    paths: value.paths.sort((a, b) => a.edge_ids.join('/').localeCompare(b.edge_ids.join('/'))),
    truncated: unsafe,
  }));
}

export type BcRegime = 'LFPIORPI' | 'CFF_RMF';
export type BcVerifiedRevision = LegalRuleRevisionInput & { status: string; verified_at: Date | string | null;
  source_name: string | null; source_checksum: string | null; source_url: string | null; source_published_at: Date | string | null };
export type BcRulePack = { regime: BcRegime; applicability: BcVerifiedRevision; determination: BcVerifiedRevision[] };
export type BcDetermination = { subject_node_id: string; subject_compareciente_id: string | null; determination: 'IDENTIFIED';
  rule_revision_id: string; rule_result: RuleEvaluation; facts: unknown };
/** Per-subject executions belong to the immutable H4 evaluation, not the H1 ledger identity. */
export type BcSubjectExecution = RuleEvaluation & {
  execution_id: string;
  h1_rule_result_id: string;
  bc_subject_node_id?: string;
  bc_facts?: { subject: BcNodeInput; mathematical_ownership: BcOwnershipCalculation | null };
};
/** Canonical persisted result facts: ordered by supporting execution_id, one fact object per execution. */
export type BcResultFacts = NonNullable<BcSubjectExecution['bc_facts']>[];

export function bcResultExecutions(result: { subject_compareciente_id?: string | null; subject_snapshot_node_id?: string | null;
  facts_snapshot: unknown; result_snapshot: unknown }, evaluationSnapshot: unknown): BcSubjectExecution[] {
  const snapshot = result.result_snapshot as any, evaluation = evaluationSnapshot as any;
  if (!Array.isArray(snapshot?.execution_ids) || !snapshot.execution_ids.length
    || new Set(snapshot.execution_ids).size !== snapshot.execution_ids.length
    || !Array.isArray(evaluation?.subject_executions) || !Array.isArray(result.facts_snapshot)) return [];
  const executions = snapshot.execution_ids.map((id: string) => evaluation.subject_executions.find((item: BcSubjectExecution) => item.execution_id === id)) as BcSubjectExecution[];
  if (executions.some(item => !item || item.truth !== 'TRUE' || !item.bc_facts || item.bc_facts.subject.id !== item.bc_subject_node_id
    || (result.subject_compareciente_id
      ? item.bc_facts.subject.identity_mode !== 'LINKED' || item.bc_facts.subject.linked_compareciente_id !== result.subject_compareciente_id
      : item.bc_facts.subject.identity_mode !== 'STRUCTURED_ONLY' || item.bc_subject_node_id !== result.subject_snapshot_node_id))) return [];
  executions.sort((a, b) => a.execution_id.localeCompare(b.execution_id));
  if (snapshot.h1_rule_result_id !== executions[0].h1_rule_result_id || snapshot.rule_revision_id !== executions[0].ruleRevisionId
    || bcLogicalHash(snapshot.supporting_rule_result_ids) !== bcLogicalHash([...new Set(executions.map(item => item.h1_rule_result_id))])
    || bcLogicalHash(snapshot.node_ids) !== bcLogicalHash([...new Set(executions.map(item => item.bc_subject_node_id))])
    || bcLogicalHash(result.facts_snapshot) !== bcLogicalHash(executions.map(item => item.bc_facts))) return [];
  return executions;
}
const verified = (rule: BcVerifiedRevision) => Boolean(rule && ['ACTIVE', 'RETIRED'].includes(rule.status) && rule.verified_at && rule.source_name
  && rule.source_checksum && rule.source_url && rule.source_published_at && rule.checksum && rule.legal_basis
  && rule.conditions && rule.outcome?.when_true);
export const bcOrderedRules = (pack?: BcRulePack | null) => pack ? [pack.applicability, ...pack.determination]
  .sort((a, b) => a.rule_id.localeCompare(b.rule_id) || a.version - b.version || a.id.localeCompare(b.id))
  .map(rule => ({ id: rule.id, rule_id: rule.rule_id, version: rule.version, checksum: rule.checksum })) : [];

export function evaluateBcRegime(input: {
  regime: 'LFPIORPI' | 'CFF_RMF';
  graph: BcGraphInput;
  target_node_id: string;
  configured_rule?: { checksum: string; revision: string } | null;
  rule_pack?: BcRulePack | null;
  context?: Record<string, unknown>;
}) {
  const validation = validateBcGraph(input.graph);
  const ownership = calculateBcOwnership(input.graph, input.target_node_id);
  const pack = input.rule_pack;
  // A checksum/revision pair is not a determination. Only executed H1 rules count.
  if (!pack || pack.regime !== input.regime || !pack.determination.length
    || !verified(pack.applicability) || !pack.determination.every(verified)
    || pack.applicability.outcome.bc?.regime !== input.regime || pack.applicability.outcome.bc?.purpose !== 'APPLICABILITY'
    || pack.determination.some(rule => rule.outcome.bc?.regime !== input.regime || rule.outcome.bc?.purpose !== 'DETERMINATION')) return {
    status: 'NOT_CONFIGURED' as const,
    rule_set_checksum: null,
    results: [] as BcDetermination[],
    executed_rules: [] as RuleEvaluation[],
    snapshot: { regime: input.regime, validation, mathematical_ownership: ownership, reason: 'LEGAL_RULE_NOT_CONFIGURED' },
  };
  const checksum = bcLogicalHash(bcOrderedRules(pack));
  const context = { ...(input.context || {}), graph: canonicalBcGraph(input.graph), controls: input.graph.controls };
  const applicability = evaluateLegalRule(pack.applicability, context);
  if (validation.hard_errors.length || validation.incomplete_markers.length || validation.cycles.length || applicability.truth === 'UNKNOWN') return {
    status: 'REQUIRES_REVIEW' as const,
    rule_set_checksum: checksum,
    results: [] as BcDetermination[],
    executed_rules: [applicability],
    snapshot: { regime: input.regime, validation, mathematical_ownership: ownership, applicability },
  };
  if (applicability.truth === 'FALSE') return { status: 'NOT_APPLICABLE' as const, rule_set_checksum: checksum,
    results: [] as BcDetermination[], executed_rules: [applicability], snapshot: { regime: input.regime, validation, mathematical_ownership: ownership, applicability } };
  const executed: Array<RuleEvaluation & { bc_subject_node_id?: string; bc_facts?: unknown }> = [applicability], results: BcDetermination[] = [];
  for (const subject of byId(input.graph.nodes).filter(node => node.id !== input.target_node_id)) {
    const math = ownership.find(row => row.subject_node_id === subject.id);
    for (const rule of [...pack.determination].sort((a, b) => a.id.localeCompare(b.id))) {
      const result = evaluateLegalRule(rule, { ...context, subject,
        ownership: { known_minimum: bcDecimal(math?.known_minimum || '0'), total: math?.total_percentage == null ? null : bcDecimal(math.total_percentage) },
        controls: input.graph.controls.filter(control => control.subject_node_id === subject.id) });
      executed.push({ ...result, bc_subject_node_id: subject.id, bc_facts: { subject, mathematical_ownership: math || null } });
      if (result.truth === 'UNKNOWN') return { status: 'REQUIRES_REVIEW' as const, rule_set_checksum: checksum,
        results: [] as BcDetermination[], executed_rules: executed,
        snapshot: { regime: input.regime, validation, mathematical_ownership: ownership, applicability } };
      if (result.truth === 'TRUE') results.push({ subject_node_id: subject.id, subject_compareciente_id: subject.linked_compareciente_id || null,
        determination: 'IDENTIFIED', rule_revision_id: rule.id, rule_result: result, facts: { subject, mathematical_ownership: math || null } });
    }
  }
  return {
    status: 'EVALUATED' as const,
    rule_set_checksum: checksum,
    results,
    executed_rules: executed,
    snapshot: { regime: input.regime, validation, mathematical_ownership: ownership, applicability, executed_rule_ids: executed.map(rule => rule.ruleRevisionId) },
  };
}
