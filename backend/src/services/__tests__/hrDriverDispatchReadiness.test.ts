import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DispatchConfirmationService,
  DispatchConfirmationConflictError,
} from "../dispatchConfirmation";
import {
  PhysicalGateExitService,
  PhysicalGateExitConflictError,
} from "../physicalGateExit";
import { ProtectedTemplateVault } from "../biometricTemplateVault";
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../approvedPricing';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';
import { bytesHash, readInvoiceSource, sourceHash } from '../salesDispatchInvoice/source';

/** Build the current mandatory invoice prerequisite with real immutable hashes. */
async function addValidInvoicePrerequisite(tx: any, revision: any, waybill: any) {
  const decimal = (value: string) => new Prisma.Decimal(value);
  const versionBase = { id: 'pricing', contractId: 'contract', versionNumber: 1, sourceFinancialRecordId: 'financial',
    approvedAt: new Date('2026-10-13T10:00:00Z'), approvedBy: 'accountant', schemaVersion: 1, currency: 'TOMAN',
    grossAmount: '100.000000000000', discountAmount: '0.000000000000', netAmount: '100.000000000000', sourceEvidence: {} };
  const rowBase = { versionId: versionBase.id, contractId: versionBase.contractId, sourceFinancialRecordId: versionBase.sourceFinancialRecordId,
    versionNumber: 1, contractItemId: 'item', productRowId: 'row', ordinal: 1, contractedQuantity: '2.000', unit: 'M3',
    canonicalAllInTotal: '100.000000000000', discountEligible: true, componentEvidence: { material: '100.000000000000' } };
  const row = { id: 'pricing-row', pricingVersionId: versionBase.id, ...rowBase,
    contractedQuantity: decimal('2'), canonicalAllInTotal: decimal('100'), integrityHash: approvedPricingRowIntegrityHash(rowBase) };
  const version = { ...versionBase, grossAmount: decimal('100'), discountAmount: decimal('0'), netAmount: decimal('100'), rows: [row],
    integrityHash: approvedPricingVersionIntegrityHash({ ...versionBase, rowHashes: [row.integrityHash] }) };
  const line = { id: 'line', sourceKind: 'SALES_CONTRACT', sourceContractId: 'contract', sourceContractItemId: 'item',
    productId: 'product', productRowId: 'row', unit: 'M3', quantity: decimal('2'), snapshot: { productName: 'سنگ آزمون' } };
  const payload = { allocationRevisionId: revision.id, allocationRevisionLineId: line.id, pricingVersionId: version.id,
    pricingRowId: row.id, quantity: '2.000', grossAmount: '100.000000000000', discountAmount: '0.000000000000',
    netAmount: '100.000000000000', consumesFinalRemainder: true, evidence: { ledgerSequence: 1 }, recordedBy: 'operator' };
  const event = { ...payload, quantity: decimal('2'), grossAmount: decimal('100'), discountAmount: decimal('0'), netAmount: decimal('100'),
    integrityHash: pricedAllocationIntegrityHash(payload), allocationRevisionLine: line, pricingRow: row };
  const reference = { contractId: 'contract', pricingVersionId: version.id, expectedPricingHash: version.integrityHash,
    readinessEvidenceHash: 'd'.repeat(64), pricingVersion: version };
  waybill.dispatchCorrections = [];
  Object.assign(revision, { sourceKind: 'SALES_CONTRACT', integrityHash: 'revision-hash', lines: [line],
    snapshot: { loading: { customer: { id: 'customer', name: 'مشتری آزمون' } },
      queueTurn: { admissionSnapshot: { driver: { name: 'راننده آزمون' }, plate: { plate: 'پلاک آزمون' } } } },
    candidate: { status: 'ACCEPTED', waybills: [waybill] } });
  tx.logisticsAllocationRevision.findUnique = async () => revision;
  tx.logisticsAllocationRevisionPricing = { findMany: async () => [reference] };
  tx.contractApprovedPricingHead = { findMany: async () => [{ contractId: 'contract', currentVersion: version }] };
  tx.contractApprovedPricingVersion = { findUniqueOrThrow: async () => version };
  tx.dispatchPricedAllocationEvent = { findMany: async () => [event] };
  tx.dispatchStatementAdjustment = { findMany: async () => [] };
  tx.salesInvoiceCorrection = { findMany: async () => [] };
  tx.logisticsLoading = { findUnique: async () => ({ id: 'loading', status: 'FINALIZED', loadingNumber: 'QA',
    customerId: 'customer', canonicalAllocationRevisions: [revision] }) };
  const financial = { id: 'financial', contractId: 'contract', customerId: 'customer', status: 'ISSUED', kind: 'INVOICE_CANDIDATE',
    financiallyApprovedAt: new Date('2026-10-13'), amount: decimal('100'), sepidarAmount: decimal('100'),
    systemInvoiceNumber: 'QA', systemInvoiceDate: new Date('2026-10-13'), sourceSnapshot: { contractData: { products: [{ rowId: 'row', stoneName: 'سنگ آزمون' }] } } };
  tx.accountingFinancialRecord = { findUnique: async () => financial, findMany: async () => [financial] };
  tx.salesContract = { findMany: async () => [{ id: 'contract', status: 'SIGNED', commercialFlowVersion: 0, partnerKind: null, partnerCaseId: null }] };
  const pdf = Buffer.from('invoice-fixture');
  const source = await readInvoiceSource(tx, 'loading');
  tx.salesDispatchInvoice = { findFirst: async () => ({ id: 'invoice', issuedAt: new Date('2026-10-13'),
    sourceHash: sourceHash(source), pdf, pdfSha256: bytesHash(pdf) }) };
}

