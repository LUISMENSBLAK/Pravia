import { CatalogoDestinoFuncional, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { CatalogConfigurationError } from './configurationCatalogError';

type Actor = NonNullable<Express.Request['user']>;
type ParsedDestination = {
  destino: CatalogoDestinoFuncional;
  activo: boolean;
  predeterminado: boolean;
  reglas_json?: Prisma.InputJsonValue;
  mapeo_datos_json?: Prisma.InputJsonValue;
};

export const FUNCTIONAL_DESTINATIONS = [
  { value: CatalogoDestinoFuncional.COTIZACION_SERVICIOS, label: 'Cotización de servicios', artifactTypes: ['PLANTILLA', 'FORMATO'] },
  { value: CatalogoDestinoFuncional.EXPEDIENTE_PRESUPUESTO, label: 'Presupuesto del expediente', artifactTypes: ['PLANTILLA', 'FORMATO'] },
  { value: CatalogoDestinoFuncional.CALCULO_ISR_MEMORIA, label: 'Memoria de cálculo ISR', artifactTypes: ['PLANTILLA', 'FORMATO'] },
  { value: CatalogoDestinoFuncional.FINANZAS_RECIBO_PAGO, label: 'Recibo de pago', artifactTypes: ['PLANTILLA', 'FORMATO'] },
  { value: CatalogoDestinoFuncional.FINANZAS_SOLICITUD_PAGO, label: 'Solicitud de pago', artifactTypes: ['PLANTILLA', 'FORMATO'] },
  { value: CatalogoDestinoFuncional.PROYECTO_MACHOTE, label: 'Machote para proyecto', artifactTypes: ['PLANTILLA'] },
  { value: CatalogoDestinoFuncional.EXPEDIENTE_DOCUMENTO_GENERICO, label: 'Documento genérico del expediente', artifactTypes: ['PLANTILLA', 'FORMATO'] },
  { value: CatalogoDestinoFuncional.CUMPLIMIENTO_PLD_UIF, label: 'Cumplimiento PLD / UIF', artifactTypes: ['PLANTILLA', 'FORMATO'] },
] as const;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function destination(value: unknown) {
  if (!Object.values(CatalogoDestinoFuncional).includes(value as CatalogoDestinoFuncional) || value === CatalogoDestinoFuncional.SIN_ASIGNAR) {
    throw new CatalogConfigurationError(400, 'FUNCTIONAL_DESTINATION_INVALID', 'Selecciona un destino funcional válido.');
  }
  return value as CatalogoDestinoFuncional;
}

export const functionalDestinationService = {
  catalog() {
    return FUNCTIONAL_DESTINATIONS;
  },

  async assign(actor: Actor, artifactId: string, input: any) {
    const artifact = await prisma.catalogoArtefacto.findFirst({ where: { id: artifactId, organization_id: actor.organizationId }, select: { id: true, tipo: true } });
    if (!artifact) throw new CatalogConfigurationError(404, 'ARTIFACT_NOT_FOUND', 'Archivo maestro no encontrado.');
    const values = Array.isArray(input?.destinos) ? input.destinos : [];
    const parsed: ParsedDestination[] = values.map((item: any) => ({
      destino: destination(item?.destino), activo: item?.activo !== false, predeterminado: item?.predeterminado === true,
      reglas_json: item?.reglas_json == null ? undefined : json(item.reglas_json),
      mapeo_datos_json: item?.mapeo_datos_json == null ? undefined : json(item.mapeo_datos_json),
    }));
    if (new Set(parsed.map((item) => item.destino)).size !== parsed.length) throw new CatalogConfigurationError(400, 'FUNCTIONAL_DESTINATION_DUPLICATE', 'No repitas un destino funcional para el mismo formato.');
    for (const item of parsed) {
      const specification = FUNCTIONAL_DESTINATIONS.find((candidate) => candidate.value === item.destino)!;
      if (!(specification.artifactTypes as readonly string[]).includes(artifact.tipo)) throw new CatalogConfigurationError(400, 'FUNCTIONAL_DESTINATION_TYPE_MISMATCH', `${specification.label} no admite archivos de tipo ${artifact.tipo}.`);
    }
    return prisma.$transaction(async (tx) => {
      const before = await tx.catalogoArtefactoDestino.findMany({ where: { organization_id: actor.organizationId, artefacto_id: artifactId } });
      await tx.catalogoArtefactoDestino.deleteMany({ where: { organization_id: actor.organizationId, artefacto_id: artifactId } });
      if (parsed.length) await tx.catalogoArtefactoDestino.createMany({ data: parsed.map((item) => ({ ...item, organization_id: actor.organizationId, artefacto_id: artifactId, creado_por_id: actor.id, actualizado_por_id: actor.id })) });
      const after = await tx.catalogoArtefactoDestino.findMany({ where: { organization_id: actor.organizationId, artefacto_id: artifactId }, orderBy: { destino: 'asc' } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'CFG002_FUNCTIONAL_DESTINATIONS_UPDATED', entidad: 'CatalogoArtefacto', entidad_id: artifactId, valores_anteriores: json(before), valores_nuevos: json(after), session_id: actor.sessionId } });
      return after;
    });
  },

  async resolve(actor: Actor, destinationRaw: unknown, options: { tipoActoId?: string | null } = {}) {
    const functionalDestination = destination(destinationRaw);
    const links = await prisma.catalogoArtefactoDestino.findMany({
      where: {
        organization_id: actor.organizationId, destino: functionalDestination, activo: true,
        artefacto: {
          activo: true,
          ...(options.tipoActoId ? { OR: [{ actos: { none: {} } }, { actos: { some: { tipo_acto_id: options.tipoActoId } } }] } : {}),
          versiones: { some: { activa: true, storage_key: { not: null } } },
        },
      },
      include: { artefacto: { include: { actos: true, versiones: { where: { activa: true, storage_key: { not: null } }, orderBy: { version: 'desc' }, take: 1 } } } },
      orderBy: [{ predeterminado: 'desc' }, { created_at: 'asc' }],
    });
    const exact = options.tipoActoId ? links.filter((link) => link.artefacto.actos.some((act) => act.tipo_acto_id === options.tipoActoId)) : links;
    const candidates = exact.length ? exact : links.filter((link) => link.artefacto.actos.length === 0);
    const defaults = candidates.filter((link) => link.predeterminado);
    if (!candidates.length) throw new CatalogConfigurationError(409, 'FUNCTIONAL_DESTINATION_MISSING', 'No existe un formato activo aplicable para este destino funcional.');
    if (defaults.length > 1 || (!defaults.length && candidates.length > 1)) throw new CatalogConfigurationError(409, 'FUNCTIONAL_DESTINATION_AMBIGUOUS', 'Hay más de un formato aplicable y no existe una única selección predeterminada.');
    const selected = defaults[0] || candidates[0];
    const version = selected.artefacto.versiones[0];
    if (!version) throw new CatalogConfigurationError(409, 'FUNCTIONAL_DESTINATION_VERSION_MISSING', 'El formato seleccionado no tiene una versión de archivo activa.');
    return {
      destination: functionalDestination,
      artifact: selected.artefacto,
      version,
      rules: selected.reglas_json,
      data_mapping: selected.mapeo_datos_json,
      provenance: { artifact_id: selected.artefacto_id, version_id: version.id, version: version.version, checksum_sha256: version.checksum_sha256 },
    };
  },
};
