export type ReadinessState = 'COMPLETO' | 'PENDIENTE' | 'NO_APLICA' | 'NO_CONFIGURADO';

type Indicator = { key: string; label: string; state: ReadinessState; detail: string };

const complianceState = (reviews: any[]): Indicator => {
  const latest = reviews?.[0];
  if (!latest) return { key: 'cumplimiento', label: 'Cumplimiento', state: 'NO_CONFIGURADO', detail: 'Sin revisión registrada' };
  const classification = String(latest.resultado_json?.clasificacion || '');
  const pending = latest.estatus !== 'CONFIRMADO' || ['REQUIERE_AVISO', 'INCOMPLETO', 'INSUMOS_INCOMPLETOS'].includes(classification);
  return { key: 'cumplimiento', label: 'Cumplimiento', state: pending ? 'PENDIENTE' : 'COMPLETO', detail: pending ? 'Revisión o información pendiente' : 'Revisión confirmada' };
};

export function buildExpedienteReadiness(expediente: any, hasCurrentProject: boolean) {
  const parties = expediente.comparecientes || [];
  const requirements = (expediente.requisitos_docs || []).filter((item: any) => item.obligatorio);
  const representations = expediente.expedienteRepresentaciones || [];
  const needsRepresentation = parties.some((item: any) => String(item.forma_comparecencia || '').includes('REPRESENTACION'));
  const documentsComplete = requirements.length > 0 && requirements.every((item: any) => ['VALIDADO', 'OMITIDO_JUSTIFICADO'].includes(item.estatus));
  const indicators: Indicator[] = [
    parties.length === 0
      ? { key: 'identidad', label: 'Identidad', state: 'NO_CONFIGURADO', detail: 'Sin comparecientes vinculados' }
      : { key: 'identidad', label: 'Identidad', state: parties.every((item: any) => item.datos_validados) ? 'COMPLETO' : 'PENDIENTE', detail: parties.every((item: any) => item.datos_validados) ? 'Datos validados' : 'Falta validar comparecientes' },
    !needsRepresentation
      ? { key: 'representacion', label: 'Representación', state: 'NO_APLICA', detail: 'No requerida por las relaciones actuales' }
      : { key: 'representacion', label: 'Representación', state: representations.length > 0 && representations.every((item: any) => item.validada) ? 'COMPLETO' : 'PENDIENTE', detail: 'Revisar facultades y representación' },
    requirements.length === 0
      ? { key: 'documentos', label: 'Documentos', state: 'NO_CONFIGURADO', detail: 'Sin requisitos configurados' }
      : { key: 'documentos', label: 'Documentos', state: documentsComplete ? 'COMPLETO' : 'PENDIENTE', detail: documentsComplete ? 'Requisitos obligatorios completos' : `${requirements.filter((item: any) => !['VALIDADO', 'OMITIDO_JUSTIFICADO'].includes(item.estatus)).length} requisito(s) pendiente(s)` },
    { key: 'proyecto', label: 'Proyecto', state: hasCurrentProject ? 'COMPLETO' : 'PENDIENTE', detail: hasCurrentProject ? 'Versión vigente disponible' : 'Sin proyecto vigente' },
    complianceState(expediente.complianceReviews || []),
    expediente.fecha_estimada_firma || expediente.fecha_real_firma
      ? { key: 'agenda', label: 'Agenda', state: 'COMPLETO', detail: expediente.fecha_real_firma ? 'Firma realizada' : 'Firma programada' }
      : ['FIRMADO', 'POST_FIRMA', 'LISTO_ENTREGA', 'ENTREGADO'].includes(expediente.estatus)
        ? { key: 'agenda', label: 'Agenda', state: 'NO_APLICA', detail: 'La operación ya superó la firma' }
        : { key: 'agenda', label: 'Agenda', state: 'PENDIENTE', detail: 'Firma sin programar' },
  ];
  const overdueTasks = (expediente.tareas || []).filter((item: any) => item.estatus !== 'COMPLETADA' && item.fecha_limite && new Date(item.fecha_limite).getTime() < Date.now());
  const blockedExternal = (expediente.tareas_externas || []).filter((item: any) => item.estatus === 'BLOQUEADA');
  const pendingRequirements = requirements.filter((item: any) => !['VALIDADO', 'OMITIDO_JUSTIFICADO'].includes(item.estatus));
  const blockers = [
    ...pendingRequirements.map((item: any) => ({ type: 'REQUISITO_FALTANTE', label: item.nombre })),
    ...overdueTasks.map((item: any) => ({ type: 'TAREA_VENCIDA', label: item.titulo })),
    ...blockedExternal.map((item: any) => ({ type: 'POSTFIRMA_PENDIENTE', label: item.descripcion })),
  ];
  return { indicators, blockers, complete: indicators.filter((item) => item.state === 'COMPLETO').length };
}
