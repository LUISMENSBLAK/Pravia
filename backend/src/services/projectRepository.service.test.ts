import { describe, expect, it, vi } from 'vitest';
import { mapProjectReport, mapProjectVersion, ProjectRepository } from './projectRepository.service';

describe('repositorio persistente de proyectos', () => {
  it('mapea una versión desde Documento y su vínculo activo', () => {
    expect(mapProjectVersion({
      id: 'doc-1', expediente_id: 'exp-1', nombre_original: 'Proyecto V2.docx', mime_type: 'application/docx',
      size_bytes: 2048, fecha_carga: new Date('2026-08-12T12:00:00Z'), observaciones: null,
      datos_extraidos: { proyecto: { version_numero: 2, es_version_final: true, nota_version: 'Final revisado' } },
      subido_por: { nombre: 'Ana', apellido: 'Pérez' }, expedienteVinculos: [{ estatus: 'ACTIVO' }],
    })).toMatchObject({ id: 'doc-1', version_numero: 2, es_vigente: true, es_version_final: true, cargado_por_nombre: 'Ana Pérez' });
  });

  it('mapea un reporte sin exponer su clave de storage', () => {
    const report = mapProjectReport({
      id: 'report-1', expediente_id: 'exp-1', nombre_original: 'Reporte.docx', storage_key: 'secret/key.docx',
      fecha_carga: new Date('2026-08-12T12:00:00Z'),
      datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: 'doc-1', proyecto_version_numero: 2, documentos_analizados_count: 4, observaciones: [] } },
    });
    expect(report).toMatchObject({ id: 'report-1', proyecto_version_id: 'doc-1', documentos_analizados_count: 4 });
    expect(report).not.toHaveProperty('storage_key');
  });

  it('resuelve un reporte histórico específico por expediente e id', async () => {
    const document = {
      id: 'report-2', expediente_id: 'exp-1', nombre_original: 'Reporte histórico.docx', storage_key: 'reports/report-2.docx',
      fecha_carga: new Date('2025-01-10T10:00:00Z'), datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: 'doc-1', proyecto_version_numero: 1 } },
    };
    const db = { documento: { findFirst: vi.fn().mockResolvedValue(document) } } as any;
    const result = await new ProjectRepository(db).getReport('exp-1', 'report-2');
    expect(db.documento.findFirst).toHaveBeenCalledWith({ where: { id: 'report-2', expediente_id: 'exp-1', tipo: 'REPORTE_IA_PROYECTO' } });
    expect(result).toMatchObject({ record: { id: 'report-2', expediente_id: 'exp-1' }, storageKey: 'reports/report-2.docx' });
  });
});
