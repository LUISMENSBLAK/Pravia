import type { PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { downloadFile } from './supabase.service';

export interface ProjectVersionRecord {
  id: string;
  expediente_id: string;
  version_numero: number;
  nombre_original: string;
  mime_type: string;
  size_bytes: number;
  es_vigente: boolean;
  es_version_final: boolean;
  nota_version?: string;
  cargado_por_nombre: string;
  created_at: string;
}

export interface ProjectReportRecord {
  id: string;
  expediente_id: string;
  proyecto_version_id: string;
  proyecto_version_numero: number;
  nombre_reporte: string;
  documentos_analizados_count: number;
  documentos_totales_count: number;
  documentos_no_leidos: string[];
  observaciones: unknown[];
  solicitado_por: string;
  created_at: string;
}

const metadataObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export const projectMetadata = (document: any) => metadataObject(metadataObject(document.datos_extraidos).proyecto);
export const reportMetadata = (document: any) => metadataObject(metadataObject(document.datos_extraidos).reporte_ia_proyecto);

export function mapProjectVersion(document: any): ProjectVersionRecord {
  const meta = projectMetadata(document);
  const link = document.expedienteVinculos?.[0];
  return {
    id: document.id,
    expediente_id: document.expediente_id,
    version_numero: Number(meta.version_numero || 1),
    nombre_original: document.nombre_original,
    mime_type: document.mime_type,
    size_bytes: document.size_bytes,
    es_vigente: link?.estatus === 'ACTIVO',
    es_version_final: Boolean(meta.es_version_final),
    nota_version: meta.nota_version || document.observaciones || undefined,
    cargado_por_nombre: document.subido_por ? `${document.subido_por.nombre} ${document.subido_por.apellido}` : 'Usuario PRAVIA',
    created_at: new Date(document.fecha_carga).toISOString(),
  };
}

export function mapProjectReport(document: any): ProjectReportRecord {
  const meta = reportMetadata(document);
  return {
    id: document.id,
    expediente_id: document.expediente_id,
    proyecto_version_id: String(meta.proyecto_version_id || ''),
    proyecto_version_numero: Number(meta.proyecto_version_numero || 0),
    nombre_reporte: document.nombre_original,
    documentos_analizados_count: Number(meta.documentos_analizados_count || 0),
    documentos_totales_count: Number(meta.documentos_totales_count || 0),
    documentos_no_leidos: Array.isArray(meta.documentos_no_leidos) ? meta.documentos_no_leidos : [],
    observaciones: Array.isArray(meta.observaciones) ? meta.observaciones : [],
    solicitado_por: String(meta.solicitado_por || 'Usuario PRAVIA'),
    created_at: new Date(document.fecha_carga).toISOString(),
  };
}

export class ProjectRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listVersions(expedienteId: string) {
    const documents = await this.db.documento.findMany({
      where: { expediente_id: expedienteId, tipo: 'PROYECTO_ESCRITURA' },
      include: {
        subido_por: { select: { nombre: true, apellido: true } },
        expedienteVinculos: { where: { expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA' }, orderBy: { fecha_vinculo: 'desc' } },
      },
      orderBy: { fecha_carga: 'desc' },
    });
    return documents.map(mapProjectVersion).sort((a, b) => b.version_numero - a.version_numero);
  }

  async getVersion(expedienteId: string, versionId: string) {
    const document = await this.db.documento.findFirst({
      where: { id: versionId, expediente_id: expedienteId, tipo: 'PROYECTO_ESCRITURA' },
      include: {
        subido_por: { select: { nombre: true, apellido: true } },
        expedienteVinculos: { where: { expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA' }, orderBy: { fecha_vinculo: 'desc' } },
      },
    });
    return document ? { record: mapProjectVersion(document), storageKey: document.storage_key } : null;
  }

  async loadVersionBuffer(expedienteId: string, versionId: string) {
    const version = await this.getVersion(expedienteId, versionId);
    if (!version) return null;
    return { record: version.record, buffer: await downloadFile(version.storageKey) };
  }

  async latestReport(expedienteId: string) {
    const document = await this.db.documento.findFirst({
      where: { expediente_id: expedienteId, tipo: 'REPORTE_IA_PROYECTO' },
      orderBy: { fecha_carga: 'desc' },
    });
    return document ? { record: mapProjectReport(document), storageKey: document.storage_key } : null;
  }

  async getReport(expedienteId: string, reportId: string) {
    const document = await this.db.documento.findFirst({
      where: { id: reportId, expediente_id: expedienteId, tipo: 'REPORTE_IA_PROYECTO' },
    });
    return document ? { record: mapProjectReport(document), storageKey: document.storage_key } : null;
  }

  async loadReportBuffer(expedienteId: string, reportId: string) {
    const report = await this.getReport(expedienteId, reportId);
    if (!report) return null;
    return { record: report.record, buffer: await downloadFile(report.storageKey) };
  }

  async loadLatestReportBuffer(expedienteId: string) {
    const report = await this.latestReport(expedienteId);
    if (!report) return null;
    return { record: report.record, buffer: await downloadFile(report.storageKey) };
  }
}

export const projectRepository = new ProjectRepository();
