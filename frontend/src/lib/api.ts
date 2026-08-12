import axios from 'axios';

import type { InternalAxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5000');
const API_BASE = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;
export const API_ORIGIN = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE;

const isPublicVerificationPath = (pathname: string) => (
  pathname === '/apply'
  || pathname.startsWith('/apply/')
  || pathname === '/contracts/confirm'
  || pathname.startsWith('/contracts/confirm/')
);

export const resolveBackendAssetUrl = (url?: string | null) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  return url.startsWith('/') ? url : `/${url}`;
};

// Create axios instance
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

type RetryAwareConfig = InternalAxiosRequestConfig & { supportMutationFingerprint?: string };
const retryKeys = new Map<string, { key: string; expiresAt: number }>();
const retryStorageKey = 'sabalan.mutation-retry-keys.v1';
const loadRetryKeys = () => {
  if (typeof window === 'undefined') return;
  try {
    const stored = JSON.parse(window.localStorage.getItem(retryStorageKey) || '{}') as Record<
      string,
      { key: string; expiresAt: number }
    >;
    for (const [fingerprint, value] of Object.entries(stored)) {
      if (value.expiresAt > Date.now()) retryKeys.set(fingerprint, value);
    }
  } catch {
    try {
      window.localStorage.removeItem(retryStorageKey);
    } catch {
      // Storage can be disabled; the in-memory retry guard remains available.
    }
  }
};
const persistRetryKeys = () => {
  if (typeof window === 'undefined') return;
  const active: Record<string, { key: string; expiresAt: number }> = {};
  retryKeys.forEach((value, fingerprint) => {
    if (value.expiresAt > Date.now()) active[fingerprint] = value;
    else retryKeys.delete(fingerprint);
  });
  try {
    window.localStorage.setItem(retryStorageKey, JSON.stringify(active));
  } catch {
    // Quota/security failures must not block the underlying business mutation.
  }
};
const mutationFingerprint = async (config: InternalAxiosRequestConfig) => {
  const method = String(config.method || 'get').toUpperCase();
  const url = `${config.baseURL || ''}${config.url || ''}`;
  let body = '';
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const parts: string[] = [];
    config.data.forEach((value, key) => {
      parts.push(`${key}:${typeof value === 'string' ? value : `${value.name}:${value.size}:${value.type}`}`);
    });
    body = parts.join('|');
  } else if (typeof config.data === 'string') {
    body = config.data;
  } else if (config.data != null) {
    body = JSON.stringify(config.data);
  }
  const input = `${method}:${url}:${JSON.stringify(config.params || {})}:${body}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return `${input.length}:${hash >>> 0}`;
};
const clearRetryKey = (config?: RetryAwareConfig) => {
  if (config?.supportMutationFingerprint) {
    retryKeys.delete(config.supportMutationFingerprint);
    persistRetryKeys();
  }
};

api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (isMutation && !config.headers.has('x-correlation-id')) {
    config.headers['x-correlation-id'] = crypto.randomUUID();
  }
  if (isMutation && !config.headers['x-idempotency-key']) {
    loadRetryKeys();
    const fingerprint = await mutationFingerprint(config);
    const cached = retryKeys.get(fingerprint);
    const key = cached && cached.expiresAt > Date.now() ? cached.key : crypto.randomUUID();
    retryKeys.set(fingerprint, { key, expiresAt: Date.now() + 24 * 60 * 60 * 1_000 });
    persistRetryKeys();
    config.headers['x-idempotency-key'] = key;
    (config as RetryAwareConfig).supportMutationFingerprint = fingerprint;
  }
  return config;
});

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => {
    clearRetryKey(response.config as RetryAwareConfig);
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      if (
        typeof window !== 'undefined'
        && !window.location.pathname.startsWith('/login')
        && !isPublicVerificationPath(window.location.pathname)
      ) window.location.href = '/login';
    }
    const status = Number(error.response?.status || 0);
    if (status > 0 && status !== 409 && status < 500) {
      clearRetryKey(error.config as RetryAwareConfig | undefined);
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (identifier: string, password: string) =>
    api.post('/auth/login', { identifier, email: identifier, password }),

  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  getSessions: () => api.get('/auth/sessions'),
  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
  revokeOtherSessions: () => api.post('/auth/sessions/revoke-others'),
  changePassword: (data: { currentPassword: string; newPassword: string }) => api.post('/auth/change-password', data),
  getSecurityNotifications: () => api.get('/auth/security-notifications'),
  markSecurityNotificationRead: (id: string) => api.put(`/auth/security-notifications/${id}/read`),
};

export const notificationsAPI = {
  list: (params?: { cursor?: string; limit?: number; state?: 'ALL' | 'UNREAD' | 'READ' | 'IMPORTANT'; search?: string; workspace?: string; category?: string }) =>
    api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  getMetadata: () => api.get('/notifications/metadata'),
  markRead: (id: string) => api.put(`/notifications/${id}/read`),
  markUnread: (id: string) => api.delete(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  resolveSecurityAlert: (id: string, decision: 'MINE' | 'NOT_MINE') =>
    api.post(`/notifications/${id}/security-resolution`, { decision }),
  getPolicies: () => api.get('/notifications/admin/policies'),
  createPolicyVersion: (eventType: string, data: {
    enabled: boolean;
    titleTemplate: string;
    messageTemplate: string;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    channels: Array<'IN_APP' | 'REALTIME' | 'WEB_PUSH'>;
    recipientResolvers: string[];
    batching: 'IMMEDIATE' | 'DAILY';
    changeReason: string;
  }) => api.post(`/notifications/admin/policies/${eventType}/versions`, data),
  getPreferences: () => api.get('/notifications/settings/preferences'),
  updatePreferences: (data: { webPushEnabled: boolean; mutedCategories: string[]; lowPriorityDelivery: 'IMMEDIATE' | 'DAILY' }) =>
    api.put('/notifications/settings/preferences', data),
  registerDevice: (data: { endpoint: string; keys: { p256dh: string; auth: string }; deviceLabel?: string }) =>
    api.post('/notifications/settings/devices', data),
  disableDevice: (deviceId: string) => api.delete(`/notifications/settings/devices/${deviceId}`),
  disableAllDevices: () => api.delete('/notifications/settings/devices'),
};

export const supportTicketsAPI = {
  getContext: () => api.get('/support-tickets/context'),
  list: (params?: Record<string, string | number | undefined>) => api.get('/support-tickets', { params }),
  get: (id: string) => api.get(`/support-tickets/${id}`),
  create: (data: {
    title: string;
    type: string;
    impact: string;
    workaroundExists: boolean;
    reportedWorkspace?: string | null;
    reportedFeature?: string | null;
    originRoute: string;
    description?: string;
    steps?: string;
    expectedResult?: string;
    stagedAttachmentTokens?: string[];
    sensitiveEvidenceConsent: boolean;
    sensitiveEvidenceSnapshot?: Record<string, unknown> | null;
    diagnosticSnapshot: Record<string, unknown>;
  }, idempotencyKey: string) => api.post('/support-tickets', data, {
    headers: { 'x-idempotency-key': idempotencyKey },
  }),
  stageAttachment: (data: FormData) =>
    api.post('/support-tickets/attachments/stage', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  addEntry: (id: string, body: string) => api.post(`/support-tickets/${id}/entries`, { body }),
  assignParticipant: (id: string, data: { userId: string; role: 'HANDLER' | 'COLLABORATOR' | 'WATCHER'; reason: string }) =>
    api.post(`/support-tickets/${id}/participants`, data),
  setPriority: (id: string, priority: string, reason: string) =>
    api.put(`/support-tickets/${id}/priority`, { priority, reason }),
  setStatus: (id: string, status: string, reason: string) =>
    api.put(`/support-tickets/${id}/status`, { status, reason }),
  markDuplicate: (id: string, canonicalTicketId: string, reason: string) =>
    api.post(`/support-tickets/${id}/duplicate`, { canonicalTicketId, reason }),
  reopen: (id: string, reason: string) => api.post(`/support-tickets/${id}/reopen`, { reason }),
  uploadAttachment: (id: string, data: FormData) =>
    api.post(`/support-tickets/${id}/attachments`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateTranscript: (id: string, entryId: string, transcript: string) =>
    api.put(`/support-tickets/${id}/entries/${entryId}/transcript`, { transcript }),
  previewDiagnosticBundle: (id: string) => api.post(`/support-tickets/${id}/diagnostic-bundles/preview`),
  confirmDiagnosticBundle: (id: string, bundleId: string, data: { sensitiveAttachmentIds: string[]; reason: string }) =>
    api.post(`/support-tickets/${id}/diagnostic-bundles/${bundleId}/confirm`, data),
  diagnosticBundleDownloadUrl: (id: string, bundleId: string, format: 'markdown' | 'json') =>
    `${API_ORIGIN}/api/support-tickets/${id}/diagnostic-bundles/${bundleId}/download?format=${format}`,
  getSlaPolicies: () => api.get('/support-tickets/admin/sla-policies'),
  createSlaPolicy: (data: { calendar: Record<string, unknown>; targets: Record<string, unknown>; changeReason: string }) =>
    api.post('/support-tickets/admin/sla-policies', data),
  redactEntry: (id: string, entryId: string, reason: string) =>
    api.post(`/support-tickets/${id}/entries/${entryId}/redact`, { reason }),
  redactAttachment: (id: string, attachmentId: string, reason: string) =>
    api.post(`/support-tickets/${id}/attachments/${attachmentId}/redact`, { reason }),
  placeLegalHold: (id: string, reason: string) => api.post(`/support-tickets/${id}/legal-holds`, { reason }),
  releaseLegalHold: (id: string, holdId: string, reason: string) =>
    api.post(`/support-tickets/${id}/legal-holds/${holdId}/release`, { reason }),
};

export const systemRecoveryAPI = {
  getEnvironment: () => api.get('/system-recovery/environment'),
  getState: () => api.get('/system-recovery'),
  createBackup: (data: { packageType: 'COMPLETE' | 'SANITIZED_TEST'; adminPassword: string; passphrase: string }) =>
    api.post('/system-recovery/backups', data),
  downloadBackup: (id: string, adminPassword: string) =>
    api.post(`/system-recovery/${id}/download`, { adminPassword }, { responseType: 'blob' }),
  uploadBackup: (data: FormData) =>
    api.post('/system-recovery/uploads', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  approveRestore: (id: string, adminPassword: string) =>
    api.post(`/system-recovery/${id}/approve`, { adminPassword }),
  restore: (id: string, data: {
    adminPassword: string;
    passphrase: string;
    confirmationPhrase: string;
    breakGlassReason?: string;
  }) => api.post(`/system-recovery/${id}/restore`, data),
};

// Users API
export const usersAPI = {
  getUsers: (page = 1, limit = 10) =>
    api.get(`/users?page=${page}&limit=${limit}`),
  
  getUser: (id: string) => api.get(`/users/${id}`),
  
  createUser: (userData: {
    email: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: string;
    departmentId?: string;
    isActive?: boolean;
    personnelMode?: 'none' | 'existing';
    personnelId?: string;
    workspacePermissions?: Array<{
      workspace: string;
      permissionLevel: string;
      expiresAt?: string;
    }>;
    featurePermissions?: Array<{
      workspace: string;
      feature: string;
      permissionLevel: string;
      expiresAt?: string;
    }>;
  }) => api.post('/users', userData),
  
  updateUser: (id: string, userData: any) =>
    api.put(`/users/${id}`, userData),
  
  deleteUser: (id: string, confirmationUsername: string) =>
    api.delete(`/users/${id}`, { data: { confirmationUsername } }),
  getAuthentication: (id: string, params?: any) => api.get(`/users/${id}/authentication`, { params }),
  revokeUserSession: (id: string, sessionId: string, reason: string) => api.post(`/users/${id}/sessions/${sessionId}/revoke`, { reason }),
  revokeAllUserSessions: (id: string, reason: string) => api.post(`/users/${id}/sessions/revoke-all`, { reason }),
  resetPassword: (id: string, data: { temporaryPassword: string; adminPassword: string; requireChange?: boolean }) => api.post(`/users/${id}/reset-password`, data),
  getErasurePreview: (id: string) => api.get(`/users/${id}/erasure-preview`),
  eraseUser: (id: string, data: { reason: string; adminPassword: string }) => api.post(`/users/${id}/erase`, data),
  attributeCreator: (id: string, data: { creatorId: string; reason: string }) => api.post(`/users/${id}/creator-attribution`, data),
  previewBulk: (data: any) => api.post('/users/bulk/preview', data),
  executeBulk: (data: any) => api.post('/users/bulk/execute', data),
};

export const personnelAPI = {
  getPersonnel: (params?: { includeInactive?: boolean; search?: string; departmentId?: string }) =>
    api.get('/personnel', { params }),
  getPerson: (id: string) => api.get(`/personnel/${id}`),
};

export const hrAPI = {
  getDashboard: () => api.get('/hr/dashboard'),
  getFoundation: (params?: { dependencyAt?: string }) => api.get('/hr/foundation', { params }),
  getPositions: (params?: { filter?: string; dependencyAt?: string }) => api.get('/hr/positions', { params }),
  getPositionCapacitySummary: (params?: { dependencyAt?: string }) => api.get('/hr/positions/capacity-summary', { params }),
  getPositionHistory: (id: string) => api.get(`/hr/positions/${id}/history`),
  changePositionCapacity: (id: string, data: any) => api.post(`/hr/positions/${id}/capacity-changes`, data),
  getFoundationDependencies: (entityType: string, id: string) => api.get(`/hr/foundation/${entityType}/${id}/dependencies`),
  changeFoundationLifecycle: (entityType: string, id: string, data: any) => api.post(`/hr/foundation/${entityType}/${id}/lifecycle`, data),
  permanentlyDeleteFoundation: (entityType: string, id: string, data: any) => api.delete(`/hr/foundation/${entityType}/${id}/permanent`, { data }),
  createOrganizationalUnit: (data: any) => api.post('/hr/organizational-units', data),
  updateOrganizationalUnit: (id: string, data: any) => api.put(`/hr/organizational-units/${id}`, data),
  createWorkplace: (data: any) => api.post('/hr/workplaces', data),
  updateWorkplace: (id: string, data: any) => api.put(`/hr/workplaces/${id}`, data),
  createCostCenter: (data: any) => api.post('/hr/cost-centers', data),
  updateCostCenter: (id: string, data: any) => api.put(`/hr/cost-centers/${id}`, data),
  createJob: (data: any) => api.post('/hr/jobs', data),
  updateJob: (id: string, data: any) => api.put(`/hr/jobs/${id}`, data),
  createPosition: (data: any) => api.post('/hr/positions', data),
  updatePosition: (id: string, data: any) => api.put(`/hr/positions/${id}`, data),
  getPersonnel: (params?: any) => api.get('/hr/personnel', { params }),
  resolvePersonnelOrigin: (origin: string) => api.get('/hr/personnel-origin', { params: { origin } }),
  getPersonnelWorkSchedule: (id: string) => api.get(`/hr/personnel/${id}/work-schedule`),
  archivePersonnel: (id: string, data: { reason: string; effectiveDate: string }) => api.post(`/hr/personnel/${id}/archive`, data),
  restorePersonnel: (id: string, reason: string) => api.post(`/hr/personnel/${id}/restore`, { reason }),
  getPersonnelDeletionPreview: (id: string) => api.get(`/hr/personnel/${id}/deletion-preview`),
  permanentlyDeletePersonnel: (id: string, data: any) => api.post(`/hr/personnel/${id}/permanent-delete`, data),
  createExceptionalPersonnel: (data: any) => api.post('/hr/personnel/exceptional', data),
  updatePersonnel: (id: string, data: any) => api.put(`/hr/personnel/${id}`, data),
  updatePersonnelWorkSchedule: (id: string, data: any) => api.put(`/hr/personnel/${id}/work-schedule`, data),
  proposePersonnelWorkSchedule: (id: string, data: any) => api.post(`/hr/personnel/${id}/work-schedule/proposals`, data),
  preparePersonnelWorkSchedule: (personnelId: string, changeId: string, data: any) => api.put(`/hr/personnel/${personnelId}/work-schedule/changes/${changeId}/prepare`, data),
  submitPersonnelWorkSchedule: (personnelId: string, changeId: string) => api.post(`/hr/personnel/${personnelId}/work-schedule/changes/${changeId}/submit`),
  returnPersonnelWorkSchedule: (personnelId: string, changeId: string, reason: string) => api.post(`/hr/personnel/${personnelId}/work-schedule/changes/${changeId}/return`, { reason }),
  approvePersonnelWorkSchedule: (personnelId: string, changeId: string) => api.post(`/hr/personnel/${personnelId}/work-schedule/changes/${changeId}/approve`),
  createRelationship: (personnelId: string, data: any) => api.post(`/hr/personnel/${personnelId}/relationships`, data),
  updateRelationshipStatus: (id: string, data: any) => api.put(`/hr/relationships/${id}/status`, data),
  createAssignment: (relationshipId: string, data: any) => api.post(`/hr/relationships/${relationshipId}/assignments`, data),
  transferPrimaryAssignment: (relationshipId: string, data: any) => api.post(`/hr/relationships/${relationshipId}/transfer-primary`, data),
  endAssignment: (id: string, effectiveTo: string) => api.put(`/hr/assignments/${id}/end`, { effectiveTo }),
  getSupervisorCandidates: (params: any) => api.get('/hr/supervisor-candidates', { params }),
  getMigrationPreview: () => api.get('/hr/migration/preview'),
  getMigrationRecords: (category: string) => api.get(`/hr/migration/records/${encodeURIComponent(category)}`),
  applyMigration: (data: any) => api.post('/hr/migration/apply', data),
  getMigrationReconciliation: (params?: Record<string, string | boolean | undefined>) => api.get('/hr/migration/reconciliation', { params }),
  reviewMigrationReconciliation: (id: string, data: { outcome: string; reason: string }) => api.post(`/hr/migration/reconciliation/${encodeURIComponent(id)}/reviews`, data),
  previewHrRedesignBackfill: () => api.get('/hr/migration/redesign-preview'),
  applyHrRedesignBackfill: () => api.post('/hr/migration/redesign-backfill'),
};

export const dispatchMasterDataAPI = {
  getInternalDrivers: (params?: { at?: string }) => api.get('/dispatch-master-data/internal-drivers', { params }),
  getPersonnelDriverEligibility: (personnelId: string, params?: { at?: string }) => api.get(`/dispatch-master-data/internal-drivers/personnel/${personnelId}`, { params }),
  createInternalDriver: (data: any) => api.post('/dispatch-master-data/internal-drivers', data),
  transitionInternalDriverEligibility: (id: string, data: any) => api.post(`/dispatch-master-data/internal-drivers/${id}/eligibility`, data),
  getVehicleOperationsDrivers: (params?: { at?: string }) => api.get('/dispatch-master-data/vehicle-operations/internal-drivers', { params }),
  updateInternalDrivingProfile: (id: string, data: any) => api.put(`/dispatch-master-data/internal-drivers/${id}/profile`, data),
  transitionInternalDrivingProfile: (id: string, data: any) => api.post(`/dispatch-master-data/internal-drivers/${id}/profile-status`, data),
  getCompanyVehicles: (params?: { archived?: 'exclude' | 'include' | 'only' }) => api.get('/dispatch-master-data/company-vehicles', { params }),
  createCompanyVehicle: (data: any) => api.post('/dispatch-master-data/company-vehicles', data),
  changeCompanyVehiclePlate: (id: string, data: any) => api.post(`/dispatch-master-data/company-vehicles/${id}/plates`, data),
  transitionCompanyVehicleStatus: (id: string, data: any) => api.post(`/dispatch-master-data/company-vehicles/${id}/status`, data),
  deleteCompanyVehicleDraft: (id: string, reason: string) => api.delete(`/dispatch-master-data/company-vehicles/${id}`, { data: { reason } }),
  assignCompanyVehicle: (data: any) => api.post('/dispatch-master-data/driver-vehicle-assignments', data),
  getExternalRegistry: (params?: { archived?: 'exclude' | 'include' | 'only' }) => api.get('/dispatch-master-data/external-registry', { params }),
  createExternalDriver: (data: any) => api.post('/dispatch-master-data/external-drivers', data),
  createExternalVehicle: (data: any) => api.post('/dispatch-master-data/external-vehicles', data),
  recordExternalDriverDocument: (id: string, data: any) => api.post(`/dispatch-master-data/external-drivers/${id}/documents`, data),
  recordExternalVehicleDocument: (id: string, data: any) => api.post(`/dispatch-master-data/external-vehicles/${id}/documents`, data),
  changeExternalVehiclePlate: (id: string, data: any) => api.post(`/dispatch-master-data/external-vehicles/${id}/plates`, data),
  transitionExternalDriverStatus: (id: string, data: any) => api.post(`/dispatch-master-data/external-drivers/${id}/status`, data),
  transitionExternalVehicleStatus: (id: string, data: any) => api.post(`/dispatch-master-data/external-vehicles/${id}/status`, data),
  deleteExternalDriverDraft: (id: string, reason: string) => api.delete(`/dispatch-master-data/external-drivers/${id}`, { data: { reason } }),
  deleteExternalVehicleDraft: (id: string, reason: string) => api.delete(`/dispatch-master-data/external-vehicles/${id}`, { data: { reason } }),
};

// Posts API
export const postsAPI = {
  getPosts: (page = 1, limit = 10, published?: boolean) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (published !== undefined) {
      params.append('published', published.toString());
    }
    return api.get(`/posts?${params.toString()}`);
  },
  
  getPost: (id: string) => api.get(`/posts/${id}`),
  
  createPost: (postData: { title: string; content: string; published?: boolean }) =>
    api.post('/posts', postData),
  
  updatePost: (id: string, postData: any) =>
    api.put(`/posts/${id}`, postData),
  
  deletePost: (id: string) => api.delete(`/posts/${id}`),
};

// Orders API
export const ordersAPI = {
  getOrders: (page = 1, limit = 10, status?: string) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (status) {
      params.append('status', status);
    }
    return api.get(`/orders?${params.toString()}`);
  },
  
  getOrder: (id: string) => api.get(`/orders/${id}`),
  
  createOrder: (orderData: { total: number }) =>
    api.post('/orders', orderData),
  
  updateOrderStatus: (id: string, status: string) =>
    api.put(`/orders/${id}/status`, { status }),
  
  deleteOrder: (id: string) => api.delete(`/orders/${id}`),
};

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  getProfile: () => api.get('/dashboard/profile'),
};

// Workspace Permissions API
export const workspacePermissionsAPI = {
  getUserWorkspaces: () => api.get('/workspace-permissions/user-workspaces'),
  getUserPermissions: (params?: { page?: number; limit?: number; userId?: string; workspace?: string }) =>
    api.get('/workspace-permissions', { params }),
  getRolePermissions: (params?: { role?: string; workspace?: string }) =>
    api.get('/workspace-permissions/role-permissions', { params }),
  createUserPermission: (data: any) => api.post('/workspace-permissions', data),
  updateUserPermission: (id: string, data: any) => api.put(`/workspace-permissions/${id}`, data),
  deleteUserPermission: (id: string) => api.delete(`/workspace-permissions/${id}`),
  createRolePermission: (data: any) => api.post('/workspace-permissions/role-permissions', data),
  updateRolePermission: (id: string, data: any) => api.put(`/workspace-permissions/role-permissions/${id}`, data),
  deleteRolePermission: (id: string) => api.delete(`/workspace-permissions/role-permissions/${id}`),
};

// Departments API
export const departmentsAPI = {
  getDepartments: () => api.get('/departments'),
  getDepartment: (id: string) => api.get(`/departments/${id}`),
  createDepartment: (data: any) => api.post('/departments', data),
  updateDepartment: (id: string, data: any) => api.put(`/departments/${id}`, data),
  deleteDepartment: (id: string) => api.delete(`/departments/${id}`),
};

// Sales Workspace API
export const salesAPI = {
  // Contracts
  getContracts: (params?: { page?: number; limit?: number; status?: string; departmentId?: string; search?: string; lifecycleView?: 'active' | 'inactive' }) =>
    api.get('/sales/contracts', { params }),
  
  getContract: (id: string) => api.get(`/sales/contracts/${id}`),

  getContractProductGraph: (id: string) =>
    api.get(`/sales/contracts/${id}/product-graph`),

  executeContractProductGraphCommand: (
    id: string,
    command: unknown,
    editSession: {
      draftId: string;
      browserSessionId: string;
      leaseToken: string;
      baseRevision: number;
    }
  ) => api.post(`/sales/contracts/${id}/product-graph/commands`, command, {
    headers: {
      'x-contract-draft-id': editSession.draftId,
      'x-contract-browser-session-id': editSession.browserSessionId,
      'x-contract-lease-token': editSession.leaseToken,
      'x-contract-base-revision': String(editSession.baseRevision)
    }
  }),

  migrateLegacyContractProductGraph: (
    id: string,
    editSession: {
      draftId: string;
      browserSessionId: string;
      leaseToken: string;
      baseRevision: number;
    }
  ) => api.post(`/sales/contracts/${id}/product-graph/migrate`, {}, {
    headers: {
      'x-contract-draft-id': editSession.draftId,
      'x-contract-browser-session-id': editSession.browserSessionId,
      'x-contract-lease-token': editSession.leaseToken,
      'x-contract-base-revision': String(editSession.baseRevision)
    }
  }),
  
  createContract: (contractData: any, editSession?: {
    draftId: string;
    browserSessionId: string;
    leaseToken: string;
    baseRevision: number;
  }) => api.post('/sales/contracts', contractData, editSession ? {
    headers: {
      'x-contract-draft-id': editSession.draftId,
      'x-contract-browser-session-id': editSession.browserSessionId,
      'x-contract-lease-token': editSession.leaseToken,
      'x-contract-base-revision': String(editSession.baseRevision)
    }
  } : undefined),
  getSellerProductHistory: () => api.get('/sales/contracts/product-history'),
  acquireContractEditSession: (draftId: string, data: {
    contractId?: string | null;
    browserSessionId: string;
    schemaVersion: number;
    baseRevision: number;
    takeover?: boolean;
  }) => api.post(`/sales/contract-edit-sessions/${encodeURIComponent(draftId)}/acquire`, data),
  checkpointContractRecovery: (draftId: string, data: {
    browserSessionId: string;
    leaseToken: string;
    schemaVersion: number;
    baseRevision: number;
    recovery: unknown;
  }) => api.put(`/sales/contract-edit-sessions/${encodeURIComponent(draftId)}/recovery`, data),
  releaseContractEditSession: (draftId: string, data: {
    browserSessionId: string;
    leaseToken: string;
    baseRevision: number;
  }) => api.delete(`/sales/contract-edit-sessions/${encodeURIComponent(draftId)}`, { data }),

  updateContract: (id: string, contractData: any, editSession?: {
    draftId: string;
    browserSessionId: string;
    leaseToken: string;
    baseRevision: number;
  }) => api.put(`/sales/contracts/${id}`, contractData, editSession ? {
    headers: {
      'x-contract-draft-id': editSession.draftId,
      'x-contract-browser-session-id': editSession.browserSessionId,
      'x-contract-lease-token': editSession.leaseToken,
      'x-contract-base-revision': String(editSession.baseRevision)
    }
  } : undefined),
  
  approveContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/approve`, { note }),
  
  rejectContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/reject`, { note }),
  
  signContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/sign`, { note }),
  
  printContract: (id: string, note?: string) => api.put(`/sales/contracts/${id}/print`, { note }),

  reassignResponsibleSeller: (id: string, sellerId: string, reason: string) =>
    api.put(`/sales/contracts/${id}/responsible-seller`, { sellerId, reason }),

  assignLegacyRealizedCredit: (id: string, sellerId: string, reason: string) =>
    api.put(`/sales/contracts/${id}/legacy-realized-credit`, { sellerId, reason }),

  getContractPdf: (contractId: string, params?: { fresh?: boolean; variant?: 'original' | 'summary' }) =>
    api.get(`/sales/contracts/${contractId}/pdf`, { params }),

  downloadContractPdf: (contractId: string, params?: { fresh?: boolean; variant?: 'original' | 'summary' }) =>
    api.get(`/sales/contracts/${contractId}/pdf`, {
      params: { ...params, download: true },
      responseType: 'blob'
    }),
  
  deleteContract: (id: string) => api.delete(`/sales/contracts/${id}`),
  
  // Dashboard
  getSalesStats: () => api.get('/sales/dashboard/stats'),
  
  // Deliveries
  getDeliveries: (contractId: string) => api.get(`/sales/contracts/${contractId}/deliveries`),
  
  createDelivery: (contractId: string, deliveryData: any) => api.post(`/sales/contracts/${contractId}/deliveries`, deliveryData),
  
  // Payments
  getPayments: (contractId: string) => api.get(`/sales/contracts/${contractId}/payments`),
  
  createPayment: (contractId: string, paymentData: any) => api.post(`/sales/contracts/${contractId}/payments`, paymentData),
  
  // Digital confirmation
  sendForConfirmation: (contractId: string) =>
    api.post(`/sales/contracts/${contractId}/send-for-confirmation`),

  resendConfirmation: (contractId: string) =>
    api.post(`/sales/contracts/${contractId}/resend-confirmation`),

  getConfirmationStatus: (contractId: string) =>
    api.get(`/sales/contracts/${contractId}/confirmation-status`),

  cancelContract: (contractId: string) =>
    api.post(`/sales/contracts/${contractId}/cancel`),
  
  // Contract Items
  createContractItem: (contractId: string, itemData: any) => api.post(`/sales/contracts/${contractId}/items`, itemData),
  
  // Products
  getProducts: (params?: any) => api.get('/products', { params }),
  
  getProduct: (id: string) => api.get(`/products/${id}`),
  
  createProduct: (productData: any) => api.post('/products', productData),
  
  updateProduct: (id: string, productData: any) => api.put(`/products/${id}`, productData),
  
  deleteProduct: (id: string) => api.delete(`/products/${id}`),
  
  // Excel Import/Export
  downloadProductTemplate: () => api.get('/products/template', { responseType: 'blob' }),
  previewProductImport: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/products/import/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  applyProductImport: (importId: string) => api.post('/products/import/apply', { importId }),
  importProducts: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/products/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  exportProducts: (params?: any) => api.get('/products/export', { 
    params, 
    responseType: 'blob' 
  }),

  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/uploads/images', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  
  // Departments
  getDepartments: () => api.get('/departments'),
  
  // Contract Number Generation
  getNextContractNumber: () => api.get('/sales/contracts/next-number'),

  // Contract discount ranges
  getDiscountRanges: (params?: { activeOnly?: boolean }) => api.get('/sales/discount-ranges', { params }),
  createDiscountRange: (data: any) => api.post('/sales/discount-ranges', data),
  updateDiscountRange: (id: string, data: any) => api.put(`/sales/discount-ranges/${id}`, data),
  deleteDiscountRange: (id: string) => api.delete(`/sales/discount-ranges/${id}`),
};

