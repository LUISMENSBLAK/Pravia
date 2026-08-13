import type { ExpedienteEstatus } from '@prisma/client';

export type ExpedienteMacrophase = 'INTEGRACION' | 'PROYECTO' | 'FIRMA' | 'POSTFIRMA' | 'ENTREGADO' | 'OTROS';

export const EXPEDIENTE_MACROPHASE_STATUSES: Record<ExpedienteMacrophase, ExpedienteEstatus[]> = {
  INTEGRACION: ['ABIERTO', 'EN_INTEGRACION', 'PENDIENTE_CLIENTE'],
  PROYECTO: ['EN_PROCESO', 'PENDIENTE_NOTARIA'],
  FIRMA: ['FIRMA_PROGRAMADA', 'FIRMADO'],
  POSTFIRMA: ['POST_FIRMA', 'LISTO_ENTREGA'],
  ENTREGADO: ['ENTREGADO'],
  OTROS: ['SUSPENDIDO', 'CANCELADO'],
};

export function macrophaseForStatus(status: ExpedienteEstatus): ExpedienteMacrophase {
  return (Object.entries(EXPEDIENTE_MACROPHASE_STATUSES)
    .find(([, statuses]) => statuses.includes(status))?.[0] || 'OTROS') as ExpedienteMacrophase;
}

export type ExpedienteQueryInput = {
  search?: unknown;
  estatus?: unknown;
  macrofase?: unknown;
  etapa?: unknown;
  abogado_id?: unknown;
  responsable?: unknown;
  notaria_id?: unknown;
  tipo_acto_id?: unknown;
  cliente?: unknown;
  riesgo?: unknown;
  fecha_desde?: unknown;
  fecha_hasta?: unknown;
  page?: unknown;
  limit?: unknown;
  pageSize?: unknown;
  sort?: unknown;
};

export type ParsedExpedienteQuery = {
  search?: string;
  status?: ExpedienteEstatus;
  macrophase?: ExpedienteMacrophase;
  stage?: string;
  responsibleId?: string;
  notaryId?: string;
  actTypeId?: string;
  client?: string;
  risk?: 'ATTENTION' | 'EVALUATED' | 'UNEVALUATED';
  updatedFrom?: Date;
  updatedTo?: Date;
  page: number;
  pageSize: number;
  sort: 'numero_pravia:asc' | 'numero_pravia:desc' | 'updated_at:asc' | 'updated_at:desc';
};

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const date = (value: unknown, endOfDay = false) => {
  const source = text(value);
  if (!source) return undefined;
  const parsed = new Date(`${source}${/^\d{4}-\d{2}-\d{2}$/.test(source) ? endOfDay ? 'T23:59:59.999' : 'T00:00:00.000' : ''}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function parseExpedienteQuery(input: ExpedienteQueryInput): ParsedExpedienteQuery {
  const page = Math.max(1, Number.parseInt(String(input.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(input.pageSize || input.limit || '20'), 10) || 20));
  const statuses = new Set<ExpedienteEstatus>(Object.values(EXPEDIENTE_MACROPHASE_STATUSES).flat());
  const statusValue = text(input.estatus)?.toUpperCase() as ExpedienteEstatus | undefined;
  const macroValue = text(input.macrofase)?.toUpperCase() as ExpedienteMacrophase | undefined;
  const riskValue = text(input.riesgo)?.toUpperCase() as ParsedExpedienteQuery['risk'];
  const requestedSort = text(input.sort)?.toLowerCase().replace('folio', 'numero_pravia').replace('actualizacion', 'updated_at');
  const validSort = new Set<ParsedExpedienteQuery['sort']>(['numero_pravia:asc', 'numero_pravia:desc', 'updated_at:asc', 'updated_at:desc']);
  return {
    search: text(input.search),
    status: statusValue && statuses.has(statusValue) ? statusValue : undefined,
    macrophase: macroValue && Object.prototype.hasOwnProperty.call(EXPEDIENTE_MACROPHASE_STATUSES, macroValue) ? macroValue : undefined,
    stage: text(input.etapa),
    responsibleId: text(input.abogado_id) || text(input.responsable),
    notaryId: text(input.notaria_id),
    actTypeId: text(input.tipo_acto_id),
    client: text(input.cliente),
    risk: riskValue && ['ATTENTION', 'EVALUATED', 'UNEVALUATED'].includes(riskValue) ? riskValue : undefined,
    updatedFrom: date(input.fecha_desde),
    updatedTo: date(input.fecha_hasta, true),
    page,
    pageSize,
    sort: validSort.has(requestedSort as ParsedExpedienteQuery['sort'])
      ? requestedSort as ParsedExpedienteQuery['sort']
      : 'updated_at:desc',
  };
}

export function complianceAttention(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const classification = String((result as Record<string, unknown>).clasificacion || '');
  return ['REQUIERE_AVISO', 'INCOMPLETO', 'INSUMOS_INCOMPLETOS'].includes(classification);
}

export function complianceLabel(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'Sin evaluar';
  const classification = String((result as Record<string, unknown>).clasificacion || '');
  const labels: Record<string, string> = {
    REQUIERE_AVISO: 'Requiere atención',
    INCOMPLETO: 'Información pendiente',
    INSUMOS_INCOMPLETOS: 'Información pendiente',
    SIN_AVISO_POR_UMBRAL: 'Revisado',
    LISTO_PARA_REVISION_FISCAL: 'Revisión fiscal',
  };
  return labels[classification] || 'Evaluado';
}
