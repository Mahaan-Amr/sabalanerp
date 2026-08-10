export type CapacityAssignment = {
  id: string;
  type: 'PRIMARY' | 'SECONDARY' | 'ACTING';
  relationshipStatus: 'PLANNED' | 'ACTIVE' | 'SUSPENDED' | 'ENDED' | 'CANCELLED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  hireConvertedAt: Date | null;
};

export type CapacityRecruitmentCommitment = {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  remaining: number;
};

export type PositionCapacityBreakdown = {
  capacity: number;
  inUse: number;
  reservedForStart: number;
  acting: number;
  ended: number;
  future: number;
  vacancy: number;
};

const isEffectiveAt = (assignment: CapacityAssignment, at: Date) =>
  assignment.effectiveFrom <= at && (!assignment.effectiveTo || assignment.effectiveTo >= at);

export function reconcilePositionCapacity(input: {
  capacity: number;
  active: boolean;
  at: Date;
  assignments: CapacityAssignment[];
}): PositionCapacityBreakdown {
  let inUse = 0;
  let reservedForStart = 0;
  let acting = 0;
  let ended = 0;
  let future = 0;

  for (const assignment of input.assignments) {
    const effective = isEffectiveAt(assignment, input.at);
    const capacityConsuming = assignment.type === 'PRIMARY' || assignment.type === 'SECONDARY';

    if (assignment.relationshipStatus === 'ENDED' || (assignment.effectiveTo && assignment.effectiveTo < input.at)) {
      ended += 1;
      continue;
    }
    if (assignment.type === 'ACTING' && effective && ['ACTIVE', 'SUSPENDED'].includes(assignment.relationshipStatus)) {
      acting += 1;
      continue;
    }
    if (capacityConsuming && assignment.relationshipStatus === 'PLANNED' && assignment.hireConvertedAt) {
      reservedForStart += 1;
      continue;
    }
    if (assignment.effectiveFrom > input.at) {
      future += 1;
      continue;
    }
    if (capacityConsuming && effective && ['ACTIVE', 'SUSPENDED'].includes(assignment.relationshipStatus)) {
      inUse += 1;
    }
  }

  const capacity = input.active ? Math.max(0, Math.trunc(input.capacity)) : 0;
  return {
    capacity,
    inUse,
    reservedForStart,
    acting,
    ended,
    future,
    vacancy: input.active ? Math.max(0, capacity - inUse - reservedForStart) : 0,
  };
}

export function summarizePositionCoverage(rows: PositionCapacityBreakdown[]) {
  const summary = rows.reduce(
    (result, row) => ({
      capacity: result.capacity + row.capacity,
      inUse: result.inUse + row.inUse,
      reservedForStart: result.reservedForStart + row.reservedForStart,
      vacancy: result.vacancy + row.vacancy,
    }),
    { capacity: 0, inUse: 0, reservedForStart: 0, vacancy: 0 },
  );
  return {
    ...summary,
    percentage: summary.capacity === 0
      ? null
      : Math.round(((summary.inUse + summary.reservedForStart) / summary.capacity) * 100),
  };
}

const startOfUtcDay = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

export function resolveFoundationStatus(input: {
  baseActive: boolean;
  at: Date;
  versions: Array<{ status: 'ACTIVE' | 'INACTIVE'; effectiveFrom: Date; version?: number; afterJson?: unknown }>;
}) {
  const effectiveVersion = input.versions
    .filter((version) => {
      if (version.effectiveFrom > input.at) return false;
      if (version.afterJson === undefined) return true;
      return Boolean(version.afterJson && typeof version.afterJson === 'object' && !Array.isArray(version.afterJson) && Object.prototype.hasOwnProperty.call(version.afterJson, 'isActive'));
    })
    .sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime() || (right.version ?? 0) - (left.version ?? 0))[0];
  return effectiveVersion ? effectiveVersion.status === 'ACTIVE' : input.baseActive;
}

