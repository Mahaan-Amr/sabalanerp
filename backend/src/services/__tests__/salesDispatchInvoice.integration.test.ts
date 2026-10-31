import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createSalesInvoiceService,
  assertLoadingSalesInvoice,
} from "../salesDispatchInvoice/service";
import {
  readInvoiceSource,
  sourceHash,
  bytesHash,
  SalesInvoiceError,
} from "../salesDispatchInvoice/source";
import { renderSalesInvoice } from "../salesDispatchInvoice/render";
import { freezeSalesInvoiceCorrection } from "../salesDispatchInvoice/correction";
import {
  approvedPricingRowIntegrityHash,
  approvedPricingVersionIntegrityHash,
  canonicalApprovedPricingHash,
} from "../approvedPricing/domain";
import { pricedAllocationIntegrityHash } from "../pricedAllocationLedger";

// Explicit local URL only; the harness rolls back every business row and never consumes the real invoice sequence.
const url = process.env.DATABASE_URL;
if (
  !url ||
  new URL(url).hostname !== "127.0.0.1" ||
  new URL(url).port !== "55432"
)
  throw new Error(
    "Use the existing sabalanerp-local database at 127.0.0.1:55432.",
  );
const db = new PrismaClient(),
  rollback = Symbol("invoice-test-rollback");
