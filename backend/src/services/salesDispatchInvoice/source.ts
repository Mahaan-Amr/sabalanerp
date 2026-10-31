import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  assessBoundAllocationPricingFreshness,
  readBoundPricedAllocation,
} from "../allocationPricingReadModel";
import {
  statementAdjustmentPriorEvents,
  type StatementAdjustmentSnapshot,
} from "../statementAdjustment";
import { exactQuantityText } from "../exactQuantity";
import { canonicalApprovedPricingHash } from "../approvedPricing/domain";
import {
  mapVerifiedApprovedPricingVersion,
  persistedApprovedPricingInclude,
} from "../approvedPricing/prismaEvidence";
import { projectPartnerInternalContent } from "../partnerSales/accounting/internalDocumentContent";
import { restoreLongitudinalCustomerRequest } from "../../utils/printTemplate";

export class SalesInvoiceError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const stable = (value: any): any =>
  Array.isArray(value)
    ? value.map(stable)
    : value instanceof Date
      ? value.toISOString()
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
export const sourceHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
export const bytesHash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export type InvoiceLine = {
  key: string;
  contractNumber: string;
  project: string;
  productRowId: string;
  contractRowNumber?: number;
  code: string;
  label: string;
  length: string;
  width: string;
  details: string[];
  quantity: string;
  unit: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  driverId: string;
};
export type InvoiceSource = {
  schemaVersion: 1;
  loadingId: string;
  loadingNumber: string;
  customerId: string;
  customerName: string;
  counterparty: string;
  currency: string;
  lines: InvoiceLine[];
  drivers: Array<{
    id: string;
    name: string;
    plate: string;
    waybillNumber: string;
  }>;
  evidence: Array<{
    revisionId: string;
    waybillId: string;
    allocationHash: string;
    waybillHash: string;
    financialRecordIds: string[];
    pricing: unknown;
    corrections: string[];
  }>;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
};
const ExactDecimal = Prisma.Decimal.clone({ precision: 100 });
const amount = (value: string) => new ExactDecimal(value);
const nonempty = (value: unknown, label: string) => {
  const result = String(value ?? "").trim();
  if (!result)
    throw new SalesInvoiceError(`شواهد ${label} برای صدور فاکتور کامل نیست.`);
  return result;
};
export const validFinancialRecord = (
  row: {
    status: string;
    kind: string;
    financiallyApprovedAt: Date | null;
  } | null,
) =>
  Boolean(
    row &&
      row.kind === "INVOICE_CANDIDATE" &&
      ["ISSUED", "POSTED"].includes(row.status) &&
      row.financiallyApprovedAt,
  );

