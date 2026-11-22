import type { Prisma } from "@prisma/client";
import {
  statementAdjustmentPriorEvents,
  type StatementAdjustmentSnapshot,
} from "./statementAdjustment";

/** Both document consumers share one exact row ledger; a correction is counted once. */
export async function readShipmentPriceCorrections(
  tx: Prisma.TransactionClient,
  pricingRowIds: string[],
) {
  const selected = new Set(pricingRowIds);
  const [statements, invoices] = await Promise.all([
    tx.dispatchStatementAdjustment.findMany({
      select: { snapshot: true, integrityHash: true },
    }),
    tx.salesInvoiceCorrection.findMany({
      select: { snapshot: true, integrityHash: true },
    }),
  ]);
  const corrections = new Set<string>();
  return [...statements, ...invoices].flatMap((row) => {
    const snapshot = row.snapshot as unknown as StatementAdjustmentSnapshot;
    if (!snapshot.lines?.some((line) => selected.has(line.pricingRowId)))
      return [];
    if (corrections.has(snapshot.correctionId))
      throw new Error("A shipment correction was priced more than once.");
    corrections.add(snapshot.correctionId);
    return statementAdjustmentPriorEvents({
      snapshot,
      integrityHash: row.integrityHash,
    }).filter((event) => selected.has(event.pricingRowId));
  });
}
