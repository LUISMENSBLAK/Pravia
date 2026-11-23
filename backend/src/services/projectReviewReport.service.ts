import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ProyectoObservation, ProyectoReviewArea } from './openaiDocument.service';

export const PROJECTION_OBSERVATION_GROUPS = ['CRÍTICAS', 'REVISAR', 'PENDIENTES', 'INFORMATIVAS'] as const;
export type ProjectionObservationGroup = typeof PROJECTION_OBSERVATION_GROUPS[number];
export type ProjectionReportObservation = ProyectoObservation & { id: string; titulo: string; categoria: ProjectionObservationGroup };

export function projectionObservationGroup(item: ProyectoObservation): ProjectionObservationGroup {
  if (item.nivel_riesgo === 'ALTO') return 'CRÍTICAS';
  if (/FALTANTE|PENDIENTE|NO_LE[IÍ]DO|NO_LEGIBLE/i.test(item.tipo_discrepancia)) return 'PENDIENTES';
  return item.nivel_riesgo === 'INFORMATIVO' ? 'INFORMATIVAS' : 'REVISAR';
}

export function normalizeProjectionObservations(items: ProyectoObservation[]): ProjectionReportObservation[] {
  return items.map((item, index) => ({ ...item, id: `obs_${index + 1}`, categoria: projectionObservationGroup(item),
    titulo: `OBSERVACIÓN ${String(index + 1).padStart(2, '0')} — ${projectionObservationGroup(item)}` }));
}

/** Shared by the mandatory post-generation review and an explicit later review.
 * The report is a separate artifact; it never becomes part of the deed. */
export async function buildProjectionReviewReport(input: {
  folio: string; projectName: string; requestedBy: string; summary: string;
  observations: ProjectionReportObservation[]; areas: ProyectoReviewArea[]; unread: string[];
  sourceCount: number; totalSourceCount: number; legalFoundation: string;
}) {
  const field = (label: string, value: string, keepNext = false) => new Paragraph({ keepNext, keepLines: true, children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)] });
  const heading = (text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]) => new Paragraph({ text, heading: level, keepNext: true, keepLines: true });
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 21, color: '15263F' }, paragraph: { spacing: { after: 100, line: 270 } } },
    heading1: { run: { font: 'Arial', size: 32, bold: true, color: '15263F' }, paragraph: { spacing: { before: 0, after: 220 } } },
    heading2: { run: { font: 'Arial', size: 25, bold: true, color: '886526' }, paragraph: { spacing: { before: 240, after: 140 } } },
    heading3: { run: { font: 'Arial', size: 22, bold: true, color: '15263F' }, paragraph: { spacing: { before: 180, after: 100 } } },
  } }, sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1008, bottom: 1008, left: 1152, right: 1152 } } }, children: [
    heading('OBSERVACIONES DE PROYECCIÓN', HeadingLevel.HEADING_1),
    field('Expediente', input.folio), field('Proyecto revisado', input.projectName), field('Solicitante', input.requestedBy),
    field('Fuentes', `${input.sourceCount} de ${input.totalSourceCount} disponibles para revisión`),
    field('Resumen', input.summary), field('Fundamento jurídico verificado', input.legalFoundation),
    ...PROJECTION_OBSERVATION_GROUPS.flatMap((group) => {
      const observations = input.observations.filter((item) => item.categoria === group);
      return [heading(group, HeadingLevel.HEADING_2), ...(observations.length ? observations.flatMap((item) => [
        heading(item.titulo, HeadingLevel.HEADING_3),
        field('Capítulo / cláusula / ubicación', item.ubicacion, true), field('Problema detectado', item.dato_proyecto, true),
        field('Documento o dato de origen', `${item.documento_fuente}: ${item.dato_fuente}`, true),
        field('Recomendación concreta', item.recomendacion),
      ]) : [new Paragraph('SIN OBSERVACIONES.')])];
    }),
    heading('COBERTURA DE REVISIÓN', HeadingLevel.HEADING_2),
    ...input.areas.map((area) => field(area.etiqueta, `${({ REVISADO_SIN_HALLAZGOS: 'Revisado sin hallazgos', HALLAZGOS: 'Hallazgos', NO_VERIFICABLE: 'No verificable' })[area.estado]}. ${area.resumen}`)),
    ...(input.unread.length ? [field('Fuentes no leídas — revisión manual requerida', input.unread.join('; '))] : []),
    new Paragraph('El proyecto y este reporte requieren revisión del abogado y del Notario. Las observaciones no modifican automáticamente la escritura ni acreditan legislación ausente.'),
  ] }] }));
}
