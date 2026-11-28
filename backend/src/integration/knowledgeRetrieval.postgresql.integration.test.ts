import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { KnowledgeService, splitLegalArticles } from '../services/knowledge.service';

const url = process.env.KNOWLEDGE_VALIDITY_QA_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (u.hostname !== '127.0.0.1' || !['55521/pravia_client_qa', '55529/pravia_knowledge_qa'].includes(`${u.port}${u.pathname}`) || u.searchParams.get('schema') !== 'pravia_os') throw Error('KNOWLEDGE_RETRIEVAL_LOCAL_ONLY');
}

describe.runIf(Boolean(url))('Biblioteca — consulta literal y fundamento, en PostgreSQL local', () => {
  it('separa pendiente, exactitud del artículo, jurisdicción, vigencia y organización en SQL real', async () => {
    const db = new PrismaClient({ datasourceUrl: url });
    const rollback = new Error('QA_TRANSACTION_ROLLBACK');
    try {
      await db.$transaction(async tx => {
        const id = randomUUID();
        const [one, two] = await Promise.all(['QA UNO','QA DOS'].map(name => tx.organization.create({ data:{ name } })));
        await tx.user.create({data:{id,email:`legal-${id}@example.test`,nombre:'Sintética',apellido:'QA',rol:'DIRECCION',password_hash:'QA-NO-LOGIN'}});
        for (const org of [one,two]) await tx.organizationMembership.create({data:{organization_id:org.id,user_id:id,rol:'DIRECCION'}});
        const create = async (organization_id: string, title: string, jurisdiction: string, verification_status: string, content_text: string | null, effective_from?: string) => {
          const source = await tx.knowledgeSource.create({ data:{organization_id, title, jurisdiction, category:'LEY',inventory_code:randomUUID(),created_by_id:id} });
          const version = await tx.knowledgeSourceVersion.create({ data:{organization_id, source_id:source.id, version:1, label:'QA', verification_status, content_text, effective_from: effective_from ? new Date(effective_from) : null, provenance:{synthetic:true}, created_by_id:id} });
          if (content_text) await tx.knowledgeArticle.createMany({data:splitLegalArticles(content_text).map(article=>({...article,organization_id,version_id:version.id}))});
          return source.id;
        };
        const pending = await create(one.id,'Código Civil del Estado de Nayarit QA','NAYARIT','PENDIENTE','Artículo 7. Regla sintética QA.\nArtículo 7 Bis. No es el artículo anterior.\nArtículo 70. Inciso que no se pidió.');
        const verified = await create(one.id,'Ley de Ingresos del Estado de Nayarit QA','NAYARIT','VERIFICADA','Artículo 18. Inscripción registral por adquisición de inmuebles.','2026-01-01');
        await create(two.id,'Código Civil ajeno QA','NAYARIT','VERIFICADA','Artículo 7. Privado de otra organización.','2026-01-01');
        await create(one.id,'Código Civil de Jalisco QA','JALISCO','VERIFICADA','Artículo 7. Otro estado.','2026-01-01');
        await create(one.id,'Ley del Notariado de Nayarit QA','NAYARIT','PENDIENTE',null);
        const service = new KnowledgeService(tx as Prisma.TransactionClient as unknown as PrismaClient);
        const actor = {id,organizationId:one.id};
        const query = {query:'¿Qué dice el artículo 7 del Código Civil de Nayarit?',jurisdiction:'Nayarit',legal_date:'2026-11-27'};
        const documentary = await service.retrieve(actor,{...query,include_document_reading:true});
        expect(documentary.evidence).toEqual([]);
        expect(documentary.document_readings).toEqual([expect.objectContaining({source_id:pending,article_fragment:'Artículo 7. Regla sintética QA.',normative_use:false})]);
        expect((await service.retrieve(actor,{...query,query:'artículo 7 bis del Código Civil de Nayarit',include_document_reading:true})).document_readings).toEqual([expect.objectContaining({source_id:pending,article_fragment:'Artículo 7 Bis. No es el artículo anterior.'})]);
        const noReading = await service.retrieve(actor, query);
        expect(noReading.document_readings).toEqual([]);
        const quote = await service.retrieve(actor,{...query,query:'compraventa inscripción registral adquisición bienes inmuebles'});
        expect(quote.evidence).toEqual([expect.objectContaining({source_id:verified})]);
        expect((await service.retrieve(actor,{...query,query:'artículo 18 Ley de Ingresos',legal_date:'2025-12-31'})).evidence).toEqual([]);
        const unreadable = await service.retrieve(actor,{...query,query:'qué dice la Ley del Notariado',include_document_reading:true});
        expect(unreadable.document_readings).toEqual([expect.objectContaining({reading_status:'ORIGINAL CARGADO SIN TEXTO RECUPERABLE',normative_use:false})]);
        throw rollback;
      }, { timeout:20_000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await db.$disconnect(); }
  });
});
