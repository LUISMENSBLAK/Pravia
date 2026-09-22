import { createHash } from 'crypto';
import { CatalogoDestinoFuncional, type Prisma, type PrismaClient } from '@prisma/client';
import { downloadFile } from '../storage/storage.service';
import { CFG002_LIBRARY_CODE } from './configurationCatalogV4.domain';

type Db = PrismaClient | Prisma.TransactionClient;

export const ADMINISTRATIVE_QUOTE_TEMPLATE_CODE = `${CFG002_LIBRARY_CODE}:ADM-001`;
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class AdministrativeQuoteTemplateError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function resolveAdministrativeQuoteTemplate(
  db: Db,
  organizationId: string,
  destination: CatalogoDestinoFuncional = CatalogoDestinoFuncional.COTIZACION_SERVICIOS,
) {
  const links = await db.catalogoArtefactoDestino.findMany({
    where: {
      organization_id: organizationId,
      destino: destination,
      activo: true,
      artefacto: { activo: true, versiones: { some: { activa: true, storage_key: { not: null } } } },
    },
    include: { artefacto: { include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' }, take: 1 } } } },
    orderBy: [{ predeterminado: 'desc' }, { created_at: 'asc' }],
  });
  const defaults = links.filter((item) => item.predeterminado);
  if (defaults.length > 1 || (!defaults.length && links.length > 1)) {
    throw new AdministrativeQuoteTemplateError(409, 'ADMINISTRATIVE_QUOTE_TEMPLATE_AMBIGUOUS', 'Hay más de un formato aplicable y no existe una única selección predeterminada.');
  }
  const selected = defaults[0] || links[0];
  const artifact = selected?.artefacto;
  const version = artifact?.versiones[0];
  if (!artifact || !version?.storage_key || version.mime_type !== DOCX_MIME_TYPE) {
    throw new AdministrativeQuoteTemplateError(409, 'ADMINISTRATIVE_QUOTE_TEMPLATE_NOT_CONFIGURED', 'Configura y activa un formato para este destino funcional en Plantillas y formatos.');
  }

  const source = await downloadFile(version.storage_key);
  if (version.size_bytes != null && source.length !== version.size_bytes) {
    throw new AdministrativeQuoteTemplateError(409, 'ADMINISTRATIVE_QUOTE_TEMPLATE_SIZE_MISMATCH', 'La versión configurada no coincide con su registro.');
  }
  if (version.checksum_sha256 && createHash('sha256').update(source).digest('hex') !== version.checksum_sha256) {
    throw new AdministrativeQuoteTemplateError(409, 'ADMINISTRATIVE_QUOTE_TEMPLATE_CHECKSUM_MISMATCH', 'No fue posible verificar la integridad del formato configurado.');
  }

  return {
    artifact,
    version,
    source,
    sourceLabel: `CFG-002:${destination}:${artifact.id}:V${version.version}`,
    destination,
    mapping: selected.mapeo_datos_json,
  };
}
