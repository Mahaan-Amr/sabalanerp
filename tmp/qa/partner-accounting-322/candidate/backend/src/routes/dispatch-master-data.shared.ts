import { prisma } from '../lib/prisma';
import { Prisma, PrismaClient } from '@prisma/client';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { projectInternalDriverReadiness } from '../services/dispatchMasterDataPolicy';

export { prisma };
export const actor = (req: AuthRequest) => req.user!.id;
export const requiredText = (value: unknown, label: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};
export const optionalText = (value: unknown) => String(value ?? '').trim() || null;
export const parsedDate = (value: unknown, label: string) => {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date.`);
  return parsed;
};
export const optionalDate = (value: unknown, label: string) => value ? parsedDate(value, label) : null;
export const activeAt = (at: Date) => ({ effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] });

const conflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2010'].includes(error.code);
export const fail = (res: Response, error: unknown, context: string) => {
  console.error(context, error);
  if (conflict(error) || (error instanceof Error && /overlap|already effective/i.test(error.message))) {
    return res.status(409).json({ success: false, error: 'The requested change conflicts with existing canonical master data.' });
  }
  return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid master-data request.' });
};

export const internalInclude = {
  personnel: { include: { hrEmploymentRelationships: { orderBy: { effectiveFrom: 'desc' as const } } } },
  eligibilityPeriods: { orderBy: { effectiveFrom: 'desc' as const } },
  vehicleAssignments: { orderBy: { effectiveFrom: 'desc' as const }, include: { vehicle: { include: { plates: { orderBy: { effectiveFrom: 'desc' as const } } } } } },
} as const;

export const projectDriver = (driver: any, at = new Date()) => {
  const eligibility = driver.eligibilityPeriods.find((period: any) => period.effectiveFrom <= at && (!period.effectiveTo || period.effectiveTo > at));
  const assignment = driver.vehicleAssignments.find((item: any) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
  const employment = driver.personnel.hrEmploymentRelationships.some((item: any) => item.status === 'ACTIVE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
  const currentPlate = assignment?.vehicle.plates.find((plate: any) => plate.effectiveFrom <= at && (!plate.effectiveTo || plate.effectiveTo > at));
  return {
    ...driver,
    source: 'HR_PERSONNEL', currentEligibility: eligibility || null, currentAssignment: assignment || null,
    readiness: projectInternalDriverReadiness({
      personnelActive: driver.personnel.isActive && !driver.personnel.archivedAt,
      activeEmployment: employment,
      eligible: eligibility?.status === 'ELIGIBLE',
      drivingProfileActive: driver.status === 'ACTIVE',
      licenceNumber: driver.licenceNumber,
      licenceClass: driver.licenceClass,
      licenceExpiresAt: driver.licenceExpiresAt,
      assignmentActive: Boolean(assignment),
      assignedVehicleActive: assignment ? assignment.vehicle.status === 'ACTIVE' : null,
      assignedVehicleHasCurrentPlate: assignment ? Boolean(currentPlate) : null,
    }, at),
  };
};
