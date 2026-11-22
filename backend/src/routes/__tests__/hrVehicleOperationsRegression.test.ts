import assert from "node:assert/strict";
import test from "node:test";
import hrRouter from "../dispatch-master-data.hr";
import vehicleRouter from "../dispatch-master-data.vehicle-operations";
import { prisma } from "../../lib/prisma";

const invoke = async (router: any, path: string, body: any, tx: any) => {
  const stack = router.stack.flatMap((entry: any) => entry.handle?.stack || [entry]);
  const route = stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods.post,
  ).route;
  const original = prisma.$transaction;
  (prisma as any).$transaction = async (callback: any) => callback(tx);
  let status = 200;
  let result: any;
  const response = {
    status: (value: number) => {
      status = value;
      return response;
    },
    json: (value: any) => {
      result = value;
      return response;
    },
  };
  try {
    await route.stack
      .at(-1)
      .handle(
        { params: { id: "driver" }, body, user: { id: "operator" } },
        response,
      );
    return { status, result };
  } finally {
    prisma.$transaction = original;
  }
};
const audit = {
  findFirst: async () => null,
  create: async ({ data }: any) => data,
};

test("the ordinary same-day suspension uses the actual instant instead of colliding with designation midnight", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const from = new Date(`${today}T00:00:00+03:30`);
  const driver = {
    id: "driver",
    status: "ACTIVE",
    personnel: { isActive: true, hrEmploymentRelationships: [] },
    eligibilityPeriods: [],
    vehicleAssignments: [],
  };
  let endedAt: Date | undefined;
  const tx = {
    $executeRawUnsafe: async () => undefined,
    $executeRaw: async () => undefined,
    $queryRaw: async () => [],
    internalDriverProfile: {
      findUnique: async () => driver,
      findUniqueOrThrow: async () => driver,
    },
    internalDriverEligibilityPeriod: {
      findFirst: async () => ({
        id: "period",
        status: "ELIGIBLE",
        effectiveFrom: from,
      }),
      update: async ({ data }: any) => {
        endedAt = data.effectiveTo;
        return data;
      },
      create: async ({ data }: any) => ({ id: "new-period", ...data }),
    },
    dispatchMasterDataAudit: audit,
  };
  const { status, result } = await invoke(
    hrRouter,
    "/internal-drivers/:id/eligibility",
    {
      status: "SUSPENDED",
      effectiveFrom: today,
      reason: "legacy client",
    },
    tx,
  );
  assert.equal(status, 200, JSON.stringify(result));
  assert.equal(result.success, true);
  assert.ok(endedAt && endedAt > from);
});

test("selecting the currently assigned vehicle is a successful no-op, with no zero-length or duplicate history", async () => {
  const from = new Date(new Date().toISOString().slice(0, 10));
  const current = {
    id: "assignment",
    driverId: "driver",
    vehicleId: "vehicle",
    effectiveFrom: from,
    effectiveTo: null,
  };
  let writes = 0;
  const tx = {
    $executeRawUnsafe: async () => undefined,
    $executeRaw: async () => undefined,
    $queryRaw: async () => [],
    internalDriverProfile: {
      findUnique: async () => ({ id: "driver", status: "ACTIVE" }),
    },
    companyVehicle: {
      findUnique: async () => ({
        id: "vehicle",
        status: "ACTIVE",
        plates: [{ effectiveFrom: from, effectiveTo: null }],
      }),
    },
    driverVehicleAssignment: {
      findFirst: async () => current,
      findMany: async () => [current],
      update: async () => {
        writes++;
        throw new Error("zero-length period");
      },
      create: async () => {
        writes++;
        return current;
      },
    },
    guardDriverQueueTurn: { findFirst: async () => null },
    dispatchMasterDataAudit: audit,
  };
  const { status, result } = await invoke(
    vehicleRouter,
    "/driver-vehicle-assignments",
    {
      driverId: "driver",
      vehicleId: "vehicle",
      effectiveFrom: from.toISOString().slice(0, 10),
      reason: "legacy client",
    },
    tx,
  );
  assert.equal(status, 200, JSON.stringify(result));
  assert.equal(result.unchanged, true);
  assert.equal(writes, 0);
});
