import type {
  IdempotencyIdentity, Money, PartnerEvent, PaymentPlan, PermissionContext, Result, RevisionRef,
} from './contracts';

export type RetailCollectionReceipt = {
  receiptId: string;
  planId: string;
  kind: 'RECEIPT' | 'REVERSAL';
  originalReceiptId?: string;
  amount: Money;
  effectiveDate: string;
  recordedAt: string;
  actorId: string;
  commandId: string;
  correlationId: string;
  reason?: string;
  allocations: readonly { installmentId: string; amount: string }[];
};

export type RetailCollectionSource = {
  owner: RevisionRef;
  state: 'DRAFT' | 'AWAITING_CUSTOMER_CONFIRMATION' | 'CUSTOMER_APPROVED' | 'COMMITTED' | 'CANCELLED' | 'VOIDED';
  partnerSellerId: string;
  retailPayable: Money;
  customerPaymentPlan: PaymentPlan;
  customerOutputPaymentPlan: PaymentPlan;
  privateReportPaymentPlan: PaymentPlan;
  planHistory: readonly PaymentPlan[];
  receipts: readonly RetailCollectionReceipt[];
  events: readonly PartnerEvent[];
  permission: PermissionContext;
};

export type RetailCollectionCommandReceipt = {
  commandId: string;
  intentHash: string;
  idempotency: IdempotencyIdentity;
  eventIds: readonly string[];
};

export interface RetailCollectionTransaction {
  now(): Promise<string>;
  readAuthorizedSource(expected: RevisionRef, channel: 'DETAIL' | 'EXPORT' | 'API'): Promise<Result<RetailCollectionSource>>;
  readCommand(commandId: string, idempotency: IdempotencyIdentity): Promise<RetailCollectionCommandReceipt | null>;
  appendReceipt(input: {
    expected: RevisionRef;
    receipt: RetailCollectionReceipt;
    event: PartnerEvent;
    command: RetailCollectionCommandReceipt;
  }): Promise<Result<RetailCollectionCommandReceipt>>;
  appendDelayEvents(input: {
    expected: RevisionRef;
    events: readonly PartnerEvent[];
    command: RetailCollectionCommandReceipt;
  }): Promise<Result<RetailCollectionCommandReceipt>>;
}

export interface RetailCollectionRepository {
  transaction<T>(operation: (tx: RetailCollectionTransaction) => Promise<Result<T>>): Promise<Result<T>>;
}
