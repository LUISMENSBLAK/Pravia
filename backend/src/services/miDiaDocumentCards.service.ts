import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { MiDiaScope } from '../domain/miDiaCardCatalog';
import { miDiaDashboardScope } from './miDiaDashboardScope';
import { reportMetadata } from './projectRepository.service';

type Actor = NonNullable<Request['user']>;
export type DocumentCardKey = 'MISSING_DOCUMENTS' | 'DOCUMENTS_TO_REVIEW' | 'EXPIRED_DOCUMENTS'
  | 'FORMATS_TO_GENERATE' | 'FORMATS_TO_SIGN' | 'DOCUMENT_INCONSISTENCIES';
export type DocumentCardResult = { count: number; items: Array<{
  id: string; folio: string; nombre: string; estado: string; href: string;
}> };

/** Only persisted, current document links and act requirements may populate these cards. */
export class MiDiaDocumentCardsService {
  constructor(private readonly db: PrismaClient) {}

  async read(actor: Actor, key: DocumentCardKey, options: {
    scope: MiDiaScope; requestedUserId?: unknown; limit?: number; offset?: number; now?: Date;
  }): Promise<DocumentCardResult> {
    const canReadSource = key === 'FORMATS_TO_GENERATE' || key === 'DOCUMENT_INCONSISTENCIES'
      ? actor.permissions.includes('expedientes.project.read')
      : actor.permissions.includes('documentos.read');
    if (!canReadSource || !actor.permissions.includes('expedientes.read')) {
      throw new Error('MIDIA_DOCUMENT_READ_DENIED');
    }
    if (key === 'FORMATS_TO_SIGN' && !actor.permissions.includes('compliance.read')) {
      throw new Error('MIDIA_DOCUMENT_READ_DENIED');
    }
    const { caseWhere } = miDiaDashboardScope(actor, options.requestedUserId, options.scope);
    const now = options.now ?? new Date();
    const limit = options.limit ?? 5;
    const offset = Math.max(0, options.offset ?? 0);
    if (key === 'FORMATS_TO_SIGN') {
      // H2 explicitly marks generated formats that need a signed upload.
      // A generated file alone does not satisfy the signed requirement.
      const requirements = await this.db.complianceRequirement.findMany({ where: {
        organization_id: actor.organizationId, expediente: { is: caseWhere },
        requires_signed_document: true, status: { not: 'NO_APLICA' },
        evidence: { some: { estatus: 'ACTIVO', source: 'FORMAT_GENERATED', document_state: 'GENERATED' } },
      }, select: { id: true, review_id: true, label: true,
        state: { select: { current_review_id: true } },
        expediente: { select: { id: true, numero_pravia: true } },
        evidence: { where: { estatus: 'ACTIVO' }, select: { document_state: true } } },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
      const pending = requirements.filter((item) => item.state.current_review_id === item.review_id
        && !item.evidence.some((evidence) => evidence.document_state === 'SIGNED_UPLOADED'));
      return { count: pending.length, items: pending.slice(offset, offset + limit).map((item) => ({
        id: item.id, folio: item.expediente.numero_pravia, nombre: item.label,
        estado: 'PENDIENTE_FIRMA', href: `/expedientes/${item.expediente.id}#cumplimiento`,
      })) };
    }
    if (key === 'DOCUMENT_INCONSISTENCIES') {
      // A persisted IA observation is current only while both the report and the
      // project version reviewed by that report remain active for the same case.
      const [reports, projects] = await Promise.all([
        this.db.documento.findMany({ where: { organization_id: actor.organizationId,
          tipo: 'REPORTE_IA_PROYECTO', estatus: 'VIGENTE', expediente: { is: caseWhere },
          expedienteVinculos: { some: { organization_id: actor.organizationId,
            tipo_vinculo: 'REPORTE_IA_PROYECTO', estatus: 'ACTIVO' } } },
          select: { id: true, expediente_id: true, datos_extraidos: true,
            expediente: { select: { id: true, numero_pravia: true } } },
          orderBy: [{ fecha_carga: 'desc' }, { id: 'desc' }] }),
        this.db.expedienteDocumento.findMany({ where: { organization_id: actor.organizationId,
          tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO', expediente: { is: caseWhere },
          documento: { estatus: 'VIGENTE' } },
          select: { expediente_id: true, documento_id: true },
          orderBy: [{ fecha_vinculo: 'desc' }, { id: 'desc' }] }),
      ]);
      const activeProject = new Map<string, string>();
      projects.forEach((row) => { if (!activeProject.has(row.expediente_id)) activeProject.set(row.expediente_id, row.documento_id); });
      const seenCases = new Set<string>();
      const findings: DocumentCardResult['items'] = [];
      for (const report of reports) {
        if (!report.expediente_id || !report.expediente || seenCases.has(report.expediente_id)) continue;
        seenCases.add(report.expediente_id);
        const metadata = reportMetadata(report);
        if (metadata.proyecto_version_id !== activeProject.get(report.expediente_id)) continue;
        if (!Array.isArray(metadata.observaciones)) continue;
        metadata.observaciones.forEach((observation: unknown, index: number) => {
          if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return;
          const item = observation as Record<string, unknown>;
          const label = typeof item.tipo_discrepancia === 'string' && item.tipo_discrepancia.trim()
            ? item.tipo_discrepancia.trim() : null;
          if (!label) return;
          findings.push({ id: `${report.id}:${index}`, folio: report.expediente!.numero_pravia,
            nombre: label, estado: typeof item.nivel_riesgo === 'string' ? item.nivel_riesgo : 'REVISAR',
            href: `/expedientes/${report.expediente!.id}#proyecto` });
        });
      }
      return { count: findings.length, items: findings.slice(offset, offset + limit) };
    }
    if (key === 'FORMATS_TO_GENERATE') {
      // EXP-006 is the operational CFG-002 resolution. Only a materialized,
      // compareciente-scoped FORMAT with no current document exposes "Generar".
      const where: Prisma.ExpedienteArtefactoPendienteWhereInput = {
        organization_id: actor.organizationId, expediente: { is: caseWhere },
        en_alcance: true, estado: 'PENDIENTE', current_document_id: null,
        sujeto_tipo: 'COMPARECIENTE', artefacto: { is: { tipo: 'FORMATO' } },
      };
      const [count, rows] = await Promise.all([
        this.db.expedienteArtefactoPendiente.count({ where }),
        this.db.expedienteArtefactoPendiente.findMany({ where,
          select: { id: true, estado: true, artefacto: { select: { nombre: true } },
            expediente: { select: { id: true, numero_pravia: true } } },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }], skip: offset, take: limit }),
      ]);
      return { count, items: rows.map((row) => ({ id: row.id,
        folio: row.expediente.numero_pravia, nombre: row.artefacto.nombre,
        estado: row.estado, href: `/expedientes/${row.expediente.id}#plantillas` })) };
    }
    if (key === 'EXPIRED_DOCUMENTS') {
      const where: Prisma.DocumentoWhereInput = { organization_id: actor.organizationId,
        estatus: { in: ['VIGENTE', 'POR_VENCER', 'VENCIDO'] }, fecha_vigencia: { lt: now },
        expedienteVinculos: { some: { estatus: 'ACTIVO', expediente: { is: caseWhere } } } };
      const [count, rows] = await Promise.all([
        this.db.documento.count({ where }),
        this.db.documento.findMany({ where, select: { id: true, nombre_original: true, estatus: true,
          expedienteVinculos: { where: { estatus: 'ACTIVO', expediente: { is: caseWhere } }, take: 1,
            select: { expediente: { select: { id: true, numero_pravia: true } } } } },
          orderBy: [{ fecha_vigencia: 'asc' }, { id: 'asc' }], skip: offset, take: limit }),
      ]);
      return { count, items: rows.flatMap((row) => row.expedienteVinculos[0] ? [{ id: row.id,
        folio: row.expedienteVinculos[0].expediente.numero_pravia, nombre: row.nombre_original,
        estado: row.estatus, href: `/expedientes/${row.expedienteVinculos[0].expediente.id}#documentos` }] : []) };
    }
    const currentDocument: Prisma.RequisitoDocumentoVinculoWhereInput = { estatus: 'ACTIVO',
      documento: { is: { organization_id: actor.organizationId,
        estatus: { in: ['PENDIENTE', 'VIGENTE', 'POR_VENCER'] },
        OR: [{ fecha_vigencia: null }, { fecha_vigencia: { gte: now } }],
      } } };
    const where: Prisma.ExpedienteRequisitoDocWhereInput = { expediente: { is: caseWhere },
      ...(key === 'MISSING_DOCUMENTS'
        ? { obligatorio: true, estatus: { not: 'OMITIDO_JUSTIFICADO' }, documentoVinculos: { none: currentDocument } }
        : { estatus: 'EN_REVISION', documentoVinculos: { some: currentDocument } }),
    };
    const [count, rows] = await Promise.all([
      this.db.expedienteRequisitoDoc.count({ where }),
      this.db.expedienteRequisitoDoc.findMany({ where, select: { id: true, nombre: true, estatus: true,
        expediente: { select: { id: true, numero_pravia: true } } },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }], skip: offset, take: limit }),
    ]);
    return { count, items: rows.map((row) => ({ id: row.id, folio: row.expediente.numero_pravia,
      nombre: row.nombre, estado: row.estatus, href: `/expedientes/${row.expediente.id}#documentos` })) };
  }
}
