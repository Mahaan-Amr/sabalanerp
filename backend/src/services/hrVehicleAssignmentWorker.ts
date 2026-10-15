import { startBackgroundJob } from "./backgroundJobLifecycle";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  withRecoveryBackgroundWrite,
} from "./recoveryRuntime";
import {
  HrVehicleError,
  auditHrVehicle,
  executeHrAssignmentPlan,
  lockHrVehicleOperations,
} from "./hrVehicleOperations";

export const processDueHrAssignmentPlans = async (
  prisma: PrismaClient,
  now?: Date,
) =>
  withRecoveryBackgroundWrite(async () => {
    const clock = now ? () => now : () => new Date();
    const dueAt = clock();
    const due = await prisma.driverVehicleAssignmentPlan.findMany({
      where: { status: "PLANNED", effectiveFrom: { lte: dueAt } },
      orderBy: [
        { effectiveFrom: "asc" },
        { action: "desc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      take: 50,
    });
    for (const plan of due) {
      try {
        await prisma.$transaction(
          async (tx) => {
            await lockHrVehicleOperations(tx);
            await executeHrAssignmentPlan(
              tx,
              plan.id,
              plan.createdBy,
              true,
              {},
              clock(),
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        // Serialization failures are transient; only a known business blocker changes a plan's state.
        if (!(error instanceof HrVehicleError)) {
          console.error("HR assignment plan execution failed", plan.id, error);
          continue;
        }
        await prisma.$transaction(async (tx) => {
          await lockHrVehicleOperations(tx);
          const changed = await tx.driverVehicleAssignmentPlan.updateMany({
            where: {
              id: plan.id,
              status: "PLANNED",
              updatedAt: plan.updatedAt,
            },
            data: { status: "NEEDS_ATTENTION", blockedReason: error.message },
          });
          if (changed.count) {
            await auditHrVehicle(
              tx,
              "INTERNAL_DRIVER_PROFILE",
              plan.driverId,
              "ASSIGNMENT_PLAN_BLOCKED",
              plan.createdBy,
              { planId: plan.id, blocker: error.message },
            );
            await auditHrVehicle(
              tx,
              "COMPANY_VEHICLE",
              plan.vehicleId,
              "ASSIGNMENT_PLAN_BLOCKED",
              plan.createdBy,
              { planId: plan.id, blocker: error.message },
            );
          }
        });
      }
    }
  });
export const startHrVehicleAssignmentMaintenance = (prisma: PrismaClient) =>
  startBackgroundJob({
    name: "hr-vehicle-assignment-maintenance",
    intervalMs: 15_000,
    run: () => processDueHrAssignmentPlans(prisma),
  });
