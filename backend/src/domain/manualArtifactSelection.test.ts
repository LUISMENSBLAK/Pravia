import { describe,it,expect } from 'vitest';
import { parseManualArtifactSelections,resolveManualArtifacts } from './manualArtifactSelection';
import type { Exp006Artifact,Exp006Context } from './expedienteArtifacts';
const id=(n:number)=>`26110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context:Exp006Context={expedienteId:id(1),organizationId:id(2),institutionIds:[id(8)],acts:[],properties:[],parties:[{relationId:id(3),partyId:id(4),actId:id(5),personType:'FISICA',roleId:id(6),name:'PERSONA QA'}]};
const artifact:Exp006Artifact={id:id(7),organization_id:id(2),nombre:'Formato QA',tipo:'FORMATO',propietario_tipo:'ORGANIZACION',activo:true,actos:[],reglas:[],versiones:[{id:id(9),version:1,checksum_sha256:'qa',activa:true}]};
const selection={artifact_id:id(7),subject_type:'COMPARECIENTE' as const,subject_id:id(3)};
describe('Selección manual EXP006 sin reglas ficticias',()=>{
 it('permite elegir un formato sin acto/regla automática sin mutar el maestro',()=>{const before=JSON.stringify(artifact);const rows=resolveManualArtifacts([artifact],context,[selection]);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({ruleId:null,mandatory:false,subjectId:id(3),snapshot:{source:'MANUAL'}});expect(JSON.stringify(artifact)).toBe(before);});
 it('distingue el formato general del individual',()=>{const result=resolveManualArtifacts([artifact],context,[selection,{...selection,subject_type:'EXPEDIENTE',subject_id:id(1)}]);expect(result).toHaveLength(2);expect(new Set(result.map(r=>r.identityKey)).size).toBe(2);});
 it.each([{...artifact,organization_id:id(20)},{...artifact,activo:false},{...artifact,propietario_tipo:'INSTITUCION',institucion_id:id(20)},{...artifact,versiones:[]}])('excluye tenant/banco/maestro no disponible',item=>expect(resolveManualArtifacts([item as Exp006Artifact],context,[selection])).toEqual([]));
 it('admite el banco seleccionado, no otro, sin automatizar selección',()=>expect(resolveManualArtifacts([{...artifact,propietario_tipo:'INSTITUCION',institucion_id:id(8)}],context,[selection])).toHaveLength(1));
 it('excluye persona o expediente ajenos',()=>{expect(resolveManualArtifacts([artifact],context,[{...selection,subject_id:id(20)}])).toEqual([]);expect(resolveManualArtifacts([artifact],context,[{...selection,subject_type:'EXPEDIENTE',subject_id:id(20)}])).toEqual([]);});
 it('rechaza duplicados aunque las claves JSON vengan en diferente orden',()=>expect(()=>parseManualArtifactSelections([selection,{subject_id:id(3),subject_type:'COMPARECIENTE',artifact_id:id(7)}])).toThrow('DUPLICATE'));
 it.each([[{...selection,document_ids:[id(9)]}],[{...selection,subject_type:'OTHER'}],[{...selection,artifact_id:'bad'}],{}])('rechaza inyección de fuentes y selección malformada',value=>expect(()=>parseManualArtifactSelections(value)).toThrow());
});
