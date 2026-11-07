import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getEffectiveUserAccess } from "../effectiveAccessService";
import { resolveNarrowFeatureAccess } from "../narrowFeatureAccess";
import { createAuditedPartnerAuthorization } from "../partnerSales/authorization/audited";
import { authorizePartnerLoading } from "../partnerSales/fulfillment/loadingAuthority";
import { assertCanonicalDispatchCommandAllowed } from "../dispatchCutover";
import { dispatchDocumentLifecycleAuditEventHash } from "../dispatchDocuments/prismaRepository";
import { loadShipmentStatementRuntimeStateUnderLock } from "../dispatchDocuments/runtimeState";
import { isPostCutoverFinalization, isShipmentStatementFlowActive } from "../dispatchDocuments/featureGate";
import { verifyDispatchArtifactStorageUnderLock } from "../dispatchDocuments/artifactStorageLock";
import type { DispatchArtifactStorage } from "../dispatchDocuments/ports";
import { DispatchDocumentIntegrityError } from "../dispatchDocuments/service";
import { allocationPricingIntegrityVerifier } from "../dispatchDocuments/prismaSourceReader";
import { isRetryableDispatchTransactionError } from "../dispatchAllocation";
import { generatePdfBufferFromHtml } from "../../utils/pdf";
import {
  bytesHash,
  readInvoiceSource,
  SalesInvoiceError,
  sourceHash,
} from "./source";
import { renderSalesInvoice, type IssuedInvoiceSnapshot } from "./render";
export type InvoiceContext = {
  actorId: string;
  workspace: "accounting" | "logistics";
  requireDispatchDocumentGate?: boolean;
  expectedRevisionIds?: readonly string[];
};
const lock = async (tx: Prisma.TransactionClient, loadingId: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`SALES_INVOICE:${loadingId}`}))`;
};
async function authorize(
  tx: Prisma.TransactionClient,
  ctx: InvoiceContext,
  loadingId: string,
  write = false,
) {
  const loading = await tx.logisticsLoading.findUnique({
    where: { id: loadingId },
    select: { sourceKind: true, partnerCaseId: true },
  });
  if (!loading) throw new SalesInvoiceError("بارگیری پیدا نشد.", 404);
  // Price-bearing internal documents never inherit a Partner profile's operational grants.
  const actor = await tx.user.findUnique({
    where: { id: ctx.actorId },
    select: {
      id: true,
      role: true,
      isActive: true,
      partnerProfile: { select: { id: true } },
    },
  });
  if (
    !actor?.isActive ||
    actor.partnerProfile ||
    (write && ctx.workspace !== "accounting")
  )
    throw new SalesInvoiceError("دسترسی مجاز نیست.", 403);
  if (loading.partnerCaseId) {
    if (ctx.workspace === "accounting") {
      const result = await createAuditedPartnerAuthorization(
        tx,
        { actorId: ctx.actorId, purpose: "ACCOUNTING", channel: "API" },
        {
          correlationId: randomUUID(),
          reason: "دسترسی فاکتور فروش بارگیری همکار",
        },
      ).authorize(write ? "ACCOUNTING_WRITE" : "ACCOUNTING_READ", {
        kind: "CASE",
        id: loading.partnerCaseId,
      });
      if (!result.ok)
        throw new SalesInvoiceError("دسترسی پرونده همکار مجاز نیست.", 403);
    } else if (
      !(
        await authorizePartnerLoading(
          tx,
          { actorId: ctx.actorId, correlationId: randomUUID() },
          loading.partnerCaseId,
          "READ",
        )
      ).ok
    )
      throw new SalesInvoiceError("دسترسی بارگیری همکار مجاز نیست.", 403);
  } else {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${ctx.actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT revision FROM effective_authorization_state WHERE id=1 FOR UPDATE`;
  }
  const access = await getEffectiveUserAccess(tx, {
    userId: actor.id,
    userRole: actor.role,
  });
  const workspace = access.workspaces.find(
    (w) => w.workspace === ctx.workspace,
  )?.permission;
  const feature =
    ctx.workspace === "logistics"
      ? "logistics_loadings_view"
      : write
        ? "accounting_dispatch_candidates_manage"
        : "accounting_dispatch_candidates_view";
  if (
    !(write ? ["edit", "admin"] : ["view", "edit", "admin"]).includes(
      workspace || "",
    ) ||
    !(
      await resolveNarrowFeatureAccess(tx, {
        userId: actor.id,
        role: actor.role,
        workspace: ctx.workspace,
        feature,
        requiredPermission: write ? "edit" : "view",
      })
    ).allowed
  )
    throw new SalesInvoiceError("دسترسی مجاز نیست.", 403);
}
const transaction = async <T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) => {
  for (let attempt = 0; ; attempt++)
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60000,
        maxWait: 10000,
      });
    } catch (error) {
      const target =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.meta?.target
          : null;
      const invoiceRace =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        ((Array.isArray(target) && target.includes("loadingId")) ||
          (typeof target === "string" &&
            target.startsWith("sales_dispatch_invoices_")));
      const retry = invoiceRace || isRetryableDispatchTransactionError(error);
      if (!retry) throw error;
      if (attempt >= 2)
        throw new SalesInvoiceError(
          "اطلاعات فاکتور هم‌زمان تغییر کرد؛ تازه‌سازی کنید و دوباره تلاش کنید.",
        );
    }
};
const audit = async (
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
export function createSalesInvoiceService(
  db: PrismaClient,
  render = (snapshot: IssuedInvoiceSnapshot, reason?: string) =>
    generatePdfBufferFromHtml({
      htmlContent: renderSalesInvoice(snapshot, reason),
      displayHeaderFooter: false,
    }),
  documentStorage?: DispatchArtifactStorage,
) {
  return {
    list: async (ctx: InvoiceContext, loadingId: string) =>
      transaction(db, async (tx) => {
        await authorize(tx, ctx, loadingId);
        const rows = await tx.salesDispatchInvoice.findMany({
          where: { loadingId },
          orderBy: { number: "desc" },
          select: {
            id: true,
            number: true,
            sourceHash: true,
            issuedAt: true,
            voidedAt: true,
            voidReason: true,
            replacesId: true,
          },
        });
        let hash: string | null = null,
          reason: string | null = null;
        try {
          hash = sourceHash(await readInvoiceSource(tx, loadingId));
        } catch (error) {
          if (!(error instanceof SalesInvoiceError)) throw error;
          reason = error.message;
        }
        return {
          ready: Boolean(hash),
          blockedReason: reason,
          invoices: rows.map((row) => ({
            ...row,
            number: row.number.toString(),
            status: row.voidedAt
              ? "VOIDED"
              : row.sourceHash === hash
                ? "ISSUED"
                : "INVALIDATED",
            invalidReason:
              row.sourceHash === hash
                ? null
                : reason || "اقلام یا شواهد بارگیری تغییر کرده است.",
          })),
        };
      }),
    issue: async (ctx: InvoiceContext, loadingId: string, requestKey: string) =>
      transaction(db, async (tx) => {
        if (!requestKey?.trim() || requestKey.length > 200)
          throw new SalesInvoiceError("شناسه درخواست صدور معتبر نیست.", 400);
        await authorize(tx, ctx, loadingId, true);
        await assertCanonicalDispatchCommandAllowed(tx);
        await lock(tx, loadingId);
        if (ctx.requireDispatchDocumentGate) {
          const gate = await loadShipmentStatementRuntimeStateUnderLock(tx);
          if (!gate) throw new SalesInvoiceError('وضعیت گذار اسناد قابل بررسی نیست.');
          const revisions = await tx.logisticsAllocationRevision.findMany({ where: { loadingId },
            orderBy: [{ queueTurnId: 'asc' }, { revisionNumber: 'desc' }],
            select: { id: true, queueTurnId: true, sourceKind: true, finalizedAt: true, sealedAt: true,
              candidate: { select: { status: true, waybills: { where: { status: { in: ['ISSUED', 'EXIT_RECORDED'] } },
                select: { integrityHash: true, legacyReconstruction: { select: { allocationRevisionId: true, sourceIntegrityHash: true,
                  waybillIntegrityHash: true, pdfSha256: true, pdf: true } }, documentArtifacts: { where: { kind: { in: ['WAYBILL', 'STATEMENT'] } },
                  select: { kind: true, storageKey: true, byteLength: true, sha256: true } } } } } } } });
          const latest = new Map<string, typeof revisions[number]>();
          for (const revision of revisions) if (!latest.has(revision.queueTurnId)) latest.set(revision.queueTurnId, revision);
          if (!latest.size || [...latest.values()].some(revision => revision.sourceKind !== 'PARTNER_CASE' && gate?.cutoverAt &&
            isPostCutoverFinalization(revision.finalizedAt, gate.cutoverAt) && !isShipmentStatementFlowActive(process.env, gate))) {
            throw new SalesInvoiceError('مسیر صدور اسناد در حال حاضر فعال نیست؛ دوباره وضعیت بارگیری را بررسی کنید.');
          }
          const actualRevisionIds = [...latest.values()].map(revision => revision.id).sort();
          const expectedRevisionIds = [...(ctx.expectedRevisionIds ?? [])].sort();
          if (actualRevisionIds.length !== expectedRevisionIds.length ||
            actualRevisionIds.some((id, index) => id !== expectedRevisionIds[index])) {
            throw new SalesInvoiceError('تخصیص راننده‌ها تغییر کرده است؛ اطلاعات را دوباره بررسی کنید.');
          }
          const artifacts: Array<{ storageKey: string; byteLength: number; sha256: string }> = [];
          for (const revision of latest.values()) {
            const waybills = revision.candidate?.waybills ?? [];
            const documents = waybills[0]?.documentArtifacts ?? [];
            const waybill = waybills[0];
            const legacy = revision.sourceKind === 'SALES_CONTRACT' && (!gate?.cutoverAt || !isPostCutoverFinalization(revision.finalizedAt, gate.cutoverAt));
            const waybillDocuments = documents.filter(document => document.kind === 'WAYBILL');
            if (!revision.sealedAt || revision.candidate?.status !== 'ACCEPTED' || waybills.length !== 1) {
              throw new SalesInvoiceError('فایل‌های بارنامه یکی از راننده‌ها کامل نیست.');
            }
            if (legacy && waybill.legacyReconstruction && waybillDocuments.length === 0) {
              const reconstructed = waybill.legacyReconstruction;
              if (reconstructed.allocationRevisionId !== revision.id || reconstructed.waybillIntegrityHash !== waybill.integrityHash ||
                bytesHash(reconstructed.pdf) !== reconstructed.pdfSha256) throw new SalesInvoiceError('بارنامه بازسازی‌شده معتبر نیست.');
              const freshness = await allocationPricingIntegrityVerifier.assess({ transaction: tx, allocationRevisionId: revision.id,
                expectedSourceIntegrityHash: reconstructed.sourceIntegrityHash });
              if (freshness.status !== 'CURRENT') throw new SalesInvoiceError('شواهد قیمت بارگیری به بررسی نیاز دارند.');
            } else if (waybillDocuments.length !== 1 || (legacy && waybill.legacyReconstruction) ||
              (!legacy && documents.filter(document => document.kind === 'STATEMENT').length !== 1)) {
              throw new SalesInvoiceError('فایل‌های بارنامه یکی از راننده‌ها کامل نیست.');
            }
            for (const document of legacy ? waybillDocuments : documents) {
              const byteLength = Number(document.byteLength);
              if (!Number.isSafeInteger(byteLength) || byteLength < 1) throw new SalesInvoiceError('اندازه فایل سند معتبر نیست.');
              artifacts.push({ storageKey: document.storageKey, byteLength, sha256: document.sha256 });
            }
          }
          if (artifacts.length && !documentStorage) throw new SalesInvoiceError('بررسی فایل اسناد در دسترس نیست.');
          // The transaction holds the same storage-key locks used by publication
          // and removal until the invoice transaction commits.
          try {
            if (artifacts.length) await verifyDispatchArtifactStorageUnderLock({ transaction: tx, storage: documentStorage!, artifacts });
          } catch (error) {
            if (error instanceof DispatchDocumentIntegrityError) {
              throw new SalesInvoiceError('فایل بارنامه یا صورت‌حساب ناقص یا مخدوش است؛ ابتدا بازیابی اسناد را بررسی کنید.');
            }
            throw error;
          }
        }
        const replay = await tx.salesDispatchInvoice.findUnique({
          where: { loadingId_requestKey: { loadingId, requestKey } },
        });
        if (replay) return { id: replay.id, number: replay.number.toString() };
        const source = await readInvoiceSource(tx, loadingId),
          hash = sourceHash(source);
        const active = await tx.salesDispatchInvoice.findFirst({
          where: { loadingId, voidedAt: null },
        });
        if (active) {
          if (active.sourceHash !== hash)
            throw new SalesInvoiceError(
              "ابتدا فاکتور قبلی را با دلیل معتبر باطل کنید.",
            );
          return { id: active.id, number: active.number.toString() };
        }
        const predecessor = await tx.salesDispatchInvoice.findFirst({
          where: { loadingId },
          orderBy: { number: "desc" },
        });
        const [{ number }] = await tx.$queryRaw<
          Array<{ number: bigint }>
        >`SELECT nextval('sales_dispatch_invoice_number_seq') AS number`;
        const snapshot: IssuedInvoiceSnapshot = {
          ...source,
          number: number.toString(),
          issuedAt: new Date().toISOString(),
          replacesNumber: predecessor?.number.toString() ?? null,
        };
        const pdf = await render(snapshot),
          id = randomUUID();
        await tx.salesDispatchInvoice.create({
          data: {
            id,
            number,
            loadingId,
            requestKey,
            sourceHash: hash,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            pdf,
            pdfSha256: bytesHash(pdf),
            issuedAt: new Date(snapshot.issuedAt),
            issuedBy: ctx.actorId,
            replacesId: predecessor?.id,
          },
        });
        await audit(
          tx,
          id,
          "ISSUED",
          {
            loadingId,
            number: number.toString(),
            sourceHash: hash,
            pdfSha256: bytesHash(pdf),
            replacesId: predecessor?.id ?? null,
          },
          ctx.actorId,
        );
        return { id, number: number.toString() };
      }),
    void: async (
      ctx: InvoiceContext,
      loadingId: string,
      id: string,
      reason: string,
    ) =>
      transaction(db, async (tx) => {
        if (
          typeof reason !== "string" ||
          reason.trim().length < 3 ||
          reason.length > 2000
        )
          throw new SalesInvoiceError("دلیل ابطال را وارد کنید.", 400);
        await authorize(tx, ctx, loadingId, true);
        await lock(tx, loadingId);
        const invoice = await tx.salesDispatchInvoice.findFirst({
          where: { id, loadingId },
        });
        if (!invoice) throw new SalesInvoiceError("فاکتور پیدا نشد.", 404);
        if (invoice.voidedAt) return { id };
        const exited = await tx.logisticsAllocationRevision.findFirst({
          where: {
            loadingId,
            OR: [
              { physicalExit: { isNot: null } },
              { manualOutageExit: { status: "REGISTERED" } },
            ],
          },
        });
        if (exited) {
          const corrected = await readInvoiceSource(tx, loadingId);
          if (sourceHash(corrected) === invoice.sourceHash)
            throw new SalesInvoiceError(
              "پس از خروج، ابتدا گردش اصلاح ارسال را تکمیل کنید.",
            );
        }
        await tx.salesDispatchInvoice.update({
          where: { id },
          data: {
            voidedAt: new Date(),
            voidedBy: ctx.actorId,
            voidReason: reason.trim(),
          },
        });
        await audit(
          tx,
          id,
          "VOIDED",
          {
            loadingId,
            reason: reason.trim(),
            number: invoice.number.toString(),
          },
          ctx.actorId,
        );
        return { id };
      }),
    download: async (ctx: InvoiceContext, loadingId: string, id: string, requireCurrent = false) =>
      transaction(db, async (tx) => {
        await authorize(tx, ctx, loadingId);
        const invoice = await tx.salesDispatchInvoice.findFirst({
          where: { id, loadingId },
        });
        if (!invoice) throw new SalesInvoiceError("فاکتور پیدا نشد.", 404);
        if (bytesHash(invoice.pdf) !== invoice.pdfSha256)
          throw new SalesInvoiceError(
            "فایل فاکتور با شاهد ثبت‌شده مطابقت ندارد.",
          );
        let reason = invoice.voidReason;
        if (!reason)
          try {
            if (
              sourceHash(await readInvoiceSource(tx, loadingId)) !==
              invoice.sourceHash
            )
              reason = "شواهد بارگیری تغییر کرده است.";
          } catch (error) {
            if (!(error instanceof SalesInvoiceError)) throw error;
            reason = error.message;
          }
        if (requireCurrent && reason) throw new SalesInvoiceError('فاکتور فروش معتبر برای چاپ موجود نیست.');
        const bytes = reason
          ? await render(
              invoice.snapshot as unknown as IssuedInvoiceSnapshot,
              reason,
            )
          : invoice.pdf;
        await audit(
          tx,
          id,
          "DOWNLOADED",
          { loadingId, status: reason ? "VOIDED" : "ISSUED" },
          ctx.actorId,
        );
        return { bytes, number: invoice.number.toString() };
      }),
  };
}

/** Run inside the exit transaction. A whole-loading invoice supplements, never replaces, exit authority. */
export async function assertLoadingSalesInvoice(
  tx: Prisma.TransactionClient,
  loadingId: string,
  occurredAt?: Date,
) {
  await lock(tx, loadingId);
  const invoice = await tx.salesDispatchInvoice.findFirst({
    where: { loadingId, voidedAt: null },
  });
  if (!invoice)
    throw new SalesInvoiceError(
      "خروج مجاز نیست؛ فاکتور فروش کل بارگیری هنوز صادر نشده است.",
    );
  if (occurredAt && invoice.issuedAt > occurredAt)
    throw new SalesInvoiceError(
      "فاکتور فروش باید پیش از زمان واقعی خروج صادر شده باشد.",
    );
  const source = await readInvoiceSource(tx, loadingId);
  if (
    sourceHash(source) !== invoice.sourceHash ||
    bytesHash(invoice.pdf) !== invoice.pdfSha256
  )
    throw new SalesInvoiceError(
      "خروج مجاز نیست؛ فاکتور کل بارگیری معتبر نیست و به اصلاح حسابداری نیاز دارد.",
    );
  return invoice.id;
}
