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
import { PrismaDispatchDocumentSourceReader } from "../dispatchDocuments/prismaSourceReader";
import type { PublishedDispatchArtifact } from "../dispatchDocuments/contracts";
import { renderDispatchDocumentHtml } from "../../documents/dispatch/dispatchDocumentPdf";
import { renderSalesInvoice } from "../salesDispatchInvoice/render";
import { freezeSalesInvoiceCorrection } from "../salesDispatchInvoice/correction";
import { issueLoadingDocuments } from "../loadingDocumentIssuance";
import { assertDispatchDocumentsMigrationTarget } from "./dispatchDocumentsTemporaryDatabase";
import {
  approvedPricingRowIntegrityHash,
  approvedPricingVersionIntegrityHash,
  canonicalApprovedPricingHash,
} from "../approvedPricing/domain";
import { pricedAllocationIntegrityHash } from "../pricedAllocationLedger";

// Explicit local URL only; the harness rolls back every business row and never consumes the real invoice sequence.
const url = process.env.DATABASE_URL;
const target = url && new URL(url);
const candidateDatabaseName = process.env.SABALAN_CANDIDATE_QA_DATABASE_NAME;
if (!target || target.hostname !== "127.0.0.1" || target.port !== "55432")
  throw new Error(
    "Use the existing sabalanerp-local database at 127.0.0.1:55432.",
  );
if (candidateDatabaseName) assertDispatchDocumentsMigrationTarget(url, candidateDatabaseName);
else if (target.pathname !== '/sabalanerp') throw new Error('Only the existing local database or a verified candidate QA clone is allowed.');
const db = new PrismaClient(),
  rollback = Symbol("invoice-test-rollback");
