import { partnerReactivationAt } from './reactivationPricing';
import type { Prisma } from '@prisma/client';
import { inquiryConfigurationHash } from '@sabalanerp/partner-sales-contracts';
import { decodeTechnicalRecovery } from './technicalRecoveryRecords';
import { decodeTechnicalSavedSnapshot } from './technicalSavedRecords';
import { parseInquiryDefinition } from '../inquiries/definition';
import { canRetainCasePricingApproval } from '../inquiries/approvalUsage';

type ResponseState = 'READY' | 'PARTIAL' | 'WAITING' | 'REJECTED' | 'EXPIRED';
type Response = { subjectHash: string; outcome: string; expiresAt?: Date; superseded: boolean; predecessorId?: string | null; hasSuccessor?: boolean };

/** Completion follows the newest request, independently of reusable price evidence. */
export function summarizeCaseInquiryCompletion(required: readonly string[], responses: readonly Response[]) {
  const latest = required.map(hash => responses.find(row => row.subjectHash === hash && !row.superseded && !row.hasSuccessor));
  return { complete: latest.length > 0 && latest.every(row => row && ['APPROVED', 'REJECTED'].includes(row.outcome)),
    resubmittedWaiting: latest.some(row => row?.outcome === 'PENDING' && Boolean(row.predecessorId)) };
}

/** Read-only presentation of offers; never changes the accepted Case revision. */
export function summarizeCasePricingResponses(required: readonly string[], responses: readonly Response[], now: Date): ResponseState {
  const states = required.map(hash => {
    const matching = responses.filter(row => row.subjectHash === hash && !row.superseded);
    if (matching.some(row => row.outcome === 'APPROVED' && row.expiresAt && row.expiresAt > now)) return 'READY';
    const latest = matching[0];
    if (latest?.outcome === 'REJECTED') return 'REJECTED';
    if (latest?.outcome === 'APPROVED') return 'EXPIRED';
    return 'WAITING';
  });
  if (states.length && states.every(state => state === 'READY')) return 'READY';
  if (states.includes('REJECTED')) return 'REJECTED';
  if (states.includes('EXPIRED')) return 'EXPIRED';
  return states.includes('READY') ? 'PARTIAL' : 'WAITING';
}

export async function readCasePricingResponse(tx: Prisma.TransactionClient, input: {
  caseId: string; headRevision: number; profileId: string; actorId: string; recovery: unknown;
}): Promise<ResponseState | undefined> {
  return (await readCasePricingPresentation(tx, input))?.state;
}

export async function readCasePricingPresentation(tx: Prisma.TransactionClient, input: {
  caseId: string; headRevision: number; profileId: string; actorId: string; recovery: unknown;
}): Promise<{ state: ResponseState; complete: boolean; resubmittedWaiting: boolean } | undefined> {
  const recovery = decodeTechnicalRecovery(input.recovery);
  if (!recovery) return undefined;
  let saved: Awaited<ReturnType<typeof decodeTechnicalSavedSnapshot>>;
  for (const record of Array.isArray(recovery.validatedSnapshots) ? recovery.validatedSnapshots : []) {
    const candidate = await decodeTechnicalSavedSnapshot(record);
    if (candidate && (!saved || candidate.view.recoveryRevision > saved.view.recoveryRevision)) saved = candidate;
  }
  if (!saved || recovery.draft.inputRevision > saved.view.inputRevision) return undefined;
  const subjectIds = saved.view.pricingSubjects?.map(subject => subject.configurationRef.productRowId);
  const subjects = saved.identities.filter(item => (!subjectIds || subjectIds.includes(item.productRowId)) && !saved!.draft.dependents?.some(dependent =>
    dependent.kind === 'remainder' && dependent.productRowId === item.productRowId));
  const required = await Promise.all(subjects.map(item => inquiryConfigurationHash(item.identity)));
  if (!required.length && saved.serviceRows?.length) return { state: 'READY', complete: true, resubmittedWaiting: false };
  const reactivatedAt = await partnerReactivationAt(tx, input.caseId);
  const rows = await tx.partnerInquiryRow.findMany({ where: { inquiry: { caseId: input.caseId, profileId: input.profileId, ...(reactivatedAt ? { submittedAt: { gt: reactivatedAt } } : {}) } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], select: { outcome: true, definition: true, predecessorId: true,
      inquiry: { select: { caseRevision: true } }, successor: { select: { outcome: true } },
      approval: { select: { expiresAt: true } } } });
  const responses: Response[] = [];
  for (const row of rows) {
    const definition = parseInquiryDefinition(row.definition);
    if (!definition || definition.identity.partnerSellerId !== input.actorId ||
        !canRetainCasePricingApproval(row.inquiry.caseRevision, input.headRevision)) continue;
    responses.push({ subjectHash: await inquiryConfigurationHash(definition.identity), outcome: row.outcome,
      expiresAt: row.approval?.expiresAt, superseded: row.successor?.outcome === 'APPROVED', predecessorId: row.predecessorId,
      hasSuccessor: Boolean(row.successor) });
  }
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return { state: summarizeCasePricingResponses(required, responses, clock.now), ...summarizeCaseInquiryCompletion(required, responses) };
}
