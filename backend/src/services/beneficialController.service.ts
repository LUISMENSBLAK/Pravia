import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { BC_ENGINE_VERSION, bcOrderedRules, bcGraphFingerprint, bcLogicalHash, bcReconciliationGraph, canonicalBcGraph, evaluateBcRegime, validateBcGraph, isBcUuid, type BcGraphInput, type BcRulePack, type BcVerifiedRevision, type BcSubjectExecution } from '../domain/beneficialController';
import { complianceDocumentVersion, ComplianceDocumentService } from './complianceDocument.service';
import { ComplianceBcScreeningAdapter } from './complianceBcScreening.service';
import { canAccessDocumento, comparecienteObjectWhere } from './objectAccess.service';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { downloadFile } from '../storage/storage.service';
import { generateOperationalArtifactWithOpenAI } from './openaiDocument.service';
import { recordAIUsageInDb } from './aiUsage.service';
import { ComparecienteService } from './compareciente.service';
import { selectEffectiveRuleRevisions } from '../domain/complianceLegalEngine';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
type BcTargetPlan = { personaMoralId: string; actId: string | null; structure: any; graph: BcGraphInput | null; fingerprint: string | null };
type BcReviewPlan = { targets: BcTargetPlan[]; identity: unknown };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export class BeneficialControllerError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const need = (actor: Actor, permission: string) => {
  if (!actor.permissions.includes(permission as never)) throw new BeneficialControllerError(403, 'BC_PERMISSION_DENIED', 'No tienes permiso para realizar esta acción.');
};

