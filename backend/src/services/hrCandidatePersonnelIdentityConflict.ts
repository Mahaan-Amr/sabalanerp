import { Prisma } from '@prisma/client';
import { classifyCandidateIdentity } from './hrCandidateIdentityPolicy';
import { addTehranWorkingDays, tehranCivilDateKey } from './tehranBusinessCalendar';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export type IdentityClaim = {
  firstName: unknown;
  lastName: unknown;
  mobile: unknown;
  nationalCode?: unknown;
  foreignIdentityType?: unknown;
  foreignIdentityNumber?: unknown;
};

export const openIdentityConflictForApplication = (database: any, applicationId: string) =>
  database.hrCandidatePersonnelIdentityConflict.findFirst({
    where: { applicationId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });

export const assertIdentityConflictResolved = async (database: any, applicationId: string) => {
  if (await openIdentityConflictForApplication(database, applicationId)) {
    throw new Error('مغایرت هویت Candidate و Personnel باید پیش از ادامه تعیین تکلیف شود.');
  }
};

type CandidatePersonnelIdentityInput = {
  applicationId: string;
  candidate: { id: string; firstName: unknown; lastName: unknown; mobile: unknown; nationalCode?: unknown; linkedPersonnel?: { id: string; firstName: unknown; lastName: unknown; nationalCode?: string | null; identityCompletionStatus?: string | null } | null };
};

const candidatePersonnelIdentityMismatch = (input: CandidatePersonnelIdentityInput) => {
  if (!input.candidate.linkedPersonnel) return false;
  const classification = classifyCandidateIdentity(
    { ...input.candidate.linkedPersonnel, mobile: input.candidate.mobile },
    input.candidate,
  );
  const nationalCodeMismatch = Boolean(input.candidate.nationalCode
    && input.candidate.linkedPersonnel.nationalCode !== input.candidate.nationalCode);
  return classification.kind === 'HARD_CONFLICT' || nationalCodeMismatch;
};

const assertLinkedPersonnelComplete = (input: CandidatePersonnelIdentityInput) => {
  if (input.candidate.linkedPersonnel?.identityCompletionStatus !== 'COMPLETE') {
    throw new Error('هویت Personnel پیوندشده هنوز نیازمند تکمیل است.');
  }
};

export const assertCandidatePersonnelIdentityConsistent = async (database: any, input: CandidatePersonnelIdentityInput) => {
  await assertIdentityConflictResolved(database, input.applicationId);
  if (!input.candidate.linkedPersonnel) return;
  assertLinkedPersonnelComplete(input);
  if (!candidatePersonnelIdentityMismatch(input)) return;
  throw new Error('مغایرت هویت Candidate و Personnel باید پیش از ادامه تعیین تکلیف شود.');
};

export const ensureCandidatePersonnelIdentityConsistent = async (database: any, input: CandidatePersonnelIdentityInput) => {
  await assertIdentityConflictResolved(database, input.applicationId);
  if (!input.candidate.linkedPersonnel) return;
  assertLinkedPersonnelComplete(input);
  if (!candidatePersonnelIdentityMismatch(input)) return;
  await createIdentityConflictIfNeeded(database, {
    applicationId: input.applicationId,
    candidateId: input.candidate.id,
    claim: input.candidate,
    potentialPersonnel: input.candidate.linkedPersonnel,
  });
  throw new Error('مغایرت هویت Candidate و Personnel باید پیش از ادامه تعیین تکلیف شود.');
};

export const createIdentityConflictIfNeeded = async (database: any, input: {
  applicationId: string;
  candidateId: string;
  claim: IdentityClaim;
  potentialCandidate?: { id: string; firstName: unknown; lastName: unknown; mobile: unknown; linkedPersonnelId?: string | null } | null;
  potentialPersonnel?: { id: string; firstName: unknown; lastName: unknown; nationalCode?: string | null } | null;
  now?: Date;
}) => {
  const compared = input.potentialPersonnel || input.potentialCandidate;
  if (!compared) return null;
  const classification = classifyCandidateIdentity(
    { firstName: compared.firstName, lastName: compared.lastName, mobile: (compared as any).mobile ?? input.claim.mobile },
    input.claim,
  );
  const referencesAnotherIdentity = Boolean(input.potentialPersonnel || input.potentialCandidate?.id !== input.candidateId);
  if (!referencesAnotherIdentity && classification.kind !== 'HARD_CONFLICT') return null;
  const current = await openIdentityConflictForApplication(database, input.applicationId);
  if (current) return current;
  const now = input.now || new Date();
  const holidays = new Set<string>((await database.sabalanCalendarEntry.findMany({
    where: { isActive: true, isHoliday: true }, select: { date: true },
  })).map(({ date }: { date: Date }) => tehranCivilDateKey(date)));
  const dueAt = addTehranWorkingDays(now, 3, holidays);
  const conflict = await database.hrCandidatePersonnelIdentityConflict.create({ data: {
    applicationId: input.applicationId,
    candidateId: input.candidateId,
    potentialCandidateId: input.potentialCandidate?.id || null,
    potentialPersonnelId: input.potentialPersonnel?.id || input.potentialCandidate?.linkedPersonnelId || null,
    claimedIdentityJson: json(input.claim),
    matchedIdentityJson: json({
      firstName: compared.firstName,
      lastName: compared.lastName,
      nationalCode: (compared as any).nationalCode ?? null,
    }),
    mobileMismatch: classification.mobileMismatch,
    dueAt,
  } });
  const sourceKey = `HIRING:${input.applicationId}:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED`;
  const workItem = await database.hrWorkItem.upsert({ where: { sourceKey }, update: {
    status: 'PENDING', dueDate: dueAt, completedAt: null, completedByUserId: null,
  }, create: {
    title: 'تعیین تکلیف مغایرت هویت متقاضی و پرسنل',
    description: 'تصمیم مستقل هویتی با شواهد معتبر لازم است.',
    sourceType: 'HIRING_ACTION', sourceKey,
    destinationHref: `/dashboard/hr/hiring/${input.applicationId}`,
    assignedToUserId: null, dueDate: dueAt, createdByUserId: null,
  } });
  await database.hrWorkItemAudit.create({ data: {
    workItemId: workItem.id, eventType: 'IDENTITY_CONFLICT_TASK_CREATED', actorUserId: null,
    beforeJson: Prisma.JsonNull, afterJson: json({ conflictId: conflict.id, dueAt }),
  } });
  await database.hrJobApplication.update({ where: { id: input.applicationId }, data: { identityClearance: 'IN_PROGRESS' } });
  await database.hrHiringAudit.create({ data: {
    applicationId: input.applicationId, actorUserId: null, actorKind: 'SYSTEM',
    eventType: 'CANDIDATE_PERSONNEL_IDENTITY_CONFLICT_OPENED',
    payloadJson: json({ conflictId: conflict.id, potentialCandidateId: conflict.potentialCandidateId,
      potentialPersonnelId: conflict.potentialPersonnelId, dueAt }),
  } });
  return conflict;
};
