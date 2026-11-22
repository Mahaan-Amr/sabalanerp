import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { calculateStatementAdjustment } from "../statementAdjustment";
import {
  mapVerifiedApprovedPricingVersion,
  persistedApprovedPricingInclude,
} from "../approvedPricing/prismaEvidence";
import { createPrismaAllocationPricingBindingPort } from "../allocationPricingPrismaAdapter";
import { record, SalesInvoiceError } from "./source";

/** Called only by the authorized posting transaction, after its physical and
 * return evidence checks. The optional statement workflow retains its gate. */
export async function freezeSalesInvoiceCorrection(
  tx: Prisma.TransactionClient,
  correctionId: string,
  actorId: string,
) {
  const correction = await tx.dispatchCorrection.findUniqueOrThrow({
    where: { id: correctionId },
    include: {
      lines: true,
      statementAdjustment: true,
      salesInvoiceCorrection: true,
      waybill: {
        include: {
          candidate: {
            include: {
              allocationRevision: {
                include: {
                  lines: true,
                  pricingReferences: {
                    include: {
                      pricingVersion: {
                        include: persistedApprovedPricingInclude,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (correction.statementAdjustment || correction.salesInvoiceCorrection)
    return null;
  if (correction.status !== "POSTED" || !correction.integrityHash)
    throw new SalesInvoiceError("گردش اصلاح ارسال هنوز کامل نیست.");
  const revision = correction.waybill.candidate.allocationRevision;
  const invoices = await tx.salesDispatchInvoice.findMany({
    where: { loadingId: revision.loadingId },
    orderBy: { number: "desc" },
  });
  const invoice = invoices.find((item) =>
    record(item.snapshot).evidence?.some(
      (e: any) => e.waybillId === correction.waybillId,
    ),
  );
  if (!invoice) return null; // Existing unnumbered historical shipments are not retroactively repriced.
  if (revision.sourceKind !== "SALES_CONTRACT")
    throw new SalesInvoiceError(
      "اصلاح پرونده همکار باید از گردش بازگشت همان پرونده انجام شود.",
    );
  const versions = revision.pricingReferences.map((reference) => {
    if (
      reference.expectedPricingHash !== reference.pricingVersion.integrityHash
    )
      throw new SalesInvoiceError("شاهد قیمت اصلاح ارسال ناسازگار است.");
    return mapVerifiedApprovedPricingVersion(
      reference.pricingVersion,
      reference.readinessEvidenceHash,
    );
  });
  const pricingRows = versions.flatMap((v) => v.rows);
  const priorEvents = await createPrismaAllocationPricingBindingPort(
    tx,
  ).loadPriorPricedEvents(pricingRows.map((row) => row.id));
  const id = randomUUID();
  const sequence =
    1 +
    (await tx.salesInvoiceCorrection.count({
      where: { correction: { waybillId: correction.waybillId } },
    }));
  const calculated = calculateStatementAdjustment({
    adjustmentId: id,
    waybillId: correction.waybillId,
    correctionId,
    sequence,
    reason: correction.reason,
    correctionIntegrityHash: correction.integrityHash,
    originalStatementDocumentId: invoice.id,
    originalStatementSourceIntegrityHash: invoice.sourceHash,
    originalStatementSha256: invoice.pdfSha256,
    currency: record(invoice.snapshot).currency,
    issuedAt: new Date().toISOString(),
    issuedBy: actorId,
    versions,
    priorEvents,
    lines: correction.lines.map((line) => {
      const original = revision.lines.find(
        (r) =>
          r.sourceContractItemId === line.contractItemId &&
          r.productRowId === line.productRowId &&
          r.unit === line.unit,
      );
      const priced = pricingRows.find(
        (r) =>
          r.contractItemId === line.contractItemId &&
          r.productRowId === line.productRowId &&
          r.unit === line.unit,
      );
      if (!original || !priced)
        throw new SalesInvoiceError(
          "ردیف اصلاح با قیمت مصوب بارگیری یکسان نیست.",
        );
      return {
        correctionLineId: line.id,
        contractId: line.contractId,
        contractItemId: line.contractItemId,
        productRowId: line.productRowId,
        label: String(
          record(original.snapshot).productName || line.productRowId,
        ),
        unit: line.unit,
        quantity: line.quantity.toFixed(),
      };
    }),
    renderContext: {
      waybillNumber: correction.waybill.number.toString(),
      customerName: record(invoice.snapshot).customerName,
      projectOrDestination: record(invoice.snapshot).lines?.[0]?.project || "—",
      vehiclePlate: "—",
      templateVersion: "sales-invoice-v1",
    },
  });
  return tx.salesInvoiceCorrection.create({
    data: {
      id,
      correctionId,
      snapshot: calculated.snapshot as unknown as Prisma.InputJsonValue,
      integrityHash: calculated.integrityHash,
      recordedBy: actorId,
    },
  });
}
