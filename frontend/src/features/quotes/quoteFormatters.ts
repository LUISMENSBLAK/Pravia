import type { Quote, QuoteConcept, QuoteContractStage, QuoteState, QuoteVersion } from './quotes.types';

export const QUOTE_STATE_LABELS: Record<QuoteState, string> = {
  BORRADOR: 'Borrador',
  ENVIADA_NOTARIA: 'Enviada a notaría',
  PRESUPUESTO_RECIBIDO: 'Presupuesto recibido',
  EN_REVISION_ABOGADO: 'En revisión',
  ENVIADA_CLIENTE: 'Enviada al cliente',
  EN_NEGOCIACION: 'En negociación',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  CONVERTIDA_EXPEDIENTE: 'Convertida',
};

export const QUOTE_CONTRACT_STAGE_LABELS: Record<QuoteContractStage, string> = {
  BORRADOR: 'Borrador',
  ENVIADA_CLIENTE: 'Enviada al cliente',
  ACEPTO_ANTICIPO: 'Aceptó / Anticipo',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  CONVERTIDA_EXPEDIENTE: 'Convertida en expediente',
};

export const quoteTone = (state: QuoteState) => {
  if (state === 'ACEPTADA') return 'success';
  if (state === 'CONVERTIDA_EXPEDIENTE') return 'converted';
  if (state === 'RECHAZADA' || state === 'VENCIDA' || state === 'CANCELADA') return 'danger';
  if (state === 'SUSPENDIDA') return 'warning';
  if (state === 'ENVIADA_CLIENTE' || state === 'ENVIADA_NOTARIA') return 'info';
  if (state === 'PRESUPUESTO_RECIBIDO' || state === 'EN_REVISION_ABOGADO' || state === 'EN_NEGOCIACION') return 'warning';
  return 'neutral';
};

export const quoteDisplayStage = (quote: Quote) => ({
  label: quote.workflow?.stage
    ? QUOTE_CONTRACT_STAGE_LABELS[quote.workflow.stage]
    : QUOTE_STATE_LABELS[quote.estado],
  tone: quote.workflow?.stage === 'ACEPTO_ANTICIPO' ? 'success'
    : quote.workflow?.stage === 'CONVERTIDA_EXPEDIENTE' ? 'converted'
      : quote.workflow?.stage === 'CANCELADA' ? 'danger'
        : quote.workflow?.stage === 'SUSPENDIDA' ? 'warning'
          : quote.workflow?.stage === 'ENVIADA_CLIENTE' ? 'info'
            : quoteTone(quote.estado),
});

export const money = (value: number | string | null | undefined) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(amount) : '—';
};

export const compactMoney = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const shortDate = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';

export const quoteDeadline = (quote: Quote) => {
  if (quote.workflow?.stage) {
    if (quote.workflow.stage === 'ACEPTO_ANTICIPO') return { label: quote.workflow.acceptedAdvanceAt ? `Aceptó / Anticipo · ${shortDate(quote.workflow.acceptedAdvanceAt)}` : 'Aceptó / Anticipo', tone: 'success' };
    if (quote.workflow.stage === 'CONVERTIDA_EXPEDIENTE') return { label: 'Convertida en expediente', tone: 'converted' };
    if (quote.workflow.stage === 'SUSPENDIDA') return { label: 'Suspendida', tone: 'warning' };
    if (quote.workflow.stage === 'CANCELADA') return { label: 'Cancelada', tone: 'danger' };
    return { label: quote.workflow.stageEnteredAt ? `Desde ${shortDate(quote.workflow.stageEnteredAt)}` : 'Sin fecha registrada', tone: 'muted' };
  }
  if (quote.estado === 'VENCIDA') return { label: 'Vencida', tone: 'danger' };
  if (quote.estado === 'ACEPTADA') return { label: quote.fecha_aceptacion_cliente ? `Aceptada ${shortDate(quote.fecha_aceptacion_cliente)}` : 'Aceptada', tone: 'success' };
  if (quote.estado === 'CONVERTIDA_EXPEDIENTE') return { label: 'Convertida', tone: 'converted' };
  if (!quote.fecha_limite_respuesta_notaria || !['ENVIADA_NOTARIA'].includes(quote.estado)) return { label: 'Sin fecha definida', tone: 'muted' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(quote.fecha_limite_respuesta_notaria);
  deadline.setHours(0, 0, 0, 0);
  const days = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: 'Plazo vencido', tone: 'danger' };
  if (days === 0) return { label: 'Vence hoy', tone: 'danger' };
  return { label: `Vence en ${days} día${days === 1 ? '' : 's'}`, tone: days <= 2 ? 'warning' : 'muted' };
};

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const conceptsFromVersion = (version?: QuoteVersion | null): QuoteConcept[] => {
  if (!version) return [];
  const root = asRecord(version.desglose_notaria);
  const rows = Array.isArray(version.desglose_notaria) ? version.desglose_notaria : Array.isArray(root?.rubros) ? root.rubros : [];
  return rows.flatMap((item) => {
    const row = asRecord(item);
    const concepto = typeof row?.concepto === 'string' ? row.concepto : typeof row?.nombre === 'string' ? row.nombre : '';
    const monto = Number(row?.monto ?? row?.importe ?? 0);
    const rawCategory = String(row?.categoria ?? 'OTROS').toUpperCase();
    const categoria = ['HONORARIOS', 'DERECHOS', 'IMPUESTOS', 'GASTOS', 'OTROS'].includes(rawCategory) ? rawCategory as QuoteConcept['categoria'] : 'OTROS';
    return concepto && Number.isFinite(monto) ? [{ categoria, concepto, monto }] : [];
  });
};
