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

const attentionValues = new Set<HiringQueueFilters["attention"]>(["", "MY_ACTIONS", "BLOCKED", "WAITING", "PAUSED"]);
const sortValues = new Set<NonNullable<HiringQueueFilters["sortBy"]>>(["priority", "updatedAt", "candidateName", "position", "status"]);

export const parseHiringQueueContext = (params: Pick<URLSearchParams, "get">) => {
  const attention = params.get("attention") || "";
  const sortBy = params.get("sortBy") || "priority";
  const sortDirection = params.get("sortDirection") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  return {
    archived: params.get("archived") === "true",
    filters: {
      attention: attentionValues.has(attention as HiringQueueFilters["attention"])
        ? attention as HiringQueueFilters["attention"]
        : "",
      phase: params.get("phase") || "",
      outcome: params.get("outcome") || "",
      search: params.get("search") || "",
      positionId: params.get("positionId") || "",
      disposition: params.get("disposition") || "",
      sortBy: sortValues.has(sortBy as NonNullable<HiringQueueFilters["sortBy"]>)
        ? sortBy as NonNullable<HiringQueueFilters["sortBy"]>
        : "priority",
      sortDirection,
      page,
    } satisfies HiringQueueFilters,
  };
};

export const buildHiringQueueHref = (
  filters: HiringQueueFilters,
  archived: boolean,
  representedView?: string,
  focus?: string,
) => {
  const params = new URLSearchParams();
  if (archived) params.set("archived", "true");
  if (filters.attention) params.set("attention", filters.attention);
  if (filters.phase) params.set("phase", filters.phase);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.positionId) params.set("positionId", filters.positionId);
  if (filters.disposition) params.set("disposition", filters.disposition);
  if (filters.sortBy && filters.sortBy !== "priority") params.set("sortBy", filters.sortBy);
  if (filters.sortDirection && filters.sortDirection !== "asc") params.set("sortDirection", filters.sortDirection);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (representedView) params.set("view", representedView);
  if (focus) params.set("focus", focus);
  const query = params.toString();
  return `/dashboard/hr/hiring${query ? `?${query}` : ""}`;
};

export const buildHiringCaseHref = (applicationId: string, queueHref: string) =>
  `/dashboard/hr/hiring/${encodeURIComponent(applicationId)}?returnTo=${encodeURIComponent(queueHref)}`;

const returnContextKeys = new Set([
  "archived", "attention", "phase", "outcome", "search", "positionId",
  "disposition", "sortBy", "sortDirection", "page", "view", "focus",
]);

export const validateHiringQueueReturnHref = (raw: unknown) => {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/dashboard/hr/hiring";
  try {
    const url = new URL(raw, "https://sabalan.invalid");
    if (url.pathname !== "/dashboard/hr/hiring") return "/dashboard/hr/hiring";
    let containsUnknownKey = false;
    url.searchParams.forEach((_value, key) => {
      if (!returnContextKeys.has(key)) containsUnknownKey = true;
    });
    if (containsUnknownKey) return "/dashboard/hr/hiring";
    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "/dashboard/hr/hiring";
  }
};
