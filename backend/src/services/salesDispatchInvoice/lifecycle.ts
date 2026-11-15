import type { Prisma } from "@prisma/client";
import { dispatchDocumentLifecycleAuditEventHash } from "../dispatchDocuments/prismaRepository";

export const auditSalesInvoice = async (
  tx: Prisma.TransactionClient,
  id: string,
  eventType: string,
  payload: unknown,
  actorId: string,
) => {
  const at = new Date(),
    aggregateType = "SALES_DISPATCH_INVOICE";
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`SALES_INVOICE_AUDIT:${id}`}))`;
  const previous = await tx.dispatchLifecycleAudit.findFirst({
    where: { aggregateType, aggregateId: id },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
  });
  const previousHash = previous?.eventHash ?? null;
  await tx.dispatchLifecycleAudit.create({
    data: {
      aggregateType,
      aggregateId: id,
      eventType,
      payload: payload as Prisma.InputJsonValue,
      actorId,
      recordedAt: at,
      previousHash,
      eventHash: dispatchDocumentLifecycleAuditEventHash({
        aggregateType,
        aggregateId: id,
        eventType,
        payload,
        actorId,
        at,
        previousHash,
      }),
    },
  });
};
export async function voidSalesInvoiceInTransaction(
  tx: Prisma.TransactionClient,
  invoice: { id: string; loadingId: string; number: bigint },
  input: { actorId: string; reason: string; at?: Date },
) {
  await tx.salesDispatchInvoice.update({ where: { id: invoice.id }, data: {
    voidedAt: input.at ?? new Date(), voidedBy: input.actorId, voidReason: input.reason,
  } });
  await auditSalesInvoice(tx, invoice.id, "VOIDED", {
    loadingId: invoice.loadingId, reason: input.reason, number: invoice.number.toString(),
  }, input.actorId);
}
