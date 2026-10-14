import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  DispatchConfirmationService,
  DispatchConfirmationConflictError,
} from "../dispatchConfirmation";
import {
  PhysicalGateExitService,
  PhysicalGateExitConflictError,
} from "../physicalGateExit";
import { ProtectedTemplateVault } from "../biometricTemplateVault";

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
