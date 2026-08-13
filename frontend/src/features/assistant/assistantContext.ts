import type { Location } from 'react-router-dom';
import type { AssistantAction, AssistantContext, AssistantModule } from './assistant.types';

const labels: Record<AssistantModule, string> = {
  'mi-dia': 'Mi Día', prospectos: 'Prospectos', cotizaciones: 'Cotizaciones', expedientes: 'Expedientes',
  notarias: 'Notarías', comparecientes: 'Comparecientes', finanzas: 'Finanzas', agenda: 'Agenda',
  reportes: 'Reportes', riesgos: 'Riesgos / UIF', configuracion: 'Configuración', unknown: 'PRAVIA OS',
};

const entityRoutes = new Map<string, AssistantContext['entityType']>([
  ['expedientes', 'expediente'], ['comparecientes', 'compareciente'], ['notarias', 'notaria'],
  ['prospectos', 'prospecto'], ['cotizaciones', 'cotizacion'],
]);

export function resolveAssistantContext(location: Pick<Location, 'pathname' | 'hash'>): AssistantContext {
  const segments = location.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const module = (first === 'mi-dia' ? 'mi-dia' : first in labels ? first : 'unknown') as AssistantModule;
  const entityType = segments[1] ? entityRoutes.get(first) : undefined;
  return {
    route: location.pathname,
    module,
    label: labels[module],
    ...(entityType && segments[1] ? { entityType, entityId: decodeURIComponent(segments[1]) } : {}),
    ...(location.hash ? { subview: location.hash.slice(1) } : {}),
  };
}

const actions: Partial<Record<AssistantModule, AssistantAction[]>> = {
  'mi-dia': [
    { id: 'today-urgent', label: '¿Qué urge hoy?', prompt: '¿Qué requiere mi atención hoy?' },
    { id: 'today-pending', label: 'Ver pendientes', prompt: 'Muéstrame mis pendientes de hoy.' },
    { id: 'today-signatures', label: 'Próximas firmas', prompt: '¿Cuáles son mis próximas firmas?' },
    { id: 'today-finance', label: 'Resumen financiero', prompt: 'Muéstrame el resumen financiero disponible.' },
  ],
  expedientes: [
    { id: 'files-urgent', label: '¿Qué urge?', prompt: '¿Qué expedientes requieren atención?' },
    { id: 'files-blocked', label: 'Expedientes bloqueados', prompt: 'Muéstrame los expedientes bloqueados.' },
    { id: 'files-signatures', label: 'Próximas firmas', prompt: 'Muéstrame las próximas firmas de expedientes.' },
    { id: 'files-search', label: 'Buscar expediente', prompt: 'Ayúdame a buscar un expediente.' },
  ],
  comparecientes: [
    { id: 'person-missing', label: '¿Qué falta?', prompt: '¿Qué falta para este compareciente?' },
    { id: 'person-documents', label: 'Documentos', prompt: 'Revisa sus documentos.' },
    { id: 'person-files', label: 'Expedientes relacionados', prompt: 'Muéstrame sus expedientes relacionados.' },
  ],
  prospectos: [
    { id: 'prospects-stale', label: 'Sin seguimiento', prompt: 'Muéstrame los prospectos sin seguimiento reciente.' },
    { id: 'prospects-priority', label: 'Prioridades', prompt: 'Resume las prioridades de prospectos.' },
    { id: 'prospects-quotes', label: 'Cotizaciones pendientes', prompt: 'Muéstrame los prospectos con cotización pendiente.' },
    { id: 'prospects-search', label: 'Buscar prospecto', prompt: 'Ayúdame a buscar un prospecto.' },
  ],
  cotizaciones: [
    { id: 'quotes-expiring', label: 'Por vencer', prompt: 'Muéstrame las cotizaciones próximas a vencer.' },
    { id: 'quotes-follow-up', label: 'Sin seguimiento', prompt: 'Muéstrame las cotizaciones sin seguimiento.' },
    { id: 'quotes-accepted', label: 'Aceptadas este mes', prompt: 'Muéstrame las cotizaciones aceptadas este mes.' },
    { id: 'quotes-search', label: 'Buscar cotización', prompt: 'Ayúdame a buscar una cotización.' },
  ],
  agenda: [
    { id: 'agenda-today', label: '¿Qué tengo hoy?', prompt: '¿Qué tengo en la agenda hoy?' },
    { id: 'agenda-next', label: 'Próximos eventos', prompt: 'Muéstrame los próximos eventos.' },
    { id: 'agenda-space', label: 'Buscar espacio', prompt: 'Ayúdame a buscar un espacio disponible.' },
  ],
  finanzas: [
    { id: 'finance-receivable', label: 'Por cobrar', prompt: 'Muéstrame lo que está por cobrar.' },
    { id: 'finance-overdue', label: 'Vencidos', prompt: 'Muéstrame los saldos vencidos.' },
    { id: 'finance-summary', label: 'Resumen', prompt: 'Muéstrame el resumen financiero.' },
  ],
};

const fallbackActions: AssistantAction[] = [
  { id: 'general-summary', label: 'Resumen de esta pantalla', prompt: 'Resume la información disponible en esta pantalla.' },
  { id: 'general-pending', label: 'Ver pendientes', prompt: '¿Hay pendientes relacionados con esta pantalla?' },
];

const prospectDetailActions: AssistantAction[] = [
  { id: 'prospect-summary', label: 'Resumir prospecto', prompt: 'Resume este prospecto.' },
  { id: 'prospect-next', label: 'Próximo paso', prompt: '¿Cuál es el próximo paso para este prospecto?' },
  { id: 'prospect-activity', label: 'Actividad reciente', prompt: 'Muéstrame la actividad reciente de este prospecto.' },
  { id: 'prospect-follow-up', label: 'Preparar seguimiento', prompt: 'Ayúdame a preparar el seguimiento de este prospecto.' },
];

const quoteDetailActions: AssistantAction[] = [
  { id: 'quote-summary', label: 'Resumir cotización', prompt: 'Resume esta cotización.' },
  { id: 'quote-concepts', label: 'Explicar conceptos', prompt: 'Explica los conceptos de esta cotización.' },
  { id: 'quote-state', label: 'Estado actual', prompt: '¿Cuál es el estado actual de esta cotización?' },
  { id: 'quote-next', label: 'Próximo paso', prompt: '¿Cuál es el próximo paso para esta cotización?' },
];

const expedienteDetailActions: AssistantAction[] = [
  { id: 'file-missing', label: '¿Qué falta?', prompt: '¿Qué falta en este expediente?' },
  { id: 'file-summary', label: 'Resumen', prompt: 'Resume este expediente.' },
  { id: 'file-documents', label: 'Documentos pendientes', prompt: 'Revisa los documentos pendientes de este expediente.' },
  { id: 'file-next', label: 'Próximos pasos', prompt: '¿Cuáles son los próximos pasos de este expediente?' },
];

export const getAssistantActions = (context: AssistantContext) => context.entityType === 'expediente'
  ? expedienteDetailActions
  : context.entityType === 'prospecto'
  ? prospectDetailActions
  : context.entityType === 'cotizacion'
    ? quoteDetailActions
    : actions[context.module] ?? fallbackActions;
