import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const mocks = vi.hoisted(() => ({
  quote: vi.fn(), current: vi.fn(), resolve: vi.fn(), upload: vi.fn(), download: vi.fn(), remove: vi.fn(),
  create: vi.fn(), audit: vi.fn(), link: vi.fn(), lock: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: {
  cotizacion: { findFirst: mocks.quote }, organization: { findUnique: vi.fn().mockResolvedValue({ name: 'SINTÉTICO QA' }) },
  cotizacionDocumento: { count: vi.fn().mockResolvedValue(0) },
  $transaction: (work: (tx: unknown) => unknown) => work({ $executeRaw: mocks.lock, cotizacion: { findFirst: mocks.current }, documento: { create: mocks.create }, cotizacionDocumento: { create: mocks.link }, auditLog: { create: mocks.audit } }),
} }));
vi.mock('./supabase.service', () => ({ uploadFile: mocks.upload, downloadFile: mocks.download, deleteFile: mocks.remove }));
vi.mock('./administrativeQuoteTemplate.service', async original => ({
  ...await original<typeof import('./administrativeQuoteTemplate.service')>(), resolveAdministrativeQuoteTemplate: mocks.resolve,
}));
import { QuoteDocumentService } from './quoteDocument.service';

const actor = { id: 'user-qa', organizationId: 'org-qa', sessionId: 'session-qa' } as NonNullable<Request['user']>;
const revision = new Date('2026-11-23T00:00:00Z');
const quote = {
  id: 'quote-qa', updated_at: revision, numero_cotizacion: 'COT-SINTETICO', predio_principal_id: 'property-qa',
  predio_principal: { id: 'property-qa', version: 1, archived_at: null, valor_operacion: '1000.50', valor_catastral: '0', valor_avaluo: null },
  conceptos: [{ concepto: 'Honorario sintético', categoria: 'HONORARIOS', importe: '100', tratamiento_iva: null, iva_tasa: null }], pagos: [],
};

describe('Generación de Cotización · consistencia de revisión de las fuentes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const library = new PizZip(readFileSync(fileURLToPath(new URL('../../resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip', import.meta.url))));
    const entry = Object.keys(library.files).find(name => name.endsWith('/ADM-001_Cotizacion_Servicios_Notariales.docx'))!;
    mocks.resolve.mockResolvedValue({ artifact: { id: 'artifact-qa' }, version: { id: 'template-qa', version: 1 }, source: Buffer.from(library.file(entry)!.asUint8Array()), mapping: null });
    mocks.quote.mockResolvedValue(quote); mocks.current.mockResolvedValue(quote);
    mocks.upload.mockImplementation(async bytes => { mocks.download.mockResolvedValue(Buffer.from(bytes)); });
    mocks.create.mockImplementation(async ({ data }) => ({ id: 'document-qa', ...data }));
    mocks.remove.mockResolvedValue(undefined);
  });
  it('guarda procedencia y los valores exactos de una fuente estable', async () => {
    const document = await new QuoteDocumentService().generate(actor, quote.id);
    expect(document.datos_extraidos).toMatchObject({ generation: { property_source: { kind: 'PREDIO_MASTER', id: 'property-qa', version: 1 }, property_values: { operation: '1000.50', cadastral: '0', appraisal: null } } });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([
    { ...quote, updated_at: new Date(revision.getTime() + 1) },
    { ...quote, predio_principal_id: 'other-property' },
    { ...quote, predio_principal: { ...quote.predio_principal, version: 2 } },
    { ...quote, predio_principal: { ...quote.predio_principal, archived_at: new Date() } },
    null,
  ])('rechaza revisión modificada y retira sólo el objeto temporal nuevo, sin persistir un documento obsoleto', async current => {
    mocks.current.mockResolvedValue(current);
    await expect(new QuoteDocumentService().generate(actor, quote.id)).rejects.toMatchObject({ status: 409, code: 'QUOTE_DOCUMENT_SOURCE_CHANGED' });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.link).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove.mock.calls[0][0]).toBe(mocks.upload.mock.calls[0][1]);
  });
});
