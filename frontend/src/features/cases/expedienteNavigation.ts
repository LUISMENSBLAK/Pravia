export const expedienteSections = [
  'resumen', 'actos', 'comparecientes', 'predios', 'documentos', 'seguimiento',
  'plantillas', 'presupuesto', 'proyecto', 'finanzas', 'isr', 'cumplimiento', 'actividad',
] as const;

export type ExpedienteSection = typeof expedienteSections[number];

const safeId = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeExpedienteSection(value: string | null | undefined): ExpedienteSection {
  if (value === 'workflow') return 'seguimiento';
  return expedienteSections.includes(value as ExpedienteSection) ? value as ExpedienteSection : 'resumen';
}

export function expedienteReturnParams(expedienteId: string, section: ExpedienteSection) {
  if (!safeId.test(expedienteId)) throw new Error('Identificador de expediente inválido.');
  return new URLSearchParams({ fromExpediente: expedienteId, fromSection: section }).toString();
}

export function resolveExpedienteReturn(search: string) {
  const params = new URLSearchParams(search);
  const id = params.get('fromExpediente');
  if (!id || !safeId.test(id)) return null;
  const section = normalizeExpedienteSection(params.get('fromSection'));
  return `/expedientes/${encodeURIComponent(id)}#${section}`;
}

export function resolveExpedienteCreationContext(search: string) {
  const params = new URLSearchParams(search);
  const expedienteId = params.get('fromExpediente');
  const expedienteActoId = params.get('fromActo');
  if (!expedienteId || !safeId.test(expedienteId)) return null;
  return {
    expedienteId,
    expedienteActoId: expedienteActoId && safeId.test(expedienteActoId) ? expedienteActoId : null,
    returnPath: resolveExpedienteReturn(search)!,
  };
}
