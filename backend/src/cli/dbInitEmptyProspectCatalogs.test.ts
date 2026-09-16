import { describe, expect, it, vi } from 'vitest';
import { PROSPECT_OPERATIONAL_STAGES, PROSPECT_SERVICES } from '../domain/prospectCatalog';
import { seedProspectCatalogs } from '../../prisma/seeds/prospect_catalogs.seed';

describe('seedProspectCatalogs', () => {
  it('materializa de forma canónica etapas, actos y los 38 servicios del bootstrap vacío', async () => {
    const prospectoEtapaCatalogo = { upsert: vi.fn().mockResolvedValue({}) };
    const tipoActo = {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: `act-${create.codigo_catalogo}` })),
    };
    const prospectoServicioCatalogo = { upsert: vi.fn().mockResolvedValue({}) };
    const caracterCompareciente = {
      upsert: vi.fn().mockImplementation(({ where }) => Promise.resolve({ id: `character-${where.clave}` })),
    };
    const tipoActoCaracterCompareciente = { upsert: vi.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback({
        prospectoEtapaCatalogo,
        tipoActo,
        prospectoServicioCatalogo,
        caracterCompareciente,
        tipoActoCaracterCompareciente,
      })),
    };

    await seedProspectCatalogs(prisma as never);

    expect(prospectoEtapaCatalogo.upsert).toHaveBeenCalledTimes(PROSPECT_OPERATIONAL_STAGES.length);
    expect(tipoActo.upsert).toHaveBeenCalledTimes(38);
    expect(prospectoServicioCatalogo.upsert).toHaveBeenCalledTimes(38);
    expect(caracterCompareciente.upsert).toHaveBeenCalledTimes(4);
    expect(tipoActoCaracterCompareciente.upsert).toHaveBeenCalledTimes(4);
    expect(prospectoServicioCatalogo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { codigo: 'COMPRAVENTA' },
      create: expect.objectContaining({
        label: 'Compraventa',
        tipo_acto_id: 'act-COMPRAVENTA',
      }),
    }));
    expect(PROSPECT_SERVICES.at(-1)?.code).toBe('ADJUDICACION_REBELDIA');
  });

  it('materializa los caracteres mínimos cuando el baseline aún no tiene datos de catálogo', async () => {
    const characterUpsert = vi.fn().mockImplementation(({ where }) => Promise.resolve({ id: where.clave }));
    const relationUpsert = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (callback) => callback({
        prospectoEtapaCatalogo: { upsert: vi.fn().mockResolvedValue({}) },
        tipoActo: { upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: create.codigo_catalogo })) },
        prospectoServicioCatalogo: { upsert: vi.fn().mockResolvedValue({}) },
        caracterCompareciente: { upsert: characterUpsert },
        tipoActoCaracterCompareciente: { upsert: relationUpsert },
      })),
    };
    await expect(seedProspectCatalogs(prisma as never)).resolves.toBeUndefined();
    expect(characterUpsert).toHaveBeenCalledTimes(4);
    expect(relationUpsert).toHaveBeenCalledTimes(4);
  });
});
