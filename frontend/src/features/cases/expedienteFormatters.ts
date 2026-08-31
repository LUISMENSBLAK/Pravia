import type { ExpedienteMacrophase, ExpedienteStatus, PartyOption } from './expedientes.types';
export const statusLabels: Record<ExpedienteStatus, string> = { ABIERTO: 'Abierto', EN_INTEGRACION: 'En integración', EN_PROCESO: 'En proceso', PENDIENTE_CLIENTE: 'Pendiente del cliente', PENDIENTE_NOTARIA: 'Pendiente de Notaría', FIRMA_PROGRAMADA: 'Firma programada', FIRMADO: 'Firmado', POST_FIRMA: 'Postfirma', LISTO_ENTREGA: 'Listo para entrega', ENTREGADO: 'Entregado', SUSPENDIDO: 'Suspendido', CANCELADO: 'Cancelado' };
const activityEnumLabels: Record<string, string> = {
  ...statusLabels,
  ACTIVO: 'Activo',
  APLICADO: 'Aplicado',
  APROBADO: 'Aprobado',
  BLOQUEADO: 'Bloqueado',
  BORRADOR: 'Borrador',
  COMPLETADO: 'Completado',
  EN_ESPERA_EXTERNA: 'En espera externa',
  NO_APLICA: 'No aplica',
  NO_INICIADO: 'No iniciado',
  PAGADO: 'Pagado',
  PENDIENTE: 'Pendiente',
  PENDIENTE_REVISION: 'Pendiente de revisión',
  RECHAZADO: 'Rechazado',
  REQUIERE_AJUSTES: 'Requiere ajustes',
  REQUIERE_REVISION: 'Requiere revisión',
  RETIRADO: 'Retirado',
  VALIDADO: 'Validado',
};
const activityFieldLabels: Record<string, string> = {
  estado: 'Estado',
  estatus: 'Estado',
  etapa: 'Etapa',
  responsable: 'Responsable',
  validacion: 'Validación',
};
const technicalEnum = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/** Canonical user-facing labels for historical values shown by EXP-009. */
export const activityValueLabel = (value: string) => {
  const canonical = activityEnumLabels[value];
  if (canonical) return canonical;
  if (!technicalEnum.test(value)) return value;
  const words = value.toLocaleLowerCase('es-MX').split('_').join(' ');
  return words.charAt(0).toLocaleUpperCase('es-MX') + words.slice(1);
};

/** Canonical field names for the previous → new activity comparison. */
export const activityFieldLabel = (value: string) => activityFieldLabels[value.toLocaleLowerCase('es-MX')]
  || value.split('_').join(' ').replace(/^./, (letter) => letter.toLocaleUpperCase('es-MX'));
export const macroLabels: Record<ExpedienteMacrophase, string> = { INTEGRACION: 'Integración', PROYECTO: 'Proyecto', FIRMA: 'Firma', POSTFIRMA: 'Postfirma', ENTREGADO: 'Entregado', OTROS: 'Atención' };
export const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
export const shortDateTime = (value?: string | null) => {
  if (!value) return 'Sin fecha'; const date = new Date(value); const today = new Date(); const same = date.toDateString() === today.toDateString();
  return same ? `Hoy · ${new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(date)}` : new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
};
export const fullName = (person?: { nombre?: string; apellido?: string | null } | null) => person ? `${person.nombre || ''} ${person.apellido || ''}`.trim() : 'Sin asignar';
export const partyOptionName = (party: PartyOption) => party.personaFisica?.nombre_completo_calculado || party.personaMoral?.razon_social || party.nombre_busqueda;
export const readinessLabel = (state: string) => ({ COMPLETO: 'Completo', PENDIENTE: 'Pendiente', NO_APLICA: 'No aplica', NO_CONFIGURADO: 'No configurado' }[state] || state);
