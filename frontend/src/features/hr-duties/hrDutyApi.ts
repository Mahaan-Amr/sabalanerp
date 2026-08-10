import api from '@/lib/api';

export type DestinationDutyView = 'assigned' | 'triage' | 'history';

export type DestinationDuty = {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'WAIVED' | 'CANCELLED';
  access: 'ASSIGNEE' | 'MANAGER_TRIAGE';
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
  detailAvailable: boolean;
  createdAt: string;
  respondedAt: string | null;
  history: Array<{ version: number; eventCode: string; reason: string | null; createdAt: string }>;
};

export type DestinationDutySummary = {
  open: number;
  dueSoon: number;
  overdue: number;
  triage: number;
  canManageTriage: boolean;
};

export const hrDutyApi = {
  summary: (workspace: string) => api.get<{ success: true; data: DestinationDutySummary }>(
    `/hr-duties/workspaces/${workspace}/summary`,
  ),
  list: (workspace: string, view: DestinationDutyView) => api.get<{ success: true; data: DestinationDuty[] }>(
    `/hr-duties/workspaces/${workspace}/duties`, { params: { view } },
  ),
  detail: (workspace: string, dutyId: string) => api.get<{ success: true; data: DestinationDuty }>(
    `/hr-duties/workspaces/${workspace}/duties/${dutyId}`,
  ),
  respond: (duty: DestinationDuty, actionCode: string, reason: string | null) => api.post(
    `/hr-duties/${duty.id}/respond`,
    {
      actionCode,
      reason,
      expectedSourceVersion: duty.sourceVersion,
      expectedEnvelopeVersion: duty.envelopeVersion,
    },
  ),
};
