import { apiRequest } from '../../services/api/client';
import type { ManagedUser, NotificationFeed, OrganizationProfile, SearchResult, Session, UserPreferences } from './settings.types';
import type { ActActivity, ActListPayload, ActivityConcept, CatalogAct, CatalogArtifact, CatalogFolder, CatalogOwner, ExplorerPayload, SupportingCatalogs, CatalogImportPreview, QuestionnaireBanksPayload, QuestionnaireQuestion, FunctionalDestinationOption, ArtifactDestination, ProjectTemplateAssignment } from './catalogs/catalogs.types';
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
  organization: () => apiRequest<{ profile: OrganizationProfile }>('/settings/organization'),
  updateOrganization: (data: Partial<Omit<OrganizationProfile, 'id' | 'logo_storage_key' | 'updated_at'>>) =>
    apiRequest<{ profile: OrganizationProfile }>('/settings/organization', { method: 'PATCH', body: JSON.stringify(data) }),
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
  planConsumption: () => apiRequest<any>('/platform/consumption'),
  platformDashboard: () => apiRequest<any>('/platform/admin/dashboard'),
  platformTenants: () => apiRequest<Array<{
    id: string; name: string; status: string; created_at: string;
    storage?: { production_bytes: string; temporary_bytes: string; reserved_bytes: string } | null;
    aiWallet?: { balance_minor: string; reserved_minor: string; currency: string; status: string } | null;
  }>>('/platform/admin/tenants'),
  tenantMigrations: () => apiRequest<{ jobs: Array<{
    id: string; source_system: string; status: string; progress: number; declared_bytes: string;
    temporary_bytes: string; estimated_production_bytes: string; detected_files: number;
    detected_records: number; duplicate_files: number; corrupt_files: number; dangerous_files: number;
    created_at: string; updated_at: string; completed_at?: string | null;
  }> }>('/platform/migrations'),
  tenantExports: () => apiRequest<Array<{ id: string; status: string; progress: number; created_at: string; expires_at: string | null }>>('/platform/exports'),
  createTenantExport: () => apiRequest<{ id: string }>('/platform/exports', { method: 'POST', body: JSON.stringify({
    scope: ['TENANT', 'USUARIOS', 'COMPARECIENTES', 'PROSPECTOS', 'COTIZACIONES', 'EXPEDIENTES', 'ACTOS',
      'PREDIOS', 'ARCHIVO', 'AGENDA', 'FINANZAS', 'DOCUMENTOS', 'RELACIONES',
      'CUMPLIMIENTO', 'CONOCIMIENTO', 'CONFIGURACION'],
    format: 'ZIP_CSV', idempotency_key: globalThis.crypto.randomUUID(),
  }) }),
  tenantExportDownload: (id: string) => apiRequest<{ url: string; expiresAt: string; sizeBytes: string }>(`/platform/exports/${encodeURIComponent(id)}/download`),
  createTenantMigration: (data: { source_system: string; declared_bytes: string; idempotency_key: string }) =>
    apiRequest<any>('/platform/migrations', { method: 'POST', body: JSON.stringify(data) }),
  createMigrationUpload: (jobId: string, data: { filename: string; declared_bytes: string; part_size_bytes: number; idempotency_key: string }) =>
    apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/uploads`, { method: 'POST', body: JSON.stringify(data) }),
  uploadMigrationPart: (jobId: string, sessionId: string, partNumber: number, part: Blob, checksum: string) => {
    const body = new FormData();
    body.append('part', part, `part-${partNumber}.bin`);
    return apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/uploads/${encodeURIComponent(sessionId)}/parts/${partNumber}`, {
      method: 'PUT', headers: { 'X-Content-SHA256': checksum }, body,
    });
  },
  completeMigrationUpload: (jobId: string, sessionId: string) =>
    apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/uploads/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST', body: JSON.stringify({}),
    }),
  migrationPreview: (jobId: string) => apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/preview`),
  submitMigrationMapping: (jobId: string, data: { entity_type: string; fields: Array<{ source_field: string; target_field: string | null }> }) =>
    apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/mapping`, { method: 'PUT', body: JSON.stringify(data) }),
  approveMigration: (jobId: string) => apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/approve`, { method: 'POST', body: JSON.stringify({}) }),
  executeMigration: (jobId: string, backupRunId: string) => apiRequest<any>(`/platform/migrations/${encodeURIComponent(jobId)}/execute`, {
    method: 'POST', body: JSON.stringify({ backup_run_id: backupRunId }),
  }),
  certifiedMigrationBackups: () => apiRequest<Array<{
    id: string; scope: string; provider: string; completed_at: string; bytes: string;
    latestRestoreDrill: { tested_at: string; result: 'PASS'; sample_count: number };
  }>>('/platform/migrations/backups/certified'),
  notifications: (history = false) => apiRequest<NotificationFeed>(`/settings/notifications${history ? '?history=1' : ''}`),
  readNotification: (id: string) => apiRequest(`/settings/notifications/${id}/read`, { method: 'POST' }),
  readAllNotifications: () => apiRequest('/settings/notifications/read-all', { method: 'POST' }),
  dismissNotification: (id: string) => apiRequest(`/settings/notifications/${id}/dismiss`, { method: 'POST' }),
  markNotificationNotApplicable: (id: string) => apiRequest(`/settings/notifications/${id}/not-applicable`, { method: 'POST' }),
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
  actCreationDefaults: () => apiRequest<{ data: Record<string, Array<{ code: string; name: string; stage: string; duration: number; dayType: 'HABILES' | 'NATURALES'; nature: string }>> }>('/settings/catalogs/acts/creation-defaults').then((payload) => payload.data),
  catalogAct: (id: string) => apiRequest<{ data: CatalogAct }>(`/settings/catalogs/acts/${id}`).then((payload) => payload.data),
  createCatalogAct: (data: Record<string, unknown>) => apiRequest<{ data: CatalogAct }>('/settings/catalogs/acts', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  ensureActConfiguration: (id: string) => apiRequest(`/settings/catalogs/acts/${id}/configuration`, { method: 'POST' }),
  updateCatalogAct: (id: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/acts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addCatalogActCharacter: (id: string, data: { name: string; principal: boolean }) => apiRequest(`/settings/catalogs/acts/${id}/characters`, { method: 'POST', body: JSON.stringify(data) }),
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
  catalogArtifactRoot: () => apiRequest<{ data: { organization: CatalogOwner | null; institutions: CatalogOwner[] } }>('/settings/catalogs/artifacts/root').then((payload) => payload.data),
  functionalDestinations: () => apiRequest<{ data: FunctionalDestinationOption[] }>('/settings/catalogs/artifacts/functional-destinations').then((payload) => payload.data),
  projectTemplateAssignments: () => apiRequest<{ data: ProjectTemplateAssignment[] }>('/settings/catalogs/artifacts/project-template-assignments').then((payload) => payload.data),
  removeProjectTemplateAssignment: (actId: string) => apiRequest(`/settings/catalogs/artifacts/project-template-assignments/${encodeURIComponent(actId)}`, { method: 'DELETE' }),
  assignFunctionalDestinations: (id: string, destinos: ArtifactDestination[]) => apiRequest(`/settings/catalogs/artifacts/${id}/functional-destinations`, { method: 'PUT', body: JSON.stringify({ destinos }) }),
  catalogSupporting: () => apiRequest<{ data: SupportingCatalogs }>('/settings/catalogs/supporting').then((payload) => payload.data),
  createCatalogInstitution: (data: Record<string, unknown>) => apiRequest<{ data: CatalogOwner }>('/settings/catalogs/institutions', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  catalogExplorer: (ownerType: string, ownerId: string, type: string, folderId?: string | null) => apiRequest<{ data: ExplorerPayload }>(`/settings/catalogs/explorer?owner_type=${ownerType}&owner_id=${encodeURIComponent(ownerId)}&type=${encodeURIComponent(type)}${folderId ? `&folder_id=${encodeURIComponent(folderId)}` : ''}`).then((payload) => payload.data),
  createCatalogFolder: (data: Record<string, unknown>) => apiRequest<{ data: CatalogFolder }>('/settings/catalogs/folders', { method: 'POST', body: JSON.stringify(data) }).then((payload) => payload.data),
  updateCatalogFolder: (id: string, data: Record<string, unknown>) => apiRequest<{ data: CatalogFolder }>(`/settings/catalogs/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }).then((payload) => payload.data),
  createCatalogArtifact: (metadata: Record<string, unknown>, file: File) => { const body = new FormData(); body.append('metadata', JSON.stringify(metadata)); body.append('file', file); return apiRequest<{ data: CatalogArtifact }>('/settings/catalogs/artifacts', { method: 'POST', body }).then((payload) => payload.data); },
  updateCatalogArtifact: (id: string, data: Record<string, unknown>) => apiRequest(`/settings/catalogs/artifacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addCatalogArtifactVersion: (id: string, file: File, version?: number) => { const body = new FormData(); body.append('metadata', JSON.stringify({ version })); body.append('file', file); return apiRequest(`/settings/catalogs/artifacts/${id}/versions`, { method: 'POST', body }); },
  catalogArtifactVersionUrl: (id: string) => apiRequest<{ data: { url: string } }>(`/settings/catalogs/artifact-versions/${id}/url`).then((payload) => payload.data),
  bootstrapCatalogLibraryV4: () => apiRequest('/settings/catalogs/artifacts/library/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'PRAVIA_CFG002_STANDARD:v2-LEGAL' } }),
  previewCatalogImport: (files: File[]) => { const body = new FormData(); files.forEach((file) => body.append('files', file)); return apiRequest<{ data: CatalogImportPreview }>('/settings/catalogs/artifacts/import/preview', { method: 'POST', body }).then((payload) => payload.data); },
  confirmCatalogImport: (metadata: Record<string, unknown>, files: File[]) => { const body = new FormData(); body.append('metadata', JSON.stringify(metadata)); files.forEach((file) => body.append('files', file)); return apiRequest('/settings/catalogs/artifacts/import/confirm', { method: 'POST', headers: { 'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `cfg002-${Date.now()}` }, body }); },
  questionnaireBanks: () => apiRequest<{ data: QuestionnaireBanksPayload }>('/settings/catalogs/questionnaire-banks').then((payload) => payload.data),
  addQuestionnaireBankQuestion: (bank: string, input: Partial<QuestionnaireQuestion>) => apiRequest(`/settings/catalogs/questionnaire-banks/${encodeURIComponent(bank)}/questions`, { method: 'POST', body: JSON.stringify(input) }),
  updateQuestionnaireBankQuestion: (bank: string, id: string, input: Partial<QuestionnaireQuestion>) => apiRequest(`/settings/catalogs/questionnaire-banks/${encodeURIComponent(bank)}/questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeQuestionnaireBankQuestion: (bank: string, id: string) => apiRequest(`/settings/catalogs/questionnaire-banks/${encodeURIComponent(bank)}/questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorderQuestionnaireBank: (bank: string, questionIds: string[]) => apiRequest(`/settings/catalogs/questionnaire-banks/${encodeURIComponent(bank)}/order`, { method: 'PUT', body: JSON.stringify({ question_ids: questionIds }) }),
  knowledgeSources: (params: { search?: string; jurisdiction?: string; category?: string; page?: number; page_size?: number }) => apiRequest<any>(`/settings/knowledge/sources?${qs(params)}`),
  knowledgeCriteria: () => apiRequest<any>('/settings/knowledge/criteria'),
  retrieveKnowledge: (input: { query: string; jurisdiction?: string; category?: string; legal_date?: string }) => apiRequest<any>('/settings/knowledge/retrieve', { method: 'POST', body: JSON.stringify(input) }),
};
