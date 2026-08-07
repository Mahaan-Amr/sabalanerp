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
  | 'LICENCE_EXPIRED'
  | 'VEHICLE_NOT_ASSIGNED'
  | 'VEHICLE_NOT_IN_SERVICE';

export const projectInternalDriverReadiness = (input: {
  personnelActive: boolean;
  activeEmployment: boolean;
  eligible: boolean;
  drivingProfileActive: boolean;
  licenceExpiresAt: Date | null;
  assignedVehicleInService: boolean | null;
}, at = new Date()): { status: 'READY' | 'NOT_READY'; blockers: DriverReadinessBlocker[] } => {
  const blockers: DriverReadinessBlocker[] = [];
  if (!input.personnelActive) blockers.push('PERSONNEL_INACTIVE');
  if (!input.activeEmployment) blockers.push('EMPLOYMENT_INACTIVE');
  if (!input.eligible) blockers.push('ELIGIBILITY_INACTIVE');
  if (!input.drivingProfileActive) blockers.push('DRIVING_PROFILE_INACTIVE');
  if (input.licenceExpiresAt && input.licenceExpiresAt.getTime() <= at.getTime()) blockers.push('LICENCE_EXPIRED');
  if (input.assignedVehicleInService === null) blockers.push('VEHICLE_NOT_ASSIGNED');
  else if (!input.assignedVehicleInService) blockers.push('VEHICLE_NOT_IN_SERVICE');
  return { status: blockers.length ? 'NOT_READY' : 'READY', blockers };
};
