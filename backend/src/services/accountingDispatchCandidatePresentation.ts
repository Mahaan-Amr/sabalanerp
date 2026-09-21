type CandidateSummary = {
  driverName: string | null;
  driverSource: string | null;
  loadingNumber: string | null;
  plate: string | null;
};

const record = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

export const projectAccountingDispatchCandidateSummary = (snapshot: unknown): CandidateSummary => {
  const root = record(snapshot);
  const loading = record(root?.loading);
  const queueTurn = record(root?.queueTurn);
  const admission = record(queueTurn?.admissionSnapshot);
  const driver = record(admission?.driver);
  const plate = record(admission?.plate);

  return {
    driverName: [text(driver?.firstName), text(driver?.lastName)].filter(Boolean).join(' ') || null,
    driverSource: text(queueTurn?.driverSource),
    loadingNumber: text(loading?.number),
    plate: text(plate?.plate),
  };
};
