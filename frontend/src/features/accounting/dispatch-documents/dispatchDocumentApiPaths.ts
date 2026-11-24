import type { DispatchDocumentFilter } from './dispatchDocumentsViewModel';

export const dispatchDocumentApiPaths = (baseUrl = "/api/accounting") => ({
  candidates: () => `${baseUrl}/dispatch-candidates`,
  queue: (filter: DispatchDocumentFilter, page: number) =>
    `${baseUrl}/dispatch-candidates?${new URLSearchParams({ documentQueue: filter, page: String(page) })}`,
  group: (loadingId: string) =>
    `${baseUrl}/dispatch-candidates?${new URLSearchParams({ documentQueue: 'GROUP', loadingId })}`,
  decision: (candidateId: string) =>
    `${baseUrl}/dispatch-candidates/${encodeURIComponent(candidateId)}/decision`,
  readModel: (candidateId: string, waybillId?: string) =>
    `${baseUrl}/dispatch-candidates/${encodeURIComponent(candidateId)}/document-read-model${waybillId ? `?waybillId=${encodeURIComponent(waybillId)}` : ""}`,
  replace: (waybillId: string) =>
    `${baseUrl}/dispatch-waybills/${encodeURIComponent(waybillId)}/replace`,
  artifact: (waybillId: string, artifactId: string) =>
    `${baseUrl}/dispatch-waybills/${encodeURIComponent(waybillId)}/artifacts/${encodeURIComponent(artifactId)}`,
  print: (waybillId: string) =>
    `${baseUrl}/dispatch-waybills/${encodeURIComponent(waybillId)}/print-handoffs`,
});
