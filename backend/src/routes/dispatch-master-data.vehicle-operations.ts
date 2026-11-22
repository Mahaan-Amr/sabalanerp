import { createVehicleAssignmentRoutes } from "./vehicle-assignment-routes";
import express from "express";
import {
  HrVehicleError,
  activePeriodAt,
  afterPeriodStart,
  ordinaryChangeInstant,
  lockHrVehicleOperations,
  assertNoOpenHrOperations,
  auditHrVehicle,
  endHrSubjectAssignments,
  previewHrAssignment,
  assignHrVehicle,
  endHrAssignment,
  cancelHrAssignmentPlans,
  executeHrAssignmentPlan,
  validateDriverForAssignment,
} from "../services/hrVehicleOperations";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { FEATURES } from "../middleware/feature";
import { requireHrFeature } from "../middleware/hrAuthorization";
import { appendDispatchMasterDataAudit } from "../services/dispatchMasterDataAudit";
import {
  assertLifecycleTransition,
  assertValidEffectivePeriod,
  canPermanentlyDeleteDraft,
  normalizeIranianPlate,
} from "../services/dispatchMasterDataPolicy";
import { authorizeHrUser } from "../services/hrAuthorizationService";
import {
  activeAt,
  actor,
  fail,
  internalInclude,
  optionalDate,
  optionalText,
  parsedDate,
  prisma,
  projectDriver,
  requiredText,
} from "./dispatch-master-data.shared";

import {
  requireCompanyPlate,
  requireManufactureYear,
} from "../services/companyVehicleEntry";

const router = express.Router();
const view = requireHrFeature(FEATURES.HR_VEHICLE_OPERATIONS_VIEW, "VIEW");
const manageProfiles = requireHrFeature(
  FEATURES.HR_DRIVER_PROFILES_MANAGE,
  "EDIT",
);
const manageVehicles = requireHrFeature(
  FEATURES.HR_COMPANY_VEHICLES_MANAGE,
  "EDIT",
);
const managePlates = requireHrFeature(
  FEATURES.HR_VEHICLE_PLATES_MANAGE,
  "EDIT",
);
const manageEligibility = requireHrFeature(
  FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE,
  "EDIT",
);
const manageAssignments = requireHrFeature(
  FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE,
  "EDIT",
);

const capabilitiesFor = async (req: AuthRequest) => {
  const decide = (feature: string) =>
    authorizeHrUser(prisma, actor(req), {
      workspaceLevel: "EDIT",
      feature: { code: feature, level: "EDIT" },
    });
  const [profiles, vehicles, plates, assignments] = await Promise.all([
    decide(FEATURES.HR_DRIVER_PROFILES_MANAGE),
    decide(FEATURES.HR_COMPANY_VEHICLES_MANAGE),
    decide(FEATURES.HR_VEHICLE_PLATES_MANAGE),
    decide(FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE),
  ]);
  const eligibility = await decide(
    FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE,
  );
  return {
    canManageEligibility: eligibility.allowed,
    canManageProfiles: profiles.allowed,
    canManageCompanyVehicles: vehicles.allowed,
    canManagePlates: plates.allowed,
    canManageAssignments: assignments.allowed,
  };
};

router.get(
  "/vehicle-operations/internal-drivers",
  view,
  async (req: AuthRequest, res) => {
    try {
      const at = req.query.at ? parsedDate(req.query.at, "at") : new Date();
      const drivers = await prisma.internalDriverProfile.findMany({
        include: internalInclude,
        orderBy: { createdAt: "desc" },
      });
      return res.json({
        success: true,
        data: drivers.map((driver) => projectDriver(driver, at)),
        capabilities: await capabilitiesFor(req),
      });
    } catch (error) {
      return fail(res, error, "List Vehicle Operations driving profiles");
    }
  },
);

