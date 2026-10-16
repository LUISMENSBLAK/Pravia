// Límites de transporte documental. Las restricciones específicas de negocio
// (por ejemplo, CSF o paquetes de importación) se declaran por separado.
export const MEBIBYTE = 1024 * 1024;
export const DOCUMENT_UPLOAD_MAX_BYTES = 50 * MEBIBYTE;
export const FISCAL_UPLOAD_MAX_BYTES = DOCUMENT_UPLOAD_MAX_BYTES;
export const CATALOG_IMPORT_MAX_BYTES = DOCUMENT_UPLOAD_MAX_BYTES;
export const DOCUMENT_ARCHIVE_MAX_BYTES = DOCUMENT_UPLOAD_MAX_BYTES;
export const DOCUMENT_BATCH_MAX_BYTES = 200 * MEBIBYTE;

export function uploadLimitForPath(path: string, field?: string) {
  if (/^\/api\/finanzas\/facturacion\/(?:manual|proveedores(?:\/|$))/.test(path)) return FISCAL_UPLOAD_MAX_BYTES;
  if (/^\/api\/settings\/catalogs\/artifacts\/import\//.test(path)) return CATALOG_IMPORT_MAX_BYTES;
  if (/^\/api\/expedientes\/[^/]+\/documentos\/carga-lote$/.test(path) && field === 'archive') return DOCUMENT_ARCHIVE_MAX_BYTES;
  return DOCUMENT_UPLOAD_MAX_BYTES;
}

export function uploadLimitLabel(bytes: number) {
  return `${bytes / MEBIBYTE} MB`;
}
