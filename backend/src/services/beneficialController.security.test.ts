import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/prisma', () => ({ default: {} }));
import { BeneficialControllerService } from './beneficialController.service';
import { comparecienteObjectWhere } from './objectAccess.service';

const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor:any={id:id(1),organizationId:id(2),rol:'ABOGADO',permissions:['comparecientes.read','compliance.read']};
// Uses the real policy producer; physical Prisma enforcement is separately tested in A/B.
function matches(record:any,where:any):boolean{return Object.entries(where).every(([key,value]:any)=>key==='AND'?value.every((part:any)=>matches(record,part)):key==='OR'?value.some((part:any)=>matches(record,part)):value&&typeof value==='object'&&'some' in value?(record[key]||[]).some((item:any)=>matches(item,value.some)):record[key]===value)}
function fixture(authorized:boolean,crossTenant=false){
 const root={id:id(3),organization_id:actor.organizationId,archived_at:null,creado_por_id:actor.id,tipo_persona:'MORAL',personaMoral:{id:id(4),razon_social:'Synthetic root'}};
 const person={id:id(5),organization_id:crossTenant?id(22):actor.organizationId,archived_at:null,creado_por_id:authorized?actor.id:id(9),tipo_persona:'FISICA',nombre_busqueda:'Synthetic protected identity'};
 const nodes=[{id:id(6),identity_mode:'LINKED',party_kind:'PM',linked_compareciente_id:root.id,linkedCompareciente:root},{id:id(7),identity_mode:'LINKED',party_kind:'PF',linked_compareciente_id:person.id,linkedCompareciente:person}];
 const db:any={compareciente:{findFirst:async({where}:any)=>[root,person].find(row=>matches(row,where))||null},personaMoralOwnershipStructure:{findFirst:async()=>({id:id(8),persona_moral_id:id(4),root_node_id:id(6),incomplete_markers:[],revision:1})},personaMoralOwnershipNode:{findMany:async()=>nodes},personaMoralOwnershipEdge:{findMany:async()=>[]},personaMoralControlFact:{findMany:async()=>[]},personaMoralStructureReconciliation:{findMany:async()=>[]}};
 return {db,person,root};
}
describe('H4 F004 canonical read authority',()=>{
 it('denies the whole projection when a same-tenant linked identity is outside canonical object scope',async()=>{const {db,person,root}=fixture(false);expect(matches(person,comparecienteObjectWhere(actor))).toBe(false);await expect(new BeneficialControllerService(db).current(actor,root.id)).rejects.toMatchObject({code:'BC_LINKED_PARTY_NOT_FOUND'});});
 it('shows an authorized identity in both current and expanded projections',async()=>{const {db,person,root}=fixture(true);expect(matches(person,comparecienteObjectWhere(actor))).toBe(true);const result:any=await new BeneficialControllerService(db).current(actor,root.id);expect(result.nodes[1].canonical_label).toBe(person.nombre_busqueda);expect(result.expanded.nodes.find((n:any)=>n.id===id(7)).canonical_label).toBe(person.nombre_busqueda);});
 it('rejects a cross-tenant valid linked ID even when creator matches',async()=>{const {db,root}=fixture(true,true);await expect(new BeneficialControllerService(db).current(actor,root.id)).rejects.toMatchObject({code:'BC_LINKED_PARTY_NOT_FOUND'});});
});