// CRM Workspace API
export const crmAPI = {
  // Customers
  getCustomers: (params?: { page?: number; limit?: number; search?: string; status?: string; customerType?: string }) =>
    api.get('/crm/customers', { params }),

  getCustomerOwners: () => api.get('/crm/customer-owners'),
  getSellers: () => api.get('/crm/sellers'),
  
  getCustomer: (id: string) => api.get(`/crm/customers/${id}`),

  checkDuplicateCustomer: (payload: { nationalCode?: string | null; phoneNumbers?: Array<{ number?: string | null }> }) =>
    api.post('/crm/customers/duplicate-check', payload),
  
  createCustomer: (customerData: any) => api.post('/crm/customers', customerData),
  
  updateCustomer: (id: string, customerData: any) => api.put(`/crm/customers/${id}`, customerData),

  assignCustomerOwner: (id: string, ownerUserId: string | null) =>
    api.put(`/crm/customers/${id}/owner`, { ownerUserId }),
  
  deleteCustomer: (id: string) => api.delete(`/crm/customers/${id}`),
  
  // Project Addresses
  addProjectAddress: (customerId: string, addressData: any) => 
    api.post(`/crm/customers/${customerId}/project-addresses`, addressData),
  updateProjectAddress: (customerId: string, addressId: string, addressData: any) => 
    api.put(`/crm/customers/${customerId}/project-addresses/${addressId}`, addressData),
  deleteProjectAddress: (customerId: string, addressId: string) => 
    api.delete(`/crm/customers/${customerId}/project-addresses/${addressId}`),
  
  // Phone Numbers
  addPhoneNumber: (customerId: string, phoneData: any) => 
    api.post(`/crm/customers/${customerId}/phone-numbers`, phoneData),
  updatePhoneNumber: (customerId: string, phoneId: string, phoneData: any) => 
    api.put(`/crm/customers/${customerId}/phone-numbers/${phoneId}`, phoneData),
  deletePhoneNumber: (customerId: string, phoneId: string) => 
    api.delete(`/crm/customers/${customerId}/phone-numbers/${phoneId}`),
  
  // Blacklist/Lock Management
  toggleBlacklist: (id: string) => api.put(`/crm/customers/${id}/blacklist`),
  toggleLock: (id: string) => api.put(`/crm/customers/${id}/lock`),
  
  // Contacts
  getContacts: (params?: { page?: number; limit?: number; customerId?: string }) =>
    api.get('/crm/contacts', { params }),
  
  getContact: (id: string) => api.get(`/crm/contacts/${id}`),
  
  createContact: (customerIdOrData: string | any, contactData?: any) => {
    if (typeof customerIdOrData === 'string') {
      return api.post(`/crm/customers/${customerIdOrData}/contacts`, contactData);
    }
    return api.post(`/crm/customers/${customerIdOrData.customerId}/contacts`, customerIdOrData);
  },
  
  updateContact: (customerIdOrId: string, contactIdOrData: string | any, contactData?: any) => {
    if (typeof contactIdOrData === 'string') {
      return api.put(`/crm/customers/${customerIdOrId}/contacts/${contactIdOrData}`, contactData);
    }
    return api.put(`/crm/contacts/${customerIdOrId}`, contactIdOrData);
  },
  
  deleteContact: (customerIdOrId: string, contactId?: string) => {
    if (contactId) {
      return api.delete(`/crm/customers/${customerIdOrId}/contacts/${contactId}`);
    }
    return api.delete(`/crm/contacts/${customerIdOrId}`);
  },
  
  // Leads
  getLeads: (params?: { page?: number; limit?: number; status?: string; assignedTo?: string }) =>
    api.get('/crm/leads', { params }),
  
  getLead: (id: string) => api.get(`/crm/leads/${id}`),
  
  createLead: (leadData: any) => api.post('/crm/leads', leadData),
  
  updateLead: (id: string, leadData: any) => api.put(`/crm/leads/${id}`, leadData),
  
  deleteLead: (id: string) => api.delete(`/crm/leads/${id}`),
  
  // Communications
  getCommunications: (params?: { page?: number; limit?: number; customerId?: string; contactId?: string }) =>
    api.get('/crm/communications', { params }),
  
  getCommunication: (id: string) => api.get(`/crm/communications/${id}`),
  
  createCommunication: (communicationData: any) => api.post('/crm/communications', communicationData),
  
  updateCommunication: (id: string, communicationData: any) => api.put(`/crm/communications/${id}`, communicationData),
  
  deleteCommunication: (id: string) => api.delete(`/crm/communications/${id}`),
  
  // Dashboard
  getCrmStats: () => api.get('/crm/dashboard'),

  // Potential Projects
  getPotentialProjects: (params?: any) => api.get('/crm/potential-projects', { params }),
  getPotentialProject: (id: string) => api.get(`/crm/potential-projects/${id}`),
  createPotentialProject: (data: any) => api.post('/crm/potential-projects', data),
  updatePotentialProject: (id: string, data: any) => api.put(`/crm/potential-projects/${id}`, data),
  reassignPotentialProject: (id: string, data: { responsibleSellerId: string; reason: string }) =>
    api.put(`/crm/potential-projects/${id}/reassign`, data),

  // Follow-up reports and next actions
  getFollowUps: (params?: any) => api.get('/crm/follow-ups', { params }),
  createFollowUp: (data: any) => api.post('/crm/follow-ups', data),
  getNextActions: (params?: any) => api.get('/crm/next-actions', { params }),
  completeNextAction: (id: string) => api.put(`/crm/next-actions/${id}/complete`),
};