export function projectEffectiveFoundation<T extends Record<string, unknown>>(
  base: T,
  versions: Array<{ effectiveFrom: Date; afterJson: unknown; version?: number }>,
  at: Date,
): T {
  const effectiveVersions = versions
    .filter((version) => version.version !== 1 && version.effectiveFrom <= at && version.afterJson && typeof version.afterJson === 'object' && !Array.isArray(version.afterJson))
    .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime() || (left.version ?? 0) - (right.version ?? 0));
  return effectiveVersions.reduce<T>((projected, version) => ({ ...projected, ...(version.afterJson as Partial<T>) }), base);
}

export function capacityAt(
  baseCapacity: number,
  changes: Array<{ newCapacity: number; effectiveAt: Date }>,
  at: Date,
) {
  const effectiveChange = changes
    .filter((change) => change.effectiveAt <= at)
    .sort((left, right) => right.effectiveAt.getTime() - left.effectiveAt.getTime())[0];
  return effectiveChange?.newCapacity ?? baseCapacity;
}

export function maximumCapacityCommitmentFrom(assignments: CapacityAssignment[], from: Date, recruitment: CapacityRecruitmentCommitment[] = []) {
  const events: Array<{ at: number; delta: number }> = [];
  for (const assignment of assignments) {
    const counts = assignment.type !== 'ACTING'
      && (['ACTIVE', 'SUSPENDED'].includes(assignment.relationshipStatus)
        || (assignment.relationshipStatus === 'PLANNED' && Boolean(assignment.hireConvertedAt)));
    if (!counts || (assignment.effectiveTo && assignment.effectiveTo < from)) continue;
    events.push({ at: Math.max(from.getTime(), assignment.effectiveFrom.getTime()), delta: 1 });
    if (assignment.effectiveTo) events.push({ at: assignment.effectiveTo.getTime() + 1, delta: -1 });
  }
  for (const request of recruitment) {
    if (request.remaining <= 0 || (request.effectiveTo && request.effectiveTo < from)) continue;
    events.push({ at: Math.max(from.getTime(), request.effectiveFrom.getTime()), delta: request.remaining });
    if (request.effectiveTo) events.push({ at: request.effectiveTo.getTime() + 1, delta: -request.remaining });
  }
  events.sort((left, right) => left.at - right.at || right.delta - left.delta);
  let current = 0;
  let maximum = 0;
  for (const event of events) {
    current += event.delta;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export class FoundationVersionConflictError extends Error {
  readonly code = 'HR_FOUNDATION_VERSION_CONFLICT';

  constructor() {
    super('رکورد هم‌زمان تغییر کرده است؛ داده تازه را مرور و تغییر را دوباره اعمال کنید.');
  }
}

export function assertFreshVersion(updatedAt: Date, expectedUpdatedAt: string | undefined) {
  if (!expectedUpdatedAt) throw new FoundationVersionConflictError();
  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime()) || updatedAt.getTime() !== expected.getTime()) {
    throw new FoundationVersionConflictError();
  }
}

export function assertCapacityChangeAllowed(input: {
  currentCapacity: number;
  newCapacity: number;
  committedFromEffectiveDate: number;
  approvedRecruitmentRemaining: number;
  reason: string;
  effectiveAt: Date;
  today: Date;
}) {
  if (!Number.isInteger(input.newCapacity) || input.newCapacity < 1) {
    throw new Error('ظرفیت جایگاه باید یک عدد صحیح مثبت باشد؛ برای ظرفیت صفر جایگاه را غیرفعال کنید.');
  }
  if (startOfUtcDay(input.effectiveAt) < startOfUtcDay(input.today)) {
    throw new Error('تغییر ظرفیت در گذشته مجاز نیست.');
  }
  if (input.newCapacity < input.currentCapacity && !input.reason.trim()) {
    throw new Error('دلیل کاهش ظرفیت الزامی است.');
  }
  if (input.newCapacity < input.committedFromEffectiveDate) {
    throw new Error('ظرفیت جدید از تخصیص‌های متعهد در تاریخ اثر کمتر است.');
  }
  if (input.newCapacity < input.committedFromEffectiveDate + input.approvedRecruitmentRemaining) {
    throw new Error('ظرفیت جدید درخواست استخدام تأییدشده را نامعتبر می‌کند.');
  }
}