router.put(
  "/internal-drivers/:id/profile",
  manageProfiles,
  async (req: AuthRequest, res) => {
    try {
      const reason = "ثبت خودکار اقدام راننده و خودرو";
      const result = await prisma.$transaction(async (tx) => {
        await lockHrVehicleOperations(tx);
        const previous = await tx.internalDriverProfile.findUnique({
          where: { id: req.params.id },
        });
        if (!previous)
          throw new Error("Internal driving profile was not found.");
        if (previous.status === "ARCHIVED")
          throw new Error("Restore the archived profile before editing it.");
        const updated = await tx.internalDriverProfile.update({
          where: { id: previous.id },
          data: {
            licenceNumber: optionalText(req.body.licenceNumber),
            licenceClass: optionalText(req.body.licenceClass),
            licenceExpiresAt: optionalDate(
              req.body.licenceExpiresAt,
              "licenceExpiresAt",
            ),
            notes: optionalText(req.body.notes),
          },
        });
        await appendDispatchMasterDataAudit(tx, {
          ownerScope: "VEHICLE_OPERATIONS",
          subjectType: "INTERNAL_DRIVER_PROFILE",
          subjectId: updated.id,
          eventType: "DRIVING_PROFILE_UPDATED",
          payload: { before: previous, after: updated, automaticAction: true },
          actorId: actor(req),
        });
        return tx.internalDriverProfile.findUniqueOrThrow({
          where: { id: updated.id },
          include: internalInclude,
        });
      });
      return res.json({ success: true, data: projectDriver(result) });
    } catch (error) {
      return fail(res, error, "Update internal driving profile");
    }
  },
);

router.post(
  "/internal-drivers/:id/profile-status",
  manageProfiles,
  async (req: AuthRequest, res) => {
    try {
      const next = requiredText(req.body.status, "status") as
        "DRAFT" | "ACTIVE" | "ARCHIVED";
      const reason = "ثبت خودکار اقدام راننده و خودرو";
      const updated = await prisma.$transaction(async (tx) => {
        await lockHrVehicleOperations(tx);
        const current = await tx.internalDriverProfile.findUnique({
          where: { id: req.params.id },
        });
        if (!current)
          throw new Error("Internal driving profile was not found.");
        if (current.status === next) return current;
        await tx.$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext($1))",
          `DRIVER_BIOMETRIC:${current.id}`,
        );
        if (next === "ARCHIVED")
          throw new HrVehicleError(
            "برای پایان فعالیت از گزینه «پایان فعالیت رانندگی» استفاده کنید.",
            400,
          );
        assertLifecycleTransition(
          "INTERNAL_DRIVER_PROFILE",
          current.status,
          next,
        );
        if (next === "ACTIVE") {
          const full = await tx.internalDriverProfile.findUniqueOrThrow({
            where: { id: current.id },
            include: internalInclude,
          });
          const at = new Date();
          if (
            !full.personnel.isActive ||
            full.personnel.archivedAt ||
            !full.personnel.hrEmploymentRelationships.some(
              (item) =>
                item.status === "ACTIVE" &&
                item.effectiveFrom <= at &&
                (!item.effectiveTo || item.effectiveTo > at),
            )
          )
            throw new HrVehicleError(
              "پرونده پرسنل یا رابطه استخدامی فعال نیست. ابتدا وضعیت پرسنل را اصلاح کنید.",
              400,
            );
          if (
            !full.eligibilityPeriods.some(
              (item) =>
                item.status === "ELIGIBLE" &&
                item.effectiveFrom <= at &&
                (!item.effectiveTo || item.effectiveTo > at),
            )
          )
            throw new HrVehicleError(
              "صلاحیت رانندگی فعال نیست. ابتدا از صفحه صلاحیت رانندگی پرسنل، صلاحیت را برقرار کنید.",
              400,
            );
        }
        if (
          next === "ACTIVE" &&
          (!current.licenceNumber ||
            !current.licenceClass ||
            !current.licenceExpiresAt ||
            current.licenceExpiresAt <= new Date())
        )
          throw new Error(
            "A licence number, licence class, and future licence expiry are required for activation.",
          );
        const record = await tx.internalDriverProfile.update({
          where: { id: current.id },
          data: { status: next },
        });
        await appendDispatchMasterDataAudit(tx, {
          ownerScope: "VEHICLE_OPERATIONS",
          subjectType: "INTERNAL_DRIVER_PROFILE",
          subjectId: record.id,
          eventType: `DRIVING_PROFILE_${next}`,
          payload: { reason },
          actorId: actor(req),
        });
        return record;
      });
      return res.json({ success: true, data: updated });
    } catch (error) {
      return fail(res, error, "Transition internal driving profile");
    }
  },
);