export const shipmentQuantityAPI = {
  getContract: (contractId: string, params?: { cutoff?: string; mode?: 'operational' | 'audit-known-at' }) =>
    api.get(`/shipment-quantities/contracts/${contractId}`, { params }),
  getCustomer: (customerId: string, params?: { cutoff?: string; mode?: 'operational' | 'audit-known-at' }) =>
    api.get(`/shipment-quantities/customers/${customerId}`, { params }),
};

export const dispatchCasesAPI = {
  list: (workspace: string, filters: { subjectId?: string; loadingId?: string } = {}) => api.get('/dispatch-cases', { params: { workspace, ...filters } }),
  detail: (workspace: string, id: string, filters: { subjectId?: string; loadingId?: string } = {}) => api.get(`/dispatch-cases/${id}`, { params: { workspace, ...filters } }),
};

// Inventory Workspace API
export const inventoryAPI = {
  // Cut Types
  getCutTypes: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/cut-types', { params }),
  
  getCutType: (id: string) => api.get(`/inventory/cut-types/${id}`),
  
  createCutType: (cutTypeData: any) => api.post('/inventory/cut-types', cutTypeData),
  
  updateCutType: (id: string, cutTypeData: any) => api.put(`/inventory/cut-types/${id}`, cutTypeData),
  
  deleteCutType: (id: string) => api.delete(`/inventory/cut-types/${id}`),
  
  // Stone Materials
  getStoneMaterials: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/stone-materials', { params }),
  
  getStoneMaterial: (id: string) => api.get(`/inventory/stone-materials/${id}`),
  
  createStoneMaterial: (stoneMaterialData: any) => api.post('/inventory/stone-materials', stoneMaterialData),
  
  updateStoneMaterial: (id: string, stoneMaterialData: any) => api.put(`/inventory/stone-materials/${id}`, stoneMaterialData),
  
  deleteStoneMaterial: (id: string) => api.delete(`/inventory/stone-materials/${id}`),
  
  // Cut Widths
  getCutWidths: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/cut-widths', { params }),
  
  getCutWidth: (id: string) => api.get(`/inventory/cut-widths/${id}`),
  
  createCutWidth: (cutWidthData: any) => api.post('/inventory/cut-widths', cutWidthData),
  
  updateCutWidth: (id: string, cutWidthData: any) => api.put(`/inventory/cut-widths/${id}`, cutWidthData),
  
  deleteCutWidth: (id: string) => api.delete(`/inventory/cut-widths/${id}`),
  
  // Thicknesses
  getThicknesses: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/thicknesses', { params }),
  
  getThickness: (id: string) => api.get(`/inventory/thicknesses/${id}`),
  
  createThickness: (thicknessData: any) => api.post('/inventory/thicknesses', thicknessData),
  
  updateThickness: (id: string, thicknessData: any) => api.put(`/inventory/thicknesses/${id}`, thicknessData),
  
  deleteThickness: (id: string) => api.delete(`/inventory/thicknesses/${id}`),
  
  // Mines
  getMines: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/mines', { params }),
  
  getMine: (id: string) => api.get(`/inventory/mines/${id}`),
  
  createMine: (mineData: any) => api.post('/inventory/mines', mineData),
  
  updateMine: (id: string, mineData: any) => api.put(`/inventory/mines/${id}`, mineData),
  
  deleteMine: (id: string) => api.delete(`/inventory/mines/${id}`),
  
  // Finish Types
  getFinishTypes: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/finish-types', { params }),
  
  getFinishType: (id: string) => api.get(`/inventory/finish-types/${id}`),
  
  createFinishType: (finishTypeData: any) => api.post('/inventory/finish-types', finishTypeData),
  
  updateFinishType: (id: string, finishTypeData: any) => api.put(`/inventory/finish-types/${id}`, finishTypeData),
  
  deleteFinishType: (id: string) => api.delete(`/inventory/finish-types/${id}`),
  
  // Colors
  getColors: (params?: { page?: number; limit?: number; search?: string; isActive?: boolean }) =>
    api.get('/inventory/colors', { params }),
  
  getColor: (id: string) => api.get(`/inventory/colors/${id}`),
  
  createColor: (colorData: any) => api.post('/inventory/colors', colorData),
  
  updateColor: (id: string, colorData: any) => api.put(`/inventory/colors/${id}`, colorData),
  
  deleteColor: (id: string) => api.delete(`/inventory/colors/${id}`),
};

