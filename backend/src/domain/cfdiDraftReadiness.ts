import { Prisma } from '@prisma/client';

type DraftSnapshot = {
  direccion: string; tipo: string; estado: string; entidad_fiscal_id: string | null;
  entidadFiscal: { activa: boolean } | null;
  emisor_rfc: string; receptor_rfc: string; receptor_nombre: string;
  receptor_regimen: string | null; receptor_codigo_postal: string | null;
  uso_cfdi: string | null; metodo_pago: string | null; forma_pago: string | null;
  moneda: string; subtotal: Prisma.Decimal; impuestos_trasladados: Prisma.Decimal;
  impuestos_retenidos: Prisma.Decimal; total: Prisma.Decimal; draft_payload: unknown;
};

/** Data-only preflight. It deliberately says nothing about PAC/CSD or SAT acceptance. */
export function hasCompleteCfdiDraftData(row: DraftSnapshot): boolean {
  if (row.estado !== 'PREFACTURA' || row.direccion !== 'EMITIDO' || row.tipo !== 'I'
    || !row.entidad_fiscal_id || !row.entidadFiscal?.activa
    || !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(row.emisor_rfc)
    || !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(row.receptor_rfc)
    || !row.receptor_nombre.trim() || !row.receptor_regimen?.trim()
    || !/^\d{5}$/.test(row.receptor_codigo_postal || '') || !row.uso_cfdi?.trim()
    || !['PUE', 'PPD'].includes(row.metodo_pago || '')
    || !/^\d{2}$/.test(row.forma_pago || '') || row.moneda !== 'MXN'
    || (row.metodo_pago === 'PPD' && row.forma_pago !== '99')
    || row.total.lessThanOrEqualTo(0)
    || !row.subtotal.plus(row.impuestos_trasladados).minus(row.impuestos_retenidos).equals(row.total)) return false;
  const payload = row.draft_payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const concepts = (payload as Record<string, unknown>).concepts;
  if (!Array.isArray(concepts) || !concepts.length) return false;
  return concepts.every((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    const field = line as Record<string, unknown>;
    return ['clave_prod_serv', 'clave_unidad', 'objeto_impuesto', 'descripcion', 'cantidad', 'valor_unitario']
      .every((key) => typeof field[key] === 'string' && Boolean((field[key] as string).trim()));
  });
}
