import { apiRequest } from '../../services/api/client';
import type { ManagedUser, NotificationItem, SearchResult, Session, UserPreferences } from './settings.types';

const qs = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
  return query.toString();
};

export const settingsService = {
  overview: () => apiRequest<any>('/settings/overview'),
  profile: () => apiRequest<any>('/settings/profile'),
  updateProfile: (data: { nombre: string; apellido: string; telefono?: string }) => apiRequest<any>('/settings/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  preferences: () => apiRequest<{ preferences: UserPreferences }>('/settings/preferences'),
  updatePreferences: (data: Partial<UserPreferences>) => apiRequest<{ preferences: UserPreferences }>('/settings/preferences', { method: 'PATCH', body: JSON.stringify(data) }),
  sessions: () => apiRequest<{ sessions: Session[] }>('/settings/sessions'),
  revokeSession: (id: string) => apiRequest<{ current_session_revoked: boolean }>(`/settings/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () => apiRequest<{ revoked_count: number }>('/settings/sessions/revoke-others', { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) => apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  users: (params: Record<string, string | number | undefined>) => apiRequest<{ data: ManagedUser[]; metrics: any; meta: any }>(`/users?${qs(params)}`),
  user: (id: string) => apiRequest<any>(`/users/${id}`),
  userImpact: (id: string) => apiRequest<any>(`/users/${id}/impact`),
  updateUser: (id: string, data: Record<string, unknown>) => apiRequest<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  invitations: () => apiRequest<any>('/users/invitations'),
  invite: (data: { email: string; nombre: string; apellido: string; rol: string }) => apiRequest<any>('/users/invitations', { method: 'POST', body: JSON.stringify(data) }),
  revokeInvitation: (id: string) => apiRequest(`/users/invitations/${id}`, { method: 'DELETE' }),
  roles: () => apiRequest<any>('/settings/roles'),
  audit: (params: Record<string, string | number | undefined>) => apiRequest<any>(`/settings/audit?${qs(params)}`),
  aiDashboard: () => apiRequest<any>('/ia/dashboard?periodo=30_DIAS'),
  notifications: () => apiRequest<{ notifications: NotificationItem[]; unread: number }>('/settings/notifications'),
  readNotification: (id: string) => apiRequest(`/settings/notifications/${id}/read`, { method: 'POST' }),
  readAllNotifications: () => apiRequest('/settings/notifications/read-all', { method: 'POST' }),
  search: (query: string) => apiRequest<{ data: SearchResult[] }>(`/settings/search?q=${encodeURIComponent(query)}`),
};