const json = (v: unknown) => v as Prisma.InputJsonValue;
async function run() {
  const scenario = process.env.SABALAN_MATERIAL_SCENARIO || "partial";
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
            profile: { create: { phone: "09121234567" } },
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
          const quantity = index === 0 ? 90 : 100;
          const loaded = scenario === "full" ? String(quantity) : (scenario === "successive" || scenario === "remainder") ? "1" : index === 0 ? "70" : "30";
          const previouslyLoaded = scenario === "remainder" ? String(quantity - 1) : scenario === "successive" ? "1" : "0";
          const sourceSnapshot = {
            customerId: customer.id,
            contractData: {
              project: { projectName: `پروژه ${index}`, address: `نشانی ذخیره‌شدهٔ قرارداد ${index}`,
                projectManagerName: "مدیر آزمون", projectManagerNumber: "09120000000" },
              products: [
                {
                  rowId,
                  stoneName: `سنگ مصوب ${index}`,
                  productType: "stair",
                  quantity,
                  originalWidth: index === 0 ? 40 : 35,
                  originalLength: 1.2,
                  meta: { stair: { baseStoneQuantity: index === 0 ? 45 : 100, piecesPerStone: index === 0 ? 2 : 1, standardLength: { meters: 1.2 }, pricingSquareMeters: index === 0 ? 21.6 : 42 } },
                  length: "1.2",
                  lengthUnit: "m",
                  width: index === 0 ? "20" : "35",
                  widthUnit: "cm",
                  description: "شرح ذخیره‌شده",
                  originalTotalPrice: 13,
                  totalPrice: 30,
                  unitPrice: 11,
                  tools: [{ code: "TEST-TOOL", name: "ابزار نیم‌لول",
                    computedMeters: index === 1 ? 155 : 2, minimumQuantity: index === 1 ? 155 : 0, pricePerMeter: 4, totalPrice: 8 }],
                  cuttingBreakdown: [{ type: "longitudinal", meters: index === 0 ? 108 : 1, rate: 3, cost: 3 }],
                  finishingId: "test-finishing",
                  finishingName: "ساب آزمون",
                  finishingUnitPrice: 2,
                  finishingCost: 6,
                  squareMeters: index === 0 ? 21.6 : 42,
                },
              ],
            },
          };
          if (scenario === 'currency') {
            (sourceSnapshot as any).currency = 'IRR';
            for (const product of sourceSnapshot.contractData.products) {
              for (const field of ['originalTotalPrice', 'totalPrice', 'unitPrice', 'finishingUnitPrice', 'finishingCost'])
                (product as any)[field] *= 10;
              for (const tool of product.tools) { tool.pricePerMeter *= 10; tool.totalPrice *= 10; }
              for (const cut of product.cuttingBreakdown) { cut.rate *= 10; cut.cost *= 10; }
            }
          }
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
            contractedQuantity: String(quantity),
            unit: "count",
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
              revisionNumber: (scenario === "successive" || scenario === "remainder") ? 2 : 1,
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
              quantity: `${loaded}.000`,
              unit: "count",
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
          if ((scenario === "successive" || scenario === "remainder")) {
            const previousRevision = await tx.logisticsAllocationRevision.create({ data: {
              batchId: batch.id, loadingId: loading.id, queueTurnId: turn.id,
              revisionNumber: 1, snapshot: json(snapshot), integrityHash: randomUUID(), finalizedBy: actor.id,
            } });
            const previousLine = await tx.logisticsAllocationRevisionLine.create({ data: {
              revisionId: previousRevision.id, sourceContractId: contractId, sourceContractItemId: itemId,
              productId: product.productId, productRowId: rowId, quantity: previouslyLoaded, unit: "count",
              snapshot: json({}), integrityHash: randomUUID(),
            } });
            await tx.logisticsAllocationRevisionPricing.create({ data: {
              allocationRevisionId: previousRevision.id, contractId, pricingVersionId: version.id,
              expectedPricingHash: version.integrityHash, readinessEvidenceHash: sourceHash(randomUUID()),
            } });
            const priorPayload = {
              allocationRevisionId: previousRevision.id, allocationRevisionLineId: previousLine.id,
              pricingVersionId: version.id, pricingRowId: pricingRow.id, quantity: previouslyLoaded,
              grossAmount: "0.333333333333", discountAmount: "0.066666666667", netAmount: "0.266666666666",
              consumesFinalRemainder: false, evidence: { ledgerSequence: 1, beforeQuantity: "0", afterQuantity: previouslyLoaded, contractedQuantity: String(quantity) }, recordedBy: actor.id,
            };
            await tx.dispatchPricedAllocationEvent.create({ data: { ...priorPayload, integrityHash: pricedAllocationIntegrityHash(priorPayload) } });
            await tx.logisticsAllocationRevision.update({ where: { id: previousRevision.id }, data: { sealedAt: new Date() } });
          }
          const payload = {
            allocationRevisionId: revision.id,
            allocationRevisionLineId: revisionLine.id,
            pricingVersionId: version.id,
            pricingRowId: pricingRow.id,
            quantity: `${loaded}.000`,
            grossAmount: "12.500000000000",
            discountAmount: "2.500000000000",
            netAmount: "10.000000000000",
            consumesFinalRemainder: false,
            evidence: { ledgerSequence: (scenario === "successive" || scenario === "remainder") ? 2 : 1, beforeQuantity: previouslyLoaded, afterQuantity: String(Number(previouslyLoaded) + Number(loaded)), contractedQuantity: String(quantity) },
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
        const issued = await service.issue(ctx, loading.id, "material-100413");
        const download = await service.download(ctx, loading.id, issued.id);
        const html = Buffer.from(download.bytes).toString();
        const sourceRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => match[1]).filter(row => row.includes('سنگ مصرفی'));
        assert.equal(sourceRows.length, 2);
        if (scenario === 'full') {
          assert.ok(sourceRows.some(row => row.includes('۴۵') && row.includes('۲۱٫۶')));
          assert.ok(sourceRows.some(row => row.includes('۱۰۰') && row.includes('۴۲')));
        } else if (scenario === 'successive' || scenario === 'remainder') {
          assert.ok(sourceRows.some(row => /class="number"[^>]*>۰<|>۰<\//.test(row)), 'second riser uses remainder of the first source piece');
          assert.ok(sourceRows.some(row => row.includes('۰٫۴۲')), 'next tread consumes exactly one separate source piece');
        } else {
        assert.ok(sourceRows.some(row => row.includes('۳۵') && row.includes('۱۶٫۸')), '70 risers consume 35 mother pieces and 16.8 square metres');
        assert.ok(sourceRows.some(row => row.includes('۳۰') && row.includes('۱۲٫۶')), '30 treads consume only 12.6 square metres');
        }
        const operations = [...html.matchAll(/<tr class="operation">([\s\S]*?)<\/tr>/g)].map(match => match[1]);
        const toolRows = operations.filter(row => row.includes('ابزار نیم‌لول'));
        const cutRows = operations.filter(row => row.includes('برش طولی'));
        assert.equal(toolRows.length, 2);
        assert.equal(cutRows.length, 2);
        if (scenario === 'partial' || scenario === 'currency') {
          assert.ok(toolRows.some(row => row.includes('۴۶٫۵')), '30/100 treads carry 46.5 metres of the approved 155-metre tool');
          assert.ok(cutRows.some(row => row.includes('۸۴')), '70/90 risers carry 84 metres of the approved 108-metre cut');
        } else if (scenario === 'full') {
          assert.ok(toolRows.some(row => row.includes('۱۵۵')));
          assert.ok(cutRows.some(row => row.includes('۱۰۸')));
        } else {
          assert.ok(toolRows.some(row => row.includes('۱٫۵۵')), 'contract minimum is not charged again per shipment');
          assert.ok(cutRows.some(row => row.includes('۱٫۲')), 'one riser carries 1.2 metres of longitudinal cutting');
        }
        if (scenario === 'currency') {
          assert.ok(toolRows.every(row => />۳۳<\//.test(row)), 'historical rial totals reconcile with canonical toman approval before shipment allocation');
          assert.ok(toolRows.every(row => row.includes('۴۰ / متر طول')));
        }
        const storedInvoice = await tx.salesDispatchInvoice.findUniqueOrThrow({ where: { id: issued.id } });
        const oldPrint = (storedInvoice.snapshot as any).print;
        const originalArtifact = Buffer.from('immutable older issued PDF');
        const olderInvoice = { ...storedInvoice, pdf: originalArtifact, pdfSha256: bytesHash(originalArtifact),
          snapshot: { ...(storedInvoice.snapshot as any), pdfLayoutVersion: 2,
            print: { ...oldPrint, rows: Object.fromEntries(Object.entries(oldPrint.rows).map(([key, rows]) =>
              [key, (rows as any[]).map(row => ({ ...row, count: '۹۹۹۹', linearMeasurement: '۹۹۹۹', squareMeasurement: '۹۹۹۹' }))])) } } };
        const historicalClient = new Proxy(client, {
          get(target, key, receiver) {
            if (key === '$transaction') return async (work: (database: PrismaClient) => Promise<unknown>) => work(historicalClient);
            if (key === 'salesDispatchInvoice') return { findFirst: async () => olderInvoice };
            return Reflect.get(target, key, receiver);
          },
        });
        const historicalService = createSalesInvoiceService(historicalClient,
          async (snapshot, reason) => Buffer.from(renderSalesInvoice(snapshot, reason)));
        assert.equal(Buffer.from((await historicalService.download(ctx, loading.id, issued.id)).bytes).toString(), html,
          'ordinary download regenerates stale material/services from the same frozen evidence');
        assert.equal(bytesHash((await historicalService.download(ctx, loading.id, issued.id, false, true)).bytes), bytesHash(originalArtifact));
        assert.equal(download.number, issued.number);
        assert.match(html, /۲۰۰/); // Original approved net: 20 toman, displayed in rials.
        throw rollback;
      }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal(await db.salesDispatchInvoice.count(), before);
  console.log('sales dispatch material quantities issuance/download: PASS');
}
run().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
