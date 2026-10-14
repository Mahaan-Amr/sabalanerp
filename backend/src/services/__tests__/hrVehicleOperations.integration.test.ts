import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, CompanyVehicle } from "@prisma/client";
import { processDueHrAssignmentPlans } from "../hrVehicleAssignmentWorker";
import { isGuardQueueTurnCurrentlyReady } from "../guardDriverQueue";
import {
  assignHrVehicle,
  previewHrAssignment,
  endHrAssignment,
  assertNoOpenHrOperations,
  executeHrAssignmentPlan,
  endHrSubjectAssignments,
  lockHrVehicleOperations,
  validateDriverForAssignment,
  HrVehicleError,
} from "../hrVehicleOperations";

const localUrl = process.env.DATABASE_URL || "";
if (!localUrl.includes("127.0.0.1:55432"))
  throw new Error(
    "Use only the existing sabalanerp-local database for this transaction harness.",
  );
const client = new PrismaClient();
const rollback = new Error("rollback isolated HR fixture");
test.after(async () => {
  await client.$disconnect();
});

const fixture = async (
  work: (tx: Prisma.TransactionClient, f: any) => Promise<void>,
  rollbackAtEnd = true,
) => {
  try {
    await client.$transaction(
      async (tx) => {
        await lockHrVehicleOperations(tx);
        const key = randomUUID();
        const now = new Date();
        const before = new Date(now.getTime() - 60_000);
        const actor = await tx.user.create({
          data: {
            email: "hr-" + key + "@example.invalid",
            username: "hr-" + key,
            password: "unused-test-password",
            firstName: "آزمون",
            lastName: "منابع انسانی",
            role: "ADMIN",
          },
        });
        const personnel = await tx.personnel.create({
          data: { firstName: "راننده", lastName: key },
        });
        await tx.hrEmploymentRelationship.create({
          data: {
            personnelId: personnel.id,
            status: "ACTIVE",
            effectiveFrom: before,
            createdBy: actor.id,
          },
        });
        const driver = await tx.internalDriverProfile.create({
          data: {
            personnelId: personnel.id,
            licenceNumber: "LIC-" + key,
            licenceClass: "پایه یک",
            licenceExpiresAt: new Date(now.getTime() + 365 * 86400000),
            status: "ACTIVE",
            createdBy: actor.id,
          },
        });
        await tx.internalDriverEligibilityPeriod.create({
          data: {
            driverId: driver.id,
            status: "ELIGIBLE",
            effectiveFrom: before,
            reason: "fixture",
            recordedBy: actor.id,
          },
        });
        const vehicles: CompanyVehicle[] = [];
        for (const index of [0, 1]) {
          const vehicle = await tx.companyVehicle.create({
            data: {
              fleetCode: "HR-" + key + "-" + index,
              vehicleType: "سواری",
              status: "ACTIVE",
              createdBy: actor.id,
            },
          });
          await tx.companyVehiclePlate.create({
            data: {
              vehicleId: vehicle.id,
              plate: "پلاک آزمون " + key + "-" + index,
              normalizedPlate: key + index,
              effectiveFrom: before,
              reason: "fixture",
              recordedBy: actor.id,
            },
          });
          vehicles.push(vehicle);
        }
        await work(tx, { driver, personnel, vehicles, actor, now, before });
        if (rollbackAtEnd) throw rollback;
      },
      {
        timeout: 30_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
};

test("real DB same-day transfer has adjacent positive periods, duplicate no-op, independent ending and complete audit", () =>
  fixture(async (tx, f) => {
    const input = {
      driverId: f.driver.id,
      vehicleId: f.vehicles[0].id,
      confirmed: true,
      expectedAssignmentIds: [],
    };
    const first = await assignHrVehicle(tx, input, f.actor.id, f.now);
    const duplicate = await assignHrVehicle(
      tx,
      input,
      f.actor.id,
      new Date(f.now.getTime() + 1),
    );
    assert.equal(duplicate.unchanged, true);
    assert.equal(
      await tx.driverVehicleAssignment.count({
        where: { driverId: f.driver.id },
      }),
      1,
    );
    const second = await assignHrVehicle(
      tx,
      {
        ...input,
        vehicleId: f.vehicles[1].id,
        expectedAssignmentIds: [first.data.id],
      },
      f.actor.id,
      new Date(f.now.getTime() + 2),
    );
    const ended = await tx.driverVehicleAssignment.findUniqueOrThrow({
      where: { id: first.data.id },
    });
    assert.ok(ended.effectiveTo! > ended.effectiveFrom);
    assert.equal(
      ended.effectiveTo!.getTime(),
      second.data.effectiveFrom.getTime(),
    );
    const preview = await previewHrAssignment(
      tx,
      { driverId: f.driver.id, vehicleId: f.vehicles[0].id },
      new Date(f.now.getTime() + 3),
    );
    assert.deepEqual(
      preview.current.map((item) => item.id),
      [second.data.id],
      "closed history must never be treated as a current assignment in a later transfer or plan edit",
    );
    await endHrAssignment(
      tx,
      second.data.id,
      f.actor.id,
      [],
      new Date(f.now.getTime() + 3),
    );
    assert.equal(
      await tx.driverVehicleAssignment.count({
        where: { driverId: f.driver.id, effectiveTo: null },
      }),
      0,
    );
    const audit = await tx.dispatchMasterDataAudit.findMany({
      where: { subjectId: f.driver.id },
    });
    assert.equal(audit.length, 4);
    assert.ok(
      audit.every(
        (item) => item.actorId === f.actor.id && item.eventHash.length === 64,
      ),
    );
  }));

test("future plans preserve current assignment, reject silent conflict, retain cancellation and execute at the actual instant", () =>
  fixture(async (tx, f) => {
    const first = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      f.actor.id,
      f.now,
    );
    const from = new Date(f.now.getTime() + 60_000);
    const plan = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[1].id,
        effectiveFrom: from.toISOString(),
        confirmed: true,
        expectedAssignmentIds: [first.data.id],
      },
      f.actor.id,
      f.now,
    );
    assert.equal(plan.planned, true);
    assert.equal(
      (
        await tx.driverVehicleAssignment.findUniqueOrThrow({
          where: { id: first.data.id },
        })
      ).effectiveTo,
      null,
    );
    const preview = await previewHrAssignment(
      tx,
      { driverId: f.driver.id, vehicleId: f.vehicles[1].id },
      f.now,
    );
    assert.equal(preview.conflictingPlans.length, 1);
    await assert.rejects(
      () =>
        assignHrVehicle(
          tx,
          {
            driverId: f.driver.id,
            vehicleId: f.vehicles[1].id,
            confirmed: true,
            expectedAssignmentIds: [first.data.id],
          },
          f.actor.id,
          f.now,
        ),
      /برنامه‌های متعارض/,
    );
    const actual = new Date(from.getTime() + 20_000);
    await executeHrAssignmentPlan(
      tx,
      plan.data.id,
      f.actor.id,
      false,
      { expectedAssignmentIds: [first.data.id], cancelPlanIds: [] },
      actual,
    );
    const assignments = await tx.driverVehicleAssignment.findMany({
      where: { driverId: f.driver.id },
      orderBy: { effectiveFrom: "asc" },
    });
    assert.equal(assignments[1].effectiveFrom.getTime(), actual.getTime());
    assert.equal(
      (
        await tx.driverVehicleAssignmentPlan.findUniqueOrThrow({
          where: { id: plan.data.id },
        })
      ).status,
      "APPLIED",
    );
  }));

