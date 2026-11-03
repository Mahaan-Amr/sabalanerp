export const HR_RECONCILIATION_PRIMARY_STATES = [
  'PERSONNEL_CURRENT',
  'PERSONNEL_INACTIVE_ENDED',
  'USER_PERSONNEL_LINKED',
  'USER_ACCESS_ONLY',
  'USER_LINKAGE_UNRESOLVED',
  'EMPLOYMENT_CURRENT',
  'EMPLOYMENT_ENDED',
  'LEGACY_ONLY_HISTORY',
  'NEUTRAL_HISTORY',
  'CLASSIFICATION_ERROR',
] as const;

export type HrReconciliationPrimaryState = typeof HR_RECONCILIATION_PRIMARY_STATES[number];

export const HR_RECONCILIATION_ATTENTION_FLAGS = [
  'UNRESOLVED_PERSONNEL_LINKAGE',
  'POSSIBLE_DUPLICATE_IDENTITY',
  'INCOMPLETE_ORGANIZATIONAL_MAPPING',
  'MISSING_PRIMARY_ASSIGNMENT',
  'EMPLOYMENT_STATE_INCONSISTENCY',
  'OPEN_START_DATE_REVIEW',
  'ASSESSMENT_PLAN_RECONCILIATION',
  'CLASSIFICATION_ERROR',
] as const;

export type HrReconciliationAttentionFlag = typeof HR_RECONCILIATION_ATTENTION_FLAGS[number];

export const HR_RECONCILIATION_REVIEW_OUTCOMES = [
  'ACCESS_ONLY_USER',
  'DIFFERENT_PEOPLE',
  'SHARED_IDENTITY',
  'STILL_AMBIGUOUS',
  'ORGANIZATION_MAPPED',
  'ORGANIZATION_CREATED',
  'ORGANIZATION_HISTORICAL',
  'START_DATE_UNRECOVERABLE',
  'LEGACY_ONLY_CONFIRMED',
] as const;

export type HrReconciliationReviewOutcome = typeof HR_RECONCILIATION_REVIEW_OUTCOMES[number];

export type HrMigrationClassificationInput = {
  sourceType: string;
  sourceId: string;
  operationallyCurrent: boolean;
  personnelLinkResolved: boolean;
  organizationalMappingComplete: boolean;
  primaryAssignmentPresent: boolean;
  employmentStateConsistent: boolean;
  startDateReviewOpen: boolean;
  assessmentPlanReconciliationOpen: boolean;
  possibleDuplicateIdentity?: boolean;
  legacyOnly?: boolean;
  durableReviewOutcome: HrReconciliationReviewOutcome | null;
  suppressedAttentionFlags?: HrReconciliationAttentionFlag[];
};

const registeredSourceTypes = new Set(['PERSONNEL', 'USER', 'EMPLOYMENT_RELATIONSHIP', 'APPLICATION', 'LEGACY_HISTORY']);

const primaryStateFor = (input: HrMigrationClassificationInput): HrReconciliationPrimaryState => {
  if (!registeredSourceTypes.has(input.sourceType)) return 'CLASSIFICATION_ERROR';
  if (input.legacyOnly || input.sourceType === 'LEGACY_HISTORY') return 'LEGACY_ONLY_HISTORY';
  if (input.sourceType === 'PERSONNEL') return input.operationallyCurrent ? 'PERSONNEL_CURRENT' : 'PERSONNEL_INACTIVE_ENDED';
  if (input.sourceType === 'USER') {
    if (input.personnelLinkResolved) return 'USER_PERSONNEL_LINKED';
    if (input.durableReviewOutcome === 'ACCESS_ONLY_USER') return 'USER_ACCESS_ONLY';
    return 'USER_LINKAGE_UNRESOLVED';
  }
  if (input.sourceType === 'EMPLOYMENT_RELATIONSHIP') return input.operationallyCurrent ? 'EMPLOYMENT_CURRENT' : 'EMPLOYMENT_ENDED';
  return 'NEUTRAL_HISTORY';
};

