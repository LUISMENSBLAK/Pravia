import { describe, expect, it, vi } from 'vitest';
import { ExpedientePrediosService } from './expedientePredios.service';

const actor: any = { id: 'user-1', organizationId: 'org-1', sessionId: 'session-1', rol: 'ADMINISTRACION', permissions: ['expedientes.read', 'expedientes.write'], scope: 'GLOBAL' };
const now = new Date('2026-08-28T12:00:00Z');
const property = { id: 'property-1', apodo: 'Casa Bucerías', clave_catastral: 'CAT-1', cuenta_predial: null, folio_real: 'FR-1', ubicacion_texto: null, calle: null, numero_exterior: null, colonia: null, municipio: 'Bahía de Banderas', estado: 'Nayarit' };
const acts = [
  { id: 'act-1', tipo_acto_id: 'type-1', updated_at: now, tipo_acto: { id: 'type-1', nombre: 'Compraventa' } },
  { id: 'act-2', tipo_acto_id: 'type-2', updated_at: now, tipo_acto: { id: 'type-2', nombre: 'Fideicomiso' } },
];

function database(options: { inaccessibleExp?: boolean; inaccessibleProperty?: boolean; duplicate?: boolean; protected?: number; immutable?: boolean; prior?: any; existing?: any; artifacts?: any[]; invalidActs?: boolean } = {}) {
  const existing = options.existing || null;
  let relation: any = existing;
  const childLinks: any[] = existing?.actos?.map((item: any, index: number) => ({ id: `child-${index}`, organization_id: 'org-1', expediente_predio_id: existing.id, expediente_acto_id: item.expediente_acto_id, estatus: 'ACTIVO' })) || [];
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    expediente: {
      findFirst: vi.fn().mockImplementation(async ({ select }: any) => {
        if (options.inaccessibleExp) return null;
        if (select && !select.version) return { id: 'exp-1' };
        return { id: 'exp-1', version: 4, estatus: options.immutable ? 'FIRMADO' : 'EN_PROCESO', updated_at: now, _count: { expedienteDocumentos: options.protected || 0, requisitos_docs: 0 }, predios: existing ? [existing] : [] };
      }),
      update: vi.fn().mockResolvedValue({ version: 5 }),
    },
    predio: { findFirst: vi.fn().mockResolvedValue(options.inaccessibleProperty ? null : { id: 'property-1' }), findMany: vi.fn().mockResolvedValue([property]) },
    expedienteActo: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => options.invalidActs ? acts.slice(0, 1) : acts.filter((item) => where.id.in.includes(item.id))),
    },
    catalogoArtefacto: { findMany: vi.fn().mockResolvedValue(options.artifacts || []) },
    expedientePredio: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.idempotency_key) return options.prior || null;
        if (where.predio_id) return options.duplicate ? existing || { id: 'duplicate', predio_id: 'property-1', estatus: 'ACTIVO' } : null;
        return relation;
      }),
      findMany: vi.fn().mockResolvedValue(existing ? [existing] : []),
      create: vi.fn().mockImplementation(async ({ data }: any) => (relation = { id: 'relation-new', estatus: 'ACTIVO', predio: property, actos: [], ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => (relation = { ...relation, ...data })),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...relation, predio: property, actos: childLinks.filter((item) => item.estatus === 'ACTIVO').map((item) => ({ ...item, expedienteActo: acts.find((act) => act.id === item.expediente_acto_id) })) })),
    },
    expedienteActoPredio: {
      findMany: vi.fn().mockResolvedValue(childLinks),
      create: vi.fn().mockImplementation(async ({ data }: any) => { const row = { id: `child-${childLinks.length + 1}`, estatus: 'ACTIVO', ...data }; childLinks.push(row); return row; }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => { const row = childLinks.find((item) => item.id === where.id); Object.assign(row, data); return row; }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) }, expedienteActividad: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) }, domainEventOutbox: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
  };
  const prisma: any = { ...tx, $transaction: vi.fn(async (callback: any) => callback(tx)) };
  return { prisma, tx };
}

const link = (overrides: Record<string, unknown> = {}) => ({ operation: 'LINK' as const, predio_id: 'property-1', expediente_acto_ids: ['act-1', 'act-2'], ...overrides });
const current = { id: 'relation-1', predio_id: 'property-1', updated_at: now, predio: property, actos: [{ expediente_acto_id: 'act-1' }, { expediente_acto_id: 'act-2' }] };

