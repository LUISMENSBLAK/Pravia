import type { Permission } from '../auth/permissions';

export type MiDiaScope = 'OWN' | 'TEAM' | 'ORGANIZATION';
export type MiDiaSize = 'S' | 'M' | 'L' | 'V';
export type MiDiaFamily = 'OPERACION' | 'COMERCIAL' | 'AGENDA' | 'DOCUMENTOS' | 'CUMPLIMIENTO' | 'FINANZAS' | 'DESEMPENO' | 'ARCHIVO' | 'IA';
export type MiDiaCardDefinition = {
  key: string; name: string; family: MiDiaFamily; sourceModule: string;
  permission: Permission; allowedSizes: MiDiaSize[]; defaultSize: MiDiaSize;
  allowedScopes: MiDiaScope[]; drillDown: string; parameters: string[];
  quickAction?: string;
};

const cards: MiDiaCardDefinition[] = [];
function add(key: string, name: string, family: MiDiaFamily, sourceModule: string, permission: Permission,
  sizes: string, scopes: string, drillDown: string, parameters = '', quickAction?: string) {
  const allowedSizes = sizes.split(',') as MiDiaSize[];
  cards.push({ key, name, family, sourceModule, permission, allowedSizes,
    defaultSize: allowedSizes[0], allowedScopes: scopes.split(',') as MiDiaScope[], drillDown,
    parameters: parameters ? parameters.split(',') : [], quickAction });
}