test("ending a subject requires explicit future-plan cancellation and closes assignments without deleting identity", () =>
  fixture(async (tx, f) => {
    const assignment = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
        effectiveTo: new Date(f.now.getTime() + 60_000).toISOString(),
      },
      f.actor.id,
      f.now,
    );
    const plans = await tx.driverVehicleAssignmentPlan.findMany({
      where: { driverId: f.driver.id },
    });
    await assert.rejects(
      () =>
        endHrSubjectAssignments(
          tx,
          { driverId: f.driver.id },
          f.actor.id,
          [],
          new Date(f.now.getTime() + 1),
        ),
      /برنامه‌های آینده/,
    );
    assert.equal(
      (
        await tx.driverVehicleAssignment.findUniqueOrThrow({
          where: { id: assignment.data.id },
        })
      ).effectiveTo,
      null,
    );
    await endHrSubjectAssignments(
      tx,
      { driverId: f.driver.id },
      f.actor.id,
      plans.map((plan) => plan.id),
      new Date(f.now.getTime() + 2),
    );
    assert.equal(
      (
        await tx.driverVehicleAssignmentPlan.findUniqueOrThrow({
          where: { id: plans[0].id },
        })
      ).status,
      "CANCELLED",
    );
    assert.ok(await tx.personnel.findUnique({ where: { id: f.personnel.id } }));
  }));

