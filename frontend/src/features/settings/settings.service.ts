import { apiRequest } from '../../services/api/client';
import type { ManagedUser, NotificationItem, SearchResult, Session, UserPreferences } from './settings.types';
import type { ActListPayload, CatalogAct, CatalogArtifact, CatalogFolder, CatalogOwner, ExplorerPayload, SupportingCatalogs } from './catalogs/catalogs.types';

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
  catalogActs: (search = '') => apiRequest<{ data: ActListPayload }>(`/settings/catalogs/acts${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((payload) => payload.data),
  catalogAct: (id: string) => apiRequest<{ data: CatalogAct }>(`/settings/catalogs/acts/${id}`).then((payload) => payload.data),
  createCatalogAct: (data: Record<string, unknown>) => apiRequest<{ data: CatalogAct }>('/settings/catalogs/acts', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  ensureActConfiguration: (id: string) => apiRequest(`/settings/catalogs/acts/${id}/configuration`, { method: 'POST' }),
  updateCatalogAct: (id: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/acts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createCatalogStage: (actId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/acts/${actId}/stages`, { method: 'POST', body: JSON.stringify(data) }),
  updateCatalogStage: (stageId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/stages/${stageId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCatalogStage: (stageId: string) => apiRequest(`/settings/catalogs/stages/${stageId}`, { method: 'DELETE' }),
  createCatalogActivity: (stageId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/stages/${stageId}/activities`, { method: 'POST', body: JSON.stringify(data) }),
  updateCatalogActivity: (activityId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/activities/${activityId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  setCatalogDependencies: (activityId: string, dependency_ids: string[]) => apiRequest(`/settings/catalogs/activities/${activityId}/dependencies`, { method: 'PUT', body: JSON.stringify({ dependency_ids, bloqueante: true }) }),
  createCatalogException: (activityId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/activities/${activityId}/exceptions`, { method: 'POST', body: JSON.stringify(data) }),
  updateCatalogException: (exceptionId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/exceptions/${exceptionId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  catalogArtifactRoot: () => apiRequest<{ data: { notarias: CatalogOwner[]; institutions: CatalogOwner[] } }>('/settings/catalogs/artifacts/root').then((payload) => payload.data),
  catalogSupporting: () => apiRequest<{ data: SupportingCatalogs }>('/settings/catalogs/supporting').then((payload) => payload.data),
  createCatalogInstitution: (data: Record<string, unknown>) => apiRequest<{ data: CatalogOwner }>('/settings/catalogs/institutions', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  catalogExplorer: (ownerType: string, ownerId: string, type: string, folderId?: string | null) => apiRequest<{ data: ExplorerPayload }>(`/settings/catalogs/explorer?owner_type=${ownerType}&owner_id=${encodeURIComponent(ownerId)}&type=${encodeURIComponent(type)}${folderId ? `&folder_id=${encodeURIComponent(folderId)}` : ''}`).then((payload) => payload.data),
  createCatalogFolder: (data: Record<string, unknown>) => apiRequest<{ data: CatalogFolder }>('/settings/catalogs/folders', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  createCatalogArtifact: (metadata: Record<string, unknown>, file: File) => { const body = new FormData(); body.append('metadata', JSON.stringify(metadata)); body.append('file', file); return apiRequest<{ data: CatalogArtifact }>('/settings/catalogs/artifacts', { method: 'POST', body }).then((payload) => payload.data); },
  updateCatalogArtifact: (id: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/artifacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addCatalogArtifactVersion: (id: string, file: File, version?: number) => { const body = new FormData(); body.append('metadata', JSON.stringify({ version })); body.append('file', file); return apiRequest(`/settings/catalogs/artifacts/${id}/versions`, { method: 'POST', body }); },
  catalogArtifactVersionUrl: (id: string) => apiRequest<{ data: { url: string } }>(`/settings/catalogs/artifact-versions/${id}/url`).then((payload) => payload.data),
};
