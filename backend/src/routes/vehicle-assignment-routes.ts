import express from "express";
import { Prisma } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { FEATURES } from "../middleware/feature";
import { requireHrFeature } from "../middleware/hrAuthorization";
import { actor, fail, prisma } from "./dispatch-master-data.shared";
import { HrVehicleError, lockHrVehicleOperations, auditHrVehicle, ordinaryChangeInstant,
  assignHrVehicle, endHrAssignment, previewHrAssignment, cancelHrAssignmentPlans,
  executeHrAssignmentPlan, externalAssignmentScope, assignmentStore, assignmentPlanStore,
  assignmentInclude } from "../services/hrVehicleOperations";
export const createVehicleAssignmentRoutes = (external = false) => {
 const router = express.Router();
 const prefix = external ? "/external" : "";
 const view = requireHrFeature(FEATURES.HR_VEHICLE_OPERATIONS_VIEW, "VIEW");
 const manageAssignments = requireHrFeature(FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE, "EDIT");
 const scope = (tx: Prisma.TransactionClient) => external ? externalAssignmentScope(tx) : tx;
 const db = scope(prisma);
 const transaction = <T>(run: (tx: ReturnType<typeof scope>) => Promise<T>, options?: {isolationLevel?: Prisma.TransactionIsolationLevel}) =>
   prisma.$transaction(tx => run(scope(tx)), options);
router.get(
  prefix + "/driver-vehicle-assignments",
  view,
  async (req: AuthRequest, res) => {
    try {
      const [assignments, plans] = await Promise.all([
        assignmentStore(db).findMany({
          include: assignmentInclude(db),
          orderBy: { effectiveFrom: "desc" },
        }),
        assignmentPlanStore(db).findMany({
          include: assignmentInclude(db),
          orderBy: { effectiveFrom: "desc" },
        }),
      ]);
      return res.json({ success: true, data: { assignments, plans } });
    } catch (error) {
      return fail(res, error, "Read assignments");
    }
  },
);

router.post(
  prefix + "/driver-vehicle-assignments/preview",
  view,
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      const data = await transaction(
        (tx) => previewHrAssignment(tx, req.body),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "Preview assignment");
    }
  },
);
router.post(
  prefix + "/driver-vehicle-assignments",
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      const result = await transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          return assignHrVehicle(
            tx,
            { ...req.body, ignorePlanId: undefined },
            actor(req),
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res
        .status(result.unchanged ? 200 : 201)
        .json({ success: true, ...result });
    } catch (error) {
      return fail(res, error, "Assign company vehicle");
    }
  },
);
router.post(
  prefix + "/driver-vehicle-assignments/:id/end",
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      if (!req.body.confirmed)
        throw new HrVehicleError("پایان تخصیص جاری را تأیید کنید.");
      const data = await transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          return endHrAssignment(
            tx,
            req.params.id,
            actor(req),
            req.body.cancelPlanIds,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "End assignment");
    }
  },
);