test("open Guard visit blocks every affected subject with the actual driver, plate and stage", () =>
  fixture(async (tx, f) => {
    const assignment = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      f.actor.id,
      f.now,
    );
    await tx.guardDriverQueueTurn.create({
      data: {
        driverSource: "INTERNAL",
        internalDriverId: f.driver.id,
        companyVehicleId: f.vehicles[0].id,
        assignmentId: assignment.data.id,
        admittedBy: f.actor.id,
        admissionSnapshot: {},
        integrityHash: randomUUID(),
      },
    });
    await assert.rejects(
      () => assertNoOpenHrOperations(tx, [], [f.vehicles[0].id]),
      (error) =>
        error instanceof HrVehicleError &&
        error.message.includes(f.personnel.lastName) &&
        error.message.includes("پلاک آزمون") &&
        error.message.includes("در انتظار گارد"),
    );
    await assert.rejects(
      () =>
        endHrAssignment(
          tx,
          assignment.data.id,
          f.actor.id,
          [],
          new Date(f.now.getTime() + 1),
        ),
      /عملیات باز/,
    );
    assert.equal(
      (
        await tx.driverVehicleAssignment.findUniqueOrThrow({
          where: { id: assignment.data.id },
        })
      ).effectiveTo,
      null,
    );
  }));

test("licence corrections immediately invalidate readiness without changing the active assignment", () =>
  fixture(async (tx, f) => {
    await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      f.actor.id,
      f.now,
    );
    await tx.internalDriverProfile.update({
      where: { id: f.driver.id },
      data: { licenceExpiresAt: f.before },
    });
    await assert.rejects(
      () =>
        validateDriverForAssignment(tx, f.driver.id, f.vehicles[0].id, f.now),
      /گواهینامه منقضی/,
    );
    assert.equal(
      await tx.driverVehicleAssignment.count({
        where: { driverId: f.driver.id, effectiveTo: null },
      }),
      1,
    );
  }));

test("a blocked due plan requires attention and never automatically retries after its blocker clears", () =>
  fixture(async (tx, f) => {
    const first = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      f.actor.id,
      f.now,
    );
    const dueAt = new Date(f.now.getTime() + 60_000);
    const result = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[1].id,
        effectiveFrom: dueAt.toISOString(),
        confirmed: true,
        expectedAssignmentIds: [first.data.id],
      },
      f.actor.id,
      f.now,
    );
    await tx.internalDriverProfile.update({
      where: { id: f.driver.id },
      data: { licenceExpiresAt: f.before },
    });
    // Inject the worker into the existing rollback transaction; no second database or persistent fixtures.
    const harness = {
      driverVehicleAssignmentPlan: tx.driverVehicleAssignmentPlan,
      $transaction: (work: any) => work(tx),
    } as unknown as PrismaClient;
    await processDueHrAssignmentPlans(harness, dueAt);
    const blocked = await tx.driverVehicleAssignmentPlan.findUniqueOrThrow({
      where: { id: result.data.id },
    });
    assert.equal(blocked.status, "NEEDS_ATTENTION");
    assert.match(blocked.blockedReason!, /گواهینامه منقضی/);
    await tx.internalDriverProfile.update({
      where: { id: f.driver.id },
      data: { licenceExpiresAt: new Date(dueAt.getTime() + 86400000) },
    });
    await processDueHrAssignmentPlans(harness, new Date(dueAt.getTime() + 1));
    assert.equal(
      (
        await tx.driverVehicleAssignmentPlan.findUniqueOrThrow({
          where: { id: blocked.id },
        })
      ).status,
      "NEEDS_ATTENTION",
    );
    assert.equal(
      (
        await tx.driverVehicleAssignment.findUniqueOrThrow({
          where: { id: first.data.id },
        })
      ).effectiveTo,
      null,
    );
    await executeHrAssignmentPlan(
      tx,
      blocked.id,
      f.actor.id,
      false,
      { expectedAssignmentIds: [first.data.id], cancelPlanIds: [] },
      new Date(dueAt.getTime() + 2),
    );
    assert.equal(
      (
        await tx.driverVehicleAssignmentPlan.findUniqueOrThrow({
          where: { id: blocked.id },
        })
      ).status,
      "APPLIED",
    );
  }));

