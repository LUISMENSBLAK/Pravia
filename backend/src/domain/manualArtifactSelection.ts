import { createHash } from 'crypto';
import type { Exp006Artifact, Exp006Context, Exp006Resolution } from './expedienteArtifacts';
export type ManualArtifactSelection={artifact_id:string;subject_type:'COMPARECIENTE'|'EXPEDIENTE';subject_id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseManualArtifactSelections(value:unknown):ManualArtifactSelection[]{
 if(!Array.isArray(value)||value.length>500)throw Error('EXP006_MANUAL_SELECTION_INVALID');
 const keys=new Set<string>();
 return value.map(raw=>{
  if(!raw||typeof raw!=='object'||Object.keys(raw).some(key=>!['artifact_id','subject_type','subject_id'].includes(key)))throw Error('EXP006_MANUAL_SELECTION_INVALID');
  const row=raw as ManualArtifactSelection;
  if(!uuid.test(row.artifact_id)||!uuid.test(row.subject_id)||!['COMPARECIENTE','EXPEDIENTE'].includes(row.subject_type))throw Error('EXP006_MANUAL_SELECTION_INVALID');
  const key=`${row.artifact_id}:${row.subject_type}:${row.subject_id}`;if(keys.has(key))throw Error('EXP006_MANUAL_SELECTION_DUPLICATE');keys.add(key);
  return {artifact_id:row.artifact_id,subject_type:row.subject_type,subject_id:row.subject_id};
 });
}
export function resolveManualArtifacts(artifacts:Exp006Artifact[],context:Exp006Context,selections:ManualArtifactSelection[]):Exp006Resolution[]{
 return selections.flatMap(selection=>{
  const artifact=artifacts.find(item=>item.id===selection.artifact_id&&item.activo);
  const owner=artifact&&(artifact.propietario_tipo==='ORGANIZACION'?artifact.organization_id===context.organizationId:artifact.propietario_tipo==='NOTARIA'?artifact.notaria_id===context.notariaId:artifact.tipo==='FORMATO'&&context.institutionIds.includes(artifact.institucion_id||''));
  const party=selection.subject_type==='COMPARECIENTE'?context.parties.find(item=>item.relationId===selection.subject_id):null;
  const subjectValid=selection.subject_type==='EXPEDIENTE'?selection.subject_id===context.expedienteId:Boolean(party);
  const version=artifact?.versiones.filter(item=>item.activa).sort((a,b)=>b.version-a.version)[0];
  if(!artifact||!owner||!subjectValid||!version)return [];
  const snapshot={source:'MANUAL',artifact_id:artifact.id,artifact_name:artifact.nombre,artifact_type:artifact.tipo,owner_type:artifact.propietario_tipo,owner_id:artifact.institucion_id||artifact.notaria_id||context.organizationId,master_version:version.version,master_version_id:version.id,subject_type:selection.subject_type,subject_id:selection.subject_id,subject_name:party?.name||'Expediente',act_names:party?context.acts.filter(a=>a.id===party.actId).map(a=>a.name):context.acts.map(a=>a.name),manual_applicability:true};
  return [{identityKey:`manual:${artifact.id}:${selection.subject_type}:${selection.subject_id}`,artifactId:artifact.id,ruleId:null,masterVersionId:version.id,expedienteActoId:party?.actId||null,subjectType:selection.subject_type,subjectId:selection.subject_id,ordinal:1,mandatory:false,normativeRevisionId:null,evaluatedFacts:{selected_by_user:true},pendingConditions:[],sourceRevision:createHash('sha256').update(JSON.stringify({selection,version,subject:party?.partyId,institutions:context.institutionIds.slice().sort()})).digest('hex'),snapshot}];
 });
}
