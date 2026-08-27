import type * as Foundation from '../../../../../packages/partner-sales-contracts';

// Public type entry only: #334 owns runtime installation and injects these exports.
export type ContractRuntime = Pick<typeof Foundation,
  'PartnerEventSchema' | 'PartnerCaseViewSchema' | 'PartnerAccountViewSchema'
  | 'SabalanInternalRecordViewSchema' | 'FulfillmentViewSchema' | 'PermissionContextSchema'
  | 'DateSchema' | 'InstantSchema' | 'IdSchema' | 'MoneySchema' | 'SignedDecimalSchema'
  | 'checkExpectedRevision' | 'canonicalJson' | 'canonicalHash' | 'partnerError'>;
export type Period = { from: string; to: string; asOf: string };
export type ReportPurpose = 'PARTNER' | 'MANAGEMENT' | 'ACCOUNTING' | 'FULFILLMENT';
export type ReportChannel = 'LIST' | 'DETAIL' | 'SEARCH' | 'COUNT' | 'EXPORT';
export type Currency = Foundation.Money['currency'];
export type Root = { caseId: string; partnerSellerId: string; departmentId: string | null };
export type Purchase = Foundation.PartnerAccountView['purchases'][number];

export class ReportingError extends Error {
  constructor(readonly code: Foundation.PartnerErrorCode) { super(code); }
}

export type RevenueEntry = {
  sourceKind: 'SABALAN_TO_PARTNER'; sourceKey: string; caseId: string;
  internalRecordId: string; sellerId: string; eventId: string;
  effectiveDate: string; recordedAt: string; type: 'REALIZED' | 'ADJUSTMENT';
  amount: string; currency: Currency;
};

export type Query = {
  purpose: ReportPurpose; from: string; to: string;
  search?: string; caseId?: string; state?: Foundation.CaseState;
  offset?: number; limit?: number;
};

/** Producer-validated commercial bases. Do not infer the meaning of Totals.net.
 * Each amount is AFTER its document's discount and EXCLUDES pass-through tax/fees.
 * The source verifies it against the frozen revision and financial policy evidence.
 */
export type ComparableBasis = { retail: Foundation.Money; sabalan: Foundation.Money; evidenceId: string };
export type CommercialRevision = {
  view: Foundation.PartnerCaseView;
  comparable: ComparableBasis;
};
export type DeliveryProgress = {
  productRowId: string; unit: string; contracted: string; reserved: string; dispatched: string;
};
export type CaseEvidence = {
  root: Root;
  events: Foundation.PartnerEvent[];
  internal: Foundation.SabalanInternalRecordView;
  // Not requested from an Accounting/Logistics source; no broad entity is serialized.
  commercial?: CommercialRevision[];
  account: Purchase | null;
  fulfillment: Foundation.FulfillmentView;
  deliveryProgress: DeliveryProgress[] | null;
};

/** #334 binds authenticated identity and #319 CENTRAL policy. No HTTP-supplied context.
 * read() runs candidates, current authorization, events, revisions, Accounting and
 * fulfillment under ONE consistent database snapshot, with a database clock.
 * All effective source evidence must be <= capturedAt and the requested to date.
 */
export interface ReportingSource {
  read<T>(query: Query, work: (snapshot: ReportingSnapshot) => Promise<T>): Promise<T>;
}
export interface ReportingSnapshot {
  snapshotId: string;
  capturedAt: string;
  /** Current explicit REPORT_READ grant, resolved by #319 even for an empty list. */
  access: Foundation.Result<Foundation.PermissionContext>;
  roots: readonly Root[];
  authorization(purpose: ReportPurpose, channel: ReportChannel): Foundation.PartnerAuthorizationPort;
  caseEvidence(root: Root, purpose: ReportPurpose): Promise<CaseEvidence>;
}
export type Metrics = {
  wholesalePurchases: string;
  retailSales?: string; retailCollected?: string; netComparableMargin?: string;
};
export type ReportRow = {
  caseId: string; revision: number; caseNumber: string; customerContractNumber: string;
  internalRecordNumber?: string; state: Foundation.CaseState;
  currency?: Currency; metrics?: Metrics;
  account?: Purchase | null;
  customerPaymentPlan?: Foundation.PartnerCaseView['customerPaymentPlan'];
  collectionStatus?: 'UNPAID' | 'PARTIAL' | 'SETTLED' | 'OVERPAID';
  deliveries: Foundation.FulfillmentView['deliveries'];
  deliveryProgress: DeliveryProgress[] | null;
};
export type Report = {
  schemaVersion: 1; interfaceVersion: '1.0.0'; snapshotId: string; capturedAt: string;
  scope: { purpose: ReportPurpose; kind: Foundation.PermissionContext['scope'];
    departmentId?: string; partnerSellerId?: string;
    from: string; to: string; effectiveThrough: string; search: string; state: string | null };
  count: number; offset: number; limit: number; rows: ReportRow[];
  totals: { currency: Currency; metrics: Metrics; accountingBalance: string | null; accountingReceivedAsOf: string | null;
    accountingCovered: number; accountingEligible: number }[];
};

export type FrozenExport = {
  id: string; actorId: string; expiresAt: string; query: Query; report: Report;
  roots: Root[]; contentHash: string;
};
/** Private durable storage supplied by #334. No public/static file URLs. */
export interface ReportExportStore {
  put(artifact: FrozenExport): Promise<void>;
  get(id: string): Promise<FrozenExport | null>;
}
