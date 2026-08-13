import type { Location } from 'react-router-dom';
import type { AssistantAction, AssistantContext, AssistantModule } from './assistant.types';

const labels: Record<AssistantModule, string> = {
  'mi-dia': 'Mi Día', prospectos: 'Prospectos', cotizaciones: 'Cotizaciones', expedientes: 'Expedientes',
  notarias: 'Notarías', comparecientes: 'Comparecientes', finanzas: 'Finanzas', agenda: 'Agenda',
  reportes: 'Reportes', compliance: 'Riesgos / UIF', configuracion: 'Configuración', unknown: 'PRAVIA OS',
};

const entityRoutes = new Map<string, AssistantContext['entityType']>([
  ['expedientes', 'expediente'], ['comparecientes', 'compareciente'], ['notarias', 'notaria'],
  ['prospectos', 'prospecto'], ['cotizaciones', 'cotizacion'],
]);

export function resolveAssistantContext(location: Pick<Location, 'pathname' | 'hash'>): AssistantContext {
  const segments = location.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const module = (first === 'riesgos' ? 'compliance' : first === 'mi-dia' ? 'mi-dia' : first in labels ? first : 'unknown') as AssistantModule;
  const agendaEventId = module === 'agenda' ? new URLSearchParams(location.hash.replace(/^#/, '')).get('evento') : null;
  const entityType = agendaEventId ? 'evento' : first === 'riesgos' && segments[1] === 'revisiones' && segments[2] ? 'complianceReview' : segments[1] ? entityRoutes.get(first) : undefined;
  return {
    route: location.pathname,
    module,
    label: labels[module],
    ...(agendaEventId ? { entityType, entityId: agendaEventId } : entityType === 'complianceReview' ? { entityType, entityId: decodeURIComponent(segments[2]) } : entityType && segments[1] ? { entityType, entityId: decodeURIComponent(segments[1]) } : {}),
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
    { id: 'people-search', label: 'Buscar compareciente', prompt: 'Ayúdame a buscar un compareciente.' },
    { id: 'people-documents', label: 'Documentos pendientes', prompt: 'Muéstrame comparecientes con documentos pendientes.' },
    { id: 'people-observed', label: 'Con observaciones', prompt: 'Muéstrame comparecientes con observaciones.' },
    { id: 'people-duplicates', label: 'Duplicados posibles', prompt: 'Busca posibles comparecientes duplicados.' },
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
  notarias: [
    { id: 'notaries-search', label: 'Buscar notaría', prompt: 'Ayúdame a buscar una notaría.' },
    { id: 'notaries-active-cases', label: 'Con más expedientes activos', prompt: 'Muéstrame las notarías con más expedientes activos.' },
    { id: 'notaries-activity', label: 'Actividad reciente', prompt: 'Muéstrame la actividad reciente de notarías.' },
    { id: 'notaries-contacts', label: 'Contactos pendientes', prompt: 'Muéstrame notarías sin contacto registrado.' },
  ],
  agenda: [
    { id: 'agenda-today', label: '¿Qué tengo hoy?', prompt: '¿Qué tengo en la agenda hoy?' },
    { id: 'agenda-signatures', label: 'Próximas firmas', prompt: 'Muéstrame las próximas firmas programadas.' },
    { id: 'agenda-space', label: 'Buscar espacio', prompt: 'Ayúdame a buscar un espacio disponible.' },
    { id: 'agenda-week', label: 'Eventos esta semana', prompt: 'Muéstrame los eventos de esta semana.' },
  ],
  finanzas: [
    { id: 'finance-month', label: 'Cobrado este mes', prompt: '¿Cuánto hemos cobrado este mes? Indica el periodo y usa únicamente cifras del backend.' },
    { id: 'finance-office', label: 'Del despacho', prompt: '¿Cuánto corresponde al despacho? Indica el periodo.' },
    { id: 'finance-receivable', label: 'Por cobrar', prompt: '¿Cuánto está por cobrar? Usa honorarios generados menos honorarios cobrados.' },
    { id: 'finance-receipts', label: 'Sin comprobante', prompt: 'Muéstrame los movimientos sin comprobante.' },
    { id: 'finance-reconcile', label: 'Conciliación pendiente', prompt: 'Muéstrame las conciliaciones pendientes.' },
  ],
  reportes: [
    { id: 'reports-summary', label: 'Resumen ejecutivo', prompt: 'Resume los indicadores ejecutivos del periodo visible usando únicamente datos canónicos de Reportes.' },
    { id: 'reports-collections', label: 'Analizar cobranza', prompt: 'Analiza la cobranza del periodo visible y señala los saldos con mayor prioridad.' },
    { id: 'reports-signatures', label: 'Analizar firmas', prompt: 'Resume las firmas realizadas, pendientes y programadas del periodo visible.' },
    { id: 'reports-potential', label: 'Clientes potenciales', prompt: 'Muéstrame las cotizaciones sin anticipo y prioriza el seguimiento con datos del reporte.' },
  ],
  compliance: [
    { id: 'compliance-pending', label: '¿Qué requiere revisión?', prompt: 'Muéstrame las revisiones de cumplimiento pendientes dentro de mi alcance.' },
    { id: 'compliance-alerts', label: 'Explicar alertas', prompt: 'Resume las alertas persistidas e indica regla, versión, dato y fuente.' },
    { id: 'compliance-evidence', label: 'Evidencia faltante', prompt: '¿Qué evidencia falta en las revisiones disponibles?' },
    { id: 'compliance-changes', label: 'Cambios desde revisión', prompt: '¿Qué datos cambiaron desde la última revisión?' },
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

const comparecienteDetailActions: AssistantAction[] = [
  { id: 'person-missing', label: '¿Qué falta?', prompt: '¿Qué falta para este compareciente?' },
  { id: 'person-summary', label: 'Resumen', prompt: 'Resume este compareciente.' },
  { id: 'person-documents', label: 'Documentos', prompt: 'Revisa sus documentos.' },
  { id: 'person-files', label: 'Expedientes relacionados', prompt: 'Muéstrame sus expedientes relacionados.' },
];

const notariaDetailActions: AssistantAction[] = [
  { id: 'notary-summary', label: 'Resumen de notaría', prompt: 'Resume esta notaría.' },
  { id: 'notary-cases', label: 'Expedientes activos', prompt: 'Muéstrame los expedientes activos de esta notaría.' },
  { id: 'notary-signatures', label: 'Próximas firmas', prompt: 'Muéstrame las próximas firmas de esta notaría.' },
  { id: 'notary-contacts', label: 'Contactos', prompt: 'Muéstrame los contactos de esta notaría.' },
];

const eventDetailActions: AssistantAction[] = [
  { id: 'event-summary', label: 'Resumir evento', prompt: 'Resume este evento de agenda.' },
  { id: 'event-case', label: 'Ver expediente', prompt: 'Muéstrame el expediente relacionado con este evento.' },
  { id: 'event-reschedule', label: 'Reprogramar', prompt: 'Prepara una reprogramación de este evento y pide confirmación antes de aplicarla.' },
  { id: 'event-missing', label: '¿Qué falta antes de esta firma?', prompt: '¿Qué falta antes de esta firma programada?' },
];

const complianceDetailActions: AssistantAction[] = [
  { id: 'compliance-why', label: '¿Por qué esta alerta?', prompt: 'Explica esta alerta usando la regla, versión, dato y fuente persistidos.' },
  { id: 'compliance-missing', label: '¿Qué falta?', prompt: '¿Qué falta para completar esta revisión?' },
  { id: 'compliance-summary', label: 'Resumir revisión', prompt: 'Resume esta revisión sin emitir un dictamen legal.' },
  { id: 'compliance-docs', label: 'Documentos de soporte', prompt: '¿Qué documentos respaldan este resultado?' },
  { id: 'compliance-changed', label: 'Cambios desde anterior', prompt: '¿Qué cambió desde la revisión anterior?' },
];

export const getAssistantActions = (context: AssistantContext) => context.entityType === 'expediente'
  ? expedienteDetailActions
  : context.entityType === 'notaria'
  ? notariaDetailActions
  : context.entityType === 'compareciente'
  ? comparecienteDetailActions
  : context.entityType === 'prospecto'
  ? prospectDetailActions
  : context.entityType === 'cotizacion'
  ? quoteDetailActions
  : context.entityType === 'evento'
  ? eventDetailActions
  : context.entityType === 'complianceReview'
  ? complianceDetailActions
    : actions[context.module] ?? fallbackActions;
