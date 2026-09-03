import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  generate: vi.fn(),
  usage: vi.fn(),
  canAccessDocumento: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: {} }));
vi.mock('../storage/storage.service', () => ({ downloadFile: external.downloadFile }));
vi.mock('./openaiDocument.service', () => ({ generateOperationalArtifactWithOpenAI: external.generate }));
vi.mock('./aiUsage.service', () => ({ recordAIUsageInDb: external.usage }));
vi.mock('../middleware/auth.middleware', () => ({ expedienteAccessWhere: (actor: any) => ({ organization_id: actor.organizationId }) }));
vi.mock('./objectAccess.service', () => ({
  comparecienteObjectWhere: (actor: any) => ({ organization_id: actor.organizationId }),
  canAccessDocumento: external.canAccessDocumento,
}));

import { BeneficialControllerService } from './beneficialController.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = Buffer.from('synthetic H4 source');
const checksum = createHash('sha256').update(source).digest('hex');
const actor: any = { id: id(1), organizationId: id(2), rol: 'ADMINISTRACION', permissions: [
  'ia.execute', 'comparecientes.read', 'comparecientes.write', 'compliance.read', 'compliance.write',
  'documentos.read', 'expedientes.write',
] };

function aiDb() {
  const structure = { id: id(4), organization_id: actor.organizationId, persona_moral_id: id(5), root_node_id: id(6), revision: 3, fingerprint: 'a'.repeat(64), incomplete_markers: [] };
  const document = { id: id(9), organization_id: actor.organizationId, compareciente_id: id(3), checksum_sha256: checksum,
    storage_key: 'synthetic/h4.pdf', size_bytes: source.length, fecha_carga: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
    mime_type: 'application/pdf', nombre_original: 'synthetic.pdf', tipo: 'H4_TEST', comparecienteVinculos: [] };
  const root = { id: id(3), tipo_persona: 'MORAL', personaMoral: { id: id(5), compareciente_id: id(3) } };
  const rootNode = { id: id(6), organization_id: actor.organizationId, structure_id: structure.id, party_kind: 'PM', identity_mode: 'LINKED',
    linked_compareciente_id: id(3), display_name: null, incomplete: false, metadata: {}, linkedCompareciente: null };
  const db: any = {
    compareciente: { findFirst: vi.fn().mockResolvedValue(root) },
    personaMoralOwnershipStructure: { findFirst: vi.fn().mockResolvedValue(structure), findFirstOrThrow: vi.fn().mockResolvedValue(structure), create: vi.fn(), update: vi.fn() },
    personaMoralOwnershipNode: { findMany: vi.fn().mockResolvedValue([rootNode]) },
    personaMoralOwnershipEdge: { findMany: vi.fn().mockResolvedValue([]) },
    personaMoralControlFact: { findMany: vi.fn().mockResolvedValue([]) },
    personaMoralStructureReconciliation: { findMany: vi.fn().mockResolvedValue([]) },
    documento: { findFirst: vi.fn().mockResolvedValue(document) },
    complianceBcAiProposal: { create: vi.fn().mockImplementation(({ data }: any) => ({ ...data, status: 'PENDING' })), findFirst: vi.fn(), update: vi.fn().mockImplementation(({ data }: any) => ({ id: id(30), ...data })) },
    auditLog: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  db.$transaction = (fn: any) => fn(db);
  return { db, structure, document, rootNode };
}

function societyDb() {
  const root = { id: id(3), tipo_persona: 'MORAL', personaMoral: { id: id(5), compareciente_id: id(3), estatus_societario: 'EN_CONSTITUCION' } };
  const db: any = {
    compareciente: { findFirst: vi.fn().mockResolvedValue(root) },
    expediente: { findFirst: vi.fn().mockResolvedValue({ id: id(40) }) },
    expedienteActo: { findFirst: vi.fn().mockResolvedValue({ id: id(41) }) },
    expedienteSocietyTarget: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => ({ id: id(42), ...data })) },
    auditLog: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  db.$transaction = (fn: any) => fn(db);
  return { db, root };
}