export class BeneficialControllerService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async root(actor: Actor, comparecienteId: string, db: Db = this.db) {
    if (!isBcUuid(comparecienteId)) throw new BeneficialControllerError(400, 'BC_INVALID_ID', 'El identificador no es válido.');
    const root = await db.compareciente.findFirst({
      where: { AND: [{ id: comparecienteId, organization_id: actor.organizationId, archived_at: null }, comparecienteObjectWhere(actor)] },
      include: { personaMoral: true },
    });
    if (!root?.personaMoral || root.tipo_persona !== 'MORAL') throw new BeneficialControllerError(404, 'BC_PERSONA_MORAL_NOT_FOUND', 'La persona moral no está disponible.');
    return root;
  }

  private async authorizeGraphIdentities(db: Db, actor: Actor, graph: Pick<BcGraphInput, 'nodes'>) {
    for (const id of new Set(graph.nodes.filter(node => node.identity_mode === 'LINKED').map(node => node.linked_compareciente_id))) {
      if (!id || !await db.compareciente.findFirst({ where: { AND: [
        { id, organization_id: actor.organizationId, archived_at: null }, comparecienteObjectWhere(actor),
      ] }, select: { id: true } })) throw new BeneficialControllerError(404, 'BC_LINKED_PARTY_NOT_FOUND', 'La estructura contiene una identidad no disponible dentro de tus permisos.');
    }
  }

  private async labelGraph(db: Db, actor: Actor, graph: BcGraphInput) {
    await this.authorizeGraphIdentities(db, actor, graph);
    const nodes = [];
    for (const node of graph.nodes) {
      const party = node.identity_mode === 'LINKED' ? await db.compareciente.findFirst({ where: { AND: [
        { id: node.linked_compareciente_id!, organization_id: actor.organizationId, archived_at: null }, comparecienteObjectWhere(actor),
      ] }, include: { personaFisica: true, personaMoral: true } }) : null;
      nodes.push({ ...node, canonical_label: party?.personaFisica?.nombre_completo_calculado || party?.personaMoral?.razon_social || party?.nombre_busqueda || null });
    }
    return { ...graph, nodes };
  }

  private reviewToken(graph: BcGraphInput) {
    // Includes persisted metadata and evidence versions, unlike the legal graph fingerprint.
    return bcLogicalHash({ graph: canonicalBcGraph(graph), metadata: graph.nodes.map(node => ({ id: node.id, metadata: node.metadata || {} })).sort((a,b) => a.id.localeCompare(b.id)) });
  }

  private async freezeReviewEvidence(db: Db, actor: Actor, rootId: string, graph: BcGraphInput) {
    for (const fact of [...graph.edges, ...graph.controls]) {
      const document = fact.evidence_document_id ? await this.authorizedSource(actor, rootId, fact.evidence_document_id, db) : null;
      fact.evidence_document_version = document ? complianceDocumentVersion(document) : null;
      fact.evidence_document_checksum = document?.checksum_sha256 || null;
    }
    return graph;
  }

  private async graph(db: Db, actor: Actor, structure: any) {
    const organizationId = actor.organizationId;
    const [nodes, edges, controls, reconciliations] = await Promise.all([
      db.personaMoralOwnershipNode.findMany({ where: { organization_id: organizationId, structure_id: structure.id },
        include: { linkedCompareciente: { include: { personaFisica: true, personaMoral: true } } }, orderBy: { id: 'asc' } }),
      db.personaMoralOwnershipEdge.findMany({ where: { organization_id: organizationId, structure_id: structure.id }, orderBy: { id: 'asc' } }),
      db.personaMoralControlFact.findMany({ where: { organization_id: organizationId, structure_id: structure.id }, orderBy: { id: 'asc' } }),
      db.personaMoralStructureReconciliation.findMany({ where: { organization_id: organizationId, structure_id: structure.id }, orderBy: { created_at: 'desc' } }),
    ]);
    await this.authorizeGraphIdentities(db, actor, { nodes: nodes.map(node => ({
      id: node.id, party_kind: node.party_kind, identity_mode: node.identity_mode,
      linked_compareciente_id: node.linked_compareciente_id, display_name: node.display_name,
      incomplete: node.incomplete, metadata: node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? node.metadata as Record<string, unknown> : {},
    })) });
    for (const reconciliation of reconciliations) {
      const branch = reconciliation.local_branch_snapshot as any;
      if (Array.isArray(branch?.nodes)) await this.authorizeGraphIdentities(db, actor, branch);
    }
    return {
      id: structure.id, root_node_id: structure.root_node_id, revision: structure.revision, fingerprint: structure.fingerprint,
      incomplete_markers: structure.incomplete_markers,
      nodes: nodes.map(({ linkedCompareciente, ...node }) => ({ ...node,
        canonical_label: linkedCompareciente?.personaFisica?.nombre_completo_calculado
          || linkedCompareciente?.personaMoral?.razon_social || linkedCompareciente?.nombre_busqueda || null })), edges,
      controls: controls.map(control => ({ ...control, human_confirmed: Boolean(control.confirmed_by_id && control.confirmed_at) })), reconciliations,
    };
  }

  async current(actor: Actor, comparecienteId: string) {
    need(actor, 'comparecientes.read'); need(actor, 'compliance.read');
    const root = await this.root(actor, comparecienteId);
    const structure = await this.db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: root.personaMoral!.id } });
    if (!structure) return { configured: false, revision: 0, fingerprint: null, incomplete_markers: ['EMPTY_STRUCTURE'], nodes: [], edges: [], controls: [], reconciliations: [] };
    const graph = await this.graph(this.db, actor, structure);
    const expanded = await this.expand(this.db, actor, structure);
    return { configured: true, ...graph, expanded, expanded_fingerprint: bcGraphFingerprint(expanded) };
  }

  /** Read a canonical PM recursively; only a derived projection, never a second current graph. */
  async expand(db: Db, actor: Actor, structure: any, path: string[] = []): Promise<BcGraphInput> {
    const current = await this.graph(db, actor, structure);
    const graph: BcGraphInput = { root_node_id: structure.root_node_id,
      nodes: current.nodes as any, edges: current.edges.map(edge => ({ ...edge, percentage: edge.percentage?.toString() ?? null })),
      controls: current.controls as any, incomplete_markers: [...(current.incomplete_markers as string[])].filter(marker =>
        !current.nodes.some(node => node.id !== structure.root_node_id && node.identity_mode === 'LINKED' && marker === `UNKNOWN_BRANCH:${node.id}`)) };
    const nextPath = [...path, structure.persona_moral_id];
    for (const node of [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      if (node.id === graph.root_node_id || node.party_kind !== 'PM' || node.identity_mode !== 'LINKED') continue;
      const linked = await db.compareciente.findFirst({ where: { AND: [
        { id: node.linked_compareciente_id!, organization_id: actor.organizationId, archived_at: null }, comparecienteObjectWhere(actor),
      ] }, include: { personaMoral: true } });
      // Current local edges may never override a linked canonical PM.
      graph.edges = graph.edges.filter(edge => edge.owned_node_id !== node.id);
      const pm = linked?.personaMoral;
      if (!pm || path.length >= 19 || nextPath.includes(pm.id)) {
        graph.incomplete_markers!.push(`CANONICAL_BRANCH_REQUIRES_REVIEW:${node.id}`); continue;
      }
      const child = await db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: pm.id } });
      if (!child) { graph.incomplete_markers!.push(`UNKNOWN_CANONICAL_BRANCH:${node.id}`); continue; }
      const expanded = await this.expand(db, actor, child, nextPath);
      const namespaced = (id: string) => {
        if (id === expanded.root_node_id) return node.id;
        const hash = bcLogicalHash({ parent: node.id, structure: child.id, id });
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      };
      graph.nodes.push(...expanded.nodes.filter(item => item.id !== expanded.root_node_id).map(item => ({ ...item, id: namespaced(item.id),
        source: { structure_id: child.id, node_id: item.id, persona_moral_id: pm.id } })));
      graph.edges.push(...expanded.edges.map(edge => ({ ...edge, id: namespaced(edge.id), owner_node_id: namespaced(edge.owner_node_id), owned_node_id: namespaced(edge.owned_node_id) })));
      graph.controls.push(...expanded.controls.map(control => ({ ...control, id: namespaced(control.id), subject_node_id: namespaced(control.subject_node_id) })));
      graph.incomplete_markers!.push(...(expanded.incomplete_markers || []).map(marker => `${node.id}/${marker}`));
    }
    graph.incomplete_markers = [...new Set([...graph.incomplete_markers!, ...validateBcGraph(graph).incomplete_markers])].sort();
    const projection = canonicalBcGraph(graph) as BcGraphInput;
    return { ...projection, nodes: projection.nodes.map(node => ({ ...node, canonical_label: graph.nodes.find(item => item.id === node.id)?.canonical_label || null })) };
  }

  async previewLinks(actor: Actor, comparecienteId: string, body: any, db: Db = this.db) {
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    const root = await this.root(actor, comparecienteId, db), graph = this.normalize(body);
    const current = await db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: root.personaMoral!.id } });
    const previous = current ? await this.graph(db, actor, current) : null;
    const previews = [];
    for (const node of graph.nodes.filter(node => node.identity_mode === 'LINKED' && node.id !== graph.root_node_id)) {
      const old = previous?.nodes.find(item => item.id === node.id);
      if (old?.linked_compareciente_id === node.linked_compareciente_id) continue;
      const linked = await db.compareciente.findFirst({ where: { AND: [
        { id: node.linked_compareciente_id!, organization_id: actor.organizationId, archived_at: null }, comparecienteObjectWhere(actor),
      ] }, include: { personaMoral: true, personaFisica: true } });
      if (!linked || (node.party_kind === 'PM' ? linked.tipo_persona !== 'MORAL' : linked.tipo_persona !== 'FISICA')) {
        throw new BeneficialControllerError(404, 'BC_LINK_NOT_AVAILABLE', 'El compareciente no está disponible.');
      }
      const target = linked.personaMoral ? await db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: linked.personaMoral.id } }) : null;
      const identity = { id: linked.id, nombre: linked.personaFisica?.nombre_completo_calculado || linked.personaMoral?.razon_social || linked.nombre_busqueda, tipo_persona: linked.tipo_persona };
      previews.push({ node_id: node.id, before: old || null, canonical_identity: identity,
        target_structure_revision: target?.revision || 0, target_fingerprint: target?.fingerprint || null,
        confirmation: bcLogicalHash({ node_id: node.id, source_fingerprint: current?.fingerprint || null,
          identity, target_fingerprint: target?.fingerprint || null }) });
    }
    return previews;
  }

  private normalize(body: any): BcGraphInput {
    if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.edges) || !Array.isArray(body.controls)) {
      throw new BeneficialControllerError(400, 'BC_GRAPH_REQUIRED', 'La estructura de propiedad y control no es válida.');
    }
    return {
      root_node_id: body.root_node_id,
      nodes: body.nodes.map((node: any) => ({
        id: String(node.id || ''), party_kind: node.party_kind, identity_mode: node.identity_mode,
        linked_compareciente_id: node.linked_compareciente_id || null, display_name: node.display_name || null,
        incomplete: Boolean(node.incomplete), metadata: node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata) ? node.metadata : {},
      })),
      edges: body.edges.map((edge: any) => ({
        id: String(edge.id || ''), owner_node_id: String(edge.owner_node_id || ''), owned_node_id: String(edge.owned_node_id || ''),
        percentage: edge.percentage === '' ? null : edge.percentage ?? null, evidence_document_id: edge.evidence_document_id || null,
        evidence_document_version: edge.evidence_document_version || null, evidence_document_checksum: edge.evidence_document_checksum || null,
      })),
      controls: body.controls.map((fact: any) => ({
        id: String(fact.id || ''), subject_node_id: String(fact.subject_node_id || ''), kind: fact.kind,
        description: fact.description || null, evidence_document_id: fact.evidence_document_id || null,
        human_confirmed: fact.human_confirmed === true,
        evidence_document_version: fact.evidence_document_version || null, evidence_document_checksum: fact.evidence_document_checksum || null,
      })),
    } as BcGraphInput;
  }

  async save(actor: Actor, comparecienteId: string, body: any, transaction?: Prisma.TransactionClient) {
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    const root = await this.root(actor, comparecienteId, transaction || this.db);
    const graph = this.normalize(body);
    const validation = validateBcGraph(graph, root.id);
    if (validation.hard_errors.length) throw new BeneficialControllerError(422, 'BC_GRAPH_INVALID', `La estructura contiene errores: ${validation.hard_errors.join(', ')}`);
    const expectedRevision = Number(body.expected_revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new BeneficialControllerError(400, 'BC_EXPECTED_REVISION_REQUIRED', 'Debes indicar la revisión que estás editando.');
    const requestHash = bcLogicalHash({ graph, expectedRevision, identity_confirmations: body.identity_confirmations || {} });
    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (!idempotencyKey) throw new BeneficialControllerError(400, 'BC_IDEMPOTENCY_REQUIRED', 'La clave de idempotencia es obligatoria.');

    const operation = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h4:structure:${actor.organizationId}:${root.personaMoral!.id}`);
      const previousAudit = await tx.auditLog.findFirst({ where: { organization_id: actor.organizationId, accion: 'BC_STRUCTURE_SAVED', entidad_id: root.personaMoral!.id, detalles: { path: ['idempotency_key'], equals: idempotencyKey } } });
      if (previousAudit) {
        if ((previousAudit.detalles as any)?.request_hash !== requestHash) throw new BeneficialControllerError(409, 'BC_IDEMPOTENCY_CONFLICT', 'La clave corresponde a otra edición.');
        const existing = await tx.personaMoralOwnershipStructure.findFirstOrThrow({ where: { organization_id: actor.organizationId, persona_moral_id: root.personaMoral!.id } });
        return { idempotent: true, ...(await this.graph(tx, actor, existing)) };
      }
      const current = await tx.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: root.personaMoral!.id } });
      if ((current?.revision || 0) !== expectedRevision) throw new BeneficialControllerError(409, 'BC_REVISION_CONFLICT', 'La estructura cambió mientras la editabas. Recárgala antes de continuar.');

      const linkedIds = graph.nodes.filter((node) => node.identity_mode === 'LINKED').map((node) => node.linked_compareciente_id!).filter(Boolean);
      const linked = linkedIds.length ? await tx.compareciente.findMany({ where: { AND: [
        { organization_id: actor.organizationId, id: { in: linkedIds }, archived_at: null },
        comparecienteObjectWhere(actor),
      ] }, include: { personaMoral: true } }) : [];
      if (linked.length !== new Set(linkedIds).size) throw new BeneficialControllerError(422, 'BC_LINKED_PARTY_NOT_FOUND', 'Uno de los comparecientes vinculados no pertenece a tu organización.');
      const linkedMap = new Map(linked.map((item) => [item.id, item]));
      for (const node of graph.nodes) {
        if (node.identity_mode !== 'LINKED') continue;
        const party = linkedMap.get(node.linked_compareciente_id!);
        const expected = node.party_kind === 'PF' ? 'FISICA' : 'MORAL';
        if (party?.tipo_persona !== expected) throw new BeneficialControllerError(422, 'BC_LINKED_PARTY_KIND_MISMATCH', 'El tipo del nodo no coincide con el compareciente vinculado.');
      }
      const previews = await this.previewLinks(actor, comparecienteId, body, tx);
      if (previews.some(preview => body.identity_confirmations?.[preview.node_id] !== preview.confirmation)) {
        throw new BeneficialControllerError(409, 'BC_IDENTITY_CONFIRMATION_REQUIRED', 'Revisa y confirma la identidad canónica antes de vincular.');
      }
      const oldGraph = current ? await this.graph(tx, actor, current) : null;
      const reconciliationDrafts: Array<any> = [];
      for (const preview of previews) {
        const node = graph.nodes.find(item => item.id === preview.node_id)!;
        const linkedPm = linkedMap.get(node.linked_compareciente_id!)?.personaMoral;
        if (!linkedPm || !oldGraph) continue;
        const ancestors = new Set<string>([node.id]);
        let grew = true;
        while (grew) { grew = false; for (const edge of oldGraph.edges) if (ancestors.has(edge.owned_node_id) && !ancestors.has(edge.owner_node_id) && edge.owner_node_id !== graph.root_node_id) { ancestors.add(edge.owner_node_id); grew = true; } }
        const localEdges = oldGraph.edges.filter(edge => ancestors.has(edge.owned_node_id));
        if (!localEdges.length) continue;
        reconciliationDrafts.push({ linked_persona_moral_id: linkedPm.id, source_node_id: node.id,
          source_revision: current!.revision, source_fingerprint: current!.fingerprint,
          target_revision: preview.target_structure_revision, canonical_fingerprint: preview.target_fingerprint || bcLogicalHash({ empty: linkedPm.id }),
          local_branch_snapshot: asJson({ root_node_id: node.id, nodes: oldGraph.nodes.filter(item => ancestors.has(item.id)),
            edges: localEdges, controls: oldGraph.controls.filter(item => ancestors.has(item.subject_node_id)), actor_id: actor.id,
            source_root: root.id, target_pm: linkedPm.id, semantic_diff: preview }) });
        graph.edges = graph.edges.filter(edge => !localEdges.some(old => old.id === edge.id));
        const removable = new Set([...ancestors].filter(id => id !== node.id && !graph.edges.some(edge => edge.owner_node_id === id || edge.owned_node_id === id)));
        graph.nodes = graph.nodes.filter(item => !removable.has(item.id));
        graph.controls = graph.controls.filter(item => !removable.has(item.subject_node_id));
      }

      const evidenceIds = [...new Set([...graph.edges.map((item) => item.evidence_document_id), ...graph.controls.map((item) => item.evidence_document_id)].filter(Boolean) as string[])];
      if (evidenceIds.length) need(actor, 'documentos.read');
      const documents = evidenceIds.length ? await tx.documento.findMany({ where: { organization_id: actor.organizationId, id: { in: evidenceIds } }, include: {
        comparecienteVinculos: { where: { organization_id: actor.organizationId, estatus: 'ACTIVO', archived_at: null } },
      } }) : [];
      if (documents.length !== evidenceIds.length || documents.some((document) => !document.checksum_sha256)) throw new BeneficialControllerError(422, 'BC_EVIDENCE_NOT_RESOLVABLE', 'La evidencia debe ser un documento auténtico, resoluble y con checksum.');
      for (const document of documents) {
        // Access to a file and permission to use it for this target are distinct.
        const exactTarget = document.compareciente_id === root.id
          || document.comparecienteVinculos.some((link) => link.compareciente_id === root.id);
        if (!exactTarget || !(await canAccessDocumento(actor, document.id))) {
          throw new BeneficialControllerError(404, 'BC_EVIDENCE_NOT_AVAILABLE', 'La evidencia no está disponible para esta persona moral.');
        }
      }
      const documentMap = new Map(documents.map((document) => [document.id, document]));
      for (const fact of [...graph.edges, ...graph.controls]) {
        const document = fact.evidence_document_id ? documentMap.get(fact.evidence_document_id) : undefined;
        fact.evidence_document_version = document ? complianceDocumentVersion(document) : null;
        fact.evidence_document_checksum = document?.checksum_sha256 || null;
      }
      const finalValidation = validateBcGraph(graph, root.id);
      if (finalValidation.hard_errors.length) throw new BeneficialControllerError(422, 'BC_GRAPH_INVALID', `La conciliación produjo una estructura inválida: ${finalValidation.hard_errors.join(', ')}`);
      graph.incomplete_markers = finalValidation.incomplete_markers;
      const fingerprint = bcGraphFingerprint(graph);
      if (current?.fingerprint === fingerprint) return { idempotent: true, ...(await this.graph(tx, actor, current)) };

      const structure = current
        ? await tx.personaMoralOwnershipStructure.update({ where: { id: current.id }, data: { root_node_id: graph.root_node_id!, revision: current.revision + 1, fingerprint, incomplete_markers: asJson(finalValidation.incomplete_markers), updated_by_id: actor.id } })
        : await tx.personaMoralOwnershipStructure.create({ data: { organization_id: actor.organizationId, persona_moral_id: root.personaMoral!.id, root_node_id: graph.root_node_id!, revision: 1, fingerprint, incomplete_markers: asJson(finalValidation.incomplete_markers), created_by_id: actor.id, updated_by_id: actor.id } });
      if (current) {
        await tx.personaMoralControlFact.deleteMany({ where: { organization_id: actor.organizationId, structure_id: structure.id } });
        await tx.personaMoralOwnershipEdge.deleteMany({ where: { organization_id: actor.organizationId, structure_id: structure.id } });
        await tx.personaMoralOwnershipNode.deleteMany({ where: { organization_id: actor.organizationId, structure_id: structure.id } });
      }
      await tx.personaMoralOwnershipNode.createMany({ data: graph.nodes.map((node) => ({
        id: node.id, organization_id: actor.organizationId, structure_id: structure.id, party_kind: node.party_kind,
        identity_mode: node.identity_mode, linked_compareciente_id: node.linked_compareciente_id || null,
        display_name: node.identity_mode === 'STRUCTURED_ONLY' ? node.display_name!.trim() : null,
        incomplete: Boolean(node.incomplete), metadata: asJson(node.metadata || {}),
      })) });
      if (graph.edges.length) await tx.personaMoralOwnershipEdge.createMany({ data: graph.edges.map((edge) => {
        const document = edge.evidence_document_id ? documentMap.get(edge.evidence_document_id) : null;
        return { id: edge.id, organization_id: actor.organizationId, structure_id: structure.id, owner_node_id: edge.owner_node_id,
          owned_node_id: edge.owned_node_id, percentage: edge.percentage == null ? null : String(edge.percentage),
          evidence_document_id: document?.id || null, evidence_document_version: document ? complianceDocumentVersion(document) : null,
          evidence_document_checksum: document?.checksum_sha256 || null, confirmed_by_id: document ? actor.id : null, confirmed_at: document ? new Date() : null };
      }) });
      if (graph.controls.length) await tx.personaMoralControlFact.createMany({ data: graph.controls.map((fact) => {
        const document = fact.evidence_document_id ? documentMap.get(fact.evidence_document_id) : null;
        return { id: fact.id, organization_id: actor.organizationId, structure_id: structure.id, subject_node_id: fact.subject_node_id,
          kind: fact.kind, description: fact.description || null, evidence_document_id: document?.id || null,
          evidence_document_version: document ? complianceDocumentVersion(document) : null, evidence_document_checksum: document?.checksum_sha256 || null,
          confirmed_by_id: document && fact.human_confirmed ? actor.id : null, confirmed_at: document && fact.human_confirmed ? new Date() : null };
      }) });

      for (const draft of reconciliationDrafts) {
        const proposal = await tx.personaMoralStructureReconciliation.create({ data: { organization_id: actor.organizationId, structure_id: structure.id, ...draft } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'BC_PM_RECONCILIATION_PROPOSED', entidad: 'PersonaMoralStructureReconciliation', entidad_id: proposal.id, detalles: asJson(draft) } });
      }
      for (const preview of previews) {
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
          accion: preview.canonical_identity.tipo_persona === 'FISICA' ? 'BC_PF_IDENTITY_CONFIRMED' : 'BC_PM_IDENTITY_CONFIRMED',
          entidad: 'PersonaMoral', entidad_id: root.personaMoral!.id, detalles: asJson(preview) } });
      }
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'BC_STRUCTURE_SAVED', entidad: 'PersonaMoral', entidad_id: root.personaMoral!.id, detalles: asJson({ idempotency_key: idempotencyKey, request_hash: requestHash, revision: structure.revision, fingerprint, warnings: finalValidation.warnings, incomplete_markers: finalValidation.incomplete_markers,
        evidence_before: oldGraph ? [...oldGraph.edges, ...oldGraph.controls].filter(item => item.evidence_document_id) : [], evidence_after: [...graph.edges, ...graph.controls].filter(item => item.evidence_document_id) }) } });
      return { idempotent: false, validation: finalValidation, ...(await this.graph(tx, actor, structure)) };
    };
    return transaction ? operation(transaction) : this.db.$transaction(operation, { isolationLevel: 'Serializable' });
  }

  async decideReconciliation(actor: Actor, comparecienteId: string, proposalId: string, body: any) {
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    const root = await this.root(actor, comparecienteId);
    if (!['ACCEPTED', 'REJECTED'].includes(body.decision)) throw new BeneficialControllerError(400, 'BC_DECISION_REQUIRED', 'Selecciona una decisión.');
    return this.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h4:reconciliation:${actor.organizationId}:${proposalId}`);
      const proposal = await tx.personaMoralStructureReconciliation.findFirst({ where: { id: proposalId, organization_id: actor.organizationId,
        structure: { persona_moral_id: root.personaMoral!.id } }, include: { linkedPersonaMoral: true } });
      if (!proposal) throw new BeneficialControllerError(404, 'BC_PROPOSAL_NOT_FOUND', 'La propuesta no está disponible.');
      if (proposal.status !== 'PENDING') return proposal;
      if (body.decision === 'ACCEPTED') {
        const preview = await this.previewReconciliation(actor, comparecienteId, proposalId, tx);
        if (body.review_token !== preview.review_token || !body.graph
          || this.reviewToken(this.normalize(body.graph)) !== this.reviewToken(this.normalize(preview.proposed))) {
          throw new BeneficialControllerError(409, 'BC_RECONCILIATION_REVIEW_REQUIRED', 'Revisa y confirma los cambios concretos antes de incorporarlos.');
        }
        const saved = await this.save(actor, proposal.linkedPersonaMoral.compareciente_id, { ...preview.proposed,
          expected_revision: proposal.target_revision, identity_confirmations: preview.identity_confirmations,
          idempotency_key: `reconciliation:${proposal.id}` }, tx);
        if (saved.idempotent) throw new BeneficialControllerError(409, 'BC_RECONCILIATION_NO_CHANGE', 'La propuesta no produjo cambios; no se ha marcado como incorporada.');
      }
      const decided = await tx.personaMoralStructureReconciliation.update({ where: { id: proposal.id }, data: {
        status: body.decision, decided_by_id: actor.id, decided_at: new Date(),
      } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'BC_PM_RECONCILIATION_DECIDED',
        entidad: 'PersonaMoralStructureReconciliation', entidad_id: proposal.id, detalles: asJson({ decision: body.decision, target_pm: proposal.linked_persona_moral_id }) } });
      return decided;
    }, { isolationLevel: 'Serializable' });
  }

  async previewReconciliation(actor: Actor, comparecienteId: string, proposalId: string, db: Db = this.db) {
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    const root = await this.root(actor, comparecienteId, db);
    const proposal = await db.personaMoralStructureReconciliation.findFirst({ where: { id: proposalId, organization_id: actor.organizationId,
      structure: { persona_moral_id: root.personaMoral!.id }, status: 'PENDING' }, include: { linkedPersonaMoral: true } });
    if (!proposal) throw new BeneficialControllerError(404, 'BC_PROPOSAL_NOT_FOUND', 'La propuesta no está disponible.');
    const linked = await this.root(actor, proposal.linkedPersonaMoral.compareciente_id, db);
    const target = await db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: linked.personaMoral!.id } });
    if ((target?.revision || 0) !== proposal.target_revision
      || (target?.fingerprint || bcLogicalHash({ empty: linked.personaMoral!.id })) !== proposal.canonical_fingerprint) {
      throw new BeneficialControllerError(409, 'BC_RECONCILIATION_STALE', 'La estructura canónica cambió; revisa de nuevo.');
    }
    const local = this.normalize(proposal.local_branch_snapshot);
    await this.authorizeGraphIdentities(db, actor, local);
    const rootHash = bcLogicalHash({ proposal_id: proposal.id, target_root: true });
    const targetRootId = `${rootHash.slice(0, 8)}-${rootHash.slice(8, 12)}-5${rootHash.slice(13, 16)}-a${rootHash.slice(17, 20)}-${rootHash.slice(20, 32)}`;
    const current = target ? await this.graph(db, actor, target) : {
      root_node_id: targetRootId, nodes: [{ id: targetRootId, party_kind: 'PM' as const, identity_mode: 'LINKED' as const,
        linked_compareciente_id: linked.id, canonical_label: linked.personaMoral!.razon_social }], edges: [], controls: [],
    };
    const currentGraph = this.normalize(current);
    const proposed = bcReconciliationGraph(local, currentGraph, proposal.id);
    await this.authorizeGraphIdentities(db, actor, proposed);
    await this.freezeReviewEvidence(db, actor, linked.id, proposed);
    const links = await this.previewLinks(actor, linked.id, proposed, db);
    const identity_confirmations = Object.fromEntries(links.map(item => [item.node_id, item.confirmation]));
    return { local: await this.labelGraph(db, actor, local), current: await this.labelGraph(db, actor, currentGraph), proposed: await this.labelGraph(db, actor, proposed), identity_confirmations,
      review_token: bcLogicalHash({ proposal_id: proposal.id, local: this.reviewToken(local), current: this.reviewToken(currentGraph),
        proposed: this.reviewToken(proposed), identity_confirmations }) };
  }

  private async authorizedSource(actor: Actor, comparecienteId: string, documentId: string, db: Db = this.db) {
    need(actor, 'documentos.read');
    if (!isBcUuid(documentId)) throw new BeneficialControllerError(400, 'BC_INVALID_ID', 'El identificador no es válido.');
    await this.root(actor, comparecienteId, db);
    const document = await db.documento.findFirst({ where: { id: documentId, organization_id: actor.organizationId }, include: {
      comparecienteVinculos: { where: { organization_id: actor.organizationId, compareciente_id: comparecienteId, estatus: 'ACTIVO', archived_at: null } },
    } });
    if (!document?.checksum_sha256 || (document.compareciente_id !== comparecienteId && !document.comparecienteVinculos.length)
      || !await canAccessDocumento(actor, documentId)) throw new BeneficialControllerError(404, 'BC_EVIDENCE_NOT_AVAILABLE', 'La evidencia no está disponible para esta persona moral.');
    return document;
  }

  async proposeAi(actor: Actor, comparecienteId: string, body: any) {
    need(actor, 'ia.execute'); need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    const root = await this.root(actor, comparecienteId);
    const structure = await this.db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: root.personaMoral!.id } });
    if (!structure) throw new BeneficialControllerError(409, 'BC_STRUCTURE_REQUIRED', 'Guarda la estructura inicial antes de preparar una propuesta.');
    const document = await this.authorizedSource(actor, comparecienteId, body.document_id);
    const buffer = await downloadFile(document.storage_key);
    if (createHash('sha256').update(buffer).digest('hex') !== document.checksum_sha256) throw new BeneficialControllerError(409, 'BC_SOURCE_CHANGED', 'El archivo no coincide con la versión documental registrada.');
    const base = await this.graph(this.db, actor, structure);
    const proposalId = randomUUID();
    const generated = await generateOperationalArtifactWithOpenAI({ purpose: 'OWNERSHIP_PROPOSAL', artifactName: 'Propuesta de estructura',
      masterText: 'Devuelve en content un JSON con graph (root_node_id, nodes, edges, controls) y source_pages. Conserva raíz e IDs existentes. Nuevos nodos: UUID, party_kind PF/PM, identity_mode STRUCTURED_ONLY, display_name. No crees vínculos a comparecientes. Porcentajes como strings, desconocidos null; no normalices ni supongas porcentajes. Controles VOTE/APPOINTMENT/MANAGEMENT/AGREEMENT/OTHER. Incluye sólo hechos expresos. source_pages: páginas enteras positivas comprobadas o []. Nunca inventes páginas, identidades o hechos.',
      structuredData: { current_graph: canonicalBcGraph(base as any) }, currentPartyDocuments: [],
      sourceDocument: { buffer, mimeType: document.mime_type, documentoId: document.id, nombreOriginal: document.nombre_original, tipoDocumento: document.tipo },
    });
    // Charge tracking survives a rejected/malformed proposal; no second ledger.
    await recordAIUsageInDb(this.db, generated.usage, { organizationId: actor.organizationId, usuarioId: actor.id,
      operacion: 'H4_OWNERSHIP_PROPOSAL', operationId: `h4:proposal:${proposalId}`, metadata: { source_document_id: document.id, structure_id: structure.id } });
    let parsed: any;
    try { parsed = JSON.parse(generated.content); } catch { throw new BeneficialControllerError(422, 'BC_AI_PROPOSAL_INVALID', 'La propuesta no tiene un formato revisable.'); }
    const graph = this.normalize(parsed.graph);
    await this.freezeReviewEvidence(this.db, actor, comparecienteId, graph);
    // An AI proposal is not a human assertion about control.
    for (const fact of graph.controls) fact.human_confirmed = false;
    if (graph.root_node_id !== structure.root_node_id || graph.nodes.some(node => node.identity_mode === 'LINKED'
      && !base.nodes.some(old => old.id === node.id && old.linked_compareciente_id === node.linked_compareciente_id))) {
      throw new BeneficialControllerError(422, 'BC_AI_IDENTITY_OUTSIDE_SOURCES', 'La propuesta contiene una identidad fuera de las fuentes autorizadas.');
    }
    const pages = Array.isArray(parsed.source_pages) ? [...new Set(parsed.source_pages.filter((page: unknown) => Number.isInteger(page) && Number(page) > 0))] : [];
    return this.db.$transaction(async tx => {
      const proposal = await tx.complianceBcAiProposal.create({ data: { id: proposalId, organization_id: actor.organizationId,
        structure_id: structure.id, source_document_id: document.id, source_document_version: complianceDocumentVersion(document), source_document_checksum: document.checksum_sha256!,
        source_pages: asJson(pages), base_revision: structure.revision, base_fingerprint: structure.fingerprint,
        proposed_changes: asJson({ graph, validation: validateBcGraph(graph, root.id), missing_fields: generated.missing_fields, conflicts: generated.conflicts }),
        provider: 'OPENAI', model: generated.model, prompt_version: 'H4-OWNERSHIP-PROPOSAL-1', created_by_id: actor.id } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'BC_AI_PROPOSED',
        entidad: 'ComplianceBcAiProposal', entidad_id: proposal.id, detalles: asJson({ base_fingerprint: structure.fingerprint, source_document_id: document.id }) } });
      await this.authorizeGraphIdentities(tx, actor, graph);
      return { ...proposal, proposed_changes: { ...(proposal.proposed_changes as any), graph: await this.labelGraph(tx, actor, graph) }, review_token: this.reviewToken(graph) };
    });
  }

  async readAi(actor: Actor, comparecienteId: string, proposalId: string) {
    need(actor, 'comparecientes.read'); need(actor, 'compliance.read');
    const root = await this.root(actor, comparecienteId);
    const proposal = await this.db.complianceBcAiProposal.findFirst({ where: { id: proposalId, organization_id: actor.organizationId,
      structure: { persona_moral_id: root.personaMoral!.id } } });
    if (!proposal) throw new BeneficialControllerError(404, 'BC_PROPOSAL_NOT_FOUND', 'La propuesta no está disponible.');
    await this.authorizedSource(actor, comparecienteId, proposal.source_document_id);
    const graph = this.normalize((proposal.proposed_changes as any).graph);
    await this.authorizeGraphIdentities(this.db, actor, graph);
    return { ...proposal, proposed_changes: { ...(proposal.proposed_changes as any), graph: await this.labelGraph(this.db, actor, graph) }, review_token: this.reviewToken(graph) };
  }

  async decideAi(actor: Actor, comparecienteId: string, proposalId: string, body: any) {
    need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    if (!['CONFIRMED', 'REJECTED'].includes(body.decision)) throw new BeneficialControllerError(400, 'BC_DECISION_REQUIRED', 'Selecciona una decisión.');
    await this.root(actor, comparecienteId);
    const result = await this.db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h4:ai:${actor.organizationId}:${proposalId}`);
      const proposal = await tx.complianceBcAiProposal.findFirst({ where: { id: proposalId, organization_id: actor.organizationId,
        structure: { personaMoral: { compareciente_id: comparecienteId } } } });
      if (!proposal) throw new BeneficialControllerError(404, 'BC_PROPOSAL_NOT_FOUND', 'La propuesta no está disponible.');
      if (proposal.status !== 'PENDING') return { stale: proposal.status === 'CONFLICT', proposal };
      if (body.decision === 'CONFIRMED') {
        const source = await this.authorizedSource(actor, comparecienteId, proposal.source_document_id, tx);
        const current = await tx.personaMoralOwnershipStructure.findFirstOrThrow({ where: { id: proposal.structure_id, organization_id: actor.organizationId } });
        if (current.fingerprint !== proposal.base_fingerprint || current.revision !== proposal.base_revision
          || complianceDocumentVersion(source) !== proposal.source_document_version || source.checksum_sha256 !== proposal.source_document_checksum) {
          const stale = await tx.complianceBcAiProposal.update({ where: { id: proposal.id }, data: { status: 'CONFLICT', decided_by_id: actor.id, decided_at: new Date() } });
          await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'BC_AI_STALE_CONFLICT',
            entidad: 'ComplianceBcAiProposal', entidad_id: proposal.id, detalles: asJson({ base_fingerprint: proposal.base_fingerprint, current_fingerprint: current.fingerprint }) } });
          return { stale: true, proposal: stale };
        }
        const graph = this.normalize((proposal.proposed_changes as any).graph);
        if (!body.graph || body.review_token !== this.reviewToken(graph)
          || this.reviewToken(this.normalize(body.graph)) !== body.review_token) {
          throw new BeneficialControllerError(409, 'BC_AI_REVIEW_REQUIRED', 'Confirma exactamente la propuesta revisada o corrígela en el editor canónico.');
        }
        const refreshed = await this.freezeReviewEvidence(tx, actor, comparecienteId, this.normalize(graph));
        if (this.reviewToken(refreshed) !== body.review_token) throw new BeneficialControllerError(409, 'BC_AI_STALE', 'La evidencia cambió. Prepara y revisa otra propuesta.');
        await this.save(actor, comparecienteId, { ...graph, identity_confirmations: body.identity_confirmations,
          expected_revision: proposal.base_revision, idempotency_key: `ai:${proposal.id}` }, tx);
      }
      const decided = await tx.complianceBcAiProposal.update({ where: { id: proposal.id }, data: { status: body.decision === 'CONFIRMED' ? 'ACCEPTED' : 'REJECTED', decided_by_id: actor.id, decided_at: new Date() } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: `BC_AI_${body.decision}`,
        entidad: 'ComplianceBcAiProposal', entidad_id: proposal.id, detalles: asJson({ source_document_id: proposal.source_document_id }) } });
      return { stale: false, proposal: decided };
    }, { isolationLevel: 'Serializable' });
    if (result.stale) throw new BeneficialControllerError(409, 'BC_AI_STALE', 'La estructura o el documento cambiaron. Prepara y revisa otra propuesta.');
    return result.proposal;
  }

  async caseSummary(actor: Actor, expedienteId: string) {
    need(actor, 'compliance.read');
    need(actor, 'comparecientes.read');
    const expediente = await this.db.expediente.findFirst({ where: { AND: [{ id: expedienteId, organization_id: actor.organizationId }, expedienteAccessWhere(actor)] } });
    if (!expediente) throw new BeneficialControllerError(404, 'BC_CASE_NOT_FOUND', 'Expediente no encontrado.');
    const state = await this.db.expedienteComplianceState.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId } });
    const all = await this.db.complianceBcEvaluation.findMany({ where: { organization_id: actor.organizationId, expediente_id: expedienteId },
      include: { results: true, snapshot: true }, orderBy: [{ created_at: 'desc' }, { regime: 'asc' }] });
    const projected = [];
    for (const item of all) {
      const graph = item.snapshot.graph_snapshot as unknown as BcGraphInput;
      await this.authorizeGraphIdentities(this.db, actor, graph);
      const labeled = await this.labelGraph(this.db, actor, graph);
      const root = labeled.nodes.find(node => node.id === graph.root_node_id);
      const structure_path = root?.linked_compareciente_id ? `/comparecientes/${encodeURIComponent(root.linked_compareciente_id)}` : null;
      const supports = [];
      if (actor.permissions.includes('documentos.read')) for (const documentId of new Set([...graph.edges, ...graph.controls].map(fact => fact.evidence_document_id).filter(Boolean))) {
        if (!await canAccessDocumento(actor, documentId!)) continue;
        const document = await this.db.documento.findFirst({ where: { id: documentId!, organization_id: actor.organizationId }, include: {
          comparecienteVinculos: { where: { organization_id: actor.organizationId, estatus: 'ACTIVO', archived_at: null } },
        } });
        if (document && structure_path && (document.compareciente_id === root?.linked_compareciente_id || document.comparecienteVinculos.some(link => link.compareciente_id === root?.linked_compareciente_id))) {
          supports.push({ document_id: document.id, label: document.nombre_original, path: structure_path });
        }
      }
      projected.push({ ...item, structure_path, target_name: root?.canonical_label || root?.display_name || 'Entidad analizada', supports,
        results: item.results.map(result => {
          const node = labeled.nodes.find(node => result.subject_compareciente_id ? node.linked_compareciente_id === result.subject_compareciente_id : node.id === result.subject_snapshot_node_id);
          return { ...result, subject_name: node?.canonical_label || node?.display_name || 'Identidad pendiente de revisión',
            subject_path: node?.linked_compareciente_id ? `/comparecientes/${encodeURIComponent(node.linked_compareciente_id)}` : null };
        }) });
    }
    const evaluations = projected.filter(item => item.review_id === state?.current_review_id);
    const evaluated = [];
    for (const item of evaluations) {
      const structure = await this.db.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: item.target_persona_moral_id } });
      const fingerprint = structure ? bcGraphFingerprint(await this.expand(this.db, actor, structure)) : null;
      const revisions = item.legal_date ? selectEffectiveRuleRevisions(await this.db.complianceLegalRuleRevision.findMany({ where: {
        organization_id: actor.organizationId, status: { in: ['ACTIVE', 'RETIRED'] }, effective_from: { lte: item.legal_date },
        OR: [{ effective_to: null }, { effective_to: { gte: item.legal_date } }], outcome: { path: ['bc', 'regime'], equals: item.regime },
      } })) : [];
      const rules = revisions.map(rule => ({ id: rule.id, rule_id: rule.rule_id, version: rule.version, checksum: rule.checksum }));
      const storedRules = (item.input_snapshot as any)?.rules || [];
      evaluated.push({ ...item, reevaluation_required: fingerprint !== item.snapshot.structure_fingerprint || bcLogicalHash(rules) !== bcLogicalHash(storedRules) });
    }
    return { current_review_id: state?.current_review_id || null, evaluations: evaluated,
      history: projected.filter(item => item.review_id !== state?.current_review_id),
      snapshots: evaluations.map(item => item.snapshot), legacy_promoted: false,
      configured_legal_rules: evaluations.length > 0 && evaluations.every(item => Boolean(item.rule_set_checksum)) };
  }

  static societyOpeningStatus() {
    // Frozen CUM-MAT-002 detection remains legally unconfigured. Never infer from a label.
    return { status: 'NOT_CONFIGURED' as const, automatic_creation: false, action: 'EXPLICIT_TARGET_REVIEW' as const };
  }

  async ensureSociety(actor: Actor, expedienteId: string, body: any) {
    need(actor, 'expedientes.write'); need(actor, 'comparecientes.write'); need(actor, 'compliance.write');
    const actId = body.expediente_acto_id || null;
    const intent = String(body.target_intent || '').trim();
    if (!intent || intent.length > 160 || (actId && !isBcUuid(actId)) || Boolean(body.compareciente_id) === Boolean(body.create_persona_moral)) {
      throw new BeneficialControllerError(400, 'BC_SOCIETY_EXPLICIT_TARGET_REQUIRED', 'Selecciona una persona moral o confirma su creación, e indica el propósito del vínculo.');
    }
    const key = bcLogicalHash({ organization_id: actor.organizationId, expediente_id: expedienteId, act_id: actId, intent });
    return this.db.$transaction(async tx => {
      const expediente = await tx.expediente.findFirst({ where: { AND: [{ id: expedienteId, organization_id: actor.organizationId, archived_at: null }, expedienteAccessWhere(actor)] } });
      if (!expediente) throw new BeneficialControllerError(404, 'BC_CASE_NOT_FOUND', 'Expediente no encontrado.');
      if (actId && !await tx.expedienteActo.findFirst({ where: { id: actId, expediente_id: expedienteId, organization_id: actor.organizationId, estatus: 'ACTIVO', removed_at: null } })) throw new BeneficialControllerError(404, 'BC_ACT_NOT_FOUND', 'El acto no pertenece al expediente.');
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h4:society:${key}`);
      const existing = await tx.expedienteSocietyTarget.findFirst({ where: { organization_id: actor.organizationId, target_intent_key: key }, include: { personaMoral: true } });
      if (existing) {
        if (body.compareciente_id && existing.personaMoral.compareciente_id !== body.compareciente_id) throw new BeneficialControllerError(409, 'BC_SOCIETY_INTENT_CONFLICT', 'El propósito ya corresponde a otra sociedad.');
        await this.root(actor, existing.personaMoral.compareciente_id, tx);
        return { ...existing, idempotent: true };
      }
      let pm;
      if (body.compareciente_id) pm = (await this.root(actor, body.compareciente_id, tx)).personaMoral!;
      else {
        if (body.confirm_create !== true) throw new BeneficialControllerError(409, 'BC_SOCIETY_CONFIRMATION_REQUIRED', 'Confirma explícitamente la creación.');
        const draft = body.create_persona_moral;
        const created = await new ComparecienteService(this.db).crearPersonaMoral({ razon_social: draft.razon_social,
          rfc: draft.rfc, tipo_societario: draft.tipo_societario, estatus_societario: 'EN_CONSTITUCION', creado_por_id: actor.id }, tx);
        pm = created.personaMoral;
      }
      const target = await tx.expedienteSocietyTarget.create({ data: { organization_id: actor.organizationId, expediente_id: expedienteId,
        expediente_acto_id: actId, persona_moral_id: pm.id, target_intent_key: key,
        status: ['EN_CONSTITUCION', 'CONSTITUIDA'].includes(pm.estatus_societario || '') ? pm.estatus_societario! : 'PENDING_REVIEW',
        applicability_status: 'NOT_CONFIGURED', created_by_id: actor.id } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'BC_SOCIETY_TARGET_ENSURED',
        entidad: 'ExpedienteSocietyTarget', entidad_id: target.id, detalles: asJson({ expediente_id: expedienteId, expediente_acto_id: actId, persona_moral_id: pm.id, explicit: true }) } });
      return { ...target, idempotent: false };
    }, { isolationLevel: 'Serializable' });
  }

  async formatPort(actor: Actor, expedienteId: string, requirementId: string) {
    need(actor, 'compliance.read'); need(actor, 'documentos.read');
    const requirement = await ComplianceDocumentService.assertRequirement(this.db, actor, expedienteId, requirementId);
    if (requirement.document_category !== 'BENEFICIARIO_CONTROLADOR') throw new BeneficialControllerError(404, 'BC_FORMAT_REQUIREMENT_NOT_FOUND', 'El requisito no corresponde a beneficiario controlador.');
    const party = requirement.target_compareciente_id ? await this.db.compareciente.findFirst({ where: { AND: [
      { id: requirement.target_compareciente_id, organization_id: actor.organizationId, archived_at: null }, comparecienteObjectWhere(actor),
    ] }, include: { personaMoral: true } }) : null;
    const key = party?.tipo_persona === 'FISICA' ? 'PF' : party?.personaMoral ? (party.personaMoral.estatus_societario === 'EN_CONSTITUCION' ? 'NEW_PM' : 'EXISTING_PM') : null;
    const mapping = key ? await this.db.complianceBcFormatMapping.findFirst({ where: { organization_id: actor.organizationId, format_key: key, status: 'CONFIGURED' } }) : null;
    const available = Boolean(mapping?.template_document_id && await canAccessDocumento(actor, mapping.template_document_id));
    return { status: available ? 'CONFIGURED' : 'NOT_CONFIGURED', format_key: key, requirement_id: requirement.id,
      template_document_id: available ? mapping!.template_document_id : null,
      action: available ? 'UPLOAD_SIGNED' : 'CONFIGURE_APPROVED_FORMAT', official_document_generated: false,
      lifecycle: 'CUM-DOC-001', signed_upload_path: `/compliance/expedientes/${expedienteId}/documental/requisitos/${requirement.id}/cargar-firmado` };
  }

  /** Freeze all mutable BC inputs BEFORE creating the canonical H1 review. */
  static async prepareReviewTx(tx: Prisma.TransactionClient, actor: Actor, expediente: any): Promise<BcReviewPlan> {
    const service = new BeneficialControllerService();
    const targets = new Map<string, BcTargetPlan>();
    for (const party of expediente.comparecientes) {
      const pm = party.compareciente?.personaMoral;
      if (!pm) continue;
      const acts = party.expediente_acto_id ? [party.expediente_acto_id] : expediente.actos.map((act: any) => act.id);
      for (const actId of acts.length ? acts : [null]) {
        if (actId && !expediente.actos.some((act: any) => act.id === actId)) continue;
        const key = `${pm.id}:${actId || 'GENERAL'}`;
        if (targets.has(key)) continue;
        await service.root(actor, party.compareciente_id, tx);
        const structure = await tx.personaMoralOwnershipStructure.findFirst({ where: { organization_id: actor.organizationId, persona_moral_id: pm.id } });
        const graph = structure ? await service.expand(tx, actor, structure) : null;
        targets.set(key, { personaMoralId: pm.id, actId, structure, graph, fingerprint: graph ? bcGraphFingerprint(graph) : null });
      }
    }
    const ordered = [...targets.values()].sort((a, b) => a.personaMoralId.localeCompare(b.personaMoralId) || (a.actId || '').localeCompare(b.actId || ''));
    return { targets: ordered, identity: ordered.map(target => ({ target_pm: target.personaMoralId,
      act_id: target.actId, expanded_fingerprint: target.fingerprint, engine: BC_ENGINE_VERSION })) };
  }

  static async materializeForReviewTx(tx: Prisma.TransactionClient, input: {
    organizationId: string; expedienteId: string; reviewId: string; stateId: string; actorUserId: string;
    actor: Actor; plan: BcReviewPlan; revisions: BcVerifiedRevision[]; legalDate: Date | null;
    requestHash: string; context: Record<string, any>; previousReviewId: string | null; correlationId?: string;
  }) {
    if (input.actor.id !== input.actorUserId || input.actor.organizationId !== input.organizationId) throw new BeneficialControllerError(403, 'BC_ACTOR_MISMATCH', 'El actor no es válido.');
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `h4:materialize:${input.organizationId}:${input.reviewId}`);
    // Plan all PMs/subjects before writing: the H1 identity never acquires a subject discriminator.
    const runs = input.plan.targets.flatMap(target => !target.structure || !target.graph ? [] : (['LFPIORPI', 'CFF_RMF'] as const).map(regime => {
      const scoped = input.revisions.filter(rule => rule.outcome.bc?.regime === regime);
      const applicability = scoped.filter(rule => rule.outcome.bc?.purpose === 'APPLICABILITY');
      const determination = scoped.filter(rule => rule.outcome.bc?.purpose === 'DETERMINATION');
      const pack: BcRulePack | null = input.legalDate && target.actId && applicability.length === 1 && determination.length
        ? { regime, applicability: applicability[0], determination } : null;
      const identity = { organization_id: input.organizationId, expediente_id: input.expedienteId,
        expediente_acto_id: target.actId, target_persona_moral_id: target.personaMoralId, regime,
        expanded_fingerprint: target.fingerprint, rules: bcOrderedRules(pack),
        legal_date: input.legalDate?.toISOString() || null, engine: BC_ENGINE_VERSION, confirmed_context_hash: input.requestHash };
      const result = evaluateBcRegime({ regime, graph: target.graph!, target_node_id: target.graph!.root_node_id!, rule_pack: pack,
        context: { ...input.context, acto: (input.context.actos || []).find((act: any) => act.id === target.actId),
          target_persona_moral_id: target.personaMoralId, legal_date: input.legalDate?.toISOString() || null } });
      return { target, regime, identity, hash: bcLogicalHash(identity), result };
    }));
    const previous = await tx.complianceBcEvaluation.findMany({ where: { organization_id: input.organizationId, review_id: input.reviewId } });
    if (previous.length) {
      if (previous.length !== runs.length || previous.some(row => !runs.some(run => run.hash === row.logical_hash))) {
        throw new BeneficialControllerError(409, 'BC_MATERIALIZATION_CONFLICT', 'La revisión ya contiene otra evaluación.');
      }
      const requirements = await tx.complianceRequirement.findMany({ where: { organization_id: input.organizationId, review_id: input.reviewId } });
      return requirements.map(row => ({ key: row.requirement_key, status: row.status }));
    }
    const h1Groups = new Map<string, Array<(typeof runs)[number]['result']['executed_rules'][number]>>();
    const h1Key = (actId: string | null, ruleId: string) => `${actId || 'GENERAL'}:${ruleId}`;
    for (const run of runs) for (const execution of run.result.executed_rules) {
      const key = h1Key(run.target.actId, execution.ruleRevisionId);
      h1Groups.set(key, [...(h1Groups.get(key) || []), execution]);
    }
    const h1Rows = new Map<string, { id: string }>();
    for (const [key, executions] of h1Groups) {
      // The H1 row is a rule/context summary; complete per-subject truth/facts stay in H4 below.
      const representative = [...executions].sort((a, b) =>
        Number(b.noticeRequired) - Number(a.noticeRequired) ||
        ({ TRUE: 0, UNKNOWN: 1, FALSE: 2 }[a.truth] - { TRUE: 0, UNKNOWN: 1, FALSE: 2 }[b.truth]))[0];
      const actId = key.slice(0, key.indexOf(':'));
      const row = await tx.complianceRuleResult.create({ data: { organization_id: input.organizationId,
        review_id: input.reviewId, rule_revision_id: representative.ruleRevisionId, expediente_acto_id: actId === 'GENERAL' ? null : actId,
        applicability: representative.applicability, vulnerable_activity: executions.some(item => item.vulnerableActivity),
        notice_required: executions.some(item => item.noticeRequired), notice_type: representative.noticeType, notice_channel: representative.noticeChannel,
        missing_paths: asJson([...new Set(executions.flatMap(item => item.missingPaths))].sort()),
        result_snapshot: asJson({ contract: 'CUM-BC-001', scope: 'RULE_ACT_AGGREGATE', execution_count: executions.length,
          truth: representative.truth, ruleRevisionId: representative.ruleRevisionId }),
        legal_basis_snapshot: asJson({ legal_basis: representative.legalBasis, revision_id: representative.ruleRevisionId, checksum: representative.checksum }) } });
      h1Rows.set(key, row);
    }
    const statuses: Array<{ key: string; status: string }> = [];
    for (const target of input.plan.targets) {
      const structure = target.structure, graph = target.graph;
      if (!structure || !graph) {
        const key = `BC:${target.personaMoralId}:${target.actId || 'GENERAL'}:STRUCTURE`;
        await tx.complianceRequirement.create({ data: {
          organization_id: input.organizationId, expediente_id: input.expedienteId, state_id: input.stateId,
          review_id: input.reviewId, provider: 'BC', requirement_key: key,
          label: 'Completar estructura de propiedad y control', status: 'PENDIENTE',
          source_snapshot: asJson({ contract: 'CUM-BC-001', reason: 'OWNERSHIP_STRUCTURE_NOT_CONFIGURED', target_persona_moral_id: target.personaMoralId, expediente_acto_id: target.actId }),
          requires_human_validation: true,
        } });
        statuses.push({ key, status: 'PENDIENTE' }); continue;
      }
      const snapshot = await tx.complianceBcStructureSnapshot.create({ data: {
        organization_id: input.organizationId, review_id: input.reviewId, expediente_id: input.expedienteId,
        expediente_acto_id: target.actId, target_persona_moral_id: target.personaMoralId,
        structure_id: structure.id, structure_revision: structure.revision, structure_fingerprint: target.fingerprint!,
        graph_snapshot: asJson(graph), incomplete_markers: asJson(graph.incomplete_markers || []), captured_by_id: input.actorUserId,
      } });
      for (const regime of ['LFPIORPI', 'CFF_RMF'] as const) {
        const { result, identity, hash } = runs.find(run => run.target === target && run.regime === regime)!;
        const executed = result.executed_rules.map(execution => {
          const row = h1Rows.get(h1Key(target.actId, execution.ruleRevisionId))!;
          const subjectExecution = { ...execution, h1_rule_result_id: row.id,
            execution_id: bcLogicalHash({ evaluation: hash, rule: execution.ruleRevisionId, subject: (execution as any).bc_subject_node_id || null }) } as BcSubjectExecution;
          return { execution: subjectExecution, row };
        }).sort((a, b) => a.execution.execution_id.localeCompare(b.execution.execution_id));
        const predecessor = input.previousReviewId ? await tx.complianceBcEvaluation.findFirst({ where: {
          organization_id: input.organizationId, expediente_id: input.expedienteId, review_id: input.previousReviewId,
          target_persona_moral_id: target.personaMoralId, expediente_acto_id: target.actId, regime,
        } }) : null;
        const evaluation = await tx.complianceBcEvaluation.create({ data: {
          organization_id: input.organizationId, review_id: input.reviewId, expediente_id: input.expedienteId,
          expediente_acto_id: target.actId, target_persona_moral_id: target.personaMoralId, snapshot_id: snapshot.id,
          regime, status: result.status, logical_hash: hash, legal_date: input.legalDate,
          rule_set_checksum: result.rule_set_checksum, engine_version: BC_ENGINE_VERSION,
          input_snapshot: asJson({ ...identity, executed_rule_result_ids: [...new Set(executed.map(item => item.row.id))] }),
          result_snapshot: asJson({ ...result.snapshot, subject_executions: executed.map(item => item.execution) }), supersedes_evaluation_id: predecessor?.id || null, created_by_id: input.actorUserId,
        } });
        const subjects = new Map<string, typeof result.results>();
        for (const subject of result.results) {
          const key = subject.subject_compareciente_id || subject.subject_node_id;
          subjects.set(key, [...(subjects.get(key) || []), subject]);
        }
        for (const matches of subjects.values()) {
          const subject = matches[0];
          const matched = executed.filter(item => matches.some(match => match.rule_revision_id === item.execution.ruleRevisionId
            && (item.execution as any).bc_subject_node_id === match.subject_node_id));
          const row = await tx.complianceBcResult.create({ data: {
            organization_id: input.organizationId, evaluation_id: evaluation.id,
            subject_compareciente_id: subject.subject_compareciente_id,
            subject_snapshot_node_id: subject.subject_compareciente_id ? null : subject.subject_node_id,
            determination: subject.determination, facts_snapshot: asJson(matched.map(item => item.execution.bc_facts)),
            result_snapshot: asJson({ h1_rule_result_id: matched[0].row.id, rule_revision_id: matched[0].execution.ruleRevisionId,
              supporting_rule_result_ids: [...new Set(matched.map(item => item.row.id))],
              node_ids: [...new Set(matched.map(item => item.execution.bc_subject_node_id))],
              execution_ids: matched.map(item => item.execution.execution_id) }),
          } });
          for (const item of matched) {
            const documentStatuses = await ComplianceDocumentService.materializeForRuleResultTx(tx, input.actor, {
              expedienteId: input.expedienteId, reviewId: input.reviewId, stateId: input.stateId, ruleResultId: item.row.id,
              expedienteActoId: target.actId!, result: item.execution,
              parties: subject.subject_compareciente_id ? [{ compareciente_id: subject.subject_compareciente_id, expediente_acto_id: target.actId }] : [],
              correlationId: input.correlationId,
            });
            statuses.push(...documentStatuses.map((status, index) => ({ key: `BCDOC:${row.id}:${index}`, status })));
          }
          if (subject.subject_compareciente_id && matches.some(match => input.revisions.find(rule => rule.id === match.rule_revision_id)?.outcome.bc?.requires_screening)) {
            const screening = await ComplianceBcScreeningAdapter.ensureForIdentifiedBcTx(tx, {
              actor: input.actor, organizationId: input.organizationId, expedienteId: input.expedienteId, reviewId: input.reviewId,
              expedienteActoId: target.actId, targetPersonaMoralId: target.personaMoralId, evaluationId: evaluation.id,
              resultId: row.id, comparecienteId: subject.subject_compareciente_id, actorUserId: input.actorUserId, correlationId: input.correlationId,
            });
            if (screening.eligible) statuses.push({ key: `BCLST:${row.id}`, status: 'PENDIENTE' });
          }
        }
        const key = `BC:${target.personaMoralId}:${target.actId || 'GENERAL'}:${regime}`;
        const status = result.status === 'NOT_APPLICABLE' ? 'NO_APLICA' : 'PENDIENTE';
        await tx.complianceRequirement.create({ data: {
          organization_id: input.organizationId, expediente_id: input.expedienteId, state_id: input.stateId,
          review_id: input.reviewId, provider: 'BC', requirement_key: key, label: `Revisión de beneficiario controlador — ${regime === 'LFPIORPI' ? 'LFPIORPI' : 'CFF / RMF'}`,
          status, source_snapshot: asJson({ contract: 'CUM-BC-001', evaluation_id: evaluation.id, reason: result.status, target_persona_moral_id: target.personaMoralId,
            expediente_acto_id: target.actId, structure_fingerprint: target.fingerprint }), requires_human_validation: true,
        } });
        statuses.push({ key, status });
        await tx.auditLog.create({ data: { organization_id: input.organizationId, user_id: input.actorUserId, accion: 'BC_EVALUATION_CAPTURED',
          entidad: 'ComplianceBcEvaluation', entidad_id: evaluation.id, detalles: asJson({ logical_hash: hash, regime, status: result.status, supersedes_evaluation_id: predecessor?.id || null }) } });
      }
    }
    return statuses;
  }

  static async markSocietyConstitutedTx(tx: Prisma.TransactionClient, input: { organizationId: string; expedienteId: string; actorUserId: string }) {
    const targets = await tx.expedienteSocietyTarget.findMany({ where: { organization_id: input.organizationId, expediente_id: input.expedienteId, status: 'EN_CONSTITUCION' }, orderBy: { persona_moral_id: 'asc' } });
    let transitioned = 0;
    for (const target of targets) {
      const changed = await tx.personaMoral.updateMany({ where: { id: target.persona_moral_id, organization_id: input.organizationId, estatus_societario: 'EN_CONSTITUCION' }, data: { estatus_societario: 'CONSTITUIDA' } });
      await tx.expedienteSocietyTarget.updateMany({ where: { id: target.id, organization_id: input.organizationId, status: 'EN_CONSTITUCION',
        personaMoral: { estatus_societario: 'CONSTITUIDA' } }, data: { status: 'CONSTITUIDA' } });
      if (changed.count !== 1) continue;
      transitioned++;
      await tx.auditLog.create({ data: { organization_id: input.organizationId, user_id: input.actorUserId, accion: 'SOCIEDAD_CONSTITUIDA_POR_FIRMA', entidad: 'PersonaMoral', entidad_id: target.persona_moral_id, detalles: asJson({ expediente_id: input.expedienteId, target_id: target.id }) } });
    }
    return transitioned;
  }
}
