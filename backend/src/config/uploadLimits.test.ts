import { describe, expect, it } from 'vitest';
import {
  CATALOG_IMPORT_MAX_BYTES,
  DOCUMENT_ARCHIVE_MAX_BYTES,
  DOCUMENT_BATCH_MAX_BYTES,
  DOCUMENT_UPLOAD_MAX_BYTES,
  FISCAL_UPLOAD_MAX_BYTES,
  uploadLimitForPath,
  uploadLimitLabel,
} from './uploadLimits';

describe('upload policy', () => {
  it('declara 50 MB por archivo en todas las superficies y 200 MB por lote', () => {
    expect(DOCUMENT_UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(DOCUMENT_BATCH_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(DOCUMENT_ARCHIVE_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(FISCAL_UPLOAD_MAX_BYTES).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
    expect(CATALOG_IMPORT_MAX_BYTES).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
    expect(uploadLimitForPath('/api/documentos')).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
    expect(uploadLimitForPath('/api/expedientes/exp-1/proyecto/versiones')).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
    expect(uploadLimitForPath('/api/finanzas/facturacion/manual')).toBe(FISCAL_UPLOAD_MAX_BYTES);
    expect(uploadLimitForPath('/api/finanzas/facturacion/proveedores/csf/extraer')).toBe(FISCAL_UPLOAD_MAX_BYTES);
    expect(uploadLimitForPath('/api/settings/catalogs/artifacts/import/preview')).toBe(CATALOG_IMPORT_MAX_BYTES);
    expect(uploadLimitForPath('/api/expedientes/exp-1/documentos/carga-lote', 'files')).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
    expect(uploadLimitForPath('/api/expedientes/exp-1/documentos/carga-lote', 'archive')).toBe(DOCUMENT_ARCHIVE_MAX_BYTES);
    expect(uploadLimitLabel(DOCUMENT_UPLOAD_MAX_BYTES)).toBe('50 MB');
  });

});