describe('PRD-001 relaciones expediente–predio–acto', () => {
  it('vincula un maestro a dos actos sin duplicarlo', async () => { const { prisma, tx } = database(); const service = new ExpedientePrediosService(prisma); const preview = await service.preview(actor, 'exp-1', link()); await service.apply(actor, 'exp-1', { ...link(), idempotency_key: 'one', preview_fingerprint: preview.fingerprint }); expect(tx.expedientePredio.create).toHaveBeenCalledTimes(1); expect(tx.expedienteActoPredio.create).toHaveBeenCalledTimes(2); expect(tx.predio.create).toBeUndefined(); });
  it('bloquea duplicar el mismo maestro en el expediente', async () => { const { prisma } = database({ duplicate: true, existing: current }); await expect(new ExpedientePrediosService(prisma).preview(actor, 'exp-1', link())).rejects.toMatchObject({ code: 'PREDIO_RELATION_DUPLICATE', status: 409 }); });
  it('bloquea expediente ajeno', async () => { const { prisma } = database({ inaccessibleExp: true }); await expect(new ExpedientePrediosService(prisma).preview(actor, 'foreign', link())).rejects.toMatchObject({ code: 'EXPEDIENTE_ACCESS_DENIED', status: 403 }); });
  it('bloquea predio ajeno', async () => { const { prisma } = database({ inaccessibleProperty: true }); await expect(new ExpedientePrediosService(prisma).preview(actor, 'exp-1', link())).rejects.toMatchObject({ code: 'PREDIO_ACCESS_DENIED', status: 403 }); });
  it('bloquea acto que no pertenece al expediente', async () => { const { prisma } = database({ invalidActs: true }); await expect(new ExpedientePrediosService(prisma).preview(actor, 'exp-1', link())).rejects.toMatchObject({ code: 'PREDIO_ACT_ACCESS_DENIED', status: 403 }); });
  it('rechaza preview obsoleto antes de mutar', async () => { const { prisma, tx } = database(); await expect(new ExpedientePrediosService(prisma).apply(actor, 'exp-1', { ...link(), idempotency_key: 'stale', preview_fingerprint: 'obsolete' })).rejects.toMatchObject({ code: 'PREDIO_RELATION_PREVIEW_STALE', status: 409 }); expect(tx.expedientePredio.create).not.toHaveBeenCalled(); });
  it('desvincula la relación sin borrar maestro ni documento', async () => { const { prisma, tx } = database({ existing: current }); const service = new ExpedientePrediosService(prisma); const command = { operation: 'UNLINK' as const, relation_id: 'relation-1', reason: 'Ya no participa' }; const preview = await service.preview(actor, 'exp-1', command); await service.apply(actor, 'exp-1', { ...command, idempotency_key: 'unlink', preview_fingerprint: preview.fingerprint }); expect(tx.expedientePredio.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estatus: 'INACTIVO' }) })); expect(tx.predio.delete).toBeUndefined(); expect(tx.documento?.delete).toBeUndefined(); });
  it('retira sólo un acto y conserva el otro', async () => { const { prisma, tx } = database({ existing: current }); const service = new ExpedientePrediosService(prisma); const command = { operation: 'UPDATE' as const, relation_id: 'relation-1', expediente_acto_ids: ['act-2'] }; const preview = await service.preview(actor, 'exp-1', command); await service.apply(actor, 'exp-1', { ...command, idempotency_key: 'partial', preview_fingerprint: preview.fingerprint }); expect(tx.expedienteActoPredio.update).toHaveBeenCalledTimes(1); expect(tx.expedientePredio.update).toHaveBeenCalledWith(expect.objectContaining({ data: { idempotency_key: 'partial' } })); });
  it('exige confirmación cuando se retira aplicabilidad con trabajo protegido', async () => { const artifact = { id: 'artifact-1', nombre: 'Formato inmueble', actos: [{ tipo_acto_id: 'type-1' }] }; const { prisma, tx } = database({ existing: current, protected: 2, artifacts: [artifact] }); tx.catalogoArtefacto.findMany.mockImplementation(async ({ where }: any) => where.actos.some.tipo_acto_id.in.includes('type-1') ? [artifact] : []); const service = new ExpedientePrediosService(prisma); const command = { operation: 'UPDATE' as const, relation_id: 'relation-1', expediente_acto_ids: ['act-2'] }; const preview = await service.preview(actor, 'exp-1', command); expect(preview.classification).toBe('REVIEW_REQUIRED'); await expect(service.apply(actor, 'exp-1', { ...command, idempotency_key: 'protected', preview_fingerprint: preview.fingerprint })).rejects.toMatchObject({ code: 'PREDIO_RELATION_CONFIRMATION_REQUIRED' }); });
  it('devuelve idempotentemente el vínculo previo', async () => { const prior = { ...current, idempotency_key: 'same' }; const { prisma, tx } = database({ prior }); const result = await new ExpedientePrediosService(prisma).apply(actor, 'exp-1', { ...link(), idempotency_key: 'same', preview_fingerprint: 'ignored' }); expect(result).toMatchObject({ relation: prior, idempotent: true }); expect(tx.expedientePredio.create).not.toHaveBeenCalled(); });
});
