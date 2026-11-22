import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  createAuthoritativeSession,
  SESSION_COOKIE,
} from "../src/services/identitySessionService";

assert.ok(
  process.env.DATABASE_URL?.includes("127.0.0.1:55432"),
  "Use the existing sabalanerp-local PostgreSQL only.",
);
const prisma = new PrismaClient();
const key = randomUUID();
const ids: {
  users: string[];
  drivers: string[];
  vehicles: string[];
  personnel: string[];
} = { users: [], drivers: [], vehicles: [], personnel: [] };
let checks = 0;
const request = async (
  token: string,
  path: string,
  method = "GET",
  data?: unknown,
  status = 200,
) => {
  const response = await fetch(
    "http://127.0.0.1:5000/api/dispatch-master-data" + path,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: SESSION_COOKIE + "=" + encodeURIComponent(token),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    },
  );
  const body: any = await response.json();
  assert.equal(response.status, status, path + ": " + JSON.stringify(body));
  checks++;
  return body;
};
const main = async () => {
  const actors = [];
  for (const role of ["ADMIN", "USER"] as const) {
    const actor = await prisma.user.create({
      data: {
        email: "hr-ops-" + role + "-" + key + "@example.invalid",
        username: "hr-ops-" + role + "-" + key,
        password: "unused-isolated-test",
        firstName: "آزمون",
        lastName: "ناوگان",
        role,
      },
    });
    ids.users.push(actor.id);
    actors.push(actor);
  }
  const [adminSession, forbiddenSession] = await Promise.all(
    actors.map((actor) =>
      createAuthoritativeSession(prisma, actor.id, {
        userAgent: "isolated-hr-vehicle-verifier",
      }),
    ),
  );
  const token = adminSession.token;
  const personnel = await prisma.personnel.create({
    data: { firstName: "راننده", lastName: "آزمون " + key },
  });
  ids.personnel.push(personnel.id);
  await prisma.hrEmploymentRelationship.create({
    data: {
      personnelId: personnel.id,
      status: "ACTIVE",
      effectiveFrom: new Date(Date.now() - 86400000),
      createdBy: actors[0].id,
    },
  });
  const created = await request(
    token,
    "/internal-drivers",
    "POST",
    { personnelId: personnel.id },
    201,
  );
  const driverId = created.data.id;
  ids.drivers.push(driverId);
  assert.equal(created.data.status, "DRAFT");
  assert.equal(created.data.licenceNumber, null);
  await request(
    token,
    "/internal-drivers/" + driverId + "/profile-status",
    "POST",
    { status: "ACTIVE" },
    400,
  );
  await request(
    token,
    "/internal-drivers/" + driverId + "/eligibility",
    "POST",
    { status: "SUSPENDED" },
  );
  await request(
    token,
    "/internal-drivers/" + driverId + "/eligibility",
    "POST",
    { status: "ELIGIBLE" },
  );
  const periods = await prisma.internalDriverEligibilityPeriod.findMany({
    where: { driverId },
    orderBy: { effectiveFrom: "asc" },
  });
  assert.equal(periods.length, 3);
  for (const period of periods.slice(0, -1))
    assert.ok(period.effectiveTo! > period.effectiveFrom);
  await request(token, "/internal-drivers/" + driverId + "/profile", "PUT", {
    licenceNumber: "HR-" + key,
    licenceClass: "پایه یک",
    licenceExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
  });
  await request(
    token,
    "/internal-drivers/" + driverId + "/profile-status",
    "POST",
    { status: "ACTIVE" },
  );
  const year = Number(
    new Intl.DateTimeFormat("en-US-u-ca-persian", {
      timeZone: "Asia/Tehran",
      year: "numeric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "year")!.value,
  );
  for (const index of [0, 1]) {
    const digits = String(randomInt(10000000)).padStart(7, "0");
    const vehicle = await request(
      token,
      "/company-vehicles",
      "POST",
      {
        fleetCode: "HR-OPS-" + key + "-" + index,
        vehicleType: "سواری",
        manufactureYear: year,
        plate:
          digits.slice(0, 2) +
          " ب " +
          digits.slice(2, 5) +
          " ایران " +
          digits.slice(5),
      },
      201,
    );
    ids.vehicles.push(vehicle.data.id);
    await request(
      token,
      "/company-vehicles/" + vehicle.data.id + "/status",
      "POST",
      { status: "ACTIVE" },
    );
  }
  const assign = async (vehicleId: string, extra: any = {}) => {
    const payload = { driverId, vehicleId, ...extra };
    const preview = await request(
      token,
      "/driver-vehicle-assignments/preview",
      "POST",
      payload,
    );
    return request(
      token,
      "/driver-vehicle-assignments",
      "POST",
      {
        ...payload,
        confirmed: true,
        expectedAssignmentIds: preview.data.current.map((item: any) => item.id),
        cancelPlanIds: preview.data.conflictingPlans.map(
          (item: any) => item.id,
        ),
      },
      201,
    );
  };
  const first = await assign(ids.vehicles[0]);
  const beforeCount = await prisma.driverVehicleAssignment.count({
    where: { driverId },
  });
  const repeat = await request(token, "/driver-vehicle-assignments", "POST", {
    driverId,
    vehicleId: ids.vehicles[0],
  });
  assert.equal(repeat.unchanged, true);
  assert.equal(
    await prisma.driverVehicleAssignment.count({ where: { driverId } }),
    beforeCount,
  );
  const second = await assign(ids.vehicles[1]);
  const old = await prisma.driverVehicleAssignment.findUniqueOrThrow({
    where: { id: first.data.id },
  });
  assert.equal(old.effectiveTo!.toISOString(), second.data.effectiveFrom);
  assert.ok(old.effectiveTo! > old.effectiveFrom);
  const plan = await assign(ids.vehicles[0], {
    effectiveFrom: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(plan.planned, true);
  const changed = await request(
    token,
    "/driver-vehicle-assignment-plans/" + plan.data.id,
    "PUT",
    {
      driverId,
      vehicleId: ids.vehicles[0],
      effectiveFrom: new Date(Date.now() + 7200000).toISOString(),
      expectedUpdatedAt: plan.data.updatedAt,
      confirmed: true,
      expectedAssignmentIds: [second.data.id],
      cancelPlanIds: [],
    },
  );
  await request(
    token,
    "/driver-vehicle-assignment-plans/" + plan.data.id + "/cancel",
    "POST",
    { confirmed: true, expectedUpdatedAt: changed.data.updatedAt },
  );
  assert.equal(
    (
      await prisma.driverVehicleAssignmentPlan.findUniqueOrThrow({
        where: { id: plan.data.id },
      })
    ).status,
    "CANCELLED",
  );
  await request(
    forbiddenSession.token,
    "/internal-drivers/" + driverId + "/end-activity",
    "POST",
    { confirmed: true },
    403,
  );
  assert.equal(
    (
      await prisma.internalDriverProfile.findUniqueOrThrow({
        where: { id: driverId },
      })
    ).status,
    "ACTIVE",
  );
  assert.equal(
    (
      await prisma.driverVehicleAssignment.findUniqueOrThrow({
        where: { id: second.data.id },
      })
    ).effectiveTo,
    null,
  );
  await request(
    token,
    "/driver-vehicle-assignments/" + second.data.id + "/end",
    "POST",
    { confirmed: true, cancelPlanIds: [] },
  );
  await assign(ids.vehicles[0]);
  await request(
    token,
    "/internal-drivers/" + driverId + "/end-activity",
    "POST",
    { confirmed: true, cancelPlanIds: [] },
  );
  assert.equal(
    (
      await prisma.internalDriverProfile.findUniqueOrThrow({
        where: { id: driverId },
      })
    ).status,
    "ARCHIVED",
  );
  assert.equal(
    await prisma.driverVehicleAssignment.count({
      where: { driverId, effectiveTo: null },
    }),
    0,
  );
  assert.equal(
    (await prisma.personnel.findUniqueOrThrow({ where: { id: personnel.id } }))
      .isActive,
    true,
  );
  await request(
    token,
    "/internal-drivers/" + driverId + "/profile-status",
    "POST",
    { status: "DRAFT" },
  );
  await request(
    token,
    "/internal-drivers/" + driverId + "/profile-status",
    "POST",
    { status: "ACTIVE" },
    400,
  );
  await request(token, "/company-vehicles/" + ids.vehicles[0], "PUT", {
    fleetCode: "HR-OPS-EDIT-" + key,
    vehicleType: "سواری",
    model: "مدل اصلاح‌شده",
    manufactureYear: year,
    vin: "VIN-" + key,
  });
  const conflict = await request(
    token,
    "/company-vehicles/" + ids.vehicles[1],
    "PUT",
    {
      fleetCode: "HR-OPS-EDIT-" + key,
      vehicleType: "سواری",
      manufactureYear: year,
    },
    409,
  );
  assert.match(conflict.error, /کد ناوگان/);
  await request(
    token,
    "/company-vehicles/" + ids.vehicles[0],
    "DELETE",
    {},
    400,
  );
  await request(
    token,
    "/company-vehicles/" + ids.vehicles[0] + "/status",
    "POST",
    { status: "ARCHIVED", confirmed: true, cancelPlanIds: [] },
  );
  await request(
    token,
    "/company-vehicles/" + ids.vehicles[0] + "/status",
    "POST",
    { status: "DRAFT" },
  );
  await request(
    token,
    "/company-vehicles/" + ids.vehicles[0] + "/status",
    "POST",
    { status: "ARCHIVED", confirmed: true, cancelPlanIds: [] },
  );
  assert.ok(
    (await prisma.dispatchMasterDataAudit.count({
      where: { subjectId: driverId },
    })) >= 10,
  );
  console.log(
    "PASS: " +
      checks +
      " local API assertions; same-day eligibility, no-op, transfer, future edit/cancel, permissions, ending, restoration and Persian conflict errors.",
  );
};
main()
  .finally(async () => {
    try {
      // Delete only this verifier's isolated non-operational fixtures; no Guard turns were created.
      await prisma.dispatchMasterDataAudit.deleteMany({
        where: { subjectId: { in: [...ids.drivers, ...ids.vehicles] } },
      });
      await prisma.driverVehicleAssignmentPlan.deleteMany({
        where: { driverId: { in: ids.drivers } },
      });
      await prisma.driverVehicleAssignment.deleteMany({
        where: { driverId: { in: ids.drivers } },
      });
      await prisma.internalDriverEligibilityPeriod.deleteMany({
        where: { driverId: { in: ids.drivers } },
      });
      await prisma.internalDriverProfile.deleteMany({
        where: { id: { in: ids.drivers } },
      });
      await prisma.companyVehiclePlate.deleteMany({
        where: { vehicleId: { in: ids.vehicles } },
      });
      await prisma.companyVehicle.deleteMany({
        where: { id: { in: ids.vehicles } },
      });
      await prisma.hrEmploymentRelationship.deleteMany({
        where: { personnelId: { in: ids.personnel } },
      });
      await prisma.personnel.deleteMany({
        where: { id: { in: ids.personnel } },
      });
      await prisma.authSession.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.recognizedBrowserProfile.deleteMany({
        where: { userId: { in: ids.users } },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    } finally {
      await prisma.$disconnect();
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
