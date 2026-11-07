type CandidateSummary = {
  driverName: string | null;
  driverSource: string | null;
  loadingNumber: string | null;
  plate: string | null;
  customerName: string | null;
  projectName: string | null;
  projectAddress: string | null;
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
  const customer = record(loading?.customer);
  const project = record(loading?.project);

  return {
    driverName: [text(driver?.firstName), text(driver?.lastName)].filter(Boolean).join(' ') || null,
    driverSource: text(queueTurn?.driverSource),
    loadingNumber: text(loading?.number),
    plate: text(plate?.plate),
    customerName: text(customer?.companyName) || text(customer?.name),
    projectName: text(project?.name),
    projectAddress: text(project?.address),
  };
};

/** Only display fields frozen on the allocation; do not infer identities from mutable catalog data. */
export const projectAccountingDispatchLines = (lines: Array<{ snapshot: unknown; quantity: { toString(): string }; unit: string }>) =>
  lines.map(line => {
    const source = record(line.snapshot);
    return {
      contractNumber: text(source?.contractNumber),
      productName: text(source?.productName) || text(source?.label),
      quantity: line.quantity.toString(),
      unit: line.unit,
    };
  });
