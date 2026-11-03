export type DispatchDocumentFilter = 'READY' | 'BLOCKED' | 'ISSUED';
export type DispatchDocumentPermission = 'MANAGE' | 'VIEW' | 'UNAUTHORIZED';
export type DispatchDocumentCommand = 'ACCEPT' | 'REJECT' | 'DOWNLOAD' | 'PRINT' | 'REPLACE';
export type MonetaryAmount = { amount: string; currency: string };

export type DispatchDocumentBlockingReason = {
  id: string;
  label: string;
  ownerLabel: string;
  ownerHref: string;
};

export type DispatchDocumentArtifact = {
  id: string;
  kind: 'WAYBILL' | 'STATEMENT' | 'ADJUSTMENT';
  fileName: string;
  checksum: string;
  byteSize: number;
  createdAt: string;
};

export type DispatchDocumentBundle = {
  id: string;
  number: string;
  status: 'ISSUED' | 'VOIDED' | 'REPLACED' | 'EXIT_RECORDED';
  issuedAt: string;
  artifacts: DispatchDocumentArtifact[];
  printHistory: Array<{ id: string; action: 'WAYBILL' | 'STATEMENT' | 'BOTH'; actorName: string; occurredAt: string; outcome: 'SUCCEEDED' | 'FAILED' }>;
  adjustments: Array<{ id: string; sequence: number; sharedNumber: string; issuedAt: string; summary: string; netDelta: MonetaryAmount; artifactId: string }>;
  history: Array<{ id: string; number: string; status: string; occurredAt: string; reason?: string }>;
};

export type DispatchDocumentContract = {
  id: string;
  number: string;
  rows: Array<{ id: string; label: string; quantity: string; unit: string; gross: MonetaryAmount; discount: MonetaryAmount; net: MonetaryAmount }>;
};

export type DispatchDocumentCase = {
  id: string;
  state: DispatchDocumentFilter;
  customerName: string;
  destination: string;
  loadingNumber: string;
  finalizedAt: string;
  total: MonetaryAmount;
  vehiclePlate: string;
  driverName: string;
  readiness: { code: 'READY' | 'STALE_PRICING' | 'LEGACY_REVIEW_REQUIRED' | 'INCOMPLETE_EVIDENCE' | 'EVIDENCE_CONFLICT'; label: string; reasons: DispatchDocumentBlockingReason[] };
  contracts: DispatchDocumentContract[];
  bundle?: DispatchDocumentBundle;
};

export type DispatchDocumentWorkspace = {
  permission: DispatchDocumentPermission;
  cases: DispatchDocumentCase[];
  retrievedAt: string;
};

export type DispatchDocumentView = {
  counts: Record<DispatchDocumentFilter, number>;
  visibleCases: DispatchDocumentCase[];
  selectedCase: DispatchDocumentCase | null;
  permission: DispatchDocumentPermission;
};

export function formatDisplayedMoney(value: MonetaryAmount): string {
  const match = value.amount.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return `— ${value.currency === 'IRR' ? 'ریال' : value.currency}`;
  const [, sign, whole, fraction = ''] = match;
  const zero = BigInt(0);
  const roundedMagnitude = BigInt(whole) + (fraction[0] && fraction[0] >= '5' ? BigInt(1) : zero);
  const rounded = sign === '-' && roundedMagnitude !== zero ? -roundedMagnitude : roundedMagnitude;
  return `${rounded.toLocaleString('fa-IR')} ${value.currency === 'IRR' ? 'ریال' : value.currency}`;
}

const emptyCounts = (): Record<DispatchDocumentFilter, number> => ({ READY: 0, BLOCKED: 0, ISSUED: 0 });

export function buildDispatchDocumentView(
  workspace: DispatchDocumentWorkspace,
  filter: DispatchDocumentFilter,
  selectedId: string | null,
): DispatchDocumentView {
  if (workspace.permission === 'UNAUTHORIZED') {
    return { counts: emptyCounts(), visibleCases: [], selectedCase: null, permission: workspace.permission };
  }
  const counts = workspace.cases.reduce((result, item) => {
    result[item.state] += 1;
    return result;
  }, emptyCounts());
  const visibleCases = workspace.cases.filter((item) => item.state === filter);
  const selectedCase = visibleCases.find((item) => item.id === selectedId) || visibleCases[0] || null;
  return { counts, visibleCases, selectedCase, permission: workspace.permission };
}

export function canRunDispatchDocumentCommand(
  command: DispatchDocumentCommand,
  workspace: DispatchDocumentWorkspace,
  item: DispatchDocumentCase,
  staleOrPending: boolean,
): boolean {
  if (workspace.permission === 'UNAUTHORIZED' || staleOrPending) return false;
  if (command === 'DOWNLOAD' || command === 'PRINT') return item.state === 'ISSUED' && hasCompletePrimaryBundle(item);
  if (workspace.permission !== 'MANAGE') return false;
  if (command === 'ACCEPT' || command === 'REJECT') return item.state === 'READY' && item.readiness.code === 'READY';
  return command === 'REPLACE' && item.state === 'ISSUED' && item.bundle?.status === 'ISSUED' && hasCompletePrimaryBundle(item);
}

export function hasCompletePrimaryBundle(item: DispatchDocumentCase): boolean {
  if (!item.bundle) return false;
  return item.bundle.artifacts.filter((artifact) => artifact.kind === 'WAYBILL').length === 1
    && item.bundle.artifacts.filter((artifact) => artifact.kind === 'STATEMENT').length === 1;
}