describe('H4 AI proposal lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    external.downloadFile.mockResolvedValue(source);
    external.canAccessDocumento.mockResolvedValue(true);
    external.usage.mockResolvedValue(undefined);
  });

  it('creates a prepare-only proposal, freezes source lineage and records usage without mutating the master', async () => {
    const { db, structure, document, rootNode } = aiDb();
    external.generate.mockResolvedValue({ content: JSON.stringify({ graph: { root_node_id: rootNode.id, nodes: [{
      id: rootNode.id, party_kind: 'PM', identity_mode: 'LINKED', linked_compareciente_id: id(3), metadata: {},
    }], edges: [], controls: [] }, source_pages: [2, 2, 4] }), model: 'synthetic-model', usage: { input_tokens: 1, output_tokens: 1 } });
    const proposal = await new BeneficialControllerService(db).proposeAi(actor, id(3), { document_id: document.id });
    expect(proposal).toMatchObject({ status: 'PENDING', base_revision: structure.revision, base_fingerprint: structure.fingerprint,
      source_document_id: document.id, source_document_checksum: checksum, source_pages: [2, 4] });
    expect(external.usage).toHaveBeenCalledTimes(1);
    expect(db.personaMoralOwnershipStructure.create).not.toHaveBeenCalled();
    expect(db.personaMoralOwnershipStructure.update).not.toHaveBeenCalled();
  });

  it('rejects a proposal once and records only the effective decision', async () => {
    const { db, structure, document } = aiDb();
    const pending = { id: id(30), organization_id: actor.organizationId, structure_id: structure.id, source_document_id: document.id,
      source_document_version: checksum, source_document_checksum: checksum, base_revision: 3, base_fingerprint: structure.fingerprint,
      proposed_changes: { graph: {} }, status: 'PENDING' };
    db.complianceBcAiProposal.findFirst.mockResolvedValue(pending);
    const service = new BeneficialControllerService(db);
    await expect(service.decideAi(actor, id(3), pending.id, { decision: 'REJECTED' })).resolves.toMatchObject({ status: 'REJECTED' });
    db.complianceBcAiProposal.findFirst.mockResolvedValue({ ...pending, status: 'REJECTED' });
    await expect(service.decideAi(actor, id(3), pending.id, { decision: 'REJECTED' })).resolves.toMatchObject({ status: 'REJECTED' });
    expect(db.complianceBcAiProposal.update).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('confirms a current proposal once through the canonical save path', async () => {
    const { db, structure, document } = aiDb();
    const proposal = { id: id(30), organization_id: actor.organizationId, structure_id: structure.id,
      source_document_id: document.id, source_document_version: checksum, source_document_checksum: checksum,
      base_revision: structure.revision, base_fingerprint: structure.fingerprint,
      proposed_changes: { graph: { root_node_id: id(6), nodes: [{id:id(6),party_kind:'PM',identity_mode:'LINKED',linked_compareciente_id:id(3),metadata:{}}], edges: [], controls: [] } }, status: 'PENDING' };
    db.complianceBcAiProposal.findFirst.mockResolvedValue(proposal);
    const save = vi.spyOn(BeneficialControllerService.prototype, 'save').mockResolvedValue({ idempotent: false } as any);
    const service = new BeneficialControllerService(db);
    const graph=(service as any).normalize(proposal.proposed_changes.graph);
    const review_token=(service as any).reviewToken(graph);
    await expect(service.decideAi(actor,id(3),proposal.id,{decision:'CONFIRMED',graph,review_token:'unreviewed'})).rejects.toMatchObject({code:'BC_AI_REVIEW_REQUIRED'});
    await expect(service.decideAi(actor,id(3),proposal.id,{decision:'CONFIRMED',graph:{...graph,nodes:[{...graph.nodes[0],metadata:{hidden:'unreviewed'}}]},review_token})).rejects.toMatchObject({code:'BC_AI_REVIEW_REQUIRED'});
    expect(save).not.toHaveBeenCalled();
    await expect(service.decideAi(actor, id(3), proposal.id, { decision: 'CONFIRMED',graph,review_token })).resolves.toMatchObject({ status: 'ACCEPTED' });
    db.complianceBcAiProposal.findFirst.mockResolvedValue({ ...proposal, status: 'ACCEPTED' });
    await expect(service.decideAi(actor, id(3), proposal.id, { decision: 'CONFIRMED' })).resolves.toMatchObject({ status: 'ACCEPTED' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(actor, id(3), expect.objectContaining({ expected_revision: structure.revision, idempotency_key: `ai:${proposal.id}` }), db);
  });

  it('blocks a stale confirmation before any master save and audits the conflict', async () => {
    const { db, structure, document } = aiDb();
    db.complianceBcAiProposal.findFirst.mockResolvedValue({ id: id(30), organization_id: actor.organizationId, structure_id: structure.id,
      source_document_id: document.id, source_document_version: checksum, source_document_checksum: checksum,
      base_revision: 2, base_fingerprint: 'b'.repeat(64), proposed_changes: { graph: {} }, status: 'PENDING' });
    const save = vi.spyOn(BeneficialControllerService.prototype, 'save');
    await expect(new BeneficialControllerService(db).decideAi(actor, id(3), id(30), { decision: 'CONFIRMED' }))
      .rejects.toMatchObject({ code: 'BC_AI_STALE' });
    expect(save).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'BC_AI_STALE_CONFLICT' }) });
  });

  it('denies AI proposal creation to an actor without ia.execute', async () => {
    const { db } = aiDb();
    await expect(new BeneficialControllerService(db).proposeAi({ ...actor, permissions: actor.permissions.filter((p: string) => p !== 'ia.execute') }, id(3), { document_id: id(9) }))
      .rejects.toMatchObject({ code: 'BC_PERMISSION_DENIED' });
    expect(external.generate).not.toHaveBeenCalled();
  });
});

