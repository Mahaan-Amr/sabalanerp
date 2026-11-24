import { Prisma } from "@prisma/client";
import { canonicalHash } from "@sabalanerp/partner-sales-contracts";
import { historicalServicePrintData } from "./historicalServices";
import { projectLoadedServiceRows, type ServiceQuantityBasis } from "./serviceQuantities";
import { projectLoadedMaterialRows } from "./materialQuantities";
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
import { readDispatchContractPrintSources, type DispatchContractContact } from "../dispatchDocuments/contractPrintSource";
import { createDispatchProductRows, type DispatchProductPrintRow, restoreLongitudinalCustomerRequest } from "../../utils/printTemplate";

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
// Print data is frozen with the PDF without changing the preexisting
// accounting source hash or the validity of previously issued invoices.
export const invoiceSourceHash = ({ print: _print, ...source }: InvoiceSource) => sourceHash(source);
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
  print?: {
    contacts: DispatchContractContact[];
    rows: Record<string, DispatchProductPrintRow[]>;
    contractedGross: Record<string, string>;
    loadedPieceCounts?: Record<string, string>;
  };
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
  includePrint = false,
): Promise<InvoiceSource> {
  try {
    return await buildInvoiceSource(tx, loadingId, includePrint);
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
/** Reconstruct presentation from the exact issued bindings, even after replacement or void.
 * This path has no authority to issue, validate cargo or change stored evidence. */
export async function readIssuedInvoicePrint(tx: Prisma.TransactionClient, issued: InvoiceSource) {
  try {
    return (await buildInvoiceSource(tx, issued.loadingId, true, issued)).print;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return undefined;
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) throw error;
    if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError || error instanceof RangeError) throw error;
    // Domain readers use ordinary Error for failed evidence verification.
    // Programming errors and database failures must remain visible to operators.
    if (!(error instanceof Error)) throw error;
    return undefined;
  }
}
async function buildInvoiceSource(
  tx: Prisma.TransactionClient,
  loadingId: string,
  includePrint: boolean,
  issued?: InvoiceSource,
): Promise<InvoiceSource> {
  const loading = await tx.logisticsLoading.findUnique({
    where: { id: loadingId },
    include: {
      canonicalAllocationRevisions: {
        ...(issued ? { where: { id: { in: issued.evidence.map(item => item.revisionId) } } } : {}),
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
  if (!issued && loading.status !== "FINALIZED")
    throw new SalesInvoiceError("بارگیری باید نهایی‌شده و فعال باشد.");
  const revisions = [
    ...new Map(
      loading.canonicalAllocationRevisions
        .slice()
        .reverse()
        .map((r) => [r.queueTurnId, r]),
    ).values(),
  ].sort((a, b) => a.queueTurnId.localeCompare(b.queueTurnId));
  if (!revisions.length || (issued && revisions.length !== issued.evidence.length))
    throw new SalesInvoiceError(
      "نسخه نهایی و قیمت‌گذاری‌شده بارگیری موجود نیست.",
    );
  const result: InvoiceSource = {
    schemaVersion: 1,
    loadingId,
    loadingNumber: loading.loadingNumber,
    customerId: (issued?.customerId ?? loading.customerId),
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
  const print = includePrint ? { contacts: new Map<string, DispatchContractContact>(),
    rows: Object.create(null) as Record<string, DispatchProductPrintRow[]>,
    contractedGross: Object.create(null) as Record<string, string>,
    loadedPieceCounts: Object.create(null) as Record<string, string> } : undefined;
  if (print && !issued) {
    const contractIds = revisions.flatMap(revision => revision.lines.flatMap(
      line => line.sourceContractId ? [line.sourceContractId] : [],
    ));
    if (loading.partnerCaseId) {
      const linked = await tx.partnerSaleCase.findUnique({ where: { id: loading.partnerCaseId },
        select: { customerContractId: true } });
      if (linked?.customerContractId) contractIds.push(linked.customerContractId);
    }
    const saved = await readDispatchContractPrintSources(tx, contractIds);
    for (const [id, contract] of saved) print.contacts.set(id, contract.contact);
  }
  const counterparties = new Set<string>();
  for (const revision of revisions) {
    const candidate = revision.candidate;
    const issuedEvidence = issued?.evidence.find(item => item.revisionId === revision.id);
    const waybill = candidate?.waybills.find((w) => issuedEvidence ? w.id === issuedEvidence.waybillId : w.status !== "VOIDED");
    if (issued && (!issuedEvidence || issuedEvidence.allocationHash !== revision.integrityHash ||
        issuedEvidence.waybillHash !== waybill?.integrityHash)) throw new SalesInvoiceError('شواهد تاریخی تخصیص مطابقت ندارد.');
    if (
      !candidate ||
      (!issued && candidate.status !== "ACCEPTED") ||
      !revision.sealedAt ||
      !waybill
    ) {
      throw new SalesInvoiceError(
        "تأیید حسابداری و بارنامه معتبر همه راننده‌های این بارگیری باید کامل شود.",
      );
    }
    if (!issued && waybill.dispatchCorrections.some((c) => c.status !== "POSTED"))
      throw new SalesInvoiceError("گردش اصلاح ارسال هنوز کامل نشده است.");
    if (
      !issued && (await assessBoundAllocationPricingFreshness(tx, revision.id)).status !==
      "CURRENT"
    )
      throw new SalesInvoiceError(
        "قیمت تأییدشده بارگیری تغییر کرده؛ ابتدا اصلاح ارسال را تکمیل کنید.",
      );
    const priced = await readBoundPricedAllocation(tx, revision.id, { includeQuantityBasis: includePrint });
    if (issuedEvidence && sourceHash(priced.pricingVersions) !== sourceHash(issuedEvidence.pricing))
      throw new SalesInvoiceError('نسخه قیمت تاریخی مطابقت ندارد.');
    if (result.currency && result.currency !== priced.currency)
      throw new SalesInvoiceError("ارز اقلام فاکتور یکسان نیست.");
    result.currency = priced.currency;
    const snapshot = record(revision.snapshot),
      frozenLoading = record(snapshot.loading);
    if (String(record(frozenLoading.customer).id) !== (issued?.customerId ?? loading.customerId))
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
      plate: record(snapshot.queueTurn).driverSource === "PERSONAL_PICKUP" ? "—" : nonempty(
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
      if (issuedEvidence && !issuedEvidence.financialRecordIds.includes(financialId))
        throw new SalesInvoiceError('سند مالی تاریخی مطابقت ندارد.');
      if (!financial || (!issued && !validFinancialRecord(financial)))
        throw new SalesInvoiceError("رکورد مالی مبدأ معتبر و تأییدشده نیست.");
      financialIds.push(financialId);
      if ("caseId" in pricing) {
        const preparation = record(
          record(financial!.sourceSnapshot).partnerPreparation ||
            financial!.sourceSnapshot,
        );
        if (issued) {
          const { owner, evidenceHash, ...preparedEvidence } = preparation;
          const verifiedHash = await canonicalHash({ schemaVersion: 1, purpose: 'PARTNER_ACCOUNTING_SOURCE', ...preparedEvidence });
          const readinessHash = await canonicalHash({ schemaVersion: 1, purpose: 'PARTNER_SHIPMENT_PRICING_READY',
            owner, internalRecordId: preparation.internalRecordId, invoiceRecordId: financialId,
            financialApprovalEvidenceId: pricing.financialApprovalEvidenceId, preparationEvidenceHash: evidenceHash });
          if (verifiedHash !== evidenceHash || readinessHash !== pricing.readinessEvidenceHash)
            throw new SalesInvoiceError('شاهد مالی تاریخی همکار مطابقت ندارد.');
        }
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
            financial!.customerId !== (issued?.customerId ?? loading.customerId))
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
        if (issued && !expectedSnapshotHash)
          throw new SalesInvoiceError('شاهد نسخه مالی تاریخی موجود نیست.');
        if (
          expectedSnapshotHash &&
          expectedSnapshotHash !==
            canonicalApprovedPricingHash(financial!.sourceSnapshot)
        )
          throw new SalesInvoiceError(
            "نسخه مالی ثبت‌شده با شاهد قیمت مصوب مطابقت ندارد.",
          );
        const customer = record(evidence.customer);
        if (customer.id && customer.id !== (issued?.customerId ?? loading.customerId))
          throw new SalesInvoiceError("مشتری قیمت مصوب با بارگیری یکسان نیست.");
        counterparties.add((issued?.customerId ?? loading.customerId));
        result.counterparty = result.customerName;
        versions.get(pricing.contractId).financialSnapshotCurrency = financial!.currency;
        versions.get(pricing.contractId).financialSnapshot = record(
          financial!.sourceSnapshot,
        );
      }
    }
    const currentLines: InvoiceLine[] = [];
    const materialProjection = new Map<string, { product: any; basis: typeof priced.lines[number]["quantityBasis"]; serviceBasis?: ServiceQuantityBasis }>();
    const siblingDispatchRows = new Set(priced.lines.map(line => line.productRowId));
    const contractRows = new Map<string, ReturnType<typeof createDispatchProductRows>>();
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
      if (print && issued && !issued.print?.contacts && !partner && !print.contacts.has(contractId)) {
        const data = record(source.contractData), project = record(data.project), customer = record(data.customer);
        const text = (...values: unknown[]) => values.find(value => typeof value === 'string' && value.trim()) as string || '';
        const savedLine = issued.lines.find(saved => saved.key === line.allocationRevisionLineId);
        print.contacts.set(contractId, {
          contractNumber: savedLine?.contractNumber || '', project: savedLine?.project || '',
          address: text(project.address), customerPhone: text(customer.phone, customer.mobile, customer.workNumber),
          manager: text(project.projectManagerName, project.managerName, customer.projectManagerName),
          managerPhone: text(project.projectManagerNumber, project.managerPhone, customer.projectManagerNumber),
        });
      }
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
      if (issued && !(product.productRowId || product.rowId))
        throw new SalesInvoiceError('جزئیات محصول تاریخی موجود نیست.');
      if (print) {
        if (typeof lineSnapshot.loadedPieceCount === 'string') {
          print.loadedPieceCounts[line.allocationRevisionLineId] = lineSnapshot.loadedPieceCount;
        }
        let projectRows = contractRows.get(contractId);
        if (partner) {
          projectRows = createDispatchProductRows({ products: [{ ...product,
            stoneCode: product.productCode, stoneName: product.description }] },
            { currency: priced.currency, partnerDetails: product.printDetails });
        } else if (!projectRows) {
          projectRows = createDispatchProductRows(await historicalServicePrintData(tx, source.contractData, priced.currency, source.currency || record(record(source.contractData).payment).currency || version?.financialSnapshotCurrency), { currency: priced.currency, siblingDispatchRows });
          contractRows.set(contractId, projectRows);
        }
        const approved = partner ? product.totalPrice : version?.rows?.find(
          (approvedRow: { productRowId: string }) => approvedRow.productRowId === line.productRowId,
        )?.canonicalAllInTotal;
        if (approved != null) {
          // Row totals still carry the frozen financial source currency. Compare
          // them with the approval in that same currency before allocating any
          // approved shipment amount; historical service rates are independent.
          const rowCurrency = partner ? priced.currency : source.currency || record(record(source.contractData).payment).currency || version?.financialSnapshotCurrency;
          const factor = (currency: string) => ['IRT', 'TOMAN', 'تومان'].includes(String(currency).trim().toUpperCase()) ? 10
            : ['IRR', 'RIAL', 'ریال'].includes(String(currency).trim().toUpperCase()) ? 1 : undefined;
          const from = factor(priced.currency), to = factor(rowCurrency);
          print.contractedGross[line.allocationRevisionLineId] = from && to
            ? amount(String(approved)).mul(from).div(to).toFixed() : rowCurrency ? '' : String(approved);
        }
        print.rows[line.allocationRevisionLineId] = projectRows(line.productRowId);
        const contractedQuantity = partner ? product.quantity : version?.rows?.find(
          (approvedRow: { productRowId: string }) => approvedRow.productRowId === line.productRowId,
        )?.contractedQuantity;
        materialProjection.set(line.allocationRevisionLineId, { product, basis: line.quantityBasis,
          serviceBasis: contractedQuantity != null ? {
            contractedQuantity: String(contractedQuantity), beforeQuantity: '0', afterQuantity: line.quantity,
          } : undefined });
      }
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
    for (const correction of (issued ? [] : waybill.dispatchCorrections)
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
        if (print?.loadedPieceCounts && !amount(delta.quantityDelta).isZero()) {
          delete print.loadedPieceCounts[target.key];
        }
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
      if (issued) {
        const frozenLine = issued.lines.find(saved => saved.key === line.key && saved.driverId === revision.queueTurnId);
        if (!frozenLine || frozenLine.productRowId !== line.productRowId || frozenLine.unit !== line.unit)
          throw new SalesInvoiceError('ردیف تاریخی تخصیص مطابقت ندارد.');
        if (line.quantity !== frozenLine.quantity && print?.loadedPieceCounts) delete print.loadedPieceCounts[line.key];
        Object.assign(line, frozenLine);
      }
      const projection = materialProjection.get(line.key);
      if (print && projection) {
        const basis = projection.basis ? { ...projection.basis,
          afterQuantity: amount(projection.basis.beforeQuantity).plus(line.quantity).toFixed() } : undefined;
        const serviceBasis = basis || (projection.serviceBasis ? {
          ...projection.serviceBasis, afterQuantity: line.quantity,
        } : undefined);
        print.rows[line.key] = projectLoadedServiceRows(
          projectLoadedMaterialRows(print.rows[line.key], projection.product, line, basis), projection.product, serviceBasis,
        );
      }
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
  if (issued && (result.lines.length !== issued.lines.length || result.currency !== issued.currency))
    throw new SalesInvoiceError('ردیف‌های تاریخی کامل نیستند.');
  if (print) result.print = { ...print, contacts: issued?.print?.contacts ?? [...print.contacts.values()] };
  return result;
}