router.post(
  prefix + "/driver-vehicle-assignment-plans/:id/cancel",
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      if (!req.body.confirmed)
        throw new HrVehicleError("لغو برنامه را تأیید کنید.");
      await transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          const plan = await assignmentPlanStore(tx).findUnique({
            where: { id: req.params.id },
          });
          if (!plan) throw new HrVehicleError("برنامه پیدا نشد.", 404);
          if (plan.status === "CANCELLED") return;
          if (req.body.expectedUpdatedAt !== plan.updatedAt.toISOString())
            throw new HrVehicleError(
              "برنامه هم‌زمان تغییر کرده است. فهرست را به‌روزرسانی کنید.",
            );
          await cancelHrAssignmentPlans(tx, [plan.id], actor(req));
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error, "Cancel assignment plan");
    }
  },
);
router.put(
  prefix + "/driver-vehicle-assignment-plans/:id",
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      const data = await transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          const before = await assignmentPlanStore(tx).findUnique({
            where: { id: req.params.id },
          });
          if (
            !before ||
            !["PLANNED", "NEEDS_ATTENTION"].includes(before.status)
          )
            throw new HrVehicleError(
              "این برنامه دیگر قابل ویرایش نیست. فهرست را به‌روزرسانی کنید.",
            );
          if (req.body.expectedUpdatedAt !== before.updatedAt.toISOString())
            throw new HrVehicleError(
              "برنامه هم‌زمان تغییر کرده است. فهرست را به‌روزرسانی کنید.",
            );
          const now = new Date();
          const from = ordinaryChangeInstant(req.body.effectiveFrom, now, true);
          if (from <= now)
            throw new HrVehicleError(
              "برای ویرایش برنامه، زمان آینده انتخاب کنید. اجرای برنامه رسیده از گزینه «بررسی و اجرا» انجام می‌شود.",
              400,
            );
          let changes: Prisma.DriverVehicleAssignmentPlanUpdateInput = {
            effectiveFrom: from,
            status: "PLANNED",
            blockedReason: null,
          };
          if (before.action === "ASSIGN") {
            const preview = await previewHrAssignment(
              tx,
              { ...req.body, ignorePlanId: before.id },
              now,
            );
            if (
              !req.body.confirmed ||
              JSON.stringify(
                [...(req.body.expectedAssignmentIds || [])].sort(),
              ) !==
                JSON.stringify(preview.current.map((item) => item.id).sort())
            )
              throw new HrVehicleError(
                "نتیجه تغییر برنامه را دوباره بررسی و تأیید کنید.",
                409,
                preview,
              );
            const ids: string[] = req.body.cancelPlanIds || [];
            if (
              JSON.stringify([...ids].sort()) !==
              JSON.stringify(
                preview.conflictingPlans.map((item) => item.id).sort(),
              )
            )
              throw new HrVehicleError(
                "برنامه‌های متعارض را بررسی و لغو آن‌ها را صریحاً تأیید کنید.",
                409,
                preview,
              );
            await cancelHrAssignmentPlans(tx, ids, actor(req));
            changes = {
              ...changes,
              driver: { connect: { id: req.body.driverId } },
              vehicle: { connect: { id: req.body.vehicleId } },
              effectiveTo: preview.effectiveTo,
              expectedAssignmentIds: preview.current.map((item) => item.id),
              createdBy: actor(req),
            };
          }
          const after = await assignmentPlanStore(tx).update({
            where: { id: before.id },
            data: changes,
          });
          await auditHrVehicle(
            tx,
            "INTERNAL_DRIVER_PROFILE",
            before.driverId,
            "ASSIGNMENT_PLAN_EDITED",
            actor(req),
            { before, after },
          );
          await auditHrVehicle(
            tx,
            "COMPANY_VEHICLE",
            before.vehicleId,
            "ASSIGNMENT_PLAN_EDITED",
            actor(req),
            { before, after },
          );
          if (after.driverId !== before.driverId)
            await auditHrVehicle(
              tx,
              "INTERNAL_DRIVER_PROFILE",
              after.driverId,
              "ASSIGNMENT_PLAN_EDITED",
              actor(req),
              { before, after },
            );
          if (after.vehicleId !== before.vehicleId)
            await auditHrVehicle(
              tx,
              "COMPANY_VEHICLE",
              after.vehicleId,
              "ASSIGNMENT_PLAN_EDITED",
              actor(req),
              { before, after },
            );
          return after;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "Edit assignment plan");
    }
  },
);
router.post(
  prefix + "/driver-vehicle-assignment-plans/:id/execute",
  manageAssignments,
  async (req: AuthRequest, res) => {
    try {
      if (!req.body.confirmed)
        throw new HrVehicleError("نتیجه اجرای برنامه را تأیید کنید.");
      const data = await transaction(
        async (tx) => {
          await lockHrVehicleOperations(tx);
          const plan = await assignmentPlanStore(tx).findUnique({
            where: { id: req.params.id },
          });
          if (!plan) throw new HrVehicleError("برنامه پیدا نشد.", 404);
          if (req.body.expectedUpdatedAt !== plan.updatedAt.toISOString())
            throw new HrVehicleError(
              "برنامه تغییر کرده است. فهرست را به‌روزرسانی کنید.",
            );
          return executeHrAssignmentPlan(
            tx,
            req.params.id,
            actor(req),
            false,
            req.body,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, "Execute assignment plan");
    }
  },
);

 return router;
};
