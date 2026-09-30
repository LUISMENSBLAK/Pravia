import { PrismaClient } from '@prisma/client';
import prisma from '../src/config/prisma';
import { actorScopeForRole, runWithActorContext } from '../src/auth/actorContext';
import { permissionsForRole } from '../src/auth/permissions';
import { KnowledgeService } from '../src/services/knowledge.service';
import { readKnowledgeInventoryXlsx } from '../src/services/knowledgeInventoryXlsx.service';

const arg=(name:string)=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';};
const identityDb=new PrismaClient();
async function main(){
  const file=arg('--file'); const organizationId=arg('--organization'); const userId=arg('--user');
  if(!file||!organizationId||!userId) throw new Error('Uso: ts-node scripts/import-knowledge-inventory.ts --file <xlsx> --organization <uuid> --user <uuid>');
  const membership=await identityDb.organizationMembership.findFirst({
    where:{organization_id:organizationId,user_id:userId,status:'ACTIVE',user:{activo:true}},
    include:{user:true},
  });
  if(!membership) throw new Error('El usuario local no pertenece a la organización indicada.');
  const rows=await readKnowledgeInventoryXlsx(file);
  const permissions=permissionsForRole(membership.rol);
  const result=await runWithActorContext({
    userId,
    organizationId,
    membershipId:membership.id,
    role:membership.rol,
    permissions,
    scope:actorScopeForRole(membership.rol),
    sessionId:'KNOWLEDGE-INVENTORY-LOCAL-IMPORT',
  },()=>new KnowledgeService(prisma).importInventory({id:userId,organizationId},rows,85));
  const counts=rows.reduce<Record<string,number>>((out,row)=>({...out,[row.jurisdiction]:(out[row.jurisdiction]||0)+1}),{});
  console.log(JSON.stringify({...result,counts,priorityA:rows.filter((row)=>row.priority==='A').length,pendingOfficial:rows.filter((row)=>row.ingestion_status.startsWith('PENDIENTE_')).map((row)=>row.inventory_code)},null,2));
}
main().finally(()=>Promise.allSettled([prisma.$disconnect(),identityDb.$disconnect()]));
