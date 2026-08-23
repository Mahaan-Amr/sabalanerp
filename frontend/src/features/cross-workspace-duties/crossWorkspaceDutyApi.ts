import api from '@/lib/api';

export type CrossWorkspaceDutyView = 'assigned' | 'available' | 'triage' | 'history';

export type CrossWorkspaceDutySummary = {
  open: number;
  available: number;
  availableUnseen: number;
  attention: number;
  dueSoon: number;
  overdue: number;
  triage: number;
  historyUnseen: number;
  canManageTriage: boolean;
};

export type CrossWorkspaceDuty = {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'WAIVED' | 'CANCELLED';
  access: 'ASSIGNEE' | 'AVAILABLE' | 'MANAGER_TRIAGE' | 'SHARED';
  canReassign: boolean;
  claimRequiresReason: boolean;
  responseRequiresReason: boolean;
  currentAssigneeUserId: string | null;
  currentAssignee: { id: string; displayName: string; username: string } | null;
  accessProvenance: string[];
  workspace: string;
  sourceActionCode: string;
  sourceVersion: number;
  envelopeVersion: number;
  dueAt: string;
  dueAtDisplay: string;
  overdue: boolean;
  fields: Record<string, string | null>;
  evidence: Array<{ kind: string }>;
  allowedActionCodes: string[];
  result: unknown;
  resultActor: { id: string; displayName: string; username: string } | null;
  detailAvailable: boolean;
  createdAt: string;
  respondedAt: string | null;
  updatedAt: string;
  history: Array<{ version: number; eventCode: string; reason: string | null; createdAt: string }>;
};

export const CROSS_WORKSPACE_DUTY_CHANGED_EVENT = 'cross-workspace-duty:changed';

export const announceCrossWorkspaceDutyChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CROSS_WORKSPACE_DUTY_CHANGED_EVENT));
};

export const crossWorkspaceDutyApi = {
  summary: (workspace: string) => api.get<{ success: true; data: CrossWorkspaceDutySummary }>(
    `/duties/workspaces/${workspace}/summary`,
  ),
  list: (workspace: string, view: CrossWorkspaceDutyView) => api.get<{ success: true; data: CrossWorkspaceDuty[] }>(
    `/duties/workspaces/${workspace}/duties`, { params: { view } },
  ),
  detail: (workspace: string, dutyId: string) => api.get<{ success: true; data: CrossWorkspaceDuty }>(
    `/duties/workspaces/${workspace}/duties/${dutyId}`,
  ),
  claim: (dutyId: string, reason?: string | null) => api.post(`/duties/${dutyId}/claim`, { reason: reason || null }),
  markHistorySeen: (workspace: string, seenThrough: string) => api.post(
    `/duties/workspaces/${workspace}/history-seen`,
    { seenThrough },
  ),
  markAvailableSeen: (workspace: string, seenThrough: string) => api.post(
    `/duties/workspaces/${workspace}/available-seen`,
    { seenThrough },
  ),
  eligibleAssignees: (workspace: string, dutyId: string) => api.get<{
    success: true;
    data: Array<{ id: string; displayName: string; username: string; role: string }>;
  }>(`/duties/workspaces/${workspace}/duties/${dutyId}/eligible-assignees`),
  reassign: (duty: CrossWorkspaceDuty, targetUserId: string, reason: string) => api.post(
    `/duties/${duty.id}/reassign`,
    { targetUserId, reason, expectedAssigneeUserId: duty.currentAssigneeUserId },
  ),
  respond: (duty: CrossWorkspaceDuty, actionCode: string, reason: string | null, targetUserId?: string) => api.post(
    `/duties/${duty.id}/respond`,
    {
      actionCode,
      reason,
      targetUserId,
      expectedSourceVersion: duty.sourceVersion,
      expectedEnvelopeVersion: duty.envelopeVersion,
    },
  ),
  hiringFinanceContext: (dutyId: string) => api.get(`/duties/${dutyId}/hiring-finance/context`),
  downloadHiringFinanceEvidence: (dutyId: string) => api.get(
    `/duties/${dutyId}/hiring-finance/evidence`, { responseType: 'blob' },
  ),
  recordHiringCollateralReceipt: (dutyId: string, data: FormData) => api.post(
    `/duties/${dutyId}/hiring-finance/receipt`,
    data,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  ),
  recordHiringCollateralReturn: (dutyId: string, data: FormData) => api.post(
    `/duties/${dutyId}/hiring-finance/original-return`,
    data,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  ),
};