export const classifyHrMigrationRecord = (input: HrMigrationClassificationInput) => {
  const primaryState = primaryStateFor(input);
  const flags: HrReconciliationAttentionFlag[] = [];
  const add = (condition: boolean, flag: HrReconciliationAttentionFlag) => {
    if (condition && !input.suppressedAttentionFlags?.includes(flag)) flags.push(flag);
  };
  const duplicateResolved = input.durableReviewOutcome === 'DIFFERENT_PEOPLE';

  add(primaryState === 'CLASSIFICATION_ERROR', 'CLASSIFICATION_ERROR');
  add(input.sourceType === 'USER' && !input.personnelLinkResolved && input.durableReviewOutcome !== 'ACCESS_ONLY_USER', 'UNRESOLVED_PERSONNEL_LINKAGE');
  add(Boolean(input.possibleDuplicateIdentity) && !duplicateResolved, 'POSSIBLE_DUPLICATE_IDENTITY');
  add(input.operationallyCurrent && !input.organizationalMappingComplete, 'INCOMPLETE_ORGANIZATIONAL_MAPPING');
  add(input.operationallyCurrent && ['PERSONNEL', 'EMPLOYMENT_RELATIONSHIP'].includes(input.sourceType) && !input.primaryAssignmentPresent, 'MISSING_PRIMARY_ASSIGNMENT');
  add(!input.employmentStateConsistent, 'EMPLOYMENT_STATE_INCONSISTENCY');
  add(input.operationallyCurrent && input.startDateReviewOpen && input.durableReviewOutcome !== 'START_DATE_UNRECOVERABLE', 'OPEN_START_DATE_REVIEW');
  add(input.assessmentPlanReconciliationOpen, 'ASSESSMENT_PLAN_RECONCILIATION');

  return { primaryState, attentionFlags: flags, cutoverBlocker: flags.length > 0 };
};

export const findPossibleDuplicateNationalIdentities = (people: Array<{
  id: string;
  nationalCode: string | null;
}>) => {
  const byNationalCode = new Map<string, string[]>();
  for (const person of people) {
    const nationalCode = person.nationalCode?.trim();
    if (!nationalCode || !isValidIranianNationalCode(nationalCode)) continue;
    byNationalCode.set(nationalCode, [...(byNationalCode.get(nationalCode) ?? []), person.id]);
  }
  return [...byNationalCode]
    .filter(([, personnelIds]) => personnelIds.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([nationalCode, personnelIds]) => ({ nationalCode, personnelIds: [...personnelIds].sort() }));
};

const isValidIranianNationalCode = (value: string) => {
  if (!/^\d{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const remainder = value.slice(0, 9).split('').reduce(
    (sum, digit, index) => sum + Number(digit) * (10 - index),
    0,
  ) % 11;
  return Number(value[9]) === (remainder < 2 ? remainder : 11 - remainder);
};

type ReconciliationSummaryRow = {
  primaryState: string;
  cutoverBlocker: boolean;
  attentionFlags: readonly string[];
};

export const buildHrReconciliationFilter = (filter: {
  primaryState?: string;
  attentionFlag?: string;
  cutoverBlocker?: boolean;
}) => (row: ReconciliationSummaryRow) => (
  (!filter.primaryState || row.primaryState === filter.primaryState)
  && (!filter.attentionFlag || row.attentionFlags.includes(filter.attentionFlag))
  && (filter.cutoverBlocker === undefined || row.cutoverBlocker === filter.cutoverBlocker)
);

export const summarizeHrReconciliationRows = (rows: readonly ReconciliationSummaryRow[]) => {
  const byPrimaryState: Record<string, number> = Object.fromEntries(HR_RECONCILIATION_PRIMARY_STATES.map((code) => [code, 0]));
  const byAttentionFlag: Record<string, number> = Object.fromEntries(HR_RECONCILIATION_ATTENTION_FLAGS.map((code) => [code, 0]));
  let blockers = 0;
  for (const row of rows) {
    byPrimaryState[row.primaryState] = (byPrimaryState[row.primaryState] ?? 0) + 1;
    if (row.cutoverBlocker) blockers += 1;
    for (const flag of row.attentionFlags) byAttentionFlag[flag] = (byAttentionFlag[flag] ?? 0) + 1;
  }
  return {
    total: rows.length,
    blockers,
    clearForCutover: rows.length - blockers,
    byPrimaryState,
    byAttentionFlag,
    canCutOver: blockers === 0,
  };
};

export class HrMigrationOperationBlockedError extends Error {
  readonly code = 'POSSIBLE_DUPLICATE_IDENTITY';
}

export const assertAutomatedHrMigrationOperationAllowed = (input: {
  reconciliationId: string;
  activeAttentionFlags: readonly string[];
}) => {
  if (input.activeAttentionFlags.includes('POSSIBLE_DUPLICATE_IDENTITY')) {
    throw new HrMigrationOperationBlockedError(`POSSIBLE_DUPLICATE_IDENTITY:${input.reconciliationId}`);
  }
};
