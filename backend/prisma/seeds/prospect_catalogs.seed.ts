import type { PrismaClient } from '@prisma/client';
import {
  PROSPECT_OPERATIONAL_STAGES,
  PROSPECT_SERVICES,
} from '../../src/domain/prospectCatalog';

type ProspectCatalogClient = Pick<PrismaClient, '$transaction'>;

const CANONICAL_CHARACTER_MAPPINGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  COMPRAVENTA: Object.freeze(['PARTE_VENDEDORA', 'PARTE_COMPRADORA']),
  CANCELACION_HIPOTECA: Object.freeze(['ACREEDOR_HIPOTECARIO', 'DEUDOR_HIPOTECARIO']),
});

const CANONICAL_CHARACTERS = Object.freeze({
  PARTE_VENDEDORA: { nombre: 'Parte Vendedora', descripcion: 'Transfiere el dominio o propiedad de un bien o derecho' },
  PARTE_COMPRADORA: { nombre: 'Parte Compradora', descripcion: 'Adquiere la propiedad o dominio de un bien o derecho' },
  ACREEDOR_HIPOTECARIO: { nombre: 'Acreedor Hipotecario', descripcion: 'Institución o persona a favor de quien se constituye garantía' },
  DEUDOR_HIPOTECARIO: { nombre: 'Deudor Hipotecario', descripcion: 'Constituye garantía hipotecaria sobre bien de su propiedad' },
});

/**
 * Restores the lookup rows that a schema-only empty-database baseline cannot
 * carry. Existing production databases already received these rows through
 * migrations; the upserts make the same operation safe for both paths.
 */
export async function seedProspectCatalogs(prisma: ProspectCatalogClient) {
  await prisma.$transaction(async (tx) => {
    for (const stage of PROSPECT_OPERATIONAL_STAGES) {
      await tx.prospectoEtapaCatalogo.upsert({
        where: { codigo: stage.code },
        update: { label: stage.label, orden: stage.order, activo: stage.active },
        create: { codigo: stage.code, label: stage.label, orden: stage.order, activo: stage.active },
      });
    }

    for (const service of PROSPECT_SERVICES) {
      const tipoActo = await tx.tipoActo.upsert({
        where: { codigo_catalogo: service.code },
        update: { activo: service.active },
        create: {
          codigo_catalogo: service.code,
          nombre: service.label,
          activo: service.active,
        },
        select: { id: true },
      });
      await tx.prospectoServicioCatalogo.upsert({
        where: { codigo: service.code },
        update: {
          label: service.label,
          orden: service.order,
          activo: service.active,
          estados: service.states,
          tipos_persona: service.personTypes,
          tipo_acto_id: tipoActo.id,
        },
        create: {
          codigo: service.code,
          label: service.label,
          orden: service.order,
          activo: service.active,
          estados: service.states,
          tipos_persona: service.personTypes,
          tipo_acto_id: tipoActo.id,
        },
      });

      const characterKeys = CANONICAL_CHARACTER_MAPPINGS[service.code] ?? [];
      for (const [order, characterKey] of characterKeys.entries()) {
        const definition = CANONICAL_CHARACTERS[characterKey as keyof typeof CANONICAL_CHARACTERS];
        const character = await tx.caracterCompareciente.upsert({
          where: { clave: characterKey },
          update: { ...definition, activo: true },
          create: { clave: characterKey, ...definition, activo: true },
          select: { id: true },
        });
        await tx.tipoActoCaracterCompareciente.upsert({
          where: { tipo_acto_id_caracter_id: { tipo_acto_id: tipoActo.id, caracter_id: character.id } },
          update: { sugerido: true, orden: order },
          create: { tipo_acto_id: tipoActo.id, caracter_id: character.id, sugerido: true, orden: order },
        });
      }
    }
  });
}
