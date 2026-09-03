import { beforeEach, describe, expect, it, vi } from 'vitest';

const h3 = vi.hoisted(() => ({ queueMasterScreeningTx: vi.fn(), linkOperationSnapshotTx: vi.fn(), ensureOperationScreeningForPartyTx: vi.fn() }));
const authz = vi.hoisted(() => ({ canAccessDocumento: vi.fn().mockResolvedValue(true) }));
vi.mock('../config/prisma', () => ({ default: {} }));
vi.mock('../middleware/auth.middleware', () => ({ expedienteAccessWhere: (actor: any) => ({ organization_id: actor.organizationId, abogado_id: actor.id }) }));
vi.mock('./complianceScreening.service', () => ({ queueMasterScreeningTx: h3.queueMasterScreeningTx, linkOperationSnapshotTx: h3.linkOperationSnapshotTx }));
vi.mock('./operationScreening.service', () => ({ ensureOperationScreeningForPartyTx: h3.ensureOperationScreeningForPartyTx }));
vi.mock('./objectAccess.service', () => ({ comparecienteObjectWhere: (actor: any) => ({ organization_id: actor.organizationId }), canAccessDocumento: authz.canAccessDocumento }));
import { BeneficialControllerService } from './beneficialController.service';
import { ComplianceBcScreeningAdapter, linkBeneficialControllerScreeningTx } from './complianceBcScreening.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { id: id(1), organizationId: id(2), rol: 'ABOGADO', permissions: ['comparecientes.read', 'comparecientes.write', 'compliance.read', 'compliance.write', 'documentos.read'] };

function structureDb() {
  const rootNode={id:id(6),organization_id:actor.organizationId,structure_id:id(5),party_kind:'PM',identity_mode:'LINKED',linked_compareciente_id:id(3),display_name:null,incomplete:false,metadata:{},linkedCompareciente:null};
  const ownerNode={id:id(7),organization_id:actor.organizationId,structure_id:id(5),party_kind:'PF',identity_mode:'STRUCTURED_ONLY',linked_compareciente_id:null,display_name:'Synthetic owner',incomplete:false,metadata:{},linkedCompareciente:null};
  const document={ id: id(9), organization_id: actor.organizationId, compareciente_id: id(99), expediente_id: id(98), subido_por_id: id(97), checksum_sha256: 'a'.repeat(64), storage_key: 'synthetic/unrelated',updated_at:new Date('2026-01-01'),comparecienteVinculos:[] };
  const db: any = {
    $executeRawUnsafe: vi.fn(),
    compareciente: { findFirst: vi.fn().mockResolvedValue({ id: id(3), tipo_persona: 'MORAL', personaMoral: { id: id(4) } }), findMany: vi.fn().mockResolvedValue([{id:id(3),tipo_persona:'MORAL',personaMoral:{id:id(4)}}]) },
    auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    documento: { findMany: vi.fn().mockResolvedValue([document]) },
    personaMoralOwnershipStructure: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => ({ id: id(5), ...data })) },
    personaMoralOwnershipNode: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([rootNode,ownerNode]) },
    personaMoralOwnershipEdge: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    personaMoralControlFact: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    personaMoralStructureReconciliation: { findMany: vi.fn().mockResolvedValue([]) },
  };
  db.$transaction = (fn: any) => fn(db);
  return {db,document};
}
const saveInput = () => ({ root_node_id:id(6),expected_revision: 0, idempotency_key: 'synthetic-request', nodes: [
  { id: id(6), party_kind: 'PM', identity_mode: 'LINKED', linked_compareciente_id:id(3), metadata:{} },
  { id: id(7), party_kind: 'PF', identity_mode: 'STRUCTURED_ONLY', display_name: 'Synthetic owner' },
], edges: [{ id: id(8), owner_node_id: id(7), owned_node_id: id(6), percentage: '100', evidence_document_id: id(9) }], controls: [] });

