import type { DispatchDocumentCase, DispatchDocumentWorkspace } from './dispatchDocumentsViewModel';

export type DispatchDocumentDecision = { action: 'ACCEPT' | 'REJECT'; reason: string; idempotencyKey: string };
export type DispatchDocumentReplacement = { reason: string; idempotencyKey: string };
export type DispatchDocumentHandoff = { kind: 'DOWNLOAD_WAYBILL' | 'DOWNLOAD_STATEMENT' | 'PRINT_WAYBILL' | 'PRINT_STATEMENT' | 'PRINT_BOTH' };
export type DispatchDocumentHandoffArtifact = { kind: 'WAYBILL' | 'STATEMENT'; url: string; fileName: string };
export type DispatchDocumentHandoffResult = { artifacts: DispatchDocumentHandoffArtifact[] };

export interface DispatchDocumentsClient {
  load(): Promise<DispatchDocumentWorkspace>;
  decide(caseId: string, input: DispatchDocumentDecision): Promise<DispatchDocumentCase>;
  replace(caseId: string, input: DispatchDocumentReplacement): Promise<DispatchDocumentCase>;
  handoff(caseId: string, input: DispatchDocumentHandoff): Promise<DispatchDocumentHandoffResult>;
}

type ApiEnvelope<T> = { success: boolean; data: T; error?: string };

export class DispatchDocumentsAuthorizationError extends Error {
  constructor(message: string, readonly status: 401 | 403) { super(message); this.name = 'DispatchDocumentsAuthorizationError'; }
}

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (response.status === 401 || response.status === 403) throw new DispatchDocumentsAuthorizationError(body?.error || 'دسترسی به اسناد ارسال مجاز نیست.', response.status);
  if (!response.ok || !body?.success) throw new Error(body?.error || 'سرویس اسناد ارسال در دسترس نیست.');
  return body.data;
};

/** Production adapter. Permission and case projection come only from the authenticated backend response. */
export function createDispatchDocumentsHttpClient(baseUrl = '/api/accounting/dispatch-documents'): DispatchDocumentsClient {
  return {
    load: () => request<DispatchDocumentWorkspace>(baseUrl),
    decide: (caseId, input) => request<DispatchDocumentCase>(`${baseUrl}/cases/${encodeURIComponent(caseId)}/decision`, { method: 'POST', body: JSON.stringify(input) }),
    replace: (caseId, input) => request<DispatchDocumentCase>(`${baseUrl}/cases/${encodeURIComponent(caseId)}/replacement`, { method: 'POST', body: JSON.stringify(input) }),
    handoff: (caseId, input) => request<DispatchDocumentHandoffResult>(`${baseUrl}/cases/${encodeURIComponent(caseId)}/handoffs`, { method: 'POST', body: JSON.stringify(input) }),
  };
}