// La definición es compartida por configuración, permisos, layout y lectura.
// No se crean tarjetas a partir de roles ni consultas suministradas por el usuario.
add('MY_PENDING', 'Mis pendientes', 'OPERACION', 'Seguimiento', 'expedientes.read', 'M,L,V', 'OWN,TEAM,ORGANIZATION', '/expedientes', 'limit', 'seguimiento.realizar');
add('OVERDUE_PROCESSES', 'Procesos vencidos', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('DUE_TODAY', 'Vencen hoy', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('UPCOMING_DUE', 'Próximos vencimientos', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes', 'window');
add('URGENT_TASKS', 'Tareas urgentes', 'OPERACION', 'Tareas', 'expedientes.read', 'M,L,V', 'OWN,TEAM,ORGANIZATION', '/expedientes', 'limit');
add('CASES', 'Expedientes', 'OPERACION', 'Expedientes', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes', 'limit');
add('CASES_INACTIVE', 'Expedientes sin movimiento', 'OPERACION', 'Actividad', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes', 'window');
add('CASES_DELAYED', 'Expedientes con retraso', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('CASES_BLOCKED', 'Expedientes bloqueados', 'OPERACION', 'Expedientes', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('READY_TO_SIGN', 'Listos para firma', 'OPERACION', 'Firma', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas');
add('NOT_READY_TO_SIGN', 'No listos para firma', 'OPERACION', 'Firma', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas', 'window');
add('POSTSIGN_PENDING', 'Postfirma pendiente', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('CATASTRO_PENDING', 'Catastro pendiente', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('RPP_PENDING', 'RPP pendiente', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('TESTIMONIES_PENDING', 'Testimonios pendientes', 'OPERACION', 'Seguimiento', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('DELIVERIES_PENDING', 'Entregas pendientes', 'OPERACION', 'Expedientes', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/expedientes');

add('PROSPECTS_ACTIVE', 'Prospectos activos', 'COMERCIAL', 'Prospectos', 'prospectos.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/prospectos');
add('PROSPECTS_NEW', 'Prospectos nuevos', 'COMERCIAL', 'Prospectos', 'prospectos.read', 'S', 'OWN,TEAM,ORGANIZATION', '/prospectos', 'period');
add('PROSPECTS_STALE', 'Prospectos sin seguimiento', 'COMERCIAL', 'Prospectos', 'prospectos.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/prospectos', 'window');
add('PROSPECTS_READY', 'Listos para cotizar', 'COMERCIAL', 'Prospectos', 'prospectos.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/prospectos');
add('QUOTES_ACTIVE', 'Cotizaciones activas', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones');
add('QUOTES_TO_SEND', 'Cotizaciones por enviar', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones');
add('QUOTES_NO_RESPONSE', 'Cotizaciones sin respuesta', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/cotizaciones', 'window');
add('QUOTES_FOLLOWUP', 'Cotizaciones en seguimiento', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/cotizaciones');
add('QUOTES_ACCEPTED', 'Cotizaciones aceptadas', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones', 'period');
add('QUOTES_CONVERSION', 'Conversión de cotizaciones', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones', 'period');
add('CASES_CONVERSION', 'Conversión a expediente', 'COMERCIAL', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones', 'period');

add('TODAY_AGENDA', 'Agenda del día', 'AGENDA', 'Agenda', 'agenda.read', 'V,L', 'OWN,TEAM,ORGANIZATION', '/agenda', 'limit');
add('UPCOMING_APPOINTMENTS', 'Citas próximas', 'AGENDA', 'Agenda', 'agenda.read', 'M,L', 'OWN,TEAM,ORGANIZATION', '/agenda', 'window');
add('TODAY_SIGNINGS', 'Firmas de hoy', 'AGENDA', 'Agenda', 'agenda.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas');
add('UPCOMING_SIGNINGS', 'Firmas próximas', 'AGENDA', 'Expedientes', 'expedientes.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas', 'window');
add('SIGNED_TODAY', 'Firmados hoy', 'AGENDA', 'Expedientes', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas');
add('SIGNED_PERIOD', 'Firmados en el periodo', 'AGENDA', 'Expedientes', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas', 'period');
add('FOLLOWUP_REMINDERS', 'Recordatorios de seguimiento', 'AGENDA', 'Prospectos/Cotizaciones', 'prospectos.read', 'M,L,V', 'OWN,TEAM,ORGANIZATION', '/prospectos', 'limit');
add('PERSONAL_NOTEBOOK', 'Agenda personal', 'AGENDA', 'Mi Día', 'mi_dia.read', 'V,L', 'OWN', '/mi-dia', 'date');

add('MISSING_DOCUMENTS', 'Documentos faltantes', 'DOCUMENTOS', 'Documental', 'documentos.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('DOCUMENTS_TO_REVIEW', 'Documentos por revisar', 'DOCUMENTOS', 'Documental', 'documentos.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('EXPIRED_DOCUMENTS', 'Documentos vencidos', 'DOCUMENTOS', 'Documental', 'documentos.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('FORMATS_TO_GENERATE', 'Formatos por generar', 'DOCUMENTOS', 'CFG-002', 'expedientes.project.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('FORMATS_TO_SIGN', 'Formatos pendientes de firma', 'DOCUMENTOS', 'CFG-002', 'documentos.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('DOCUMENT_INCONSISTENCIES', 'Inconsistencias detectadas', 'DOCUMENTOS', 'Revisión IA', 'documentos.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/expedientes');
add('PLD_INCOMPLETE', 'Expedientes PLD incompletos', 'CUMPLIMIENTO', 'Cumplimiento', 'compliance.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/cumplimiento');
add('NOTICES_PENDING', 'Avisos pendientes', 'CUMPLIMIENTO', 'Cumplimiento', 'compliance.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/cumplimiento');
add('NOTICES_UPCOMING', 'Avisos por vencer', 'CUMPLIMIENTO', 'Cumplimiento', 'compliance.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/cumplimiento', 'window');
add('NOTICES_OVERDUE', 'Avisos vencidos', 'CUMPLIMIENTO', 'Cumplimiento', 'compliance.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/cumplimiento');

add('INCOME_COLLECTED', 'Ingreso cobrado', 'FINANZAS', 'Finanzas', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/finanzas', 'period');
add('COLLECTION_SCHEDULED', 'Cobro programado', 'FINANZAS', 'Finanzas', 'finanzas.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/finanzas?view=cartera', 'period');
add('FEES_SCHEDULED_SIGN', 'Honorarios programados a firma', 'FINANZAS', 'Presupuesto/Firma', 'finanzas.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/finanzas', 'period');
add('FEES_SIGNED', 'Honorarios firmados', 'FINANZAS', 'Presupuesto/Firma', 'finanzas.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/finanzas', 'period');
add('RECEIVABLE', 'Por cobrar', 'FINANZAS', 'Finanzas', 'finanzas.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/finanzas?view=cartera');
add('COLLECTED_TODAY', 'Cobrado hoy', 'FINANZAS', 'Finanzas', 'finanzas.read', 'S', 'OWN,TEAM,ORGANIZATION', '/finanzas');
add('QUOTES_ACTIVE_VALUE', 'Cotizaciones en curso $', 'FINANZAS', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones');
add('QUOTES_ACCEPTED_VALUE', 'Cotizaciones aceptadas $', 'FINANZAS', 'Cotizaciones', 'cotizaciones.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/cotizaciones', 'period');
add('ADVANCES_PENDING', 'Anticipos pendientes', 'FINANZAS', 'EXP-008', 'finanzas.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/finanzas');
add('CLIENT_RESOURCES', 'Recursos no propios disponibles', 'FINANZAS', 'EXP-008', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/finanzas');
add('PAYMENTS_DUE', 'Pagos por realizar', 'FINANZAS', 'EXP-008', 'finanzas.read', 'S,M,L', 'OWN,TEAM,ORGANIZATION', '/finanzas');
add('PAYMENTS_UNPROVEN', 'Pagos por comprobar', 'FINANZAS', 'EXP-008', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/finanzas');
add('INVOICES_PENDING', 'Facturas pendientes', 'FINANZAS', 'CFDI', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/finanzas?view=facturacion');
add('CFDI_TO_STAMP', 'CFDI por timbrar', 'FINANZAS', 'CFDI', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/finanzas?view=facturacion');
add('REP_PENDING', 'REP pendientes', 'FINANZAS', 'CFDI', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/finanzas?view=facturacion');

add('MY_ACTIVE_CASES', 'Mis expedientes activos', 'DESEMPENO', 'Expedientes', 'expedientes.read', 'S', 'OWN', '/expedientes');
add('SIGNED_CASES', 'Expedientes firmados', 'DESEMPENO', 'Expedientes', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas', 'period');
add('PRODUCTION_VALUE', 'Valor de producción', 'DESEMPENO', 'Presupuesto', 'finanzas.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/reportes', 'period');
add('AVERAGE_TO_SIGN', 'Tiempo promedio a firma', 'DESEMPENO', 'Expedientes', 'expedientes.read', 'S,M', 'OWN,TEAM,ORGANIZATION', '/reportes?view=firmas', 'period');
add('AVERAGE_PROCESS', 'Tiempo promedio por proceso', 'DESEMPENO', 'Seguimiento', 'expedientes.read', 'M,L', 'OWN,TEAM,ORGANIZATION', '/reportes', 'period');
add('USER_LOAD', 'Carga por usuario', 'DESEMPENO', 'Expedientes', 'reportes.read', 'M,L', 'TEAM,ORGANIZATION', '/reportes');

add('NEXT_DEED', 'Escritura siguiente', 'ARCHIVO', 'Archivo', 'expedientes.read', 'S', 'ORGANIZATION', '/archivo');
add('NEXT_FOLIO', 'Folio siguiente', 'ARCHIVO', 'Archivo', 'expedientes.read', 'S', 'ORGANIZATION', '/archivo');
add('CURRENT_BOOK', 'Libro/Tomo actual', 'ARCHIVO', 'Archivo', 'expedientes.read', 'S', 'ORGANIZATION', '/archivo');
add('FOLIOS_LEFT', 'Folios restantes', 'ARCHIVO', 'Archivo', 'expedientes.read', 'S', 'ORGANIZATION', '/archivo');
add('DEEDS_TODAY', 'Escrituras asignadas hoy', 'ARCHIVO', 'Archivo', 'expedientes.read', 'S,M', 'ORGANIZATION', '/archivo');
add('APPENDIX_PENDING', 'Apéndices pendientes', 'ARCHIVO', 'Archivo', 'expedientes.read', 'S,M', 'ORGANIZATION', '/archivo');

add('PRAVIA_ASSISTANT', 'Asistente PRAVIA', 'IA', 'PRAVIA IA', 'ai.use', 'M,L,V', 'OWN', '/mi-dia');
add('CAN_ADVANCE_TODAY', 'Qué puedo avanzar hoy', 'IA', 'Seguimiento', 'ai.work.read', 'M,L,V', 'OWN,TEAM,ORGANIZATION', '/mi-dia');
add('NEEDS_ATTENTION', 'Requieren mi atención', 'IA', 'MID-BASE', 'ai.work.read', 'M,L,V', 'OWN,TEAM,ORGANIZATION', '/mi-dia');
add('CRITICAL_ALERTS', 'Alertas críticas', 'IA', 'Notificaciones', 'ai.work.read', 'M,L', 'OWN,TEAM,ORGANIZATION', '/mi-dia');
add('DAY_SUMMARY', 'Resumen de mi día', 'IA', 'Mi Día', 'ai.work.read', 'M,L', 'OWN', '/mi-dia');

export const MI_DIA_CARD_CATALOG = Object.freeze(cards);
export const miDiaCardByKey = new Map(cards.map((card) => [card.key, card]));

// Sólo se ofrecen en el editor las tarjetas con lector y renderer conectados.
// Las demás definiciones sirven para completar los read models sin exponer
// tarjetas vacías que parezcan datos reales.
export const MI_DIA_CONNECTED_CARD_KEYS = new Set([
  'MY_PENDING', 'OVERDUE_PROCESSES', 'DUE_TODAY', 'UPCOMING_DUE',
  'CATASTRO_PENDING', 'RPP_PENDING', 'TESTIMONIES_PENDING',
  'CASES_INACTIVE', 'CASES_DELAYED', 'CASES_BLOCKED',
  'POSTSIGN_PENDING', 'DELIVERIES_PENDING',
  'READY_TO_SIGN', 'NOT_READY_TO_SIGN',
  'SIGNED_TODAY', 'SIGNED_PERIOD',
  'PROSPECTS_ACTIVE', 'PROSPECTS_NEW', 'PROSPECTS_STALE', 'PROSPECTS_READY',
  'QUOTES_ACTIVE', 'QUOTES_TO_SEND', 'QUOTES_NO_RESPONSE', 'QUOTES_FOLLOWUP', 'QUOTES_ACCEPTED',
  'QUOTES_CONVERSION', 'CASES_CONVERSION', 'QUOTES_ACTIVE_VALUE', 'QUOTES_ACCEPTED_VALUE',
  'INCOME_COLLECTED', 'COLLECTED_TODAY', 'COLLECTION_SCHEDULED', 'FEES_SCHEDULED_SIGN', 'FEES_SIGNED', 'ADVANCES_PENDING', 'PRODUCTION_VALUE', 'PAYMENTS_DUE', 'PAYMENTS_UNPROVEN', 'CLIENT_RESOURCES', 'REP_PENDING', 'INVOICES_PENDING', 'CFDI_TO_STAMP',
  'MISSING_DOCUMENTS', 'DOCUMENTS_TO_REVIEW', 'EXPIRED_DOCUMENTS',
  'FORMATS_TO_GENERATE',
  'FORMATS_TO_SIGN',
  'DOCUMENT_INCONSISTENCIES',
  'PLD_INCOMPLETE', 'NOTICES_PENDING', 'NOTICES_UPCOMING', 'NOTICES_OVERDUE',
  'CRITICAL_ALERTS', 'DAY_SUMMARY', 'CAN_ADVANCE_TODAY', 'NEEDS_ATTENTION',
  'NEXT_DEED', 'NEXT_FOLIO', 'DEEDS_TODAY', 'CURRENT_BOOK', 'FOLIOS_LEFT', 'APPENDIX_PENDING', 'MY_ACTIVE_CASES', 'SIGNED_CASES', 'USER_LOAD', 'AVERAGE_PROCESS', 'AVERAGE_TO_SIGN',
  'URGENT_TASKS', 'TODAY_AGENDA', 'UPCOMING_SIGNINGS', 'CASES',
  'FOLLOWUP_REMINDERS', 'PERSONAL_NOTEBOOK', 'RECEIVABLE', 'PRAVIA_ASSISTANT',
  'TODAY_SIGNINGS', 'UPCOMING_APPOINTMENTS',
]);
