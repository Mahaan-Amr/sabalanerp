import { canonicalPerformanceHash } from './personnelPerformancePolicy';

/** Organization policy #353. Reference content only; publication must use the approved version workflow. */
export const PERFORMANCE_RETENTION_SCHEDULE_V1 = {
  schemaVersion: 1,
  scheduleCode: 'PERFORMANCE_INTERNAL_353_V1',
  calendar: 'UTC_GREGORIAN',
  classes: {
    ACCEPTED_EVIDENCE: { years: 7, anchor: 'RELATIONSHIP_AND_DEPENDENCIES' },
    REJECTED_EVIDENCE: { years: 2, anchor: 'CLOSED' },
    DRAFT: { days: 90, anchor: 'CLOSED' },
    NAMED_ANALYTICS: { years: 2, anchor: 'CREATED' },
    CALIBRATION: { years: 2, anchor: 'CREATED' },
    ANONYMOUS_ANALYTICS: { anchor: 'VERIFIED_ANONYMOUS' },
    EXPORT_FILE: { hours: 24, anchor: 'CREATED_OR_FIRST_DOWNLOAD' },
    DISCLOSURE_RECEIPT: { years: 7, anchor: 'CREATED' },
    DENIED_ACCESS: { days: 180, anchor: 'CREATED' },
    SECURITY_EVENT: { days: 180, anchor: 'CREATED' },
    BROWSER_DIAGNOSTIC: { hours: 24, anchor: 'CREATED' },
    SERVER_LOG: { days: 30, anchor: 'CREATED' },
    PRIVACY_CASE: { years: 7, anchor: 'CLOSED' },
    DELETION_RECEIPT: { years: 7, anchor: 'CREATED' },
    PUBLISHED_POLICY: { anchor: 'PERMANENT' },
    POLICY_APPROVER_IDENTITY: { years: 7, anchor: 'RETIRED' },
    BACKUP: { anchor: 'INDEPENDENT_PRODUCTION_CHECKPOINT_POLICY' },
  },
  closedRequestHoldDays: 90,
  policyShorteningNoticeDays: 30,
  legalHoldReviewDays: 90,
} as const;

type RetentionInput = {
  policy: unknown;
  classification: string;
  relationshipEndedAt?: Date | null;
  closedAt?: Date | null;
  createdAt?: Date | null;
  retiredAt?: Date | null;
  downloadedAt?: Date | null;
  now: Date;
  /** Only dependencies within this record's scope; re-employment is never a dependency. */
  dependencies: Array<{ closedAt: Date | null; kind: 'DISPUTE' | 'CORRECTION' | 'CONSEQUENCE' | 'PRIVACY_ACCESS' | 'PRIVACY_ERASURE' }>;
  legalHold: boolean;
  requiredForReconstruction?: boolean;
  anonymityVerified?: boolean;
};

type RetentionDecision = {
  state: 'ELIGIBLE' | 'RETAIN' | 'REQUIRES_RETENTION_DECISION' | 'LEGAL_HOLD' | 'DEPENDENCY_OPEN'
    | 'RECONSTRUCTION_DEPENDENCY' | 'PERMANENT_POLICY_TEXT' | 'NO_MANDATORY_EXPIRY' | 'CHECKPOINT_POLICY';
  deleteAfter: Date | null;
};

const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const unknownDecision: RetentionDecision = { state: 'REQUIRES_RETENTION_DECISION', deleteAfter: null };
const addYears = (value: Date, years: number) => {
  const result = new Date(value);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCMonth() !== value.getUTCMonth()) result.setUTCDate(0);
  return result;
};

export const isSupportedPerformanceRetentionPolicy = (policy: unknown) => (
  policy !== undefined && canonicalPerformanceHash(policy) === canonicalPerformanceHash(PERFORMANCE_RETENTION_SCHEDULE_V1)
);

export const evaluatePerformanceRetention = (input: RetentionInput): RetentionDecision => {
  if (!isSupportedPerformanceRetentionPolicy(input.policy) || !validDate(input.now)
    || !Object.prototype.hasOwnProperty.call(PERFORMANCE_RETENTION_SCHEDULE_V1.classes, input.classification)) return unknownDecision;
  if (input.legalHold) return { state: 'LEGAL_HOLD', deleteAfter: null };
  if (input.dependencies.some(({ closedAt }) => closedAt === null)) return { state: 'DEPENDENCY_OPEN', deleteAfter: null };
  if (input.dependencies.some(({ closedAt }) => !validDate(closedAt))) return unknownDecision;
  if (input.dependencies.some(({ kind }) => !['DISPUTE', 'CORRECTION', 'CONSEQUENCE', 'PRIVACY_ACCESS', 'PRIVACY_ERASURE'].includes(kind))) return unknownDecision;
  if (input.requiredForReconstruction) return { state: 'RECONSTRUCTION_DEPENDENCY', deleteAfter: null };
  const rule = PERFORMANCE_RETENTION_SCHEDULE_V1.classes[input.classification as keyof typeof PERFORMANCE_RETENTION_SCHEDULE_V1.classes];
  if (rule.anchor === 'PERMANENT') return { state: 'PERMANENT_POLICY_TEXT', deleteAfter: null };
  if (rule.anchor === 'VERIFIED_ANONYMOUS') return input.anonymityVerified
    ? { state: 'NO_MANDATORY_EXPIRY', deleteAfter: null } : unknownDecision;
  if (rule.anchor === 'INDEPENDENT_PRODUCTION_CHECKPOINT_POLICY') return { state: 'CHECKPOINT_POLICY', deleteAfter: null };
  const anchor = rule.anchor === 'RELATIONSHIP_AND_DEPENDENCIES' ? input.relationshipEndedAt
    : rule.anchor === 'CLOSED' ? input.closedAt : rule.anchor === 'RETIRED' ? input.retiredAt : input.createdAt;
  if (!validDate(anchor) || anchor > input.now) return unknownDecision;
  const dependencyDates = input.dependencies.map(({ closedAt }) => closedAt!);
  if (dependencyDates.some((date) => date > input.now)) return unknownDecision;
  const governingAnchor = rule.anchor === 'RELATIONSHIP_AND_DEPENDENCIES'
    ? new Date(Math.max(anchor.getTime(), ...input.dependencies
      .filter(({ kind }) => ['DISPUTE', 'CORRECTION', 'CONSEQUENCE'].includes(kind))
      .map(({ closedAt }) => closedAt!.getTime()))) : anchor;
  let deleteAfter = 'years' in rule ? addYears(governingAnchor, rule.years)
    : new Date(governingAnchor.getTime() + ('days' in rule ? rule.days * 86_400_000 : 'hours' in rule ? rule.hours * 3_600_000 : 0));
  if (rule.anchor === 'CREATED_OR_FIRST_DOWNLOAD' && input.downloadedAt != null) {
    if (!validDate(input.downloadedAt) || input.downloadedAt < anchor || input.downloadedAt > input.now) return unknownDecision;
    deleteAfter = new Date(Math.min(deleteAfter.getTime(), input.downloadedAt.getTime()));
  }
  // Closing a scoped request never releases its preservation hold immediately.
  if (dependencyDates.length) deleteAfter = new Date(Math.max(deleteAfter.getTime(),
    ...dependencyDates.map((date) => date.getTime() + PERFORMANCE_RETENTION_SCHEDULE_V1.closedRequestHoldDays * 86_400_000)));
  return { state: deleteAfter <= input.now ? 'ELIGIBLE' : 'RETAIN', deleteAfter };
};
