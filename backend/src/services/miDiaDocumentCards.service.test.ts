import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaDocumentCardsService } from './miDiaDocumentCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['expedientes.read', 'documentos.read'], requiresPasswordChange: false };

describe('Mi Día document cards: current canonical links', () => {
  it('counts required documents only when no current nonexpired linked file exists', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const findMany = vi.fn().mockResolvedValue([{ id: 'req-1', nombre: 'Identificación', estatus: 'PENDIENTE',
      expediente: { id: 'case-1', numero_pravia: 'EXP-0001-2026' } }]);
    const source = new MiDiaDocumentCardsService({ expedienteRequisitoDoc: { count, findMany } } as unknown as PrismaClient);
    const result = await source.read(actor, 'MISSING_DOCUMENTS', { scope: 'OWN', limit: 5,
      now: new Date('2026-10-13T12:00:00.000Z') });
    expect(result.count).toBe(2);
    expect(result.items[0].href).toBe('/expedientes/case-1#documentos');
    expect(findMany.mock.calls[0][0].take).toBe(5);
    expect(count.mock.calls[0][0].where).toMatchObject({ obligatorio: true,
      documentoVinculos: { none: { estatus: 'ACTIVO', documento: { is: {
        organization_id: actor.organizationId, OR: expect.any(Array),
      } } } },
    });
  });

  it('requires a real review state and a current linked document', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const source = new MiDiaDocumentCardsService({ expedienteRequisitoDoc: { count, findMany } } as unknown as PrismaClient);
    await source.read(actor, 'DOCUMENTS_TO_REVIEW', { scope: 'ORGANIZATION' });
    expect(count.mock.calls[0][0].where).toMatchObject({ estatus: 'EN_REVISION',
      documentoVinculos: { some: { estatus: 'ACTIVO' } },
    });
  });

  it('requires actual expiry date and an active linked case, never age alone', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const source = new MiDiaDocumentCardsService({ documento: { count, findMany } } as unknown as PrismaClient);
    const now = new Date('2026-10-13T12:00:00.000Z');
    await source.read(actor, 'EXPIRED_DOCUMENTS', { scope: 'ORGANIZATION', now });
    expect(count.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      fecha_vigencia: { lt: now }, expedienteVinculos: { some: { estatus: 'ACTIVO' } },
    });
  });

  it('does not query documents without both object and source permissions', async () => {
    const count = vi.fn();
    const source = new MiDiaDocumentCardsService({ documento: { count } } as unknown as PrismaClient);
    await expect(source.read({ ...actor, permissions: ['documentos.read'] }, 'EXPIRED_DOCUMENTS', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_DOCUMENT_READ_DENIED');
    expect(count).not.toHaveBeenCalled();
  });

  it('reads only materialized CFG-002 compareciente formats eligible for generation', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: 'pending-1', estado: 'PENDIENTE',
      artefacto: { nombre: 'Formato legal' }, expediente: { id: 'case-1', numero_pravia: 'EXP-0001-2026' } }]);
    const source = new MiDiaDocumentCardsService({ expedienteArtefactoPendiente: { count, findMany } } as unknown as PrismaClient);
    const authorized = { ...actor, permissions: [...actor.permissions, 'expedientes.project.read'] as Actor['permissions'] };
    const result = await source.read(authorized, 'FORMATS_TO_GENERATE', { scope: 'OWN' });
    expect(result).toMatchObject({ count: 1, items: [{ id: 'pending-1', nombre: 'Formato legal',
      href: '/expedientes/case-1#plantillas' }] });
    expect(count.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      en_alcance: true, estado: 'PENDIENTE', current_document_id: null,
      sujeto_tipo: 'COMPARECIENTE', artefacto: { is: { tipo: 'FORMATO' } },
      expediente: { is: expect.objectContaining({ organization_id: actor.organizationId }) },
    });
    await expect(source.read(actor, 'FORMATS_TO_GENERATE', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_DOCUMENT_READ_DENIED');
  });

  it('counts only generated formats of current signed-document requirements without a signed upload', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'required', review_id: 'review-current', label: 'Formato firmado',
        state: { current_review_id: 'review-current' },
        expediente: { id: 'case-1', numero_pravia: 'EXP-0001-2026' },
        evidence: [{ document_state: 'GENERATED' }] },
      { id: 'signed', review_id: 'review-current', label: 'Ya firmado',
        state: { current_review_id: 'review-current' },
        expediente: { id: 'case-1', numero_pravia: 'EXP-0001-2026' },
        evidence: [{ document_state: 'GENERATED' }, { document_state: 'SIGNED_UPLOADED' }] },
      { id: 'old', review_id: 'review-old', label: 'Revisión antigua',
        state: { current_review_id: 'review-current' },
        expediente: { id: 'case-2', numero_pravia: 'EXP-0002-2026' },
        evidence: [{ document_state: 'GENERATED' }] },
    ]);
    const source = new MiDiaDocumentCardsService({ complianceRequirement: { findMany } } as unknown as PrismaClient);
    const authorized = { ...actor, permissions: [...actor.permissions, 'compliance.read'] as Actor['permissions'] };
    expect(await source.read(authorized, 'FORMATS_TO_SIGN', { scope: 'ORGANIZATION' })).toEqual({ count: 1,
      items: [{ id: 'required', folio: 'EXP-0001-2026', nombre: 'Formato firmado',
        estado: 'PENDIENTE_FIRMA', href: '/expedientes/case-1#cumplimiento' }] });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      requires_signed_document: true,
      evidence: { some: { estatus: 'ACTIVO', source: 'FORMAT_GENERATED', document_state: 'GENERATED' } },
      expediente: { is: expect.objectContaining({ organization_id: actor.organizationId }) },
    });
    await expect(source.read(actor, 'FORMATS_TO_SIGN', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_DOCUMENT_READ_DENIED');
  });

  it('counts only persisted observations of the active report for the active project version', async () => {
    const reports = vi.fn().mockResolvedValue([
      { id: 'report-own', expediente_id: 'case-own', expediente: { id: 'case-own', numero_pravia: 'EXP-0001-2026' },
        datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: 'project-own', observaciones: [
          { tipo_discrepancia: 'Identificación inconsistente', nivel_riesgo: 'ALTO' },
          { tipo_discrepancia: 'Dato no sustentado', nivel_riesgo: 'MEDIO' },
        ] } } },
      { id: 'report-old', expediente_id: 'case-other', expediente: { id: 'case-other', numero_pravia: 'EXP-0002-2026' },
        datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: 'project-old', observaciones: [
          { tipo_discrepancia: 'Hallazgo de versión anterior' },
        ] } } },
    ]);
    const projects = vi.fn().mockResolvedValue([
      { expediente_id: 'case-own', documento_id: 'project-own' },
      { expediente_id: 'case-other', documento_id: 'project-new' },
    ]);
    const source = new MiDiaDocumentCardsService({ documento: { findMany: reports },
      expedienteDocumento: { findMany: projects } } as unknown as PrismaClient);
    const authorized = { ...actor, permissions: [...actor.permissions, 'expedientes.project.read'] as Actor['permissions'] };
    const result = await source.read(authorized, 'DOCUMENT_INCONSISTENCIES', { scope: 'OWN', limit: 1 });
    expect(result).toMatchObject({ count: 2, items: [{ id: 'report-own:0', estado: 'ALTO',
      href: '/expedientes/case-own#proyecto' }] });
    expect(reports.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      expediente: { is: expect.objectContaining({ organization_id: actor.organizationId }) },
      expedienteVinculos: { some: { estatus: 'ACTIVO', tipo_vinculo: 'REPORTE_IA_PROYECTO' } },
    });
    expect(projects.mock.calls[0][0].where).toMatchObject({ organization_id: actor.organizationId,
      estatus: 'ACTIVO', tipo_vinculo: 'PROYECTO_ESCRITURA' });
    await expect(source.read(actor, 'DOCUMENT_INCONSISTENCIES', { scope: 'OWN' }))
      .rejects.toThrow('MIDIA_DOCUMENT_READ_DENIED');
  });
});