test("a waiting Serializable dispatch cannot authorize from the old licence snapshot after an HR update commits", async () => {
  let f: any;
  await fixture(async (tx, value) => {
    const assignment = await assignHrVehicle(
      tx,
      {
        driverId: value.driver.id,
        vehicleId: value.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      value.actor.id,
      value.now,
    );
    f = { ...value, assignmentId: assignment.data.id };
  }, false);
  let writerReady!: () => void;
  let releaseWriter!: () => void;
  let readerReady!: () => void;
  const written = new Promise<void>((resolve) => {
    writerReady = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const read = new Promise<void>((resolve) => {
    readerReady = resolve;
  });
  let writer: Promise<unknown> | undefined;
  let reader: Promise<unknown> | undefined;
  try {
    writer = client.$transaction(
      async (tx) => {
        await lockHrVehicleOperations(tx);
        await tx.internalDriverProfile.update({
          where: { id: f.driver.id },
          data: { licenceExpiresAt: f.before },
        });
        writerReady();
        await release;
      },
      { timeout: 10000 },
    );
    await written;
    reader = client.$transaction(
      async (tx) => {
        const old = await tx.internalDriverProfile.findUniqueOrThrow({
          where: { id: f.driver.id },
        });
        assert.ok(
          old.licenceExpiresAt! > f.now,
          "establish the old snapshot before HR commits",
        );
        readerReady();
        return isGuardQueueTurnCurrentlyReady(
          tx,
          {
            driverSource: "INTERNAL",
            internalDriverId: f.driver.id,
            companyVehicleId: f.vehicles[0].id,
            externalDriverId: null,
            externalVehicleId: null,
            assignmentId: f.assignmentId,
          },
          f.now,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
    // Observe the rejection immediately so Node cannot report an unhandled promise during the barrier.
    const observed = reader.then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    await read;
    releaseWriter();
    await writer;
    const outcome = await observed;
    assert.ok(
      "error" in outcome,
      "the stale snapshot must fail rather than return READY",
    );
    const error = (outcome as { error: any }).error;
    assert.ok(error.code === "P2034" || String(error.meta?.code) === "40001");
  } finally {
    releaseWriter();
    await Promise.allSettled([writer, reader].filter(Boolean));
    const subjects = [f.driver.id, ...f.vehicles.map((v: any) => v.id)];
    await client.dispatchMasterDataAudit.deleteMany({
      where: { subjectId: { in: subjects } },
    });
    await client.driverVehicleAssignment.deleteMany({
      where: { driverId: f.driver.id },
    });
    await client.internalDriverEligibilityPeriod.deleteMany({
      where: { driverId: f.driver.id },
    });
    await client.internalDriverProfile.delete({ where: { id: f.driver.id } });
    await client.companyVehiclePlate.deleteMany({
      where: { vehicleId: { in: f.vehicles.map((v: any) => v.id) } },
    });
    await client.companyVehicle.deleteMany({
      where: { id: { in: f.vehicles.map((v: any) => v.id) } },
    });
    await client.hrEmploymentRelationship.deleteMany({
      where: { personnelId: f.personnel.id },
    });
    await client.personnel.delete({ where: { id: f.personnel.id } });
    await client.user.delete({ where: { id: f.actor.id } });
  }
});

test("non-overlapping future assignments execute consecutively without requiring approval again for anticipated earlier plans", () =>
  fixture(async (tx, f) => {
    const first = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      f.actor.id,
      f.now,
    );
    const t1 = new Date(f.now.getTime() + 60000),
      t2 = new Date(f.now.getTime() + 120000),
      t3 = new Date(f.now.getTime() + 180000);
    const parent = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[1].id,
        effectiveFrom: t1.toISOString(),
        effectiveTo: t2.toISOString(),
        confirmed: true,
        expectedAssignmentIds: [first.data.id],
      },
      f.actor.id,
      f.now,
    );
    const childInput = {
      driverId: f.driver.id,
      vehicleId: f.vehicles[0].id,
      effectiveFrom: t3.toISOString(),
    };
    const forecast = await previewHrAssignment(tx, childInput, f.now);
    const child = await assignHrVehicle(
      tx,
      {
        ...childInput,
        confirmed: true,
        expectedAssignmentIds: forecast.current.map((item) => item.id),
      },
      f.actor.id,
      f.now,
    );
    const applied = await executeHrAssignmentPlan(
      tx,
      parent.data.id,
      f.actor.id,
      true,
      {},
      t1,
    );
    const end = await tx.driverVehicleAssignmentPlan.findFirstOrThrow({
      where: { action: "END", assignmentId: applied.assignmentId },
    });
    await executeHrAssignmentPlan(tx, end.id, f.actor.id, true, {}, t2);
    await executeHrAssignmentPlan(tx, child.data.id, f.actor.id, true, {}, t3);
    assert.equal(
      (
        await tx.driverVehicleAssignmentPlan.findUniqueOrThrow({
          where: { id: child.data.id },
        })
      ).status,
      "APPLIED",
    );
    assert.equal(
      await tx.driverVehicleAssignment.count({
        where: {
          driverId: f.driver.id,
          vehicleId: f.vehicles[0].id,
          effectiveTo: null,
        },
      }),
      1,
    );
  }));

test("planning the end of the existing pairing preserves its period instead of ignoring the chosen deadline or duplicating history", () =>
  fixture(async (tx, f) => {
    const first = await assignHrVehicle(
      tx,
      {
        driverId: f.driver.id,
        vehicleId: f.vehicles[0].id,
        confirmed: true,
        expectedAssignmentIds: [],
      },
      f.actor.id,
      f.now,
    );
    const deadline = new Date(f.now.getTime() + 60000);
    const input = {
      driverId: f.driver.id,
      vehicleId: f.vehicles[0].id,
      effectiveTo: deadline.toISOString(),
      confirmed: true,
      expectedAssignmentIds: [first.data.id],
    };
    const planned = await assignHrVehicle(
      tx,
      input,
      f.actor.id,
      new Date(f.now.getTime() + 1),
    );
    assert.equal(planned.planned, true);
    assert.equal(
      await tx.driverVehicleAssignment.count({
        where: { driverId: f.driver.id },
      }),
      1,
    );
    assert.equal(
      (
        await tx.driverVehicleAssignment.findUniqueOrThrow({
          where: { id: first.data.id },
        })
      ).effectiveTo,
      null,
    );
    const again = await assignHrVehicle(
      tx,
      input,
      f.actor.id,
      new Date(f.now.getTime() + 2),
    );
    assert.equal(again.unchanged, true);
    assert.equal(
      await tx.driverVehicleAssignmentPlan.count({
        where: { driverId: f.driver.id },
      }),
      1,
    );
    const end = await tx.driverVehicleAssignmentPlan.findFirstOrThrow({
      where: { assignmentId: first.data.id },
    });
    await executeHrAssignmentPlan(tx, end.id, f.actor.id, true, {}, deadline);
    assert.equal(
      (
        await tx.driverVehicleAssignment.findUniqueOrThrow({
          where: { id: first.data.id },
        })
      ).effectiveTo!.getTime(),
      deadline.getTime(),
    );
  }));