function screeningTx(overrides:Record<string,unknown>={}){
  const review=id(11),expediente=id(10),act=id(14),pm=id(15),result=id(16),evaluation=id(17),person=id(13),state=id(18),h1=id(19),query=id(20);
  const subject={id:id(24),party_kind:'PF',identity_mode:'LINKED',linked_compareciente_id:person};
  const facts={subject,mathematical_ownership:null};
  const execution={execution_id:'a'.repeat(64),h1_rule_result_id:h1,ruleRevisionId:id(25),truth:'TRUE',bc_subject_node_id:subject.id,bc_facts:facts};
  const tx:any={
    $executeRawUnsafe:vi.fn(),
    expediente:{findFirst:vi.fn().mockResolvedValue({id:expediente})},
    expedienteComplianceState:{findFirst:vi.fn().mockResolvedValue({id:state,current_review_id:review})},
    complianceBcResult:{findFirst:vi.fn().mockResolvedValue({id:result,determination:'IDENTIFIED',subject_compareciente_id:person,facts_snapshot:[facts],result_snapshot:{h1_rule_result_id:h1,rule_revision_id:id(25),execution_ids:[execution.execution_id],supporting_rule_result_ids:[h1],node_ids:[subject.id]},evaluation:{id:evaluation,status:'EVALUATED',review_id:review,expediente_id:expediente,target_persona_moral_id:pm,expediente_acto_id:act,result_snapshot:{subject_executions:[execution]},snapshot:{graph_snapshot:{nodes:[subject]}}}})},
    compareciente:{findFirst:vi.fn().mockResolvedValue({id:person})},
    complianceRuleResult:{findFirst:vi.fn().mockResolvedValue({id:h1,review_id:review})},
    expedienteActo:{findFirst:vi.fn().mockResolvedValue({id:act})},
    expedienteCompareciente:{findFirst:vi.fn().mockResolvedValue(null)},
    complianceRequirement:{upsert:vi.fn().mockImplementation(({create}:any)=>({id:id(22),state_id:state,...create}))},
    complianceScreeningResult:{findFirst:vi.fn().mockResolvedValue({id:query,organization_id:actor.organizationId,compareciente_id:person,review_id:review,query_kind:'MASTER',contract_version:'CUM-LST-001'})},
    ...overrides,
  };
  const input={actor,organizationId:actor.organizationId,expedienteId:expediente,reviewId:review,expedienteActoId:act,targetPersonaMoralId:pm,evaluationId:evaluation,resultId:result,comparecienteId:person,actorUserId:actor.id};
  return {tx,input,ids:{review,expediente,act,pm,result,evaluation,person,h1,query}};
}

