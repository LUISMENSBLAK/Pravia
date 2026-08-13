import { apiRequest } from '../../services/api/client';
import type { AgendaCatalogs, AgendaDraft, AgendaEvent, AgendaLoadResult, AgendaTask } from './agenda.types';
import { zonedLocalToIso } from './agenda.utils';

const query = (values: Record<string, string | undefined>) => { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => value && params.set(key, value)); return params.toString(); };
const payload = (draft: AgendaDraft, timezone: string) => ({
  titulo: draft.titulo.trim(), tipo: draft.tipo,
  fecha_inicio: zonedLocalToIso(draft.fecha, draft.hora_inicio, timezone),
  fecha_fin: zonedLocalToIso(draft.fecha, draft.hora_fin, timezone),
  responsable_id: draft.responsable_id || undefined,
  expediente_id: draft.expediente_id || undefined,
  compareciente_id: draft.compareciente_id || undefined,
  descripcion: draft.descripcion.trim() || undefined,
  recordatorios: draft.recordatorio ? [Number(draft.recordatorio)] : [],
});

export const agendaService = {
  list: (from: Date, to: Date, userId?: string, signal?: AbortSignal) => apiRequest<AgendaLoadResult>(`/agenda?${query({ desde: from.toISOString(), hasta: to.toISOString(), estatus: 'TODOS', user_id: userId })}`, { signal }),
  catalogs: (signal?: AbortSignal) => apiRequest<{ success: true; catalogos: AgendaCatalogs }>('/agenda/catalogos', { signal }).then((result) => result.catalogos),
  tasks: (userId?: string, signal?: AbortSignal) => apiRequest<{ success: true; tareas: AgendaTask[]; meta: { total: number } }>(`/agenda/tareas?${query({ user_id: userId, estatus: 'TODOS' })}`, { signal }),
  detail: (id: string, signal?: AbortSignal) => apiRequest<{ success: true; evento: AgendaEvent; meta: { timezone: string } }>(`/agenda/${id}`, { signal }),
  conflicts: (draft: AgendaDraft, timezone: string, excludeId?: string) => {
    const body = payload(draft, timezone); return apiRequest<{ success: true; conflictos: AgendaEvent[]; meta: { total: number; blocking: boolean; timezone: string } }>(`/agenda/conflictos?${query({ responsable_id: draft.responsable_id, desde: body.fecha_inicio, hasta: body.fecha_fin, excluir_id: excludeId })}`);
  },
  create: (draft: AgendaDraft, timezone: string) => apiRequest<{ success: true; evento: AgendaEvent; conflictos: AgendaEvent[] }>('/agenda', { method: 'POST', body: JSON.stringify(payload(draft, timezone)) }),
  update: (id: string, draft: AgendaDraft, timezone: string) => apiRequest<{ success: true; evento: AgendaEvent; conflictos: AgendaEvent[] }>(`/agenda/${id}`, { method: 'PATCH', body: JSON.stringify(payload(draft, timezone)) }),
  cancel: (id: string, reason: string) => apiRequest<{ success: true; evento: AgendaEvent }>(`/agenda/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo_cancelacion: reason }) }),
};
