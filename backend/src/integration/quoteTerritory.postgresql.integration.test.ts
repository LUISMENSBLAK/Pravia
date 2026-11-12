import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuoteBudgetService } from '../services/quoteBudget.service';
import { QuoteAIProposalService } from '../services/quoteAIProposal.service';
import { KnowledgeService } from '../services/knowledge.service';
import { initializeQuoteContractInTransaction } from '../services/cotizacionWorkflow.service';

const url = process.env.NOV_QUOTE_TERRITORY_DATABASE_URL;
if (url && url !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os') throw Error('LOCAL_TERRITORY_DATABASE_REQUIRED');
const db = url ? new PrismaClient({ datasources:{ db:{ url } } }) : null;
const ids = { org:randomUUID(),user:randomUUID(),member:randomUUID(),prospect:randomUUID(),quote:randomUUID() };
const actor = { id:ids.user,organizationId:ids.org,membershipId:ids.member,sessionId:randomUUID(),rol:'DIRECCION',scope:'GLOBAL',nombre:'Territorio',apellido:'QA',email:`territory-${ids.user}@example.test`,requiresPasswordChange:false,permissions:['cotizaciones.read','cotizaciones.write','ai.use'] } as NonNullable<Request['user']>;
let criterionId = '';
const confirm = async (municipality = 'Tepic') => {
  const quote = await db!.cotizacion.findUniqueOrThrow({ where:{ id:ids.quote } });
  return new QuoteBudgetService(db!).save(actor,ids.quote,{ operationTerritory:{ jurisdiction:'Nayarit',state:'Nayarit',municipality,confirm:true },expectedUpdatedAt:quote.updated_at.toISOString() });
};

describe.runIf(Boolean(url))('Arancel territorial · PostgreSQL físico aislado', () => {
  beforeAll(async () => {
    if (!db) throw Error('LOCAL_DATABASE_REQUIRED');
    await db.organization.create({ data:{ id:ids.org,name:'QA sintético territorio' } });
    await db.user.create({ data:{ id:ids.user,email:actor.email,password_hash:'synthetic-no-login',nombre:actor.nombre,apellido:'QA',rol:'DIRECCION' } });
    await db.organizationMembership.create({ data:{ id:ids.member,organization_id:ids.org,user_id:ids.user,rol:'DIRECCION',status:'ACTIVE' } });
    await db.prospecto.create({ data:{ id:ids.prospect,organization_id:ids.org,user_id:ids.user,nombre:'Cliente sintético territorio',tipo_acto:'COMPRAVENTA QA TERRITORIO' } });
    await db.$transaction(async (tx) => {
      const quote = await tx.cotizacion.create({ data:{ id:ids.quote,organization_id:ids.org,user_id:ids.user,prospecto_id:ids.prospect } });
      await initializeQuoteContractInTransaction(tx,actor,quote,{ effectiveAt:new Date(),idempotencyKey:randomUUID(),prospectId:ids.prospect });
    });
    criterionId = (await new KnowledgeService(db).createCriterion(actor, { code:`QA-TERR-${ids.org}`,title:'Honorario sintético Tepic',content:'No es norma. Fixture aislada.',scope:{ kind:'ARANCEL_PROPIO',jurisdiction:'Nayarit',state:'Nayarit',municipality:'Tepic',act:'COMPRAVENTA QA TERRITORIO',source:'QA local',author:'QA',review_status:'REVISADO',approval_status:'APROBADO',fixed_honorarium:'4322.00' } })).id;
  });
  afterAll(async () => {
    if (!db) return;
    // Keep canonical append-only transitions and their isolated synthetic tenant
    // as evidence. The test actor has no usable password and no external access.
    await db.$disconnect();
  });
  it('no genera importes cuando falta territorio o difiere el municipio, sin inventar comparables', async () => {
    const service = new QuoteAIProposalService(db!);
    await expect(service.generate(actor,ids.quote,{ idempotency_key:randomUUID() })).rejects.toMatchObject({ code:'QUOTE_AI_FOUNDATION_INSUFFICIENT' });
    await confirm('Bahía de Banderas');
    await expect(service.generate(actor,ids.quote,{ idempotency_key:randomUUID() })).rejects.toMatchObject({ code:'QUOTE_AI_FOUNDATION_INSUFFICIENT' });
    expect(await db!.cotizacionConcepto.count({ where:{ cotizacion_id:ids.quote } })).toBe(0);
  });
  it('persiste confirmación y aplica una sola vez ante tres peticiones concurrentes', async () => {
    await confirm();
    const service = new QuoteAIProposalService(db!);
    const generated = await service.generate(actor,ids.quote,{ idempotency_key:randomUUID() });
    const decisions = await Promise.all([1,2,3].map(()=>service.decide(actor,ids.quote,generated.data.id,{action:'APLICAR'})));
    expect(decisions.filter(row=>!row.idempotent)).toHaveLength(1);
    expect(decisions.every(row=>row.applied)).toBe(true);
    const quote = await db!.cotizacion.findUniqueOrThrow({ where:{ id:ids.quote },include:{ conceptos:true } });
    expect(quote.territorio_operacion).toMatchObject({ municipality:'TEPIC',confirmedById:actor.id });
    expect(quote.conceptos).toHaveLength(2);
    expect(quote.total_cliente?.toFixed(2)).toBe('5013.52');
    expect(await db!.auditLog.count({ where:{ organization_id:ids.org,entidad_id:generated.data.id,accion:'APLICAR_PROPUESTA_COTIZACION_IA' } })).toBe(1);
  });
  it('rechaza política revisada después de generar sin sustituir el presupuesto', async () => {
    const service = new QuoteAIProposalService(db!);
    const before = await db!.cotizacionConcepto.findMany({ where:{ cotizacion_id:ids.quote },orderBy:{ orden:'asc' } });
    const generated = await service.generate(actor,ids.quote,{ idempotency_key:randomUUID() });
    const criterion = await db!.knowledgeCriterion.findUniqueOrThrow({ where:{ id:criterionId } });
    await new KnowledgeService(db!).updateCriterion(actor,criterionId,{ scope:{ ...(criterion.scope as object),fixed_honorarium:'5000.00' } });
    await expect(service.decide(actor,ids.quote,generated.data.id,{action:'APLICAR'})).rejects.toMatchObject({ code:'QUOTE_AI_POLICY_CHANGED' });
    expect(await db!.cotizacionConcepto.findMany({ where:{ cotizacion_id:ids.quote },orderBy:{ orden:'asc' } })).toEqual(before);
    expect((await db!.cotizacionIAProposal.findUniqueOrThrow({ where:{ id:generated.data.id } })).status).toBe('PENDIENTE');
  });
});
