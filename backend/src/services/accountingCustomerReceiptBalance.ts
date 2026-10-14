type Amount = { toString(): string };
/** Eligibility follows evidenced bank dates, never today's instrument status alone. */
export function collectedCustomerCheckRials(check: { amountRials: Amount; events: Array<{ eventType: string; occurredAt: Date; evidence: unknown }> }, asOf: Date) {
  let total = 0n;
  for (const event of check.events.filter(row => row.occurredAt <= asOf)) {
    const evidence = event.evidence as { kind?: string; amountRials?: string } | null;
    if (evidence?.kind === 'CHECK_SETTLE' && /^\d+$/.test(String(evidence.amountRials))) total += BigInt(evidence.amountRials!);
    else if (event.eventType === 'CLEARED') total = BigInt(check.amountRials.toString());
  }
  const face = BigInt(check.amountRials.toString());
  return total < face ? total : face;
}
export function effectiveCustomerReceiptRials(receipt: { amountRials: Amount; adjustments: Array<{ deltaRials: Amount; ledgerVoucher: { status: string; documentDate: Date } }> }, asOf = new Date()) {
  return BigInt(receipt.amountRials.toString()) + receipt.adjustments.filter(row => row.ledgerVoucher.status === 'POSTED' && row.ledgerVoucher.documentDate <= asOf)
    .reduce((sum, row) => sum + BigInt(row.deltaRials.toString()), 0n);
}
