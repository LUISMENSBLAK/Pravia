import { Prisma } from '@prisma/client';

type Kind = 'PRO' | 'COT' | 'EXP';

export class OrganizationFolioError extends Error {
  readonly status = 400;
  readonly code = 'EXPEDIENTE_SERIES_INVALID';
}

/** Reserve a folio inside the creating transaction. The counter is never
 * decremented by archival/deletion and the advisory lock serializes first use. */
export async function reserveOrganizationFolio(
  tx: Prisma.TransactionClient,
  organizationId: string,
  kind: Kind,
  effectiveDate = new Date(),
  seriesCode?: string | null,
) {
  const year = effectiveDate.getFullYear();
  if (seriesCode && kind !== 'EXP') throw new OrganizationFolioError('Las series alternativas sólo están disponibles para Expedientes.');
  if (seriesCode && (!/^[A-Z][A-Z0-9]{1,15}$/.test(seriesCode) || seriesCode === 'EXP')) throw new OrganizationFolioError('Código de serie de expediente no válido.');
  const series = seriesCode || kind;
  if (seriesCode) {
    const configured = await tx.expedienteFolioSerie.findUnique({ where: {
      organization_id_code: { organization_id: organizationId, code: seriesCode },
    }, select: { active: true } });
    if (!configured?.active) throw new OrganizationFolioError('La serie de expediente no está configurada o no está activa para esta organización.');
  }
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:folio:${organizationId}:${kind}:${series}:${year}`}))`);
  const key = { organization_id: organizationId, kind, series, year };
  const existing = await tx.folioCounter.findUnique({ where: { organization_id_kind_series_year: key }, select: { last_value: true } });
  const currentPattern = `^${kind}-${seriesCode ? `${seriesCode}-` : ''}([0-9]+)-${year}$`;
  const legacyPattern = seriesCode ? 'a^' : `^${kind}-${year}-([0-9]+)$`;
  const rows: Array<{ highest: number }> = kind === 'PRO'
    ? await tx.$queryRaw(Prisma.sql`SELECT GREATEST(COALESCE(MAX(substring(folio from ${currentPattern})::int), 0), COALESCE(MAX(substring(folio from ${legacyPattern})::int), 0))::int AS highest FROM pravia_os.prospectos WHERE organization_id = ${organizationId}::uuid`)
    : kind === 'COT'
      ? await tx.$queryRaw(Prisma.sql`SELECT GREATEST(COALESCE(MAX(substring(numero_cotizacion from ${currentPattern})::int), 0), COALESCE(MAX(substring(numero_cotizacion from ${legacyPattern})::int), 0))::int AS highest FROM pravia_os.cotizaciones WHERE organization_id = ${organizationId}::uuid`)
      : await tx.$queryRaw(Prisma.sql`SELECT GREATEST(COALESCE(MAX(substring(numero_pravia from ${currentPattern})::int), 0), COALESCE(MAX(substring(numero_pravia from ${legacyPattern})::int), 0))::int AS highest FROM pravia_os.expedientes WHERE organization_id = ${organizationId}::uuid`);
  const highest = rows[0]?.highest ?? 0;
  if (!existing) {
    await tx.folioCounter.create({ data: { ...key, last_value: highest } });
  } else if (existing.last_value < highest) {
    await tx.folioCounter.update({ where: { organization_id_kind_series_year: key }, data: { last_value: highest } });
  }
  const counter = await tx.folioCounter.update({
    where: { organization_id_kind_series_year: key },
    data: { last_value: { increment: 1 } },
    select: { last_value: true },
  });
  return `${kind}-${seriesCode ? `${seriesCode}-` : ''}${String(counter.last_value).padStart(4, '0')}-${year}`;
}
