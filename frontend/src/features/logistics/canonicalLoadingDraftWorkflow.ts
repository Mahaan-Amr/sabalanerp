type ApiResponse = Promise<{ data: { success?: boolean; data?: unknown } }>;

export type CanonicalLoadingDraftApi = {
  updateLoading: (loadingId: string, payload: Record<string, unknown>) => ApiResponse;
  reserveCanonicalDriver: (queueTurnId: string, loadingId: string) => ApiResponse;
  releaseCanonicalDriver: (queueTurnId: string, loadingId: string, reason: string) => ApiResponse;
  saveCanonicalAllocation: (loadingId: string, queueTurnId: string, payload: { lines: unknown[] }) => ApiResponse;
  getLoading: (loadingId: string) => ApiResponse;
};

type CanonicalAllocation = {
  queueTurnId: string;
  lines: unknown[];
};

export const saveCanonicalLoadingDraft = async ({
  api,
  loadingId,
  loadingPayload,
  selectedTurnIds,
  reservedTurnIds,
  allocations,
}: {
  api: CanonicalLoadingDraftApi;
  loadingId: string;
  loadingPayload: Record<string, unknown>;
  selectedTurnIds: string[];
  reservedTurnIds: string[];
  allocations: CanonicalAllocation[];
}) => {
  const selected = new Set(selectedTurnIds);
  const reserved = new Set(reservedTurnIds);

  await api.updateLoading(loadingId, loadingPayload);

  for (const queueTurnId of reservedTurnIds.filter((id) => !selected.has(id))) {
    await api.releaseCanonicalDriver(queueTurnId, loadingId, 'راننده از پیش‌نویس بارگیری حذف شد.');
  }

  for (const queueTurnId of selectedTurnIds.filter((id) => !reserved.has(id))) {
    await api.reserveCanonicalDriver(queueTurnId, loadingId);
  }

  for (const allocation of allocations.filter((item) => selected.has(item.queueTurnId))) {
    await api.saveCanonicalAllocation(loadingId, allocation.queueTurnId, { lines: allocation.lines });
  }

  return api.getLoading(loadingId);
};
