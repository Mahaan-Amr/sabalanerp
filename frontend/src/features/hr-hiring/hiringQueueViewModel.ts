export interface HiringQueueFilters {
  attention: "" | "MY_ACTIONS" | "BLOCKED" | "WAITING" | "PAUSED";
  phase: string;
  outcome: string;
  search?: string;
  positionId?: string;
  disposition?: string;
  sortBy?: "priority" | "updatedAt" | "candidateName" | "position" | "status";
  sortDirection?: "asc" | "desc";
  page?: number;
}

export const buildHiringQueueParams = (filters: HiringQueueFilters) => {
  const params: Record<string, string> = {};
  if (filters.attention === "MY_ACTIONS") params.myActions = "true";
  if (filters.attention === "BLOCKED") params.lifecycleStatus = "BLOCKED";
  if (filters.attention === "WAITING") params.lifecycleStatus = "WAITING";
  if (filters.attention === "PAUSED") params.lifecycleStatus = "PAUSED";
  if (filters.phase) params.phase = filters.phase;
  if (filters.outcome === "ALL") params.includeHired = "true";
  else if (filters.outcome) params.outcome = filters.outcome;
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.positionId) params.positionId = filters.positionId;
  if (filters.disposition) params.disposition = filters.disposition;
  if (filters.sortBy) params.sortBy = filters.sortBy;
  if (filters.sortDirection) params.sortDirection = filters.sortDirection;
  if (filters.page && filters.page > 1) params.page = String(filters.page);
  if (
    filters.search ||
    filters.positionId ||
    filters.disposition ||
    filters.sortBy ||
    filters.sortDirection ||
    filters.page
  )
    params.pageSize = "50";
  return params;
};
