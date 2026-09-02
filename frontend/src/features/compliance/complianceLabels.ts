const labels: Record<string, string> = {
  BORRADOR: 'Borrador', PENDIENTE_REVISION: 'Pendiente de revisión', REQUIERE_AJUSTES: 'Requiere ajustes',
  CONFIRMADO: 'Confirmado', EVALUACION_DETERMINISTA: 'Evaluación legal',
  NO_APLICA: 'No aplica', PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', LISTO: 'Listo',
  CUMPLIMIENTO_COMPLETO: 'Cumplimiento completo', VENCIDO: 'Vencido',
  INFORMACION_INCOMPLETA: 'Información incompleta', APLICA_SIN_AVISO: 'Aplica sin aviso',
  APLICA_CON_AVISO: 'Aplica con aviso', BLOQUEADO_POR_FALTA_DATOS: 'Pendiente de información',
  INFORMATIVA: 'Informativa', ADVERTENCIA: 'Advertencia', CRITICA: 'Crítica',
  ABIERTA: 'Abierta', RESUELTA: 'Resuelta', DESCARTADA: 'Descartada',
};

export function humanComplianceLabel(value: unknown, fallback = 'Por determinar') {
  if (value === null || value === undefined || value === '') return fallback;
  return labels[String(value)] || fallback;
}