const at = new Date("2026-10-14T12:00:00Z");
for (const invalid of ["expired", "suspended"])
  test(
    "authorization commit and physical exit both reject a now-" +
      invalid +
      " internal driver",
    async () => {
      const turn = {
        id: "turn",
        driverSource: "INTERNAL",
        internalDriverId: "driver",
        companyVehicleId: "vehicle",
        assignmentId: "assignment",
        status: "LOADING_FINALIZED",
        loadingId: "loading",
      };
      const driver = {
        id: "driver",
        personnelId: "person",
        status: "ACTIVE",
        licenceNumber: "12345",
        licenceClass: "پایه یک",
        licenceExpiresAt: new Date(
          invalid === "expired" ? "2026-10-13" : "2027-01-01",
        ),
        personnel: {
          isActive: true,
          archivedAt: null,
          hrEmploymentRelationships: [{}],
        },
        eligibilityPeriods: [
          { status: invalid === "suspended" ? "SUSPENDED" : "ELIGIBLE" },
        ],
        vehicleAssignments: [
          { id: "assignment", vehicle: { status: "ACTIVE", plates: [{}] } },
        ],
      };
      const revision = {
        id: "revision",
        queueTurnId: turn.id,
        queueTurn: turn,
        loadingId: "loading",
        sealedAt: at,
        lines: [],
        partnerCaseId: null,
      };
      const waybill = {
        id: "waybill",
        integrityHash: "sealed",
        status: "ISSUED",
        number: 1,
        candidate: {
          status: "ACCEPTED",
          allocationRevisionId: "revision",
          allocationRevision: revision,
        },
      };
      const authorization = {
        id: "authorization",
        driverId: "driver",
        driverSource: "INTERNAL",
        waybillId: waybill.id,
        waybill,
        status: "ACTIVE",
        validUntil: new Date("2026-10-15"),
        waybillIntegrityHash: "sealed",
        physicalExit: null,
      };
      let writes = 0;
      const tx: any = {
        $executeRaw: async () => 0,
        $executeRawUnsafe: async () => 0,
        $queryRaw: async () => [],
        dispatchConfirmationSession: {
          findUnique: async () => ({
            id: "session",
            waybillId: waybill.id,
            waybill,
            status: "ACTIVE",
            expiresAt: new Date("2026-10-15"),
            driverSource: "INTERNAL",
            driverId: "driver",
            waybillIntegrityHash: "sealed",
            exitAuthorization: null,
            otpChallenges: [],
            guardApprovals: [],
            attempts: [],
          }),
          update: async () => {
            writes++;
          },
        },
        logisticsAllocationRevisionLine: { findMany: async () => [] },
        logisticsAllocationRevision: { findFirst: async () => revision },
        internalDriverProfile: { findUnique: async () => driver },
        driverBiometricEnrollment: {
          findFirst: async () => ({ id: "enrollment" }),
        },
        dispatchExitAuthorization: {
          findUnique: async () => authorization,
          create: async () => {
            writes++;
            return authorization;
          },
        },
        dispatchLifecycleAudit: {
          findFirst: async () => null,
          create: async () => ({ id: "rejection-audit" }),
        },
      };
      await addValidInvoicePrerequisite(tx, revision, waybill);
      const client = {
        dispatchExitAuthorization: tx.dispatchExitAuthorization,
        $transaction: async (work: any) => work(tx),
      } as unknown as PrismaClient;
      const confirmation = new DispatchConfirmationService(client, {
        connector: {
          execute: async () => {
            throw new Error("unused connector");
          },
        },
        vault: {} as ProtectedTemplateVault,
        otpSecret: "isolated-test-secret-only",
        sendOtp: async () => {},
        now: () => at,
      });
      const commit = confirmation as unknown as {
        createAuthorizationLocked: (
          tx: unknown,
          sessionId: string,
          actorId: string,
          at: Date,
        ) => Promise<unknown>;
      };
      await assert.rejects(
        () => commit.createAuthorizationLocked(tx, "session", "operator", at),
        (error) =>
          error instanceof DispatchConfirmationConflictError &&
          /شرایط رانندگی/.test(error.message),
      );
      const exit = new PhysicalGateExitService(client, { now: () => at });
      await assert.rejects(
        () =>
          exit.recordExit({
            authorizationId: "authorization",
            actorId: "operator",
            effectiveAuthority: {},
            idempotencyKey: "test-key",
            correlationId: "test-correlation",
          }),
        (error) =>
          error instanceof PhysicalGateExitConflictError &&
          /خروج مجاز نیست/.test(error.message),
      );
      assert.equal(
        writes,
        0,
        "no authorization or physical exit is allowed after readiness is lost",
      );
    },
  );