router.get("/company-vehicles", view, async (req: AuthRequest, res) => {
  try {
    const includeArchived =
      req.query.archived === "include" || req.query.archived === "only";
    const onlyArchived = req.query.archived === "only";
    const vehicles = await prisma.companyVehicle.findMany({
      where: onlyArchived
        ? { status: "ARCHIVED" }
        : includeArchived
          ? {}
          : { status: { not: "ARCHIVED" } },
      include: {
        plates: { orderBy: { effectiveFrom: "desc" } },
        assignments: {
          include: { driver: { include: { personnel: true } } },
          orderBy: { effectiveFrom: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({
      success: true,
      data: vehicles.map((vehicle) => ({
        ...vehicle,
        source: "COMPANY_FLEET",
      })),
      capabilities: await capabilitiesFor(req),
      filters: {
        archived: onlyArchived
          ? "only"
          : includeArchived
            ? "include"
            : "exclude",
      },
    });
  } catch (error) {
    return fail(res, error, "List company vehicles");
  }
});

router.post(
  "/company-vehicles",
  manageVehicles,
  async (req: AuthRequest, res) => {
    try {
      const reason = "ثبت خودکار اقدام راننده و خودرو";
      const manufactureYear = requireManufactureYear(req.body.manufactureYear);
      const initialPlate = requireCompanyPlate(req.body.plate);
      const vehicle = await prisma.$transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          const created = await tx.companyVehicle.create({
            data: {
              fleetCode: requiredText(req.body.fleetCode, "fleetCode"),
              vehicleType: requiredText(req.body.vehicleType, "vehicleType"),
              make: optionalText(req.body.make),
              model: optionalText(req.body.model),
              manufactureYear,
              vin: optionalText(req.body.vin),
              notes: optionalText(req.body.notes),
              statusReason: reason,
              statusRecordedBy: actor(req),
              createdBy: actor(req),
            },
          });
          if (req.body.plate) {
            const effectiveFrom = ordinaryChangeInstant(req.body.effectiveFrom);
            const plate = initialPlate;
            await tx.companyVehiclePlate.create({
              data: {
                vehicleId: created.id,
                plate,
                normalizedPlate: normalizeIranianPlate(plate),
                effectiveFrom,
                reason,
                recordedBy: actor(req),
              },
            });
          }
          await appendDispatchMasterDataAudit(tx, {
            ownerScope: "VEHICLE_OPERATIONS",
            subjectType: "COMPANY_VEHICLE",
            subjectId: created.id,
            eventType: "COMPANY_VEHICLE_DRAFT_CREATED",
            payload: { fleetCode: created.fleetCode, reason },
            actorId: actor(req),
          });
          return tx.companyVehicle.findUniqueOrThrow({
            where: { id: created.id },
            include: { plates: true, assignments: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res
        .status(201)
        .json({ success: true, data: { ...vehicle, source: "COMPANY_FLEET" } });
    } catch (error) {
      return fail(res, error, "Create company-vehicle draft");
    }
  },
);

router.post(
  "/company-vehicles/:id/plates",
  managePlates,
  async (req: AuthRequest, res) => {
    try {
      let effectiveFrom = ordinaryChangeInstant(req.body.effectiveFrom);
      const plate = requireCompanyPlate(req.body.plate);
      const reason = "ثبت خودکار اقدام راننده و خودرو";
      const result = await prisma.$transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          effectiveFrom = ordinaryChangeInstant(req.body.effectiveFrom);
          const vehicle = await tx.companyVehicle.findUnique({
            where: { id: req.params.id },
          });
          if (!vehicle || vehicle.status === "ARCHIVED")
            throw new Error("An unarchived company vehicle is required.");
          await assertNoOpenHrOperations(tx, [], [req.params.id]);
          const current = await tx.companyVehiclePlate.findFirst({
            where: { vehicleId: vehicle.id, ...activeAt(effectiveFrom) },
            orderBy: { effectiveFrom: "desc" },
          });
          if (current?.normalizedPlate === normalizeIranianPlate(plate))
            return current;
          effectiveFrom = afterPeriodStart(
            effectiveFrom,
            current ? [current] : [],
          );
          if (current)
            await tx.companyVehiclePlate.update({
              where: { id: current.id },
              data: { effectiveTo: effectiveFrom },
            });
          const created = await tx.companyVehiclePlate.create({
            data: {
              vehicleId: vehicle.id,
              plate,
              normalizedPlate: normalizeIranianPlate(plate),
              effectiveFrom,
              reason,
              recordedBy: actor(req),
            },
          });
          await appendDispatchMasterDataAudit(tx, {
            ownerScope: "VEHICLE_OPERATIONS",
            subjectType: "COMPANY_VEHICLE",
            subjectId: vehicle.id,
            eventType: "VEHICLE_PLATE_CHANGED",
            payload: { plateId: created.id, plate, effectiveFrom, reason },
            actorId: actor(req),
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      return fail(res, error, "Change company vehicle plate");
    }
  },
);

router.post(
  "/company-vehicles/:id/status",
  manageVehicles,
  async (req: AuthRequest, res) => {
    try {
      const next = requiredText(req.body.status, "status") as
        "DRAFT" | "ACTIVE" | "OUT_OF_SERVICE" | "ARCHIVED";
      const reason = "ثبت خودکار اقدام راننده و خودرو";
      let effectiveFrom = ordinaryChangeInstant(req.body.effectiveFrom);
      if (effectiveFrom > new Date())
        throw new Error("Lifecycle changes cannot take effect in the future.");
      const updated = await prisma.$transaction(async (tx) => {
        await lockHrVehicleOperations(tx);
        effectiveFrom = ordinaryChangeInstant(req.body.effectiveFrom);
        const current = await tx.companyVehicle.findUnique({
          where: { id: req.params.id },
          include: { plates: true },
        });
        if (!current) throw new Error("Company vehicle was not found.");
        if (current.status === next) return current;
        if (next === "ARCHIVED") {
          const access = await authorizeHrUser(tx, actor(req), {
            workspaceLevel: "EDIT",
            feature: {
              code: FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE,
              level: "EDIT",
            },
          });
          if (!access.allowed)
            throw new HrVehicleError(
              "برای بایگانی همراه پایان تخصیص، مجوز مدیریت تخصیص خودرو هم لازم است.",
              403,
            );
          if (!req.body.confirmed)
            throw new HrVehicleError(
              "پایان تخصیص جاری و لغو برنامه‌های آینده را پیش از بایگانی تأیید کنید.",
            );
          await endHrSubjectAssignments(
            tx,
            { vehicleId: current.id },
            actor(req),
            req.body.cancelPlanIds || [],
            new Date(),
          );
        }
        assertLifecycleTransition("COMPANY_VEHICLE", current.status, next);
        if (
          next === "ACTIVE" &&
          !current.plates.some(
            (plate) =>
              plate.effectiveFrom <= effectiveFrom &&
              (!plate.effectiveTo || plate.effectiveTo > effectiveFrom),
          )
        )
          throw new Error(
            "A current effective plate is required for activation.",
          );
        const record = await tx.companyVehicle.update({
          where: { id: current.id },
          data: {
            status: next,
            statusEffectiveFrom: effectiveFrom,
            statusReason: reason,
            statusRecordedBy: actor(req),
          },
        });
        await appendDispatchMasterDataAudit(tx, {
          ownerScope: "VEHICLE_OPERATIONS",
          subjectType: "COMPANY_VEHICLE",
          subjectId: record.id,
          eventType: `COMPANY_VEHICLE_${next}`,
          payload: { effectiveFrom, reason },
          actorId: actor(req),
        });
        return record;
      });
      return res.json({ success: true, data: updated });
    } catch (error) {
      return fail(res, error, "Transition company vehicle");
    }
  },
);

router.delete(
  "/company-vehicles/:id",
  manageVehicles,
  async (req: AuthRequest, res) => {
    try {
      const deleted = await prisma.$transaction(async (tx) => {
        await lockHrVehicleOperations(tx);
        const current = await tx.companyVehicle.findUnique({
          where: { id: req.params.id },
          include: {
            _count: {
              select: {
                assignments: true,
                assignmentPlans: true,
                guardQueueTurns: true,
              },
            },
          },
        });
        if (!current) throw new Error("Company vehicle was not found.");
        if (
          !canPermanentlyDeleteDraft({
            status: current.status,
            dependencyCount:
              current._count.assignments +
              current._count.assignmentPlans +
              current._count.guardQueueTurns,
          })
        )
          throw new Error("Only an unused draft may be permanently deleted.");
        await appendDispatchMasterDataAudit(tx, {
          ownerScope: "VEHICLE_OPERATIONS",
          subjectType: "COMPANY_VEHICLE",
          subjectId: current.id,
          eventType: "COMPANY_VEHICLE_DRAFT_DELETED",
          payload: { reason: "حذف پیش‌نویس استفاده‌نشده خودرو" },
          actorId: actor(req),
        });
        await tx.companyVehiclePlate.deleteMany({
          where: { vehicleId: current.id },
        });
        await tx.companyVehicle.delete({ where: { id: current.id } });
        return current.id;
      });
      return res.json({ success: true, data: { id: deleted } });
    } catch (error) {
      return fail(res, error, "Delete company-vehicle draft");
    }
  },
);

router.get(
  "/vehicle-operations/personnel-candidates",
  manageEligibility,
  async (req: AuthRequest, res) => {
    try {
      const data = await prisma.personnel.findMany({
        where: {
          isActive: true,
          archivedAt: null,
          internalDriverProfile: null,
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { lastName: "asc" },
      });
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "Driver Personnel candidates");
    }
  },
);

router.put(
  "/company-vehicles/:id",
  manageVehicles,
  async (req: AuthRequest, res) => {
    try {
      const data = await prisma.$transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          const before = await tx.companyVehicle.findUnique({
            where: { id: req.params.id },
          });
          if (!before)
            throw new HrVehicleError(
              "خودرو پیدا نشد. فهرست را به‌روزرسانی کنید.",
              404,
            );
          if (before.status === "ARCHIVED")
            throw new HrVehicleError(
              "ابتدا خودرو را از بایگانی به پیش‌نویس بازگردانید.",
              400,
            );
          const after = await tx.companyVehicle.update({
            where: { id: before.id },
            data: {
              fleetCode: requiredText(req.body.fleetCode, "fleetCode"),
              vehicleType: requiredText(req.body.vehicleType, "vehicleType"),
              make: optionalText(req.body.make),
              model: optionalText(req.body.model),
              manufactureYear: requireManufactureYear(req.body.manufactureYear),
              vin: optionalText(req.body.vin),
              notes: optionalText(req.body.notes),
            },
          });
          await auditHrVehicle(
            tx,
            "COMPANY_VEHICLE",
            before.id,
            "COMPANY_VEHICLE_UPDATED",
            actor(req),
            { before, after },
          );
          return after;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "Update company vehicle");
    }
  },
);

router.post(
  "/internal-drivers/:id/end-activity",
  manageProfiles,
  manageEligibility,
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      const data = await prisma.$transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          const driver = await tx.internalDriverProfile.findUnique({
            where: { id: req.params.id },
          });
          if (!driver)
            throw new HrVehicleError(
              "راننده پیدا نشد. فهرست را به‌روزرسانی کنید.",
              404,
            );
          if (!req.body.confirmed)
            throw new HrVehicleError(
              "پایان صلاحیت، بایگانی پروفایل و پایان تخصیص را تأیید کنید.",
            );
          if (driver.status === "ARCHIVED") return driver;
          await tx.$executeRawUnsafe(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            `DRIVER_BIOMETRIC:${driver.id}`,
          );
          const now = new Date();
          await endHrSubjectAssignments(
            tx,
            { driverId: driver.id },
            actor(req),
            req.body.cancelPlanIds || [],
            now,
          );
          const current = await tx.internalDriverEligibilityPeriod.findFirst({
            where: { driverId: driver.id, ...activePeriodAt(now) },
          });
          const at = afterPeriodStart(now, current ? [current] : []);
          if (current)
            await tx.internalDriverEligibilityPeriod.update({
              where: { id: current.id },
              data: { effectiveTo: at },
            });
          await tx.internalDriverEligibilityPeriod.create({
            data: {
              driverId: driver.id,
              status: "ENDED",
              effectiveFrom: at,
              reason: "پایان فعالیت رانندگی",
              recordedBy: actor(req),
            },
          });
          await auditHrVehicle(
            tx,
            "INTERNAL_DRIVER_ELIGIBILITY",
            driver.id,
            "ELIGIBILITY_ENDED",
            actor(req),
            { previous: current, effectiveFrom: at },
          );
          const after = await tx.internalDriverProfile.update({
            where: { id: driver.id },
            data: { status: "ARCHIVED" },
          });
          await auditHrVehicle(
            tx,
            "INTERNAL_DRIVER_PROFILE",
            driver.id,
            "DRIVING_ACTIVITY_ENDED",
            actor(req),
            { before: driver, after },
          );
          return after;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "End driving activity");
    }
  },
);

router.use(createVehicleAssignmentRoutes());

export default router;
