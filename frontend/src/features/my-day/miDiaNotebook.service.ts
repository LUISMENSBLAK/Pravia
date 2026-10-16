import { apiRequest } from '../../services/api/client';

export type PersonalTask = {
  id: string;
  title: string;
  notes: string | null;
  original_on: string;
  effective_on: string;
  completed_at: string | null;
  canceled_at: string | null;
  carry_history: { from: string; to: string }[];
};

export type SystemTask = { id: string; origin: 'SYSTEM'; title: string; status: string;
  dueAt: string | null; completedAt: string | null; href: string };

type Envelope<T> = { success: true; data: T };

export const miDiaNotebookService = {
  async list(date?: string, view: 'DAY' | 'UPCOMING' | 'HISTORY' = 'DAY', signal?: AbortSignal) {
    const query = new URLSearchParams({ view });
    if (date) query.set('date', date);
    const response = await apiRequest<Envelope<{ today: string; selected: string; view: string; tasks: PersonalTask[]; systemItems: SystemTask[]; hasMore: boolean; systemHasMore: boolean }>>(`/mi-dia/notebook?${query}`, { signal });
    return response.data;
  },
  async create(title: string, date: string) {
    const response = await apiRequest<Envelope<PersonalTask>>('/mi-dia/notebook', { method: 'POST', body: JSON.stringify({ title, date }) });
    return response.data;
  },
  async update(id: string, changes: { completed?: boolean; title?: string; notes?: string; date?: string }) {
    const response = await apiRequest<Envelope<PersonalTask>>(`/mi-dia/notebook/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });
    return response.data;
  },
};