describe('H4 explicit society lifecycle', () => {
  it('keeps automatic activation legally unconfigured', () => {
    expect(BeneficialControllerService.societyOpeningStatus()).toEqual({ status: 'NOT_CONFIGURED', automatic_creation: false, action: 'EXPLICIT_TARGET_REVIEW' });
  });

  it('ensures an explicit target and reuses the same target intent on retry', async () => {
    const { db, root } = societyDb();
    const service = new BeneficialControllerService(db);
    const body = { expediente_acto_id: id(41), target_intent: 'Synthetic incorporation target', compareciente_id: root.id };
    const created = await service.ensureSociety(actor, id(40), body);
    expect(created).toMatchObject({ idempotent: false, persona_moral_id: root.personaMoral.id, applicability_status: 'NOT_CONFIGURED' });
    db.expedienteSocietyTarget.findFirst.mockResolvedValue({ ...created, personaMoral: root.personaMoral });
    await expect(service.ensureSociety(actor, id(40), body)).resolves.toMatchObject({ id: created.id, idempotent: true });
    expect(db.expedienteSocietyTarget.create).toHaveBeenCalledTimes(1);
  });

  it('represents separate explicit target intents without a global one-target cardinality', async () => {
    const { db, root } = societyDb();
    const service = new BeneficialControllerService(db);
    await service.ensureSociety(actor, id(40), { expediente_acto_id: id(41), target_intent: 'Target A', compareciente_id: root.id });
    await service.ensureSociety(actor, id(40), { expediente_acto_id: id(41), target_intent: 'Target B', compareciente_id: root.id });
    const keys = db.expedienteSocietyTarget.create.mock.calls.map((call: any[]) => call[0].data.target_intent_key);
    expect(new Set(keys).size).toBe(2);
  });

  it('blocks a target with the wrong act before creating or auditing it', async () => {
    const { db, root } = societyDb();
    db.expedienteActo.findFirst.mockResolvedValue(null);
    await expect(new BeneficialControllerService(db).ensureSociety(actor, id(40), {
      expediente_acto_id: id(41), target_intent: 'Target A', compareciente_id: root.id,
    })).rejects.toMatchObject({ code: 'BC_ACT_NOT_FOUND' });
    expect(db.expedienteSocietyTarget.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('transitions only EN_CONSTITUCION once and leaves legacy statuses outside the update predicate', async () => {
    const tx: any = {
      expedienteSocietyTarget: { findMany: vi.fn().mockResolvedValue([
        { id: id(50), persona_moral_id: id(51) }, { id: id(52), persona_moral_id: id(53) },
      ]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      personaMoral: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) },
      auditLog: { create: vi.fn() },
    };
    await expect(BeneficialControllerService.markSocietyConstitutedTx(tx, { organizationId: actor.organizationId, expedienteId: id(40), actorUserId: actor.id })).resolves.toBe(1);
    expect(tx.personaMoral.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ estatus_societario: 'EN_CONSTITUCION' }) }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
