export type ArchiveProtocolConfig = { revision: number; anchor_folio: string; anchor_libro: number; anchor_tomo: number; tomos_por_libro: number; folios_por_tomo: number };
export function parseArchiveProtocol(value: unknown): ArchiveProtocolConfig {
  const input = value as ArchiveProtocolConfig;
  if (!input || !/^[1-9]\d{0,18}$/.test(String(input.anchor_folio)) || BigInt(input.anchor_folio) > 9223372036854775807n ||
    ![input.anchor_libro, input.anchor_tomo, input.tomos_por_libro, input.folios_por_tomo].every(item => Number.isSafeInteger(item) && item > 0 && item <= 1_000_000) || input.anchor_tomo > input.tomos_por_libro || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw Error('ARCHIVO_PROTOCOL_INVALID');
  }
  return { revision: input.revision, anchor_folio: String(input.anchor_folio), anchor_libro: input.anchor_libro, anchor_tomo: input.anchor_tomo, tomos_por_libro: input.tomos_por_libro, folios_por_tomo: input.folios_por_tomo };
}
export function archiveProtocolPosition(config: ArchiveProtocolConfig, nextFolio: string | null) {
  const folio = BigInt(nextFolio ?? config.anchor_folio), offset = folio - BigInt(config.anchor_folio);
  if (offset < 0n) return null;
  const perTome = BigInt(config.folios_por_tomo), perBook = BigInt(config.tomos_por_libro);
  const tome = BigInt(config.anchor_tomo - 1) + offset / perTome;
  return { next_folio: folio.toString(), libro: (BigInt(config.anchor_libro) + tome / perBook).toString(), tomo: (tome % perBook + 1n).toString(), folios_restantes: Number(perTome - offset % perTome) };
}
