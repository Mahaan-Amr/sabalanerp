import { Prisma } from '@prisma/client';
import { HrVehicleError, activePeriodAt, lockHrDriverFacts, externalAssignmentScope } from './hrVehicleOperations';
import { projectExternalDriverReadiness, projectExternalVehicleReadiness } from './dispatchMasterDataPolicy';

export const externalDriverInclude = {
  documents: { orderBy: { recordedAt: 'desc' as const } },
  externalLinks: { include: { personnel: { include: { hrEmploymentRelationships: true, internalDriverProfile: { include: { eligibilityPeriods: true } } } } } },
} satisfies Prisma.ExternalDriverInclude;
export const externalVehicleInclude = { plates: true, documents: { orderBy: { recordedAt: 'desc' as const } } } satisfies Prisma.ExternalVehicleInclude;
type Driver = Prisma.ExternalDriverGetPayload<{ include: typeof externalDriverInclude }>;
type Vehicle = Prisma.ExternalVehicleGetPayload<{ include: typeof externalVehicleInclude }>;
export const externalDriverBlockers = (driver: Driver, at = new Date()) => {
  const linked = driver.externalLinks.some(({ personnel }) => personnel.isActive && !personnel.archivedAt && (
    personnel.hrEmploymentRelationships.some(p => p.status === 'ACTIVE' && p.effectiveFrom <= at && (!p.effectiveTo || p.effectiveTo > at)) ||
    personnel.internalDriverProfile?.eligibilityPeriods.some(p => p.status === 'ELIGIBLE' && p.effectiveFrom <= at && (!p.effectiveTo || p.effectiveTo > at))));
  const blockers: string[] = [...projectExternalDriverReadiness({ lifecycleStatus: driver.status, documents: driver.documents, continuityLinkedToActiveInternalIdentity: linked }, at).blockers];
  if (!driver.licenceNumber) blockers.push('شماره گواهینامه ثبت نشده');
  if (!driver.licenceClass) blockers.push('پایه گواهینامه ثبت نشده');
  if (!driver.licenceExpiresAt) blockers.push('تاریخ اعتبار گواهینامه ثبت نشده');
  else if (driver.licenceExpiresAt <= at) blockers.push('گواهینامه منقضی شده');
  return blockers;
};
const labels: Record<string, string> = {
  LIFECYCLE_INACTIVE: 'راننده یا خودرو فعال نیست', VEHICLE_PLATE_MISSING: 'پلاک معتبر ثبت نشده',
  DRIVING_LICENCE_MISSING: 'مدرک گواهینامه ثبت نشده', DRIVING_LICENCE_EXPIRED: 'مدرک گواهینامه منقضی شده',
  VEHICLE_REGISTRATION_MISSING: 'مدرک خودرو ثبت نشده', VEHICLE_REGISTRATION_EXPIRED: 'مدرک خودرو منقضی شده',
  CONTINUITY_LINKED_INTERNAL_IDENTITY_ACTIVE: 'این شخص پرسنل فعال است؛ از پرونده راننده داخلی استفاده کنید',
};
export const externalBlockerText = (blockers: string[]) => blockers.map(b => labels[b] || b).join('؛ ');
export const externalVehicleBlockers = (vehicle: Vehicle, at = new Date()) => projectExternalVehicleReadiness({
  lifecycleStatus: vehicle.status, documents: vehicle.documents,
  hasCurrentPlate: vehicle.plates.some(p => p.effectiveFrom <= at && (!p.effectiveTo || p.effectiveTo > at)),
}, at).blockers;
export const validateExternalAssignment = async (tx: Prisma.TransactionClient, driverId: string, vehicleId: string, at: Date) => {
  const [driver, vehicle] = await Promise.all([
    tx.externalDriver.findUnique({ where: { id: driverId }, include: externalDriverInclude }),
    tx.externalVehicle.findUnique({ where: { id: vehicleId }, include: externalVehicleInclude }),
  ]);
  if (!driver || !vehicle) throw new HrVehicleError('راننده و خودرو باید هر دو بیرونی و موجود در فهرست باشند.', 400);
  const blockers = [...externalDriverBlockers(driver, at), ...externalVehicleBlockers(vehicle, at)];
  if (blockers.length) throw new HrVehicleError(`تخصیص ممکن نیست: ${externalBlockerText(blockers)}.`, 400);
  return { driver, vehicle };
};
export const externalOperationalReadiness = async (tx: Prisma.TransactionClient, driverId: string, vehicleId?: string | null, at = new Date()) => {
  if (!("$transaction" in tx)) await lockHrDriverFacts(externalAssignmentScope(tx), driverId, at, vehicleId || undefined);
  const assignment = await tx.externalDriverVehicleAssignment.findFirst({ where: { driverId, ...activePeriodAt(at) } });
  if (!assignment || (vehicleId && assignment.vehicleId !== vehicleId))
    throw new HrVehicleError('این خودرو تخصیص فعال این راننده نیست. تخصیص جاری را در رانندگان و خودروها بررسی کنید.', 400);
  if (!("$transaction" in tx)) await lockHrDriverFacts(externalAssignmentScope(tx), driverId, at, assignment.vehicleId);
  const facts = await validateExternalAssignment(tx, driverId, assignment.vehicleId, at);
  const enrollment = await tx.driverBiometricEnrollment.findFirst({ where: { externalDriverId: driverId, status: 'ACTIVE' } });
  if (!enrollment) throw new HrVehicleError('راننده بیرونی ثبت بیومتریک فعال ندارد. ابتدا دو اثر انگشت را در پرونده راننده ثبت کنید.', 400);
  return { ...facts, assignment, enrollment };
};
