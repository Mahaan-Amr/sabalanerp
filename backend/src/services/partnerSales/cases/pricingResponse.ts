import type { Prisma } from '@prisma/client';
import { inquiryConfigurationHash } from '@sabalanerp/partner-sales-contracts';
import { decodeTechnicalRecovery } from './technicalRecoveryRecords';
import { decodeTechnicalSavedSnapshot } from './technicalSavedRecords';
import { parseInquiryDefinition } from '../inquiries/definition';
import { canRetainCasePricingApproval } from '../inquiries/approvalUsage';

type ResponseState = 'READY' | 'PARTIAL' | 'WAITING' | 'REJECTED' | 'EXPIRED';
type Response = { subjectHash: string; outcome: string; expiresAt?: Date; superseded: boolean };

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
  if (!required.length && saved.serviceRows?.length) return 'READY';
  const rows = await tx.partnerInquiryRow.findMany({ where: { inquiry: { caseId: input.caseId, profileId: input.profileId } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], select: { outcome: true, definition: true,
      inquiry: { select: { caseRevision: true } }, successor: { select: { outcome: true } },
      approval: { select: { expiresAt: true } } } });
  const responses: Response[] = [];
  for (const row of rows) {
    const definition = parseInquiryDefinition(row.definition);
    if (!definition || definition.identity.partnerSellerId !== input.actorId ||
        !canRetainCasePricingApproval(row.inquiry.caseRevision, input.headRevision)) continue;
    responses.push({ subjectHash: await inquiryConfigurationHash(definition.identity), outcome: row.outcome,
      expiresAt: row.approval?.expiresAt, superseded: row.successor?.outcome === 'APPROVED' });
  }
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return summarizeCasePricingResponses(required, responses, clock.now);
}
