import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const storage = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../storage/storage.service', () => ({ downloadFile: storage.downloadFile }));

import {
  ADMINISTRATIVE_QUOTE_TEMPLATE_CODE,
  AdministrativeQuoteTemplateError,
  DOCX_MIME_TYPE,
  resolveAdministrativeQuoteTemplate,
} from './administrativeQuoteTemplate.service';

const configured = (version: number, source: Buffer) => ({
  id: 'artifact-adm-001',
  codigo_biblioteca: ADMINISTRATIVE_QUOTE_TEMPLATE_CODE,
  tipo: 'FORMATO',
  activo: true,
  versiones: [{
    id: `version-${version}`,
    version,
    activa: true,
    storage_key: `templates/adm-001-v${version}.docx`,
    mime_type: DOCX_MIME_TYPE,
    size_bytes: source.length,
    checksum_sha256: createHash('sha256').update(source).digest('hex'),
  }],
});

const configuredLink = (version: number, source: Buffer) => ({
  predeterminado: true,
  mapeo_datos_json: null,
  artefacto: configured(version, source),
});

describe('ADM-001 · resolución canónica compartida', () => {
  beforeEach(() => vi.clearAllMocks());

  it('consume exactamente la versión A activa de CFG-002', async () => {
    const source = Buffer.from('DOCX-TEMPLATE-A');
    const db: any = { catalogoArtefactoDestino: { findMany: vi.fn().mockResolvedValue([configuredLink(1, source)]) } };
    storage.downloadFile.mockResolvedValue(source);

    const resolved = await resolveAdministrativeQuoteTemplate(db, 'org-1');

    expect(resolved.source).toEqual(source);
    expect(resolved.sourceLabel).toContain(':V1');
    expect(db.catalogoArtefactoDestino.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: 'org-1', destino: 'COTIZACION_SERVICIOS', activo: true }),
    }));
  });

  it('al activar la versión B consume B y no conserva la fuente A', async () => {
    const sourceA = Buffer.from('DOCX-TEMPLATE-A');
    const sourceB = Buffer.from('DOCX-TEMPLATE-B');
    const findMany = vi.fn()
      .mockResolvedValueOnce([configuredLink(1, sourceA)])
      .mockResolvedValueOnce([configuredLink(2, sourceB)]);
    const db: any = { catalogoArtefactoDestino: { findMany } };
    storage.downloadFile.mockResolvedValueOnce(sourceA).mockResolvedValueOnce(sourceB);

    const first = await resolveAdministrativeQuoteTemplate(db, 'org-1');
    const second = await resolveAdministrativeQuoteTemplate(db, 'org-1');

    expect(first.source).toEqual(sourceA);
    expect(second.source).toEqual(sourceB);
    expect(second.source).not.toEqual(first.source);
    expect(second.sourceLabel).toContain(':V2');
  });

  it('sin ADM-001 configurada falla explícitamente y no usa fallback', async () => {
    const db: any = { catalogoArtefactoDestino: { findMany: vi.fn().mockResolvedValue([]) } };

    await expect(resolveAdministrativeQuoteTemplate(db, 'org-1')).rejects.toMatchObject<Partial<AdministrativeQuoteTemplateError>>({
      status: 409,
      code: 'ADMINISTRATIVE_QUOTE_TEMPLATE_NOT_CONFIGURED',
    });
    expect(storage.downloadFile).not.toHaveBeenCalled();
  });
});