// Accounting Workspace API
export const accountingAPI = {
  getWorkspace: (params?: any) => api.get('/accounting/workspace', { params }),
  getFinancialTrend: (range: '1m' | '3m' | '6m' | '1y') => api.get('/accounting/financial-trend', { params: { range } }),
  getDispatchCandidates: () => api.get('/accounting/dispatch-candidates'),
  decideDispatchCandidate: (id: string, data: { action: 'ACCEPT' | 'REJECT'; reason: string; idempotencyKey: string }) =>
    api.post(`/accounting/dispatch-candidates/${id}/decision`, data),
  voidDispatchWaybill: (id: string, data: { reason: string; idempotencyKey: string }) =>
    api.post(`/accounting/dispatch-waybills/${id}/void`, data),
  replaceDispatchWaybill: (id: string, data: { reason: string; idempotencyKey: string }) =>
    api.post(`/accounting/dispatch-waybills/${id}/replace`, data),
  getContracts: (params?: any) => api.get('/accounting/contracts', { params }),
  getContract: (contractId: string) => api.get(`/accounting/contracts/${contractId}`),
  getContractLifecycle: (contractId: string) => api.get(`/accounting/contracts/${contractId}/lifecycle`),
  getContractLifecycleRequests: (params?: any) => api.get('/accounting/contract-lifecycle-requests', { params }),
  requestContractLifecycle: (contractId: string, data: { kind: 'DELETE' | 'DEACTIVATE' | 'REACTIVATE'; reason: string }) =>
    api.post(`/accounting/contracts/${contractId}/lifecycle-requests`, data),
  executeContractLifecycle: (contractId: string, data: { action: 'DELETE' | 'DEACTIVATE' | 'REACTIVATE'; reason: string }) =>
    api.post(`/accounting/contracts/${contractId}/lifecycle-actions`, data),
  decideContractLifecycleRequest: (requestId: string, data: { decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
    api.post(`/accounting/contract-lifecycle-requests/${requestId}/decision`, data),
  getContractPdf: (contractId: string) => api.get(`/accounting/contracts/${contractId}/pdf`),
  downloadContractPdf: (contractId: string) =>
    api.get(`/accounting/contracts/${contractId}/pdf`, {
      params: { download: true },
      responseType: 'blob'
    }),
  getSalesContractPdf: (contractId: string, params?: any) =>
    api.get(`/accounting/contracts/${contractId}/sales-pdf`, { params }),
  downloadSalesContractPdf: (contractId: string, params?: any) =>
    api.get(`/accounting/contracts/${contractId}/sales-pdf`, {
      params: { ...params, download: true },
      responseType: 'blob'
    }),
  getFinancialRecords: (params?: any) => api.get('/accounting/financial-records', { params }),
  getReceivables: (params?: any) => api.get('/accounting/receivables', { params }),
  getPayments: (params?: any) => api.get('/accounting/payments', { params }),
  getTaxRecords: (params?: any) => api.get('/accounting/tax', { params }),
  getCorrectionRequests: (params?: any) => api.get('/accounting/correction-requests', { params }),
  getAuditLogs: (params?: any) => api.get('/accounting/audit', { params }),
  getPerformanceReport: (params?: any) => api.get('/accounting/performance', { params }),
  getSettings: () => api.get('/accounting/settings'),
  updateSettings: (data: any) => api.put('/accounting/settings', data),
  executeAction: (data: any) => api.post('/accounting/actions', data),
  getBiometricConnectorDiagnostics: () => api.get('/biometric-connector/diagnostics'),
};

export const dispatchConfirmationAPI = {
  getCapabilities: () => api.get('/dispatch-confirmation/capabilities'),
  enrollInternalDriver: (personnelId: string, data: any) => api.post(`/dispatch-confirmation/internal-drivers/${personnelId}/enrollment`, data),
  withdrawEnrollment: (enrollmentId: string, reason: string) => api.post(`/dispatch-confirmation/enrollments/${enrollmentId}/withdraw`, { reason }),
  startSession: (waybillId: string, workstationId: string) => api.post(`/dispatch-confirmation/waybills/${waybillId}/sessions`, { workstationId }),
  verifyBiometric: (sessionId: string) => api.post(`/dispatch-confirmation/sessions/${sessionId}/biometric-attempts`, {}),
  beginFallback: (sessionId: string) => api.post(`/dispatch-confirmation/sessions/${sessionId}/fallback`, {}),
  resendOtp: (sessionId: string) => api.post(`/dispatch-confirmation/sessions/${sessionId}/otp/resend`, {}),
  verifyOtp: (sessionId: string, code: string) => api.post(`/dispatch-confirmation/sessions/${sessionId}/otp/verify`, { code }),
  approveByGuard: (sessionId: string, data: { password: string; reason?: string }) => api.post(`/dispatch-confirmation/sessions/${sessionId}/guard-approval`, data),
  revokeAuthorization: (authorizationId: string, reason: string) => api.post(`/dispatch-confirmation/authorizations/${authorizationId}/revoke`, { reason }),
  revokeAuthorizationAsGuard: (authorizationId: string, reason: string) => api.post(`/dispatch-confirmation/guard/authorizations/${authorizationId}/revoke`, { reason }),
};

export const hrHiringMetricsAPI = {
  getDashboardMetrics: () => api.get('/hr-hiring/dashboard-metrics'),
};

export const biAPI = {
  getSalesOverview: (params?: any) => api.get('/bi/sales/overview', { params }),
  getSalesAnalysis: (view: string, params?: any) => api.get(`/bi/sales/analysis/${view}`, { params }),
  exportSalesTable: (table: string, params?: any) =>
    api.get(`/bi/sales/export/${table}`, { params, responseType: 'blob' }),
  downloadSalesSummaryPdf: (params?: any) =>
    api.get('/bi/sales/summary.pdf', { params, responseType: 'blob' }),
};

export const salesReportsAPI = {
  getOverview: (params?: any) => api.get('/sales/reports/overview', { params }),
  getSellers: (params?: any) => api.get('/sales/reports/sellers', { params }),
  getPresets: () => api.get('/sales/reports/presets'),
  createPreset: (data: any) => api.post('/sales/reports/presets', data),
  deletePreset: (id: string) => api.delete(`/sales/reports/presets/${id}`),
  downloadPdf: (filters: any, configuration: any) =>
    api.post('/sales/reports/export.pdf', { filters, configuration }, { responseType: 'blob' }),
  downloadExcel: (filters: any, configuration: any) =>
    api.post('/sales/reports/export.xlsx', { filters, configuration }, { responseType: 'blob' })
};

export const logisticsAPI = {
  getDashboard: () => api.get('/logistics/dashboard'),
  getLoadableCustomers: (params?: any) => api.get('/logistics/customers', { params }),
  getCustomerProjects: (customerId: string) => api.get(`/logistics/customers/${customerId}/projects`),
  getProjects: (params?: any) => api.get('/logistics/projects', { params }),
  getRemaining: (projectId: string) => api.get(`/logistics/projects/${projectId}/remaining`),
  createOrResumeDraft: (projectId: string, data?: any) => api.post(`/logistics/projects/${projectId}/draft`, data || {}),
  getLoadings: (params?: any) => api.get('/logistics/loadings', { params }),
  createLoading: (data: any) => api.post('/logistics/loadings', data),
  getLoading: (id: string) => api.get(`/logistics/loadings/${id}`),
  updateLoading: (id: string, data: any) => api.put(`/logistics/loadings/${id}`, data),
  deleteLoading: (id: string) => api.delete(`/logistics/loadings/${id}`),
  finalizeLoading: (id: string) => api.post(`/logistics/loadings/${id}/finalize`),
  cancelLoading: (id: string, reason: string) => api.post(`/logistics/loadings/${id}/cancel`, { reason }),
  createCorrection: (id: string, data: any) => api.post(`/logistics/loadings/${id}/corrections`, data),
  getDrivers: (params?: any) => api.get('/logistics/drivers', { params }),
};

// Contract Templates API
export const contractTemplatesAPI = {
  getAll: (params?: { page?: number; limit?: number; category?: string; isActive?: boolean }) =>
    api.get('/contract-templates', { params }),
  
  getById: (id: string) => api.get(`/contract-templates/${id}`),
  
  create: (templateData: {
    name: string;
    namePersian: string;
    description?: string;
    content: string;
    variables?: any;
    structure?: any;
    calculations?: any;
    category?: string;
  }) => api.post('/contract-templates', templateData),
  
  update: (id: string, templateData: {
    name: string;
    namePersian: string;
    description?: string;
    content: string;
    variables?: any;
    structure?: any;
    calculations?: any;
    category?: string;
    isActive?: boolean;
  }) => api.put(`/contract-templates/${id}`, templateData),
  
  delete: (id: string) => api.delete(`/contract-templates/${id}`),
  
  generateContract: (id: string, contractData: {
    customerId: string;
    departmentId: string;
    contractData: any;
    title?: string;
    titlePersian?: string;
  }) => api.post(`/contract-templates/${id}/generate`, contractData),
};

// Customers API
const warnLegacyCustomersApiUsage = (action: string) => {
  if (typeof window === 'undefined') return;
  console.warn('[legacy-customers-api-usage]', {
    action,
    path: window.location.pathname,
    source: 'frontend/src/lib/api.ts',
    message: 'Use crmAPI for new sales contract flow.'
  });
};

const publicApi = axios.create({
  baseURL: `${API_BASE}/public`,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const publicContractsAPI = {
  lookupConfirmationContract: (contractNumber: string, phoneNumber: string) =>
    publicApi.post('/contracts/confirm/lookup', { contractNumber, phoneNumber }),

  verifyManualConfirmationCode: (contractNumber: string, phoneNumber: string, code: string) =>
    publicApi.post('/contracts/confirm/verify', { contractNumber, phoneNumber, code }),

  resendManualConfirmationCode: (contractNumber: string, phoneNumber: string) =>
    publicApi.post('/contracts/confirm/resend', { contractNumber, phoneNumber }),

  getConfirmationContract: (token: string) =>
    publicApi.get(`/contracts/confirm/${token}`),

  verifyConfirmationCode: (token: string, code: string) =>
    publicApi.post(`/contracts/confirm/${token}/verify`, { code }),

  resendConfirmationCode: (token: string) =>
    publicApi.post(`/contracts/confirm/${token}/resend`)
};

export const customersAPI = {
  getAll: (params?: { page?: number; limit?: number; search?: string }) =>
    (warnLegacyCustomersApiUsage('getAll'), api.get('/customers', { params })),
  
  getById: (id: string) => (warnLegacyCustomersApiUsage('getById'), api.get(`/customers/${id}`)),
  
  create: (customerData: {
    firstName: string;
    lastName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  }) => (warnLegacyCustomersApiUsage('create'), api.post('/customers', customerData)),
  
  update: (id: string, customerData: {
    firstName: string;
    lastName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  }) => (warnLegacyCustomersApiUsage('update'), api.put(`/customers/${id}`, customerData)),
  
  delete: (id: string) => (warnLegacyCustomersApiUsage('delete'), api.delete(`/customers/${id}`)),
};


// Contracts API
export const contractsAPI = {
  getAll: (params?: { page?: number; limit?: number; status?: string; departmentId?: string }) =>
    api.get('/contracts', { params }),
  
  getById: (id: string) => api.get(`/contracts/${id}`),
  
  create: (contractData: {
    title: string;
    titlePersian: string;
    customerId: string;
    departmentId: string;
    templateId?: string;
    totalAmount?: number;
    currency?: string;
    notes?: string;
  }) => api.post('/contracts', contractData),
  
  update: (id: string, contractData: {
    title?: string;
    titlePersian?: string;
    status?: string;
    totalAmount?: number;
    currency?: string;
    notes?: string;
  }) => api.put(`/contracts/${id}`, contractData),
  
  approve: (id: string, note?: string) =>
    api.put(`/contracts/${id}/approve`, { note }),

  reject: (id: string, note?: string) =>
    api.put(`/contracts/${id}/reject`, { note }),

  sign: (id: string, note?: string) =>
    api.put(`/contracts/${id}/sign`, { note }),

  print: (id: string, note?: string) =>
    api.put(`/contracts/${id}/print`, { note }),
  
  delete: (id: string) => api.delete(`/contracts/${id}`),
};

export const securityAPI = {
  // Shift management
  getShifts: () => api.get('/security/shifts'),
  createShift: (data: any) => api.post('/security/shifts', data),
  startShift: (shiftId: string) => api.post('/security/shifts/start', { shiftId }),
  endShift: () => api.post('/security/shifts/end'),
  getShiftPlans: (includeDrafts = false) => api.get('/security/shift-plans', { params: { includeDrafts } }),
  getShiftPlanDefaults: () => api.get('/security/shift-plans/defaults'),
  createShiftPlan: (data: any) => api.post('/security/shift-plans', data),
  publishShiftPlan: (id: string) => api.post(`/security/shift-plans/${id}/publish`),
  deleteShiftPlan: (id: string) => api.delete(`/security/shift-plans/${id}`),
  getShiftPlanSlots: (params?: any) => api.get('/security/shift-plan-slots', { params }),
  getShiftPlanSlot: (id: string) => api.get(`/security/shift-plan-slots/${id}`),
  setShiftReplacement: (id: string, personnelId: string, overrideReason?: string) => api.put(`/security/shift-plan-slots/${id}/replacement`, { personnelId, overrideReason }),
  markShiftEmergencyUncovered: (id: string, reason: string) => api.put(`/security/shift-plan-slots/${id}/emergency-uncovered`, { reason }),
  addTemporaryShiftCoverage: (id: string, data: any) => api.post(`/security/shift-plan-slots/${id}/temporary-coverage`, data),
  getCurrentShiftWorkflow: () => api.get('/security/shift-workflow/current'),
  getMyShiftWorkflow: (params?: { from?: string; to?: string }) => api.get('/security/shift-workflow/me', { params }),
  registerShiftAttendance: (slotId: string) => api.post(`/security/shift-plan-slots/${slotId}/attendance`),
  startPlannedShift: (slotId: string) => api.post(`/security/shift-plan-slots/${slotId}/start`),
  endPlannedShift: (slotId: string, closureSummary?: string) => api.post(`/security/shift-plan-slots/${slotId}/end`, { closureSummary }),
  forceCloseShift: (sessionId: string, reason: string, summary: string) => api.post(`/security/shift-sessions/${sessionId}/force-close`, { reason, summary }),
  correctShiftAttendance: (attendanceId: string, arrivedAt: string, reason: string) => api.put(`/security/shift-attendance/${attendanceId}/correct`, { arrivedAt, reason }),
  correctShiftSession: (slotId: string, data: { startedAt?: string; endedAt?: string; reason: string; deviationConfirmed?: boolean }) =>
    api.post(`/security/shift-plan-slots/${slotId}/session-correction`, data),
  confirmNoShift: (slotId: string, reason: string) =>
    api.post(`/security/shift-plan-slots/${slotId}/confirm-no-shift`, { reason }),
  
  // Attendance management
  checkIn: (employeeId: string, entryTimeOrData?: string | Record<string, any>) =>
    api.post('/security/attendance/checkin', typeof entryTimeOrData === 'object' ? { employeeId, ...entryTimeOrData } : { employeeId, entryTime: entryTimeOrData }),
  checkOut: (employeeId: string, exitTimeOrData?: string | Record<string, any>) =>
    api.post('/security/attendance/checkout', typeof exitTimeOrData === 'object' ? { employeeId, ...exitTimeOrData } : { employeeId, exitTime: exitTimeOrData }),
  correctAttendanceInterval: (intervalId: string, data: { enteredAt: string; exitedAt?: string | null; reason: string }) =>
    api.put(`/security/attendance/intervals/${intervalId}`, data),
  voidAttendanceInterval: (intervalId: string, reason: string) =>
    api.post(`/security/attendance/intervals/${intervalId}/void`, { reason }),
  recordException: (data: any) => api.post('/security/attendance/exception', data),
  
  // Reports and dashboard
  getDailyAttendance: (dateOrParams?: string | Record<string, any>) => {
    const params = typeof dateOrParams === 'string' ? { date: dateOrParams } : dateOrParams;
    return api.get('/security/attendance/daily', { params });
  },
  getDashboardStats: (params?: any) => api.get('/security/dashboard/stats', { params }),
  getDashboardCurrentShift: () => api.get('/security/dashboard/current-shift'),
  getOperationalPersonnel: () => api.get('/security/operational-personnel'),
  getSecurityReportSummary: (params?: any) => api.get('/security/reports/summary', { params }),
  getSecurityPersonnelPerformance: (params?: any) => api.get('/security/reports/security-personnel-performance', { params }),
  downloadSecurityPersonnelPerformancePdf: (params?: any) => api.get('/security/reports/security-personnel-performance.pdf', { params, responseType: 'blob' }),
  getLatestCompletedShiftReportStatus: () => api.get('/security/reports/latest-completed-shift'),
  downloadLatestCompletedShiftPdf: () => api.get('/security/reports/latest-completed-shift.pdf', { responseType: 'blob' }),
  getCompletedSecurityShifts: (params?: { q?: string; status?: string; startDate?: string; endDate?: string }) => api.get('/security/reports/completed-shifts', { params }),
  getCompletedSecurityShift: (id: string) => api.get(`/security/reports/completed-shifts/${id}`),
  downloadCompletedSecurityShiftsPdf: (shiftIds: string[]) => api.post('/security/reports/completed-shifts.pdf', { shiftIds }, { responseType: 'blob' }),
  previewSecurityShiftAttendance: (shiftIds: string[], personnelIds: string[] = []) => api.post('/security/reports/attendance-preview', { shiftIds, personnelIds }),
  downloadSecurityShiftAttendancePdf: (shiftIds: string[], personnelIds: string[] = []) => api.post('/security/reports/attendance.pdf', { shiftIds, personnelIds }, { responseType: 'blob' }),
  getPersonnelReportDirectory: (params?: any) => api.get('/security/reports/personnel-history', { params }),
  getPersonnelReportHistory: (personnelId: string, params?: any) => api.get(`/security/reports/personnel-history/${personnelId}`, { params }),
  downloadPersonnelReportHistoryPdf: (personnelId: string, filters: any, includeImages: boolean) => api.post(`/security/reports/personnel-history/${personnelId}.pdf`, { filters, includeImages }, { responseType: 'blob' }),
  getSecurityPersonnelShiftHistory: (id: string, params?: any) => api.get(`/security/reports/security-personnel/${id}/shift-history`, { params }),
  exportSecurityReport: (format: 'pdf' | 'excel', params?: any) => api.get('/security/reports/export', { params: { ...params, format }, responseType: 'blob' }),
  
  // Personnel management
  getPersonnel: () => api.get('/security/personnel'),
  getEligiblePersonnelUsers: () => api.get('/security/personnel/eligible-users'),
  assignPersonnel: (data: any) => api.post('/security/personnel', data),
  updatePersonnelStatus: (id: string, isActive: boolean) => api.put(`/security/personnel/${id}/status`, { isActive }),

  // Vehicle gate operations
  getVehiclePairs: (params?: any) => api.get('/security/vehicle-pairs', { params }),
  getVehiclePairPhoto: (photoId: string) => api.get(`/security/vehicle-pairs/photos/${photoId}`, { responseType: 'blob' }),
  getDriverQueue: (history = false) => api.get('/security/driver-queue', { params: { history } }),
  getCanonicalDriverQueue: (history = false) => api.get('/security/canonical-driver-queue', { params: { history } }),
  getCanonicalQueueAdmissionOptions: () => api.get('/security/canonical-driver-queue/admission-options'),
  admitCanonicalQueueTurn: (data: { source: 'INTERNAL' | 'EXTERNAL'; driverId: string; vehicleId?: string }) => api.post('/security/canonical-driver-queue', data),
  makeCanonicalQueueTurnAvailable: (id: string) => api.post(`/security/canonical-driver-queue/${id}/available`),
  returnCanonicalQueueTurnToWaiting: (id: string, reason: string) => api.post(`/security/canonical-driver-queue/${id}/return-to-waiting`, { reason }),
  closeCanonicalQueueTurnWithoutLoading: (id: string, reason: string) => api.post(`/security/canonical-driver-queue/${id}/close-without-loading`, { reason }),
  voidCanonicalQueueTurn: (id: string, reason: string, replacementTurnId?: string) => api.post(`/security/canonical-driver-queue/${id}/void`, { reason, replacementTurnId }),
  getAuthorizedPhysicalExits: () => api.get('/security/exit-desk/authorizations'),
  recordAuthorizedPhysicalExit: (authorizationId: string) => api.post(`/security/exit-desk/authorizations/${authorizationId}/exit`, {}),
  getVehicleMovements: (params?: any) => api.get('/security/vehicle-movements', { params }),
  getReadyExitLoadings: () => api.get('/security/vehicle-movements/ready-exit'),
  createInboundVehicleMovement: (data: any) => api.post('/security/vehicle-movements/inbound', data),
  completeVehicleMovement: (id: string, data: any) => api.put(`/security/vehicle-movements/${id}/complete`, data),
  recordVehicleExit: (data: any) => api.post('/security/vehicle-movements/exit', data),
  voidVehicleMovement: (id: string, reason: string) => api.put(`/security/vehicle-movements/${id}/void`, { reason }),
  addVehicleMovementAttachment: (id: string, data: any) => api.post(`/security/vehicle-movements/${id}/attachments`, data),
  getSupervisorReports: (params?: any) => api.get('/security/supervisor-reports', { params }),
  createSupervisorReport: (data: any) => api.post('/security/supervisor-reports', data),
  getInstantReportCategories: (includeInactive = false) => api.get('/security/instant-report-categories', { params: { includeInactive } }),
  createInstantReportCategory: (data: any) => api.post('/security/instant-report-categories', data),
  updateInstantReportCategory: (id: string, data: any) => api.put(`/security/instant-report-categories/${id}`, data),
  getInstantReportTypes: (includeInactive = false) => api.get('/security/instant-report-types', { params: { includeInactive } }),
  createInstantReportType: (data: any) => api.post('/security/instant-report-types', data),
  updateInstantReportType: (id: string, data: any) => api.put(`/security/instant-report-types/${id}`, data),
  getAttendanceRoster: (params?: any) => api.get('/security/attendance-roster', { params }),
  addAttendanceRosterMember: (data: any) => api.post('/security/attendance-roster', data),
  removeAttendanceRosterMember: (personnelId: string, data: any) => api.put(`/security/attendance-roster/${personnelId}/remove`, data),
  getActiveShiftLog: () => api.get('/security/shift-log/active'),
  createShiftLogEntry: (data: FormData) => api.post('/security/shift-log/entries', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getShiftLogParticipants: () => api.get('/security/shift-log/participants'),
  voidShiftLogEntry: (id: string, reason: string) => api.put(`/security/shift-log/entries/${id}/void`, { reason }),
  startPatrol: () => api.post('/security/shift-log/patrols/start'),
  finishPatrol: (id: string, description: string) => api.put(`/security/shift-log/patrols/${id}/finish`, { description }),

  // Exception handling system
  createExceptionRequest: (data: any) => api.post('/security/exceptions/request', data),
  getExceptionRequests: (params?: any) => api.get('/security/exceptions/requests', { params }),
  approveExceptionRequest: (id: string, notes?: string) => 
    api.put(`/security/exceptions/${id}/approve`, { notes }),
  rejectExceptionRequest: (id: string, rejectionReason: string) => 
    api.put(`/security/exceptions/${id}/reject`, { rejectionReason }),
  updateException: (id: string, data: any) => api.put(`/security/exceptions/${id}`, data),
  deleteException: (id: string) => api.delete(`/security/exceptions/${id}`),
  cancelException: (id: string, reason: string) => api.put(`/security/exceptions/${id}/cancel`, { reason }),
  correctException: (id: string, data: any) => api.put(`/security/exceptions/${id}/correct`, data),

  // Mission management
  createMissionAssignment: (data: any) => api.post('/security/missions/assign', data),
  getMissionAssignments: (params?: any) => api.get('/security/missions', { params }),
  approveMissionAssignment: (id: string) => api.put(`/security/missions/${id}/approve`),
  updateMissionAssignment: (id: string, data: any) => api.put(`/security/missions/${id}`, data),
  deleteMissionAssignment: (id: string) => api.delete(`/security/missions/${id}`),
  rejectMissionAssignment: (id: string, reason: string) => api.put(`/security/missions/${id}/reject`, { reason }),
  cancelMissionAssignment: (id: string, reason: string) => api.put(`/security/missions/${id}/cancel`, { reason }),
  correctMissionAssignment: (id: string, data: any) => api.put(`/security/missions/${id}/correct`, data),

  // Digital signature management
  saveAttendanceSignature: (id: string, signatureData: string, signatureType?: string) => 
    api.put(`/security/attendance/${id}/signature`, { signatureData, signatureType }),
  getAttendanceSignature: (id: string) => api.get(`/security/attendance/${id}/signature`),
  validateSignature: (signatureData: string, employeeId: string) => 
    api.post('/security/signature/validate', { signatureData, employeeId }),
};

export const personalAPI = {
  getLeaveRequests: (params?: any) => api.get('/personal/leave-requests', { params }),
  getLeaveUsers: () => api.get('/personal/leave-users'),
  createLeaveRequest: (data: any) => api.post('/personal/leave-requests', data),
  updateLeaveRequest: (id: string, data: any) => api.put(`/personal/leave-requests/${id}`, data),
  approveLeaveRequest: (id: string) => api.put(`/personal/leave-requests/${id}/approve`),
  rejectLeaveRequest: (id: string, rejectionReason: string) => api.put(`/personal/leave-requests/${id}/reject`, { rejectionReason }),
  cancelLeaveRequest: (id: string, reason?: string) => api.put(`/personal/leave-requests/${id}/cancel`, { reason }),
};

export const sabalanCalendarAPI = {
  getEntries: (params?: any) => api.get('/sabalan-calendar', { params }),
  createEntry: (data: any) => api.post('/sabalan-calendar', data),
  updateEntry: (id: string, data: any) => api.put(`/sabalan-calendar/${id}`, data),
};

export const hrAuthorizationAPI = {
  getMe: () => api.get('/hr/authorization/me'),
  getContext: () => api.get('/hr/authorization/context'),
  saveUserAccess: (userId: string, data: {
    role: string;
    workspaceLevels: Record<string, string | null>;
    features: Array<{ key: string; level: string }>;
    expiresAt?: string;
    reason: string;
  }) => api.post(`/hr/authorization/user-access/${userId}`, data),
  grantWorkspace: (data: { userId: string; level: 'VIEW' | 'EDIT' | 'ADMIN'; reason: string }) =>
    api.post('/hr/authorization/workspace-grants', data),
  revokeWorkspace: (id: string, reason: string) =>
    api.post(`/hr/authorization/workspace-grants/${id}/revoke`, { reason }),
  grantFeature: (data: { userId: string; featureCode: string; level: 'VIEW' | 'EDIT' | 'ADMIN'; reason: string }) =>
    api.post('/hr/authorization/feature-grants', data),
  revokeFeature: (id: string, reason: string) =>
    api.post(`/hr/authorization/feature-grants/${id}/revoke`, { reason }),
  grantAuthority: (data: { userId: string; authorityCode: string; reason: string }) =>
    api.post('/hr/authorization/business-authorities', data),
  revokeAuthority: (id: string, reason: string) =>
    api.post(`/hr/authorization/business-authorities/${id}/revoke`, { reason }),
  assignResponsibility: (data: {
    assignedUserId: string;
    responsibilityTypeCode: string;
    scopeType: string;
    scopeId?: string;
    assignmentKind: 'PRIMARY' | 'ACTING' | 'SUBSTITUTE';
    principalResponsibilityId?: string;
    reason: string;
  }) => api.post('/hr/authorization/responsibilities', data),
  endResponsibility: (id: string, reason: string) =>
    api.post(`/hr/authorization/responsibilities/${id}/end`, { reason }),
};

// Permissions API
export const permissionsAPI = {
  // Feature permissions
  getFeaturePermissions: (params?: any) => api.get('/permissions/features', { params }),
  getFeatureDefinitions: () => api.get('/permissions/features/definitions'),
  createFeaturePermission: (data: any) => api.post('/permissions/features', data),
  bulkUpsertFeaturePermissions: (data: any) => api.post('/permissions/features/bulk', data),
  updateFeaturePermission: (id: string, data: any) => api.put(`/permissions/features/${id}`, data),
  deleteFeaturePermission: (id: string) => api.delete(`/permissions/features/${id}`),
  getUserFeaturePermissions: (userId: string) => api.get(`/permissions/features/user/${userId}`),
  
  // Role feature permissions
  getRoleFeaturePermissions: (params?: any) => api.get('/permissions/role-features', { params }),
  createRoleFeaturePermission: (data: any) => api.post('/permissions/role-features', data),
  updateRoleFeaturePermission: (id: string, data: any) => api.put(`/permissions/role-features/${id}`, data),
  deleteRoleFeaturePermission: (id: string) => api.delete(`/permissions/role-features/${id}`),
  
  // User features summary
  getUserFeaturesSummary: (userId: string) => api.get(`/permissions/user/${userId}/features`),
};

// Services API
export const servicesAPI = {
  // Services
  getServices: (params?: any) => api.get('/services', { params }),
  getService: (id: string) => api.get(`/services/${id}`),
  createService: (data: any) => api.post('/services', data),
  updateService: (id: string, data: any) => api.put(`/services/${id}`, data),
  deleteService: (id: string) => api.delete(`/services/${id}`),
  toggleServiceStatus: (id: string) => api.patch(`/services/${id}/toggle`),
  
  // Cutting Types
  getCuttingTypes: (params?: any) => api.get('/cutting-types', { params }),
  getCuttingType: (id: string) => api.get(`/cutting-types/${id}`),
  createCuttingType: (data: any) => api.post('/cutting-types', data),
  updateCuttingType: (id: string, data: any) => api.put(`/cutting-types/${id}`, data),
  deleteCuttingType: (id: string) => api.delete(`/cutting-types/${id}`),
  toggleCuttingTypeStatus: (id: string) => api.patch(`/cutting-types/${id}/toggle`),
  
  // Contract tools. Backed by the legacy sub-services API for compatibility.
  getSubServices: (params?: any) => api.get('/sub-services', { params }),
  getSubService: (id: string) => api.get(`/sub-services/${id}`),
  createSubService: (data: any) => api.post('/sub-services', data),
  updateSubService: (id: string, data: any) => api.put(`/sub-services/${id}`, data),
  deleteSubService: (id: string) => api.delete(`/sub-services/${id}`),
  toggleSubServiceStatus: (id: string) => api.patch(`/sub-services/${id}/toggle`),
  getTools: (params?: any) => api.get('/sub-services', { params }),
  getTool: (id: string) => api.get(`/sub-services/${id}`),
  createTool: (data: any) => api.post('/sub-services', data),
  updateTool: (id: string, data: any) => api.put(`/sub-services/${id}`, data),
  deleteTool: (id: string) => api.delete(`/sub-services/${id}`),
  toggleToolStatus: (id: string) => api.patch(`/sub-services/${id}/toggle`),

  // Stair standard lengths
  getStairStandardLengths: (params?: any) => api.get('/stair-standard-lengths', { params }),
  getStairStandardLength: (id: string) => api.get(`/stair-standard-lengths/${id}`),
  createStairStandardLength: (data: any) => api.post('/stair-standard-lengths', data),
  updateStairStandardLength: (id: string, data: any) => api.put(`/stair-standard-lengths/${id}`, data),
  deleteStairStandardLength: (id: string) => api.delete(`/stair-standard-lengths/${id}`),
  toggleStairStandardLengthStatus: (id: string) => api.patch(`/stair-standard-lengths/${id}/toggle`),

  // Layer types
  getLayerTypes: (params?: any) => api.get('/layer-types', { params }),
  getContractLayerTypes: () => api.get('/layer-types/contract-catalog'),
  getLayerType: (id: string) => api.get(`/layer-types/${id}`),
  createLayerType: (data: any) => api.post('/layer-types', data),
  updateLayerType: (id: string, data: any) => api.put(`/layer-types/${id}`, data),
  deleteLayerType: (id: string) => api.delete(`/layer-types/${id}`),
  toggleLayerTypeStatus: (id: string) => api.patch(`/layer-types/${id}/toggle`),

  // Stone finishing services
  getStoneFinishings: (params?: any) => api.get('/stone-finishings', { params }),
  getStoneFinishing: (id: string) => api.get(`/stone-finishings/${id}`),
  createStoneFinishing: (data: any) => api.post('/stone-finishings', data),
  updateStoneFinishing: (id: string, data: any) => api.put(`/stone-finishings/${id}`, data),
  deleteStoneFinishing: (id: string) => api.delete(`/stone-finishings/${id}`),
  toggleStoneFinishingStatus: (id: string) => api.patch(`/stone-finishings/${id}/toggle`),

  downloadCatalogTemplate: (catalog: string) => api.get(`/catalog-excel/${catalog}/template`, { responseType: 'blob' }),
  exportCatalog: (catalog: string) => api.get(`/catalog-excel/${catalog}/export`, { responseType: 'blob' }),
  previewCatalogImport: (catalog: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/catalog-excel/${catalog}/import/preview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  applyCatalogImport: (catalog: string, importId: string) => api.post(`/catalog-excel/${catalog}/import/apply`, { importId })
};

export default api;
