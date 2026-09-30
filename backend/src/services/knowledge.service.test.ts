import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { buildEvidencePacket, exactArticleHeadingPattern, INSUFFICIENT_LEGAL_FOUNDATION, KnowledgeService, normalizeInventoryRow, splitLegalArticles } from './knowledge.service';

describe('KNOW-001 domain',()=>{
  it('normaliza metadata sin declarar una versión verificada',()=>expect(normalizeInventoryRow({ID:'x',codigo:'nay-1',titulo:'Ley',jurisdiccion:'nayarit',tipo:'ley',estado_ingesta:'obtener original oficial'})).toMatchObject({inventory_code:'NAY-1',jurisdiction:'NAYARIT',category:'LEY',ingestion_status:'PENDIENTE_ORIGINAL'}));
  it('devuelve literalmente el bloqueo contractual sin evidencia',()=>expect(buildEvidencePacket([])).toMatchObject({status:'INSUFFICIENT_FOUNDATION',message:INSUFFICIENT_LEGAL_FOUNDATION,evidence:[]}));
  it('no expone razonamiento interno',()=>expect(buildEvidencePacket([{source_id:'s',inventory_code:'F-1',title:'Ley',version:1,label:'V1',article_fragment:'Texto',official_url:'https://oficial.test',validity:{from:null,to:null},jurisdiction:'FEDERAL',category:'LEY',score:1}])).toMatchObject({internal_reasoning:null,disclosure:expect.stringContaining('no razonamiento interno')}));
  it('segmenta artículos y conserva texto',()=>{const result=splitLegalArticles('Preámbulo\nArtículo 1. Uno.\nFracción I.\nARTÍCULO 2 BIS Dos.');expect(result).toHaveLength(2);expect(result[0]).toMatchObject({article_key:'ART-1-1',ordinal:1});expect(result[1].body).toContain('Dos.');});
  it('conserva como documento completo cuando no hay encabezados',()=>expect(splitLegalArticles('Criterio administrativo breve')).toEqual([{article_key:'DOCUMENTO-COMPLETO',heading:'Documento completo',body:'Criterio administrativo breve',ordinal:1,metadata:{generated_from:'full_text'}}]));
  it.each(['ARTÍCULO 1','Artículo 10 Bis','ARTICULO ÚNICO','Artículo Primero'])('reconoce encabezado %s',(heading)=>expect(splitLegalArticles(`${heading}. Contenido.`)).toHaveLength(1));
  it.each([
    ['Artículo 7 capacidad jurídica', '^\\s*ART[IÍ]CULO\\s+7[Oº]?(?:\\s|[.,:;\\-]|$)'],
    ['articulo 10 bis transmisión', '^\\s*ART[IÍ]CULO\\s+10[Oº]?\\s+BIS(?:\\s|[.,:;\\-]|$)'],
    ['consulta sin número de artículo', ''],
  ])('construye referencia exacta de artículo para %s', (query, expected) => expect(exactArticleHeadingPattern(query)).toBe(expected));

  it('aísla la colección de criterios internos por organización', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new KnowledgeService({ knowledgeCriterion: { findMany } } as unknown as PrismaClient);
    await service.listCriteria({ id: 'user-a', organizationId: 'org-a' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organization_id: 'org-a', active: true } }));
  });

  it('crea un criterio auditado y explícitamente separado de las normas', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'criterion-1', code: 'INT-001', active: true });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = { knowledgeCriterion: { create }, auditLog: { create: auditCreate } };
    const service = new KnowledgeService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient);
    const result = await service.createCriterion({ id: 'user-a', organizationId: 'org-a' }, { code: 'int-001', title: 'Revisión interna', content: 'Requiere segunda revisión.', scope: { act: 'COMPRAVENTA' } });
    expect(result).toMatchObject({ id: 'criterion-1', code: 'INT-001' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: 'org-a', created_by_id: 'user-a', code: 'INT-001' }) }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ detalles: expect.objectContaining({ distinction: 'CRITERIO_INTERNO_NO_ES_NORMA' }) }) }));
  });

  it('no actualiza un criterio perteneciente a otra organización', async () => {
    const service = new KnowledgeService({ knowledgeCriterion: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient);
    await expect(service.updateCriterion({ id: 'user-a', organizationId: 'org-a' }, 'criterion-b', { title: 'Intento' })).rejects.toMatchObject({ code: 'KNOW_CRITERION_NOT_FOUND', status: 404 });
  });

  it('cierra la versión anterior en la víspera y conserva su condición histórica verificada', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ id: 'version-2', verification_status: 'VERIFICADA' });
    const tx = {
      knowledgeSourceVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-2', content_text: 'Artículo 1. Texto.', source: { source_url: 'https://oficial.test/ley' }, checksum_sha256: 'abc', effective_from: null }), updateMany, update },
      knowledgeSource: { update: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new KnowledgeService({ $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient);
    await service.verifyVersion({ id: 'user-a', organizationId: 'org-a' }, 'source-1', 'version-2', '2027-01-01');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 'org-a', verification_status: 'VERIFICADA', id: { not: 'version-2' } }),
      data: { verification_status: 'SUPERADA', legal_status: 'HISTORICA', effective_to: new Date('2026-12-31T00:00:00.000Z'), review_required: false },
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ effective_from: new Date('2027-01-01T00:00:00.000Z'), verification_status: 'VERIFICADA' }) }));
  });
});
