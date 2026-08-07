const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

export const normalizeIranianPlate = (value: string): string => String(value || '')
  .trim()
  .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
  .toUpperCase()
  .replace(/[\s\-ـ_./\\]+/g, '');

export const assertValidEffectivePeriod = (from: Date, to: Date | null): void => {
  if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) {
    throw new Error('Effective dates must be valid.');
  }
  if (to && to.getTime() <= from.getTime()) {
    throw new Error('An effective period must end after its start.');
  }
};

export const effectivePeriodsOverlap = (
  left: { from: Date; to: Date | null },
  right: { from: Date; to: Date | null },
): boolean => {
  const leftEnd = left.to?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.to?.getTime() ?? Number.POSITIVE_INFINITY;
  return left.from.getTime() < rightEnd && right.from.getTime() < leftEnd;
};

export type DriverReadinessBlocker =
  | 'PERSONNEL_INACTIVE'
  | 'EMPLOYMENT_INACTIVE'
  | 'ELIGIBILITY_INACTIVE'
  | 'DRIVING_PROFILE_INACTIVE'
  | 'LICENCE_NUMBER_MISSING'
  | 'LICENCE_CLASS_MISSING'
  | 'LICENCE_EXPIRY_MISSING'
  | 'LICENCE_EXPIRED'
  | 'VEHICLE_NOT_ASSIGNED'
  | 'VEHICLE_NOT_ACTIVE'
  | 'VEHICLE_PLATE_MISSING';

export const projectInternalDriverReadiness = (input: {
  personnelActive: boolean;
  activeEmployment: boolean;
  eligible: boolean;
  drivingProfileActive: boolean;
  licenceNumber: string | null;
  licenceClass: string | null;
  licenceExpiresAt: Date | null;
  assignmentActive: boolean;
  assignedVehicleActive: boolean | null;
  assignedVehicleHasCurrentPlate: boolean | null;
}, at = new Date()): { status: 'READY' | 'NOT_READY'; blockers: DriverReadinessBlocker[] } => {
  const blockers: DriverReadinessBlocker[] = [];
  if (!input.personnelActive) blockers.push('PERSONNEL_INACTIVE');
  if (!input.activeEmployment) blockers.push('EMPLOYMENT_INACTIVE');
  if (!input.eligible) blockers.push('ELIGIBILITY_INACTIVE');
  if (!input.drivingProfileActive) blockers.push('DRIVING_PROFILE_INACTIVE');
  if (!input.licenceNumber?.trim()) blockers.push('LICENCE_NUMBER_MISSING');
  if (!input.licenceClass?.trim()) blockers.push('LICENCE_CLASS_MISSING');
  if (!input.licenceExpiresAt) blockers.push('LICENCE_EXPIRY_MISSING');
  else if (input.licenceExpiresAt.getTime() <= at.getTime()) blockers.push('LICENCE_EXPIRED');
  if (!input.assignmentActive || input.assignedVehicleActive === null) blockers.push('VEHICLE_NOT_ASSIGNED');
  else {
    if (!input.assignedVehicleActive) blockers.push('VEHICLE_NOT_ACTIVE');
    if (!input.assignedVehicleHasCurrentPlate) blockers.push('VEHICLE_PLATE_MISSING');
  }
  return { status: blockers.length ? 'NOT_READY' : 'READY', blockers };
};

type LifecycleSubject = 'COMPANY_VEHICLE' | 'EXTERNAL_DRIVER' | 'EXTERNAL_VEHICLE' | 'INTERNAL_DRIVER_PROFILE';

const lifecycleTransitions: Record<LifecycleSubject, Record<string, readonly string[]>> = {
  COMPANY_VEHICLE: {
    DRAFT: ['ACTIVE'], ACTIVE: ['OUT_OF_SERVICE', 'ARCHIVED'], OUT_OF_SERVICE: ['ACTIVE', 'ARCHIVED'], ARCHIVED: ['DRAFT'],
  },
  EXTERNAL_DRIVER: {
    DRAFT: ['ACTIVE'], ACTIVE: ['RESTRICTED', 'ARCHIVED'], RESTRICTED: ['ACTIVE', 'ARCHIVED'], ARCHIVED: ['DRAFT'],
  },
  EXTERNAL_VEHICLE: {
    DRAFT: ['ACTIVE'], ACTIVE: ['RESTRICTED', 'ARCHIVED'], RESTRICTED: ['ACTIVE', 'ARCHIVED'], ARCHIVED: ['DRAFT'],
  },
  INTERNAL_DRIVER_PROFILE: {
    DRAFT: ['ACTIVE'], ACTIVE: ['ARCHIVED'], ARCHIVED: ['DRAFT'],
  },
};

export const assertLifecycleTransition = (subject: LifecycleSubject, from: string, to: string): void => {
  if (!lifecycleTransitions[subject]?.[from]?.includes(to)) {
    throw new Error(`${subject} lifecycle transition from ${from} to ${to} is not permitted.`);
  }
};

export const canPermanentlyDeleteDraft = (input: { status: string; dependencyCount: number }): boolean =>
  input.status === 'DRAFT' && input.dependencyCount === 0;

export type DispatchAuditOwner = 'HR' | 'VEHICLE_OPERATIONS' | 'GUARD';
export const auditOwnerForSubject = (subjectType: string): DispatchAuditOwner => {
  if (subjectType === 'INTERNAL_DRIVER_ELIGIBILITY') return 'HR';
  if (subjectType === 'INTERNAL_DRIVER_PROFILE' || subjectType === 'COMPANY_VEHICLE') return 'VEHICLE_OPERATIONS';
  if (subjectType === 'EXTERNAL_DRIVER' || subjectType === 'EXTERNAL_VEHICLE') return 'GUARD';
  throw new Error('Unsupported dispatch master-data audit subject.');
};
