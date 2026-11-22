/** Preserve payment order within each receivable's collection ledger. */
export function groupPaymentsByReceivable<T extends { receivableId: string | null }>(payments: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const payment of payments) {
    if (!payment.receivableId) continue;
    const rows = grouped.get(payment.receivableId) ?? [];
    rows.push(payment);
    grouped.set(payment.receivableId, rows);
  }
  return grouped;
}