const json = (v: unknown) => v as Prisma.InputJsonValue;
async function run() {
  const before = await db.salesDispatchInvoice.count();
  try {
    await db.$transaction(
      async (tx) => {
        const actor = await tx.user.create({
          data: {
            email: `invoice-${randomUUID()}@example.invalid`,
            username: randomUUID(),
            password: "test-not-login",
            firstName: "آزمون",
            lastName: "فاکتور",
            role: "ADMIN",
            isActive: true,
          },
        });
        const customer = await tx.crmCustomer.findFirstOrThrow();
        const template = await tx.salesContract.findFirstOrThrow({
          include: { items: { take: 1 } },
        });
        const product =
          template.items[0] || (await tx.contractItem.findFirstOrThrow());
        const project = await tx.projectAddress.create({
          data: {
            customerId: customer.id,
            projectName: "پروژه آزمون فاکتور",
            address: "نشانی فرضی",
          },
        });
        const loading = await tx.logisticsLoading.create({
          data: {
            loadingNumber: `INVOICE-TEST-${randomUUID()}`,
            customerId: customer.id,
            projectId: project.id,
            status: "FINALIZED",
            createdBy: actor.id,
          },
        });
        const batch = await tx.logisticsAllocationBatch.create({
          data: {
            loadingId: loading.id,
            idempotencyKey: randomUUID(),
            finalizedBy: actor.id,
          },
        });
        const financeIds: string[] = [];
        const candidates: string[] = [];
        for (let index = 0; index < 2; index++) {
          const rowId = randomUUID(),
            contractId = randomUUID(),
            versionId = randomUUID(),
            itemId = randomUUID();
          const sourceSnapshot = {
            customerId: customer.id,
            contractData: {
              products: [
                {
                  rowId,
                  stoneName: `سنگ مصوب ${index}`,
                  length: "1.2",
                  lengthUnit: "m",
                  width: "40",
                  widthUnit: "cm",
                  description: "ابزار نیم‌لول؛ ساب براق",
                },
              ],
            },
          };
          const contract = await tx.salesContract.create({
            data: {
              id: contractId,
              contractNumber: `IT-${randomUUID()}`,
              title: "invoice test",
              titlePersian: "آزمون",
              content: "آزمون",
              customerId: customer.id,
              departmentId: template.departmentId,
              createdBy: actor.id,
              responsibleSellerId: actor.id,
              currency: "TOMAN",
              totalAmount: 24,
              contractData: json(sourceSnapshot.contractData),
            },
          });
          await tx.contractItem.create({
            data: {
              id: itemId,
              contractId,
              productId: product.productId,
              productRowId: rowId,
              quantity: 3,
              unitPrice: 10,
              totalPrice: 30,
            },
          });
          const finance = await tx.accountingFinancialRecord.create({
            data: {
              kind: "INVOICE_CANDIDATE",
              sourceKind: "SALES_CONTRACT",
              contractId,
              customerId: customer.id,
              status: "ISSUED",
              amount: 24,
              currency: "TOMAN",
              createdBy: actor.id,
              financiallyApprovedAt: new Date(),
              financiallyApprovedBy: actor.id,
              sourceSnapshot: json(sourceSnapshot),
            },
          });
          financeIds.push(finance.id);
          const rowPayload = {
            versionId,
            contractId,
            sourceFinancialRecordId: finance.id,
            versionNumber: 1,
            contractItemId: itemId,
            productRowId: rowId,
            ordinal: 1,
            contractedQuantity: "3",
            unit: "m2",
            canonicalAllInTotal: "30.000000000000",
            discountEligible: true,
            componentEvidence: {
              base: "30.000000000000",
              discountBasis: "30.000000000000",
            },
          };
          const rowHash = approvedPricingRowIntegrityHash(rowPayload);
          const sourceEvidence = {
            contractNumber: contract.contractNumber,
            customer: { id: customer.id },
            project: { projectName: `پروژه ${index}` },
            financialApproval: {
              sourceSnapshotHash: canonicalApprovedPricingHash(sourceSnapshot),
            },
          };
          const root = {
            id: versionId,
            contractId,
            versionNumber: 1,
            sourceFinancialRecordId: finance.id,
            approvedAt: new Date(),
            approvedBy: actor.id,
            schemaVersion: 1,
            currency: "TOMAN",
            grossAmount: "30.000000000000",
            discountAmount: "6.000000000000",
            netAmount: "24.000000000000",
            sourceEvidence,
            rowHashes: [rowHash],
          };
          const { rowHashes, ...rootData } = root;
          const version = await tx.contractApprovedPricingVersion.create({
            data: {
              ...rootData,
              sourceEvidence: json(sourceEvidence),
              origin: "FINANCIAL_APPROVAL",
              integrityHash: approvedPricingVersionIntegrityHash(root),
            },
          });
          const {
            versionId: _v,
            sourceFinancialRecordId: _f,
            versionNumber: _n,
            contractId: _c,
            ...rowData
          } = rowPayload;
          const pricingRow = await tx.contractApprovedPricingRow.create({
            data: {
              ...rowData,
              pricingVersionId: version.id,
              linkedContractItemId: itemId,
              integrityHash: rowHash,
            },
          });
          await tx.contractApprovedPricingHead.create({
            data: {
              contractId,
              currentVersionId: version.id,
              advancedAt: new Date(),
              advancedBy: actor.id,
            },
          });
          const admission = {
            driver: { firstName: "راننده", lastName: String(index) },
            plate: { plate: `۱۲-${index}-۳۴۵` },
          };
          const driver = await tx.externalDriver.create({
            data: {
              firstName: "آزمون",
              lastName: "راننده",
              nationalCode: String(Math.floor(Math.random() * 1e10)).padStart(
                10,
                "0",
              ),
              phone: "09120000000",
              statusRecordedBy: actor.id,
              createdBy: actor.id,
            },
          });
          const vehicle = await tx.externalVehicle.create({
            data: {
              vehicleType: "آزمون",
              statusRecordedBy: actor.id,
              createdBy: actor.id,
            },
          });
          const turn = await tx.guardDriverQueueTurn.create({
            data: {
              driverSource: "EXTERNAL",
              externalDriverId: driver.id,
              externalVehicleId: vehicle.id,
              status: "LOADING_FINALIZED",
              admittedBy: actor.id,
              admissionSnapshot: json(admission),
              integrityHash: randomUUID(),
              loadingId: loading.id,
            },
          });
          const snapshot = {
            loading: {
              id: loading.id,
              number: loading.loadingNumber,
              customer: { id: customer.id, name: "مشتری آزمون" },
              project: { name: `پروژه ${index}` },
            },
            queueTurn: { admissionSnapshot: admission },
          };
          const revision = await tx.logisticsAllocationRevision.create({
            data: {
              batchId: batch.id,
              loadingId: loading.id,
              queueTurnId: turn.id,
              revisionNumber: 1,
              snapshot: json(snapshot),
              integrityHash: randomUUID(),
              finalizedBy: actor.id,
            },
          });
          const revisionLine = await tx.logisticsAllocationRevisionLine.create({
            data: {
              revisionId: revision.id,
              sourceContractId: contractId,
              sourceContractItemId: itemId,
              productId: product.productId,
              productRowId: rowId,
              quantity: "1.25",
              unit: "m2",
              snapshot: json({
                contractNumber: contract.contractNumber,
                productName: "نام قدیمی کاتالوگ",
              }),
              integrityHash: randomUUID(),
            },
          });
          await tx.logisticsAllocationRevisionPricing.create({
            data: {
              allocationRevisionId: revision.id,
              contractId,
              pricingVersionId: version.id,
              expectedPricingHash: version.integrityHash,
              readinessEvidenceHash: sourceHash(randomUUID()),
            },
          });
          const payload = {
            allocationRevisionId: revision.id,
            allocationRevisionLineId: revisionLine.id,
            pricingVersionId: version.id,
            pricingRowId: pricingRow.id,
            quantity: "1.250",
            grossAmount: "12.500000000000",
            discountAmount: "2.500000000000",
            netAmount: "10.000000000000",
            consumesFinalRemainder: false,
            evidence: { ledgerSequence: 1 },
            recordedBy: actor.id,
          };
          await tx.dispatchPricedAllocationEvent.create({
            data: {
              ...payload,
              integrityHash: pricedAllocationIntegrityHash(payload),
            },
          });
          await tx.logisticsAllocationRevision.update({
            where: { id: revision.id },
            data: { sealedAt: new Date() },
          });
          const candidate = await tx.accountingDispatchCandidate.create({
            data: { allocationRevisionId: revision.id, status: "ACCEPTED" },
          });
          candidates.push(candidate.id);
          await tx.accountingDispatchWaybill.create({
            data: {
              number: BigInt(
                900000 + index + Math.floor(Math.random() * 100000),
              ),
              candidateId: candidate.id,
              snapshot: json(snapshot),
              integrityHash: randomUUID(),
              issuedBy: actor.id,
            },
          });
        }
        let fakeNumber =
          BigInt(1000000) + BigInt(Math.floor(Math.random() * 1000000));
        const client = new Proxy(tx, {
          get(target, key, receiver) {
            if (key === "$transaction") return async (work: any) => work(tx);
            if (key === "$queryRaw")
              return async (query: TemplateStringsArray, ...params: any[]) =>
                query
                  .join("")
                  .includes("nextval('sales_dispatch_invoice_number_seq')")
                  ? [{ number: fakeNumber++ }]
                  : (tx.$queryRaw as any)(query, ...params);
            return Reflect.get(target, key, receiver);
          },
        }) as unknown as PrismaClient;
        // Each nested command uses this outer rollback transaction, including number allocation.
        const wrapped = new Proxy(client, {
          get(target, key, receiver) {
            if (key === "$transaction")
              return async (work: any) => work(client);
            return Reflect.get(target, key, receiver);
          },
        });
        const service = createSalesInvoiceService(
          wrapped,
          async (snapshot, reason) =>
            Buffer.from(renderSalesInvoice(snapshot, reason)),
        );
        const ctx = { actorId: actor.id, workspace: "accounting" as const };
        await assert.rejects(
          () => assertLoadingSalesInvoice(tx, loading.id),
          /هنوز صادر نشده/,
        );
        const source = await readInvoiceSource(tx, loading.id);
        assert.equal(source.lines.length, 2);
        assert.equal(source.drivers.length, 2);
        assert.equal(source.grossAmount, "25.000000000000");
        assert.equal(source.netAmount, "20.000000000000");
        assert.equal(source.lines[0].width, "0.4");
        assert.match(source.lines[0].label, /سنگ مصوب/);
        const financialCount = await tx.accountingFinancialRecord.count();
        const issued = await service.issue(ctx, loading.id, "same-key");
        assert.deepEqual(
          await service.issue(ctx, loading.id, "same-key"),
          issued,
        );
        assert.deepEqual(
          await service.issue(ctx, loading.id, "another-key"),
          issued,
        );
        assert.equal(
          await tx.accountingFinancialRecord.count(),
          financialCount,
          "PDF issuance never creates financial records",
        );
        assert.equal(
          await assertLoadingSalesInvoice(tx, loading.id),
          issued.id,
        );
        const first = await service.download(ctx, loading.id, issued.id),
          second = await service.download(ctx, loading.id, issued.id);
        assert.equal(bytesHash(first.bytes), bytesHash(second.bytes));
        assert.equal(
          (await service.list(ctx, loading.id)).invoices[0].status,
          "ISSUED",
        );
        await assert.rejects(
          () =>
            service.issue(
              { ...ctx, workspace: "logistics" },
              loading.id,
              "malicious",
            ),
          (e) => e instanceof SalesInvoiceError && e.status === 403,
        );
        await tx.$executeRawUnsafe("SAVEPOINT invoice_mutation");
        await tx.$executeRawUnsafe("SAVEPOINT invoice_partner");
        await tx.partnerProfile.create({ data: { userId: actor.id } });
        await assert.rejects(
          () => service.list(ctx, loading.id),
          (error) => error instanceof SalesInvoiceError && error.status === 403,
        );
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invoice_partner");
        await assert.rejects(
          () =>
            tx.salesDispatchInvoice.update({
              where: { id: issued.id },
              data: { sourceHash: "tampered" },
            }),
          /immutable/,
        );
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invoice_mutation");
        await tx.$executeRawUnsafe("SAVEPOINT invoice_candidate");
        await tx.accountingDispatchCandidate.update({
          where: { id: candidates[1] },
          data: { status: "PENDING" },
        });
        await assert.rejects(
          () => assertLoadingSalesInvoice(tx, loading.id),
          /تأیید حسابداری/,
        );
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invoice_candidate");
        await service.void(ctx, loading.id, issued.id, "اصلاح سند آزمایشی");
        await assert.rejects(
          () => assertLoadingSalesInvoice(tx, loading.id),
          /هنوز صادر نشده/,
        );
        assert.match(
          Buffer.from(
            (await service.download(ctx, loading.id, issued.id)).bytes,
          ).toString(),
          /باطل‌شده/,
        );
        const replacement = await service.issue(ctx, loading.id, "replacement");
        assert.notEqual(replacement.number, issued.number);
        assert.equal(
          (
            await tx.salesDispatchInvoice.findUniqueOrThrow({
              where: { id: replacement.id },
            })
          ).replacesId,
          issued.id,
        );
        const waybill = await tx.accountingDispatchWaybill.findFirstOrThrow({
          where: { candidateId: candidates[0] },
          include: {
            candidate: {
              include: { allocationRevision: { include: { lines: true } } },
            },
          },
        });
        const originalLine = waybill.candidate.allocationRevision.lines[0];
        const correction = await tx.dispatchCorrection.create({
          data: {
            waybillId: waybill.id,
            status: "DRAFT",
            reason: "اصلاح مقدار تأییدشده آزمون",
            effectiveAt: new Date(),
            createdBy: actor.id,
            postedBy: actor.id,
            postedAt: new Date(),
            integrityHash: sourceHash(randomUUID()),
            lines: {
              create: {
                contractId: originalLine.sourceContractId!,
                contractItemId: originalLine.sourceContractItemId!,
                productRowId: originalLine.productRowId,
                unit: originalLine.unit,
                quantity: "-0.25",
              },
            },
          },
        });
        await tx.dispatchCorrection.update({
          where: { id: correction.id },
          data: { status: "POSTED" },
        });
        const correctionPrice = await freezeSalesInvoiceCorrection(
          tx,
          correction.id,
          actor.id,
        );
        assert.ok(
          correctionPrice,
          "posted correction gets immutable invoice pricing without activating shipment statements",
        );
        assert.equal(
          await freezeSalesInvoiceCorrection(tx, correction.id, actor.id),
          null,
        );
        const correctedSource = await readInvoiceSource(tx, loading.id);
        assert.equal(correctedSource.netAmount, "18.000000000000");
        assert.equal(
          (await service.list(ctx, loading.id)).invoices[0].status,
          "INVALIDATED",
        );
        await service.void(
          ctx,
          loading.id,
          replacement.id,
          "اصلاح مقدار بارگیری",
        );
        const correctedInvoice = await service.issue(
          ctx,
          loading.id,
          "after-posted-correction",
        );
        assert.notEqual(correctedInvoice.number, replacement.number);
        assert.equal(
          await tx.accountingFinancialRecord.count(),
          financialCount,
        );
        await tx.accountingFinancialRecord.update({
          where: { id: financeIds[0] },
          data: { status: "VOIDED" },
        });
        assert.equal(
          (await service.list(ctx, loading.id)).invoices[0].status,
          "INVALIDATED",
        );
        await assert.rejects(
          () => assertLoadingSalesInvoice(tx, loading.id),
          /رکورد مالی/,
        );
        assert.match(
          Buffer.from(
            (await service.download(ctx, loading.id, replacement.id)).bytes,
          ).toString(),
          /باطل‌شده/,
        );
        assert.equal(
          sourceHash(source),
          sourceHash(JSON.parse(JSON.stringify(source))),
        );
        throw rollback;
      },
      { timeout: 60000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(
    await db.salesDispatchInvoice.count(),
    before,
    "rollback leaves no invoices or business changes",
  );
  console.log(
    "sales dispatch invoice local integration: PASS (multi-contract, multi-driver, partial quantity, finance, history, permissions, gate, immutability, rollback)",
  );
}
run()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
