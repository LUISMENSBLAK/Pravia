export const formatNumber = (value: number | string) => typeof value === 'number'
  ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(value)
  : value;

export const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};

export const formatRelativeDate = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const day = 86_400_000;
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / day);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(date);
};

export const formatCurrency = (value: number, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(value);

const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  ABIERTO: 'Abierto',
  ACTIVO: 'Activo',
  BORRADOR: 'Borrador',
  CANCELADO: 'Cancelado',
  CERRADO: 'Cerrado',
  EN_INTEGRACION: 'En integración',
  EN_PROCESO: 'En proceso',
  ENTREGADO: 'Entregado',
  FIRMADO: 'Firmado',
  LISTO_ENTREGA: 'Listo para entrega',
  PENDIENTE_CLIENTE: 'Pendiente del cliente',
  PENDIENTE_NOTARIA: 'Pendiente de notaría',
  SUSPENDIDO: 'Suspendido',
};

/**
 * Conserva el valor canónico recibido del backend y humaniza únicamente su
 * presentación. Los estados conocidos mantienen la redacción oficial de
 * PRAVIA; un valor histórico desconocido sigue siendo legible sin alterarlo.
 */
export const formatOperationalStatus = (value?: string) => {
  if (!value) return undefined;
  return OPERATIONAL_STATUS_LABELS[value] ?? value
    .toLocaleLowerCase('es-MX')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toLocaleUpperCase('es-MX'));
};
