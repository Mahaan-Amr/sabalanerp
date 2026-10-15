import { Prisma } from "@prisma/client";
import { appendDispatchMasterDataAudit } from "./dispatchMasterDataAudit";
import {
  effectivePeriodsOverlap,
  projectInternalDriverReadiness,
} from "./dispatchMasterDataPolicy";
import { authorizeHrUser } from "./hrAuthorizationService";
import { FEATURES } from "../middleware/feature";

type Tx = Prisma.TransactionClient;
export class HrVehicleError extends Error {
  constructor(
    message: string,
    public statusCode = 409,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const activePeriodAt = (at: Date) => ({
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
});
export const ordinaryChangeInstant = (
  value?: unknown,
  at = new Date(),
  allowFuture = false,
): Date => {
  if (!value || value === "NOW") return at;
  const text = String(value);
  const tehranDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  if (text === tehranDay || text === at.toISOString().slice(0, 10)) return at;
  const requested = new Date(
    text.length === 10 ? `${text}T00:00:00+03:30` : text,
  );
  if (Number.isNaN(requested.getTime()))
    throw new HrVehicleError(
      "تاریخ انتخاب‌شده معتبر نیست. تاریخ را دوباره انتخاب کنید.",
      400,
    );
  if (requested < at)
    throw new HrVehicleError(
      "ثبت تغییر با تاریخ گذشته از این مسیر مجاز نیست. برای تغییر فوری «همین حالا» را انتخاب کنید.",
      400,
    );
  if (!allowFuture)
    throw new HrVehicleError(
      "این تغییر باید از همین لحظه اعمال شود؛ زمان آینده فقط برای برنامه تخصیص مجاز است.",
      400,
    );
  return requested;
};
export const lockHrVehicleOperations = async (tx: Tx) => {
  // Admission and all master-data changes share this short transaction boundary.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('HR_VEHICLE_OPERATIONS'))`;
};

/** Row locks also invalidate a Serializable snapshot taken before a waiting advisory lock. */
export const lockHrDriverFacts = async (
  tx: Tx,
  driverId: string,
  at: Date,
  vehicleId?: string,
) => {
  await lockHrVehicleOperations(tx);
  await tx.$queryRaw`SELECT "id" FROM "internal_driver_profiles" WHERE "id" = ${driverId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "internal_driver_eligibility_periods" WHERE "driverId" = ${driverId}
    AND "effectiveFrom" <= ${at} AND ("effectiveTo" IS NULL OR "effectiveTo" > ${at}) FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "driver_vehicle_assignments" WHERE "driverId" = ${driverId}
    AND "effectiveFrom" <= ${at} AND ("effectiveTo" IS NULL OR "effectiveTo" > ${at}) FOR SHARE`;
  if (vehicleId) {
    await tx.$queryRaw`SELECT "id" FROM "company_vehicles" WHERE "id" = ${vehicleId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "company_vehicle_plates" WHERE "vehicleId" = ${vehicleId}
      AND "effectiveFrom" <= ${at} AND ("effectiveTo" IS NULL OR "effectiveTo" > ${at}) FOR SHARE`;
  }
};
export const afterPeriodStart = (
  at: Date,
  periods: { effectiveFrom: Date }[],
) =>
  new Date(
    Math.max(
      at.getTime(),
      ...periods.map((period) => period.effectiveFrom.getTime() + 1),
    ),
  );

const openStates = [
  "WAITING_AT_GATE",
  "AVAILABLE_FOR_LOADING",
  "RESERVED_FOR_LOADING",
  "LOADING_FINALIZED",
] as const;
const stageLabels: Record<string, string> = {
  WAITING_AT_GATE: "در انتظار گارد",
  AVAILABLE_FOR_LOADING: "آماده بارگیری",
  RESERVED_FOR_LOADING: "رزرو بارگیری",
  LOADING_FINALIZED: "بارگیری نهایی‌شده، پیش از خروج",
};
export const assertNoOpenHrOperations = async (
  tx: Tx,
  driverIds: string[],
  vehicleIds: string[],
) => {
  const turn = await tx.guardDriverQueueTurn.findFirst({
    where: {
      status: { in: [...openStates] },
      OR: [
        { internalDriverId: { in: driverIds } },
        { companyVehicleId: { in: vehicleIds } },
      ],
    },
    include: {
      internalDriver: { include: { personnel: true } },
      companyVehicle: { include: { plates: true } },
    },
    orderBy: { admittedAt: "asc" },
  });
  if (turn) {
    const person = turn.internalDriver?.personnel;
    const name = person ? `${person.firstName} ${person.lastName}` : "راننده";
    const plate =
      turn.companyVehicle?.plates.find(
        (item) =>
          item.effectiveFrom <= turn.admittedAt &&
          (!item.effectiveTo || item.effectiveTo > turn.admittedAt),
      )?.plate ||
      turn.companyVehicle?.fleetCode ||
      "خودرو";
    throw new HrVehicleError(
      `برای ${name} با خودرو ${plate} عملیات باز در مرحله «${stageLabels[turn.status]}» وجود دارد. ابتدا پرونده ارسال را در گارد یا لجستیک تعیین تکلیف کنید.`,
      409,
      { turnId: turn.id },
    );
  }
};
export const auditHrVehicle = (
  tx: Tx,
  subjectType:
    | "INTERNAL_DRIVER_PROFILE"
    | "COMPANY_VEHICLE"
    | "INTERNAL_DRIVER_ELIGIBILITY",
  subjectId: string,
  eventType: string,
  actorId: string,
  payload: unknown,
) =>
  appendDispatchMasterDataAudit(tx, {
    ownerScope:
      subjectType === "INTERNAL_DRIVER_ELIGIBILITY"
        ? "HR"
        : "VEHICLE_OPERATIONS",
    subjectType,
    subjectId,
    eventType,
    actorId,
    payload,
  });

export const validateDriverForAssignment = async (
  tx: Tx,
  driverId: string,
  vehicleId: string,
  at: Date,
) => {
  await lockHrDriverFacts(tx, driverId, at, vehicleId);
  const [driver, vehicle] = await Promise.all([
    tx.internalDriverProfile.findUnique({
      where: { id: driverId },
      include: {
        personnel: { include: { hrEmploymentRelationships: true } },
        eligibilityPeriods: {
          where: activePeriodAt(at),
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
    }),
    tx.companyVehicle.findUnique({
      where: { id: vehicleId },
      include: { plates: { where: activePeriodAt(at) } },
    }),
  ]);
  if (!driver)
    throw new HrVehicleError(
      "راننده پیدا نشد. فهرست را به‌روزرسانی کنید.",
      404,
    );
  if (!vehicle)
    throw new HrVehicleError("خودرو پیدا نشد. فهرست را به‌روزرسانی کنید.", 404);
  const readiness = projectInternalDriverReadiness(
    {
      personnelActive:
        driver.personnel.isActive && !driver.personnel.archivedAt,
      activeEmployment: driver.personnel.hrEmploymentRelationships.some(
        (item) =>
          item.status === "ACTIVE" &&
          item.effectiveFrom <= at &&
          (!item.effectiveTo || item.effectiveTo > at),
      ),
      eligible: driver.eligibilityPeriods[0]?.status === "ELIGIBLE",
      drivingProfileActive: driver.status === "ACTIVE",
      licenceNumber: driver.licenceNumber,
      licenceClass: driver.licenceClass,
      licenceExpiresAt: driver.licenceExpiresAt,
      assignmentActive: true,
      assignedVehicleActive: vehicle.status === "ACTIVE",
      assignedVehicleHasCurrentPlate: vehicle.plates.length > 0,
    },
    at,
  );
  const labels: Record<string, string> = {
    PERSONNEL_INACTIVE: "پرونده پرسنل فعال نیست",
    EMPLOYMENT_INACTIVE: "رابطه استخدامی فعال نیست",
    ELIGIBILITY_INACTIVE: "صلاحیت رانندگی فعال نیست",
    DRIVING_PROFILE_INACTIVE:
      "پروفایل راننده فعال نیست؛ ابتدا آن را تکمیل و فعال کنید",
    LICENCE_NUMBER_MISSING: "شماره گواهینامه ثبت نشده",
    LICENCE_CLASS_MISSING: "پایه گواهینامه ثبت نشده",
    LICENCE_EXPIRY_MISSING: "تاریخ اعتبار گواهینامه ثبت نشده",
    LICENCE_EXPIRED: "گواهینامه منقضی شده",
    VEHICLE_NOT_ACTIVE: "خودروی انتخاب‌شده فعال نیست",
    VEHICLE_PLATE_MISSING: "خودرو در زمان انتخاب‌شده پلاک معتبر ندارد",
  };
  if (readiness.blockers.length)
    throw new HrVehicleError(
      `تخصیص ممکن نیست: ${readiness.blockers.map((item) => labels[item]).join("؛ ")}. شرایط راننده و خودرو را اصلاح کنید.`,
      400,
    );
  return { driver, vehicle };
};

type AssignmentInput = {
  driverId: string;
  vehicleId: string;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
  expectedAssignmentIds?: string[];
  cancelPlanIds?: string[];
  confirmed?: boolean;
  ignorePlanId?: string;
};
const assertAssignmentIdentity = (input: AssignmentInput) => {
  if (typeof input.driverId !== "string" || !input.driverId.trim())
    throw new HrVehicleError(
      "راننده انتخاب نشده است. یک راننده انتخاب کنید.",
      400,
    );
  if (typeof input.vehicleId !== "string" || !input.vehicleId.trim())
    throw new HrVehicleError(
      "خودرو انتخاب نشده است. یک خودرو انتخاب کنید.",
      400,
    );
};
export const previewHrAssignment = async (
  tx: Tx,
  input: AssignmentInput,
  now = new Date(),
) => {
  assertAssignmentIdentity(input);
  const from = ordinaryChangeInstant(input.effectiveFrom, now, true);
  const to = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
  if (to && (Number.isNaN(to.getTime()) || to <= from))
    throw new HrVehicleError("پایان تخصیص باید بعد از شروع آن باشد.", 400);
  const { driver, vehicle } = await validateDriverForAssignment(
    tx,
    input.driverId,
    input.vehicleId,
    from,
  );
  let current = await tx.driverVehicleAssignment.findMany({
    where: {
      AND: [
        activePeriodAt(from),
        { OR: [{ driverId: input.driverId }, { vehicleId: input.vehicleId }] },
      ],
    },
    include: {
      driver: { include: { personnel: true } },
      vehicle: { include: { plates: true } },
    },
  });
  const relevantPlans = await tx.driverVehicleAssignmentPlan.findMany({
    where: {
      status: { in: ["PLANNED", "NEEDS_ATTENTION"] },
      id: { not: input.ignorePlanId },
      OR: [
        { driverId: input.driverId },
        { vehicleId: input.vehicleId },
        { expectedAssignmentIds: { hasSome: current.map((item) => item.id) } },
      ],
    },
    include: {
      driver: { include: { personnel: true } },
      vehicle: { include: { plates: true } },
    },
  });
  const conflictingPlans = relevantPlans.filter(
    (plan) =>
      (plan.driverId === input.driverId ||
        plan.vehicleId === input.vehicleId) &&
      (plan.action === "ASSIGN"
        ? effectivePeriodsOverlap(
            { from, to },
            { from: plan.effectiveFrom, to: plan.effectiveTo },
          )
        : current.some((item) => item.id === plan.assignmentId) &&
          (plan.effectiveFrom > from || plan.status === "NEEDS_ATTENTION")),
  );
  const anticipatedPlans =
    from > now
      ? relevantPlans.filter((plan) => {
          if (
            plan.status !== "PLANNED" ||
            plan.effectiveFrom > from ||
            conflictingPlans.some((item) => item.id === plan.id)
          )
            return false;
          if (plan.action === "END")
            return current.some((item) => item.id === plan.assignmentId);
          return (
            plan.expectedAssignmentIds.some((id) =>
              current.some((item) => item.id === id),
            ) &&
            ((plan.driverId !== input.driverId &&
              plan.vehicleId !== input.vehicleId) ||
              Boolean(plan.effectiveTo && plan.effectiveTo <= from))
          );
        })
      : [];
  // Earlier approved, non-overlapping plans will free these identities before this plan starts.
  // If an earlier plan fails, the actual IDs will differ and execution still stops for review.
  const anticipatedEnds = new Set(
    anticipatedPlans.flatMap((plan) =>
      plan.action === "END" ? [plan.assignmentId] : plan.expectedAssignmentIds,
    ),
  );
  current = current.filter((item) => !anticipatedEnds.has(item.id));
  if (from <= now)
    await assertNoOpenHrOperations(
      tx,
      [input.driverId, ...current.map((item) => item.driverId)],
      [input.vehicleId, ...current.map((item) => item.vehicleId)],
    );
  return {
    driver,
    vehicle,
    current,
    conflictingPlans,
    anticipatedPlans,
    effectiveFrom: from,
    effectiveTo: to,
  };
};
const sameIds = (left: string[], right: string[]) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
export const cancelHrAssignmentPlans = async (
  tx: Tx,
  ids: string[],
  actorId: string,
) => {
  for (const id of ids) {
    const plan = await tx.driverVehicleAssignmentPlan.findUnique({
      where: { id },
    });
    if (!plan || !["PLANNED", "NEEDS_ATTENTION"].includes(plan.status))
      throw new HrVehicleError(
        "وضعیت برنامه تغییر کرده است. فهرست را به‌روزرسانی کنید.",
      );
    await tx.driverVehicleAssignmentPlan.update({
      where: { id },
      data: { status: "CANCELLED", blockedReason: null },
    });
    await auditHrVehicle(
      tx,
      "INTERNAL_DRIVER_PROFILE",
      plan.driverId,
      "ASSIGNMENT_PLAN_CANCELLED",
      actorId,
      { planId: id, previous: plan },
    );
    await auditHrVehicle(
      tx,
      "COMPANY_VEHICLE",
      plan.vehicleId,
      "ASSIGNMENT_PLAN_CANCELLED",
      actorId,
      { planId: id },
    );
  }
};
export const closeHrAssignment = async (
  tx: Tx,
  assignment: {
    id: string;
    driverId: string;
    vehicleId: string;
    effectiveFrom: Date;
  },
  actorId: string,
  now: Date,
) => {
  const at = afterPeriodStart(now, [assignment]);
  await tx.driverVehicleAssignment.update({
    where: { id: assignment.id },
    data: { effectiveTo: at },
  });
  await auditHrVehicle(
    tx,
    "INTERNAL_DRIVER_PROFILE",
    assignment.driverId,
    "VEHICLE_ASSIGNMENT_ENDED",
    actorId,
    {
      assignmentId: assignment.id,
      vehicleId: assignment.vehicleId,
      effectiveTo: at,
    },
  );
  await auditHrVehicle(
    tx,
    "COMPANY_VEHICLE",
    assignment.vehicleId,
    "VEHICLE_ASSIGNMENT_ENDED",
    actorId,
    {
      assignmentId: assignment.id,
      driverId: assignment.driverId,
      effectiveTo: at,
    },
  );
  return at;
};
export const assignHrVehicle = async (
  tx: Tx,
  input: AssignmentInput,
  actorId: string,
  now = new Date(),
) => {
  assertAssignmentIdentity(input);
  // Repeating the active pairing is intentionally independent of readiness and has no writes.
  const from = ordinaryChangeInstant(input.effectiveFrom, now, true);
  const existing = await tx.driverVehicleAssignment.findFirst({
    where: {
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      ...activePeriodAt(now),
    },
  });
  if (
    from <= now &&
    existing &&
    input.effectiveTo &&
    !input.cancelPlanIds?.length
  ) {
    const deadline = new Date(String(input.effectiveTo));
    if (!Number.isNaN(deadline.getTime()) && deadline > now) {
      const sameEnd = await tx.driverVehicleAssignmentPlan.findFirst({
        where: {
          assignmentId: existing.id,
          action: "END",
          status: "PLANNED",
          effectiveFrom: deadline,
        },
      });
      if (sameEnd)
        return {
          data: existing,
          unchanged: true,
          message: "موعد پایان این تخصیص از قبل ثبت شده است.",
        };
    }
  }
  if (from <= now && existing && !input.effectiveTo)
    return {
      data: existing,
      unchanged: true,
      message: "این خودرو از قبل به این راننده تخصیص دارد.",
    };
  const preview = await previewHrAssignment(tx, input, now);
  if (!input.confirmed)
    throw new HrVehicleError(
      "نتیجه انتقال یا برنامه پایان تخصیص را پیش از ثبت تأیید کنید.",
    );
  if (
    !sameIds(
      input.expectedAssignmentIds || [],
      preview.current.map((item) => item.id),
    )
  )
    throw new HrVehicleError(
      "تخصیص جاری با وضعیت تأییدشده برای این اقدام یکسان نیست. فهرست و نتیجه برنامه‌های قبلی را به‌روزرسانی و انتقال را دوباره بررسی کنید.",
      409,
      preview,
    );
  const cancelling = input.cancelPlanIds || [];
  if (
    !sameIds(
      cancelling,
      preview.conflictingPlans.map((item) => item.id),
    )
  )
    throw new HrVehicleError(
      "برنامه‌های متعارض را لغو کنید یا زمان پایان تخصیص جدید را پیش از آن‌ها قرار دهید.",
      409,
      preview,
    );
  await cancelHrAssignmentPlans(tx, cancelling, actorId);
  if (from <= now && existing && preview.effectiveTo) {
    const sameEnd = await tx.driverVehicleAssignmentPlan.findFirst({
      where: {
        assignmentId: existing.id,
        action: "END",
        status: "PLANNED",
        effectiveFrom: preview.effectiveTo,
      },
    });
    if (sameEnd)
      return {
        data: existing,
        unchanged: true,
        message: "موعد پایان این تخصیص از قبل ثبت شده است.",
      };
    const endPlan = await tx.driverVehicleAssignmentPlan.create({
      data: {
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        assignmentId: existing.id,
        action: "END",
        effectiveFrom: preview.effectiveTo,
        createdBy: actorId,
      },
    });
    await auditHrVehicle(
      tx,
      "INTERNAL_DRIVER_PROFILE",
      input.driverId,
      "ASSIGNMENT_END_PLANNED",
      actorId,
      { endPlan },
    );
    await auditHrVehicle(
      tx,
      "COMPANY_VEHICLE",
      input.vehicleId,
      "ASSIGNMENT_END_PLANNED",
      actorId,
      { endPlan },
    );
    return {
      data: existing,
      endPlan,
      planned: true,
      message: "پایان تخصیص برنامه‌ریزی شد؛ تخصیص جاری تا آن موعد حفظ می‌شود.",
    };
  }
  if (preview.effectiveFrom > now) {
    const plan = await tx.driverVehicleAssignmentPlan.create({
      data: {
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        effectiveFrom: preview.effectiveFrom,
        effectiveTo: preview.effectiveTo,
        createdBy: actorId,
        expectedAssignmentIds: preview.current.map((item) => item.id),
      },
    });
    await auditHrVehicle(
      tx,
      "INTERNAL_DRIVER_PROFILE",
      input.driverId,
      "ASSIGNMENT_PLAN_CREATED",
      actorId,
      { plan },
    );
    await auditHrVehicle(
      tx,
      "COMPANY_VEHICLE",
      input.vehicleId,
      "ASSIGNMENT_PLAN_CREATED",
      actorId,
      { planId: plan.id, driverId: input.driverId },
    );
    return { data: plan, planned: true };
  }
  const at = afterPeriodStart(now, preview.current);
  for (const current of preview.current)
    await closeHrAssignment(tx, current, actorId, at);
  const assignment = await tx.driverVehicleAssignment.create({
    data: {
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      effectiveFrom: at,
      reason: "ثبت خودکار تخصیص خودرو",
      recordedBy: actorId,
    },
  });
  if (preview.effectiveTo)
    await tx.driverVehicleAssignmentPlan.create({
      data: {
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        assignmentId: assignment.id,
        action: "END",
        effectiveFrom: preview.effectiveTo,
        createdBy: actorId,
      },
    });
  await auditHrVehicle(
    tx,
    "INTERNAL_DRIVER_PROFILE",
    input.driverId,
    "VEHICLE_ASSIGNED",
    actorId,
    {
      assignment,
      previousAssignmentIds: preview.current.map((item) => item.id),
    },
  );
  await auditHrVehicle(
    tx,
    "COMPANY_VEHICLE",
    input.vehicleId,
    "DRIVER_ASSIGNED",
    actorId,
    { assignment },
  );
  return { data: assignment };
};

export const endHrAssignment = async (
  tx: Tx,
  id: string,
  actorId: string,
  confirmedPlanIds?: string[],
  now = new Date(),
) => {
  const current = await tx.driverVehicleAssignment.findUnique({
    where: { id },
  });
  if (!current)
    throw new HrVehicleError("تخصیص پیدا نشد. فهرست را به‌روزرسانی کنید.", 404);
  if (current.effectiveTo && current.effectiveTo <= now) return current;
  await assertNoOpenHrOperations(tx, [current.driverId], [current.vehicleId]);
  const endPlans = await tx.driverVehicleAssignmentPlan.findMany({
    where: { assignmentId: id, status: { in: ["PLANNED", "NEEDS_ATTENTION"] } },
  });
  if (
    !sameIds(
      confirmedPlanIds || [],
      endPlans.map((item) => item.id),
    )
  )
    throw new HrVehicleError(
      "برای این تخصیص پایان برنامه‌ریزی‌شده وجود دارد. لغو آن را همراه پایان فوری تأیید کنید.",
      409,
      { plans: endPlans },
    );
  await cancelHrAssignmentPlans(
    tx,
    endPlans.map((item) => item.id),
    actorId,
  );
  await closeHrAssignment(tx, current, actorId, now);
  return current;
};

export const endHrSubjectAssignments = async (
  tx: Tx,
  where: { driverId?: string; vehicleId?: string },
  actorId: string,
  cancelPlanIds: string[],
  now: Date,
) => {
  const current = await tx.driverVehicleAssignment.findMany({
    where: { ...where, ...activePeriodAt(now) },
  });
  await assertNoOpenHrOperations(
    tx,
    [
      ...current.map((item) => item.driverId),
      ...(where.driverId ? [where.driverId] : []),
    ],
    [
      ...current.map((item) => item.vehicleId),
      ...(where.vehicleId ? [where.vehicleId] : []),
    ],
  );
  const plans = await tx.driverVehicleAssignmentPlan.findMany({
    where: { ...where, status: { in: ["PLANNED", "NEEDS_ATTENTION"] } },
  });
  if (
    !sameIds(
      cancelPlanIds,
      plans.map((item) => item.id),
    )
  )
    throw new HrVehicleError(
      "برنامه‌های آینده تغییر کرده‌اند. فهرست را به‌روزرسانی و لغو برنامه‌ها را تأیید کنید.",
      409,
      { plans },
    );
  await cancelHrAssignmentPlans(tx, cancelPlanIds, actorId);
  for (const item of current) await closeHrAssignment(tx, item, actorId, now);
};

export const executeHrAssignmentPlan = async (
  tx: Tx,
  id: string,
  actorId: string,
  automatic: boolean,
  input: { expectedAssignmentIds?: string[]; cancelPlanIds?: string[] } = {},
  now = new Date(),
) => {
  const plan = await tx.driverVehicleAssignmentPlan.findUnique({
    where: { id },
  });
  if (!plan)
    throw new HrVehicleError(
      "برنامه تخصیص پیدا نشد. فهرست را به‌روزرسانی کنید.",
      404,
    );
  if (!["PLANNED", "NEEDS_ATTENTION"].includes(plan.status)) return plan;
  if (automatic && plan.status !== "PLANNED") return plan;
  if (plan.effectiveFrom > now)
    throw new HrVehicleError("زمان اجرای این برنامه هنوز نرسیده است.", 400);
  if (automatic) {
    actorId = plan.createdBy;
    const access = await authorizeHrUser(
      tx,
      plan.createdBy,
      {
        workspaceLevel: "EDIT",
        feature: {
          code: FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE,
          level: "EDIT",
        },
      },
      now,
    );
    if (!access.allowed)
      throw new HrVehicleError(
        "مجوز ثبت‌کننده برنامه دیگر فعال نیست. کاربر دارای مجوز باید برنامه را بررسی و اجرا کند.",
        403,
      );
  }
  if (plan.action === "END") {
    const assignment = await tx.driverVehicleAssignment.findUnique({
      where: { id: plan.assignmentId || "" },
    });
    if (
      !assignment ||
      (assignment.effectiveTo && assignment.effectiveTo <= now)
    ) {
      await cancelHrAssignmentPlans(tx, [plan.id], actorId);
      return plan;
    }
    await assertNoOpenHrOperations(
      tx,
      [assignment.driverId],
      [assignment.vehicleId],
    );
    await closeHrAssignment(tx, assignment, actorId, now);
  } else {
    const result = await assignHrVehicle(
      tx,
      {
        driverId: plan.driverId,
        vehicleId: plan.vehicleId,
        effectiveFrom: "NOW",
        effectiveTo: plan.effectiveTo,
        ignorePlanId: plan.id,
        confirmed: true,
        expectedAssignmentIds: automatic
          ? plan.expectedAssignmentIds
          : input.expectedAssignmentIds,
        cancelPlanIds: automatic ? [] : input.cancelPlanIds,
      },
      actorId,
      now,
    );
    await tx.driverVehicleAssignmentPlan.update({
      where: { id },
      data: { assignmentId: result.data.id },
    });
  }
  const after = await tx.driverVehicleAssignmentPlan.update({
    where: { id },
    data: { status: "APPLIED", blockedReason: null },
  });
  await auditHrVehicle(
    tx,
    "INTERNAL_DRIVER_PROFILE",
    plan.driverId,
    "ASSIGNMENT_PLAN_APPLIED",
    actorId,
    { planId: id, plannedTime: plan.effectiveFrom, actualTime: now, automatic },
  );
  await auditHrVehicle(
    tx,
    "COMPANY_VEHICLE",
    plan.vehicleId,
    "ASSIGNMENT_PLAN_APPLIED",
    actorId,
    { planId: id, actualTime: now },
  );
  return after;
};
