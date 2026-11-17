export type InvoiceDraftApprovalIdentity = {
  fingerprint: string;
  idempotencyKey: string;
  correlationId: string;
};

type DraftDetails = { systemInvoiceNumber: string; systemInvoiceDate: string; sepidarAmount: string };

export function invoiceDraftApprovalCommand(
  previous: InvoiceDraftApprovalIdentity | null,
  invoiceId: string,
  details: DraftDetails,
  newId: () => string = () => crypto.randomUUID(),
) {
  const fingerprint = JSON.stringify([invoiceId, details.systemInvoiceNumber, details.systemInvoiceDate, details.sepidarAmount]);
  const identity = previous?.fingerprint === fingerprint ? previous : {
    fingerprint,
    idempotencyKey: newId(),
    correlationId: newId(),
  };
  return { identity, command: { kind: 'APPROVE_FINANCIAL_INVOICE' as const, invoiceId, ...details,
    idempotencyKey: identity.idempotencyKey, correlationId: identity.correlationId } };
}