/** Only frozen allocation/pricing/financial evidence is read. No live catalog rates or loading-form amounts. */
export async function readInvoiceSource(
  tx: Prisma.TransactionClient,
  loadingId: string,
): Promise<InvoiceSource> {
  try {
    return await buildInvoiceSource(tx, loadingId);
  } catch (error) {
    if (
      error instanceof SalesInvoiceError ||
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    )
      throw error;
    console.error("Sales invoice source evidence validation failed:", error);
    throw new SalesInvoiceError(
      "شواهد قیمت یا مقدار بارگیری کامل و معتبر نیست؛ حسابداری باید منبع ارسال را بررسی کند.",
    );
  }
}
async function buildInvoiceSource(
  tx: Prisma.TransactionClient,
  loadingId: string,
): Promise<InvoiceSource> {
  const loading = await tx.logisticsLoading.findUnique({
    where: { id: loadingId },
    include: {
      canonicalAllocationRevisions: {
        orderBy: [{ queueTurnId: "asc" }, { revisionNumber: "desc" }],
        include: {
          lines: true,
          queueTurn: true,
          candidate: {
            include: {
              waybills: {
                orderBy: { issuedAt: "desc" },
                include: {
                  dispatchCorrections: {
                    include: {
                      statementAdjustment: true,
                      salesInvoiceCorrection: true,
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
  if (!loading) throw new SalesInvoiceError("بارگیری پیدا نشد.", 404);
  if (loading.status !== "FINALIZED")
    throw new SalesInvoiceError("بارگیری باید نهایی‌شده و فعال باشد.");
  const revisions = [
    ...new Map(
      loading.canonicalAllocationRevisions
        .slice()
        .reverse()
        .map((r) => [r.queueTurnId, r]),
    ).values(),
  ].sort((a, b) => a.queueTurnId.localeCompare(b.queueTurnId));
  if (!revisions.length)
    throw new SalesInvoiceError(
      "نسخه نهایی و قیمت‌گذاری‌شده بارگیری موجود نیست.",
    );
  const result: InvoiceSource = {
    schemaVersion: 1,
    loadingId,
    loadingNumber: loading.loadingNumber,
    customerId: loading.customerId,
    customerName: "",
    counterparty: "",
    currency: "",
    lines: [],
    drivers: [],
    evidence: [],
    grossAmount: "0",
    discountAmount: "0",
    netAmount: "0",
  };
  const counterparties = new Set<string>();
  for (const revision of revisions) {
    const candidate = revision.candidate;
    const waybill = candidate?.waybills.find((w) => w.status !== "VOIDED");
    if (
      !candidate ||
      candidate.status !== "ACCEPTED" ||
      !revision.sealedAt ||
      !waybill
    ) {
      throw new SalesInvoiceError(
        "تأیید حسابداری و بارنامه معتبر همه راننده‌های این بارگیری باید کامل شود.",
      );
    }
    if (waybill.dispatchCorrections.some((c) => c.status !== "POSTED"))
      throw new SalesInvoiceError("گردش اصلاح ارسال هنوز کامل نشده است.");
    if (
      (await assessBoundAllocationPricingFreshness(tx, revision.id)).status !==
      "CURRENT"
    )
      throw new SalesInvoiceError(
        "قیمت تأییدشده بارگیری تغییر کرده؛ ابتدا اصلاح ارسال را تکمیل کنید.",
      );
    const priced = await readBoundPricedAllocation(tx, revision.id);
    if (result.currency && result.currency !== priced.currency)
      throw new SalesInvoiceError("ارز اقلام فاکتور یکسان نیست.");
    result.currency = priced.currency;
    const snapshot = record(revision.snapshot),
      frozenLoading = record(snapshot.loading);
    if (String(record(frozenLoading.customer).id) !== loading.customerId)
      throw new SalesInvoiceError(
        "هویت مشتری بارگیری با نسخه نهایی مطابقت ندارد.",
      );
    const name = String(
      record(frozenLoading.customer).name ||
        record(frozenLoading.customer).companyName ||
        "",
    );
    result.customerName ||= nonempty(name, "مشتری");
    const admission = record(record(snapshot.queueTurn).admissionSnapshot),
      driver = record(admission.driver);
    result.drivers.push({
      id: revision.queueTurnId,
      name: nonempty(
        [driver.firstName, driver.lastName].filter(Boolean).join(" ") ||
          driver.name,
        "راننده",
      ),
      plate: nonempty(
        record(admission.plate).plate ||
          record(admission.vehicle).plate ||
          admission.vehiclePlate,
        "پلاک خودرو",
      ),
      waybillNumber: waybill.number.toString(),
    });
    const financialIds: string[] = [];
    const versions = new Map<string, any>();
    for (const pricing of priced.pricingVersions) {
      let financialId: string;
      if ("caseId" in pricing) financialId = pricing.sourceFinancialRecordId;
      else {
        const version =
          await tx.contractApprovedPricingVersion.findUniqueOrThrow({
            where: { id: pricing.pricingVersionId },
            include: persistedApprovedPricingInclude,
          });
        mapVerifiedApprovedPricingVersion(
          version,
          pricing.readinessEvidenceHash,
        );
        versions.set(pricing.contractId, version);
        financialId = version.sourceFinancialRecordId;
      }
      const financial = await tx.accountingFinancialRecord.findUnique({
        where: { id: financialId },
      });
      if (!validFinancialRecord(financial))
        throw new SalesInvoiceError("رکورد مالی مبدأ معتبر و تأییدشده نیست.");
      financialIds.push(financialId);
      if ("caseId" in pricing) {
        const preparation = record(
          record(financial!.sourceSnapshot).partnerPreparation ||
            financial!.sourceSnapshot,
        );
        const debtor = record(preparation.debtor);
        counterparties.add(
          nonempty(debtor.commercialAccountId, "طرف‌حساب همکار"),
        );
        result.counterparty = nonempty(
          record(debtor.identity).displayName,
          "نام طرف‌حساب همکار",
        );
        const frozen = await tx.partnerCaseRevision.findUnique({
          where: {
            caseId_revision: {
              caseId: pricing.caseId,
              revision: revision.partnerCaseRevision!,
            },
          },
        });
        if (!frozen || frozen.integrityHash !== revision.partnerIntegrityHash)
          throw new SalesInvoiceError("نسخه فنی پرونده همکار معتبر نیست.");
        const content = projectPartnerInternalContent(
          financial!.sourceSnapshot,
          frozen.graph,
        );
        const partnerCase = await tx.partnerSaleCase.findUniqueOrThrow({
          where: { id: pricing.caseId },
          select: { caseNumber: true, customerContract: { select: { contractNumber: true } } },
        });
        versions.set("PARTNER", {
          preparation,
          items: content.items,
          caseNumber: partnerCase.customerContract?.contractNumber || partnerCase.caseNumber,
          project: record(record(frozen.customerContent).project).title,
        });
      } else {
        if (
          financial!.contractId !== pricing.contractId ||
          (financial!.customerId &&
            financial!.customerId !== loading.customerId)
        )
          throw new SalesInvoiceError(
            "طرف‌حساب سند مالی با بارگیری یکسان نیست.",
          );
        const evidence = record(
          versions.get(pricing.contractId).sourceEvidence,
        );
        const expectedSnapshotHash = record(
          evidence.financialApproval,
        ).sourceSnapshotHash;
        if (
          expectedSnapshotHash &&
          expectedSnapshotHash !==
            canonicalApprovedPricingHash(financial!.sourceSnapshot)
        )
          throw new SalesInvoiceError(
            "نسخه مالی ثبت‌شده با شاهد قیمت مصوب مطابقت ندارد.",
          );
        const customer = record(evidence.customer);
        if (customer.id && customer.id !== loading.customerId)
          throw new SalesInvoiceError("مشتری قیمت مصوب با بارگیری یکسان نیست.");
        counterparties.add(loading.customerId);
        result.counterparty = result.customerName;
        versions.get(pricing.contractId).financialSnapshot = record(
          financial!.sourceSnapshot,
        );
      }
    }
    const currentLines: InvoiceLine[] = [];
    for (const line of priced.lines) {
      const allocationLine = revision.lines.find(
        (l) => l.id === line.allocationRevisionLineId,
      );
      if (!allocationLine)
        throw new SalesInvoiceError(
          "ردیف قیمت‌گذاری‌شده در بارگیری وجود ندارد.",
        );
      const lineSnapshot = record(allocationLine.snapshot),
        row = record(lineSnapshot.row);
      const partner = priced.sourceKind === "PARTNER_CASE";
      const contractId = "contractId" in line ? line.contractId : "PARTNER";
      const version = versions.get(contractId);
      const source = partner
        ? record(version?.preparation)
        : record(version?.financialSnapshot);
      const products = partner
        ? version.items
        : record(source.contractData).products;
      const product = record(
        Array.isArray(products)
          ? products.find(
              (p: any) => (p.productRowId || p.rowId) === line.productRowId,
            )
          : null,
      );
      const evidence = record(version?.sourceEvidence);
      const technical = partner
        ? product
        : restoreLongitudinalCustomerRequest(product);
      const details: string[] =
        partner && Array.isArray(product.details) ? product.details : [];
      for (const operation of [
        ...(technical.tools || []),
        ...(technical.appliedSubServices || []),
        ...(technical.finishings || []),
      ]) {
        const op = record(operation);
        const label =
          op.namePersian ||
          op.name ||
          record(op.subService).namePersian ||
          record(op.subService).name;
        if (label) details.push(String(label));
      }
      for (const cut of technical.cuttingBreakdown || [])
        details.push(record(cut).type === "cross" ? "برش عرضی" : "برش طولی");
      if (technical.finishingName)
        details.push(`پرداخت سنگ: ${technical.finishingName}`);
      if (technical.description) details.push(String(technical.description));
      currentLines.push({
        key: line.allocationRevisionLineId,
        contractNumber: String(
          evidence.contractNumber ||
            lineSnapshot.contractNumber ||
            version?.caseNumber ||
            source.internalRecordId ||
            loading.partnerCaseId ||
            "",
        ),
        project: String(
          record(evidence.project).projectName ||
            record(evidence.project).name ||
            version?.project ||
            record(frozenLoading.project).name ||
            frozenLoading.destination ||
            "",
        ),
        productRowId: line.productRowId,
        contractRowNumber: Array.isArray(products) ? products.findIndex((p: any) => (p.productRowId || p.rowId) === line.productRowId) + 1 || undefined : undefined,
        code: String(
          technical.stoneCode || technical.productCode || row.productCode || "",
        ),
        label: nonempty(
          technical.stoneName ||
            technical.name ||
            (partner ? technical.description : undefined) ||
            row.description ||
            lineSnapshot.productName ||
            lineSnapshot.label,
          "شرح محصول",
        ),
        length:
          technical.length != null
            ? amount(String(technical.length))
                .div(technical.lengthUnit === "cm" ? 100 : 1)
                .toFixed()
            : String(technical.lengthMeters ?? ""),
        width:
          technical.width != null
            ? amount(String(technical.width))
                .div(technical.widthUnit === "m" ? 1 : 100)
                .toFixed()
            : String(technical.widthMeters ?? ""),
        details: [...new Set(details)],
        quantity: line.quantity,
        unit: line.unit,
        grossAmount: line.grossAmount,
        discountAmount: line.discountAmount,
        netAmount: line.netAmount,
        driverId: revision.queueTurnId,
      });
    }
    const correctionHashes: string[] = [];
    for (const correction of waybill.dispatchCorrections
      .filter((c) => c.status === "POSTED")
      .sort(
        (a, b) =>
          a.postedAt!.getTime() - b.postedAt!.getTime() ||
          a.id.localeCompare(b.id),
      )) {
      const adjustment =
        correction.statementAdjustment || correction.salesInvoiceCorrection;
      if (!adjustment)
        throw new SalesInvoiceError(
          "شاهد مبلغ اصلاح ارسال هنوز صادر نشده است.",
        );
      const adjustmentSnapshot =
        adjustment.snapshot as unknown as StatementAdjustmentSnapshot;
      if (
        adjustmentSnapshot.waybillId !== waybill.id ||
        adjustmentSnapshot.correctionId !== correction.id ||
        adjustmentSnapshot.adjustmentId !== adjustment.id ||
        adjustmentSnapshot.currency !== priced.currency ||
        adjustmentSnapshot.correctionIntegrityHash !== correction.integrityHash
      ) {
        throw new SalesInvoiceError(
          "شاهد مبلغ اصلاح به همین بارنامه و اصلاح ارسال تعلق ندارد.",
        );
      }
      statementAdjustmentPriorEvents({
        snapshot: adjustmentSnapshot,
        integrityHash: adjustment.integrityHash,
      });
      correctionHashes.push(adjustment.integrityHash);
      for (const delta of adjustmentSnapshot.lines) {
        const target = currentLines.find(
          (l) =>
            l.productRowId === delta.productRowId &&
            revision.lines.find((r) => r.id === l.key)?.sourceContractId ===
              delta.contractId,
        );
        if (!target || target.unit !== delta.unit)
          throw new SalesInvoiceError("اصلاح ارسال با ردیف مبدأ مطابقت ندارد.");
        target.quantity = exactQuantityText(
          amount(target.quantity).add(delta.quantityDelta),
        );
        target.grossAmount = amount(target.grossAmount)
          .add(delta.grossAmountDelta)
          .toFixed(12);
        target.discountAmount = amount(target.discountAmount)
          .add(delta.discountDelta)
          .toFixed(12);
        target.netAmount = amount(target.netAmount)
          .add(delta.netAmountDelta)
          .toFixed(12);
      }
    }
    for (const line of currentLines) {
      if (
        amount(line.quantity).lt(0) ||
        amount(line.netAmount).lt(0) ||
        !amount(line.grossAmount).sub(line.discountAmount).eq(line.netAmount)
      )
        throw new SalesInvoiceError(
          "مقدار یا مبلغ نهایی اصلاح‌شده ناسازگار است.",
        );
      result.grossAmount = amount(result.grossAmount)
        .add(line.grossAmount)
        .toFixed(12);
      result.discountAmount = amount(result.discountAmount)
        .add(line.discountAmount)
        .toFixed(12);
      result.netAmount = amount(result.netAmount)
        .add(line.netAmount)
        .toFixed(12);
    }
    result.lines.push(...currentLines);
    result.evidence.push({
      revisionId: revision.id,
      waybillId: waybill.id,
      allocationHash: revision.integrityHash,
      waybillHash: waybill.integrityHash,
      financialRecordIds: financialIds.sort(),
      pricing: priced.pricingVersions,
      corrections: correctionHashes,
    });
  }
  if (counterparties.size !== 1)
    throw new SalesInvoiceError(
      "فاکتور باید متعلق به یک مشتری و یک طرف‌حساب باشد.",
    );
  return result;
}
