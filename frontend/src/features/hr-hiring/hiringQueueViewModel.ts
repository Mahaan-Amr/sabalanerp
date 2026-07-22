export interface HiringQueueFilters {
  attention: "" | "MY_ACTIONS" | "BLOCKED" | "WAITING";
  phase: string;
  outcome: string;
}

export const buildHiringQueueParams = (filters: HiringQueueFilters) => {
  const params: Record<string, string> = {};
  if (filters.attention === "MY_ACTIONS") params.myActions = "true";
  if (filters.attention === "BLOCKED") params.lifecycleStatus = "BLOCKED";
  if (filters.attention === "WAITING") params.lifecycleStatus = "WAITING";
  if (filters.phase) params.phase = filters.phase;
  if (filters.outcome) params.outcome = filters.outcome;
  return params;
};