describe('H4 service adversarial acceptance probes', () => {
  beforeEach(() => {vi.clearAllMocks();authz.canAccessDocumento.mockResolvedValue(true);h3.queueMasterScreeningTx.mockResolvedValue({query:{id:id(20)},idempotent:false});h3.linkOperationSnapshotTx.mockResolvedValue({id:id(21)});h3.ensureOperationScreeningForPartyTx.mockResolvedValue({eligible:true})});
  it('rejects a same-tenant document belonging to unrelated objects at the document authority check', async () => {const {db}=structureDb();await expect(new BeneficialControllerService(db).save(actor,id(3),saveInput())).rejects.toMatchObject({code:'BC_EVIDENCE_NOT_AVAILABLE'});expect(authz.canAccessDocumento).not.toHaveBeenCalled();expect(db.personaMoralOwnershipStructure.create).not.toHaveBeenCalled()});
  it('accepts an authorized stable document and freezes its canonical version/checksum',async()=>{const {db,document}=structureDb();document.compareciente_id=id(3);await new BeneficialControllerService(db).save(actor,id(3),saveInput());expect(authz.canAccessDocumento).toHaveBeenCalledWith(actor,id(9));expect(db.personaMoralOwnershipEdge.createMany).toHaveBeenCalledWith({data:[expect.objectContaining({evidence_document_id:id(9),evidence_document_checksum:'a'.repeat(64),evidence_document_version:expect.any(String)})]})});
  it('rejects a same-tenant linked Compareciente outside the actor object scope',async()=>{const {db}=structureDb();const input=saveInput();input.nodes.push({id:id(30),party_kind:'PF',identity_mode:'LINKED',linked_compareciente_id:id(31),metadata:{}} as any);await expect(new BeneficialControllerService(db).save(actor,id(3),input)).rejects.toMatchObject({code:'BC_LINKED_PARTY_NOT_FOUND'});expect(db.personaMoralOwnershipStructure.create).not.toHaveBeenCalled()});
  it('denies editing without canonical write permission', async () => {const {db}=structureDb();await expect(new BeneficialControllerService(db).save({ ...actor, permissions: [] }, id(3), saveInput())).rejects.toMatchObject({ code: 'BC_PERMISSION_DENIED' });expect(db.personaMoralOwnershipStructure.create).not.toHaveBeenCalled()});
  it('requires complete screening lineage before reaching H3',async()=>{const {tx,input}=screeningTx();await expect(linkBeneficialControllerScreeningTx(tx,{organizationId:input.organizationId,expedienteId:input.expedienteId,reviewId:input.reviewId,requirementId:id(99),comparecienteId:input.comparecienteId,actorUserId:input.actorUserId})).rejects.toThrow('H4_BC_SCREENING_LINEAGE_REQUIRED');expect(h3.queueMasterScreeningTx).not.toHaveBeenCalled()});
  it.each([
    ['wrong review',(tx:any)=>tx.expedienteComplianceState.findFirst.mockResolvedValue(null)],
    ['wrong expediente',(tx:any)=>tx.expediente.findFirst.mockResolvedValue(null)],
    ['wrong acto',(tx:any)=>tx.expedienteActo.findFirst.mockResolvedValue(null)],
    ['wrong PM',(tx:any)=>tx.complianceBcResult.findFirst.mockResolvedValue({...tx.complianceBcResult.findFirst.getMockImplementation?.(),id:id(16),determination:'IDENTIFIED',result_snapshot:{h1_rule_result_id:id(19)},evaluation:{status:'EVALUATED',review_id:id(11),expediente_id:id(10),target_persona_moral_id:id(99),expediente_acto_id:id(14)}})],
    ['wrong person',(tx:any)=>tx.complianceBcResult.findFirst.mockResolvedValue(null)],
  ])('blocks %s before queue/link',async(_label,breakLineage)=>{const {tx,input}=screeningTx();breakLineage(tx);await expect(ComplianceBcScreeningAdapter.ensureForIdentifiedBcTx(tx,input)).rejects.toThrow('H4_BC_SCREENING_LINEAGE_MISMATCH');expect(h3.queueMasterScreeningTx).not.toHaveBeenCalled();expect(h3.linkOperationSnapshotTx).not.toHaveBeenCalled()});
  it('blocks a valid result ID with forged subject execution before any H3 dispatch',async()=>{
    const {tx,input}=screeningTx();
    const row=await tx.complianceBcResult.findFirst({});
    row.evaluation.result_snapshot.subject_executions[0].bc_facts.subject={...row.evaluation.result_snapshot.subject_executions[0].bc_facts.subject,linked_compareciente_id:id(99)};
    await expect(ComplianceBcScreeningAdapter.ensureForIdentifiedBcTx(tx,input)).rejects.toThrow('H4_BC_SCREENING_LINEAGE_MISMATCH');
    expect(h3.ensureOperationScreeningForPartyTx).not.toHaveBeenCalled();expect(h3.queueMasterScreeningTx).not.toHaveBeenCalled();expect(h3.linkOperationSnapshotTx).not.toHaveBeenCalled();
  });
  it('dispatches a legitimate existing party through the canonical H3 party helper',async()=>{const {tx,input}=screeningTx();tx.expedienteCompareciente.findFirst.mockResolvedValue({id:id(23)});await expect(ComplianceBcScreeningAdapter.ensureForIdentifiedBcTx(tx,input)).resolves.toEqual({eligible:true});expect(h3.ensureOperationScreeningForPartyTx).toHaveBeenCalledWith(tx,expect.objectContaining({relationId:id(23),comparecienteId:input.comparecienteId}));expect(h3.queueMasterScreeningTx).not.toHaveBeenCalled()});
  it('dispatches a legitimate non-party through LST + MASTER and then links the snapshot',async()=>{const {tx,input}=screeningTx();const result=await ComplianceBcScreeningAdapter.ensureForIdentifiedBcTx(tx,input);expect(result.eligible).toBe(true);expect(tx.complianceRequirement.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({provider:'LST',target_compareciente_id:input.comparecienteId})}));expect(h3.queueMasterScreeningTx).toHaveBeenCalledWith(tx,expect.objectContaining({comparecienteId:input.comparecienteId,reviewId:input.reviewId}));expect(h3.linkOperationSnapshotTx).toHaveBeenCalledTimes(1)});
});
