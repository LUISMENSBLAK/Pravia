import { apiRequest } from '../../services/api/client';
import type { ManagedUser, NotificationItem, SearchResult, Session, UserPreferences } from './settings.types';
import type { ActActivity, ActListPayload, ActivityConcept, CatalogAct, CatalogArtifact, CatalogFolder, CatalogOwner, ExplorerPayload, SupportingCatalogs, CatalogImportPreview } from './catalogs/catalogs.types';
import type { PublishTimingPolicyInput, TimingPolicyDefinition, TimingPolicyRevision } from './timing/timing.types';

const qs = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
  return query.toString();
};

const timingVisualFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).get('fixture') === 'g0c';
const timingVisualPolicies: TimingPolicyDefinition[] = [
  ['PROSPECT_INFO_COLLECTION', 'COMMERCIAL', 'Prospecto · Recabando información', 'Desde la entrada efectiva a Recabando información hasta la salida de esa etapa.'],
  ['PROSPECT_READY_TO_REQUEST', 'COMMERCIAL', 'Prospecto · Listo para solicitar', 'Desde Listo para solicitar hasta el envío efectivo confirmado a Notaría.'],
  ['PROSPECT_NOTARY_WAIT', 'COMMERCIAL', 'Prospecto · Espera de Notaría', 'Desde el envío efectivo hasta la recepción efectiva de la cotización notarial.'],
  ['ADMIN_PAYMENT_REQUEST_PENDING', 'ADMINISTRATIVE', 'Solicitud de pago pendiente', 'Desde la creación pendiente hasta que se paga o anula.'],
  ['ADMIN_RECEIPT_PENDING_APPLICATION', 'ADMINISTRATIVE', 'Comprobante pendiente de aplicación', 'Desde el reporte del comprobante hasta que se aplica o anula.'],
].map(([type, domain, label, description]) => ({ type, domain, label, description, status: 'NOT_CONFIGURED', current: null, history: [] } as TimingPolicyDefinition));

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
  timingPolicies: () => timingVisualFixture ? Promise.resolve(timingVisualPolicies) : apiRequest<{ success: true; data: TimingPolicyDefinition[] }>('/settings/timing-policies').then((payload) => payload.data),
  publishTimingPolicy: (data: PublishTimingPolicyInput) => {
    const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `timing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return apiRequest<{ success: true; data: { revision: TimingPolicyRevision; idempotent: boolean } }>('/settings/timing-policies', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }).then((payload) => payload.data);
  },
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
  catalogActivityConcepts: () => apiRequest<{ data: ActivityConcept[] }>('/settings/catalogs/v2/concepts').then((payload) => payload.data),
  createCatalogActivityConcept: (data: Record<string, unknown>) => apiRequest<{ data: ActivityConcept }>('/settings/catalogs/v2/concepts', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  updateCatalogActivityConcept: (id: string, data: Record<string, unknown>) => apiRequest<{ data: ActivityConcept }>(`/settings/catalogs/v2/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }).then((payload) => payload.data),
  addCatalogConceptApplication: (stageId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/stages/${stageId}/activity-applications`, { method: 'POST', body: JSON.stringify(data) }),
  inheritCatalogActivityAttribute: (activityId: string, attribute: string) => apiRequest(`/settings/catalogs/activities/${activityId}/inherit/${attribute}`, { method: 'POST' }),
  duplicateCatalogAct: (id: string, nombre: string) => apiRequest(`/settings/catalogs/acts/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ nombre }) }),
  overrideInheritedCatalogActivity: (actId: string, activityId: string, data: Record<string, unknown>) => apiRequest<{ data: ActActivity }>(`/settings/catalogs/acts/${actId}/activities/${activityId}/override`, { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  removeCatalogConceptFromAct: (actId: string, activityId: string) => apiRequest(`/settings/catalogs/acts/${actId}/activities/${activityId}`, { method: 'DELETE' }),
  bootstrapCatalogV2: () => apiRequest('/settings/catalogs/v2/bootstrap', { method: 'POST' }),
  upsertInstitutionResponseTime: (institutionId: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/institutions/${institutionId}/response-times`, { method: 'PUT', body: JSON.stringify(data) }),
  createActsCatalogInstitution: (data: Record<string, unknown>) => apiRequest('/settings/catalogs/v2/institutions', { method: 'POST', body: JSON.stringify(data) }),
  catalogArtifactRoot: () => apiRequest<{ data: { notaria: CatalogOwner | null; institutions: CatalogOwner[]; legacy_notaries_hidden?: number } }>('/settings/catalogs/artifacts/root').then((payload) => payload.data),
  catalogSupporting: () => apiRequest<{ data: SupportingCatalogs }>('/settings/catalogs/supporting').then((payload) => payload.data),
  createCatalogInstitution: (data: Record<string, unknown>) => apiRequest<{ data: CatalogOwner }>('/settings/catalogs/institutions', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  catalogExplorer: (ownerType: string, ownerId: string, type: string, folderId?: string | null) => apiRequest<{ data: ExplorerPayload }>(`/settings/catalogs/explorer?owner_type=${ownerType}&owner_id=${encodeURIComponent(ownerId)}&type=${encodeURIComponent(type)}${folderId ? `&folder_id=${encodeURIComponent(folderId)}` : ''}`).then((payload) => payload.data),
  createCatalogFolder: (data: Record<string, unknown>) => apiRequest<{ data: CatalogFolder }>('/settings/catalogs/folders', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  createCatalogArtifact: (metadata: Record<string, unknown>, file: File) => { const body = new FormData(); body.append('metadata', JSON.stringify(metadata)); body.append('file', file); return apiRequest<{ data: CatalogArtifact }>('/settings/catalogs/artifacts', { method: 'POST', body }).then((payload) => payload.data); },
  updateCatalogArtifact: (id: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/artifacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addCatalogArtifactVersion: (id: string, file: File, version?: number) => { const body = new FormData(); body.append('metadata', JSON.stringify({ version })); body.append('file', file); return apiRequest(`/settings/catalogs/artifacts/${id}/versions`, { method: 'POST', body }); },
  catalogArtifactVersionUrl: (id: string) => apiRequest<{ data: { url: string } }>(`/settings/catalogs/artifact-versions/${id}/url`).then((payload) => payload.data),
  bootstrapCatalogLibraryV4: () => apiRequest('/settings/catalogs/artifacts/library/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'PRAVIA_CFG002_STANDARD:v2-LEGAL' } }),
  previewCatalogImport: (files: File[]) => { const body = new FormData(); files.forEach((file) => body.append('files', file)); return apiRequest<{ data: CatalogImportPreview }>('/settings/catalogs/artifacts/import/preview', { method: 'POST', body }).then((payload) => payload.data); },
  confirmCatalogImport: (metadata: Record<string, unknown>, files: File[]) => { const body = new FormData(); body.append('metadata', JSON.stringify(metadata)); files.forEach((file) => body.append('files', file)); return apiRequest('/settings/catalogs/artifacts/import/confirm', { method: 'POST', headers: { 'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `cfg002-${Date.now()}` }, body }); },
};
