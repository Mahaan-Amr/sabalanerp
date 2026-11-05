/** Bounds financial-review state to its current route and signed-in user. */
export class FinancialReviewRequestGuard {
  private owner = '';
  private epoch = 0;
  select(owner: string) {
    if (owner !== this.owner) { this.owner = owner; this.epoch += 1; }
  }
  begin(owner: string): number | null {
    if (owner !== this.owner) return null;
    return ++this.epoch;
  }
  snapshot(owner: string): number | null { return owner === this.owner ? this.epoch : null; }
  isCurrent(owner: string, epoch: number | null): boolean {
    return epoch !== null && owner === this.owner && epoch === this.epoch;
  }
  invalidate(owner: string) { if (owner === this.owner) this.epoch += 1; }
}

type AuditRow = { id: string; action: string; createdAt: string; note?: string | null };
type RecordResponse<T> = { data?: { success?: boolean; data?: { items?: T[]; actionAvailability?: { approve?: boolean } } } };
type AuditResponse = { data?: { success?: boolean; data?: { items?: AuditRow[]; total?: number } } };

/** The page and regression tests share the actual asynchronous record + audit chain. */
export async function loadFinancialReview<T extends { id: string }>(input: {
  owner: string; recordId: string; epoch: number; guard: FinancialReviewRequestGuard;
  fetchRecord: () => Promise<RecordResponse<T>>; fetchAudit: () => Promise<AuditResponse>;
}) {
  const { owner, recordId, epoch, guard } = input;
  const recordResult = await input.fetchRecord();
  if (!guard.isCurrent(owner, epoch)) return null;
  const data = recordResult.data?.data;
  const record = data?.items?.[0];
  if (!recordResult.data?.success || !record || record.id !== recordId) return { kind: 'missing' as const };
  let auditResult: AuditResponse | null = null;
  let auditDenied = false;
  try { auditResult = await input.fetchAudit(); }
  catch (failure) { auditDenied = (failure as { response?: { status?: number } })?.response?.status === 403; }
  if (!guard.isCurrent(owner, epoch)) return null;
  const auditLoaded = Boolean(auditResult?.data?.success);
  return { kind: 'loaded' as const, record, auditDenied, auditLoadError: !auditLoaded && !auditDenied,
    auditRows: auditLoaded ? auditResult?.data?.data?.items ?? [] : [],
    auditTotal: auditLoaded ? auditResult?.data?.data?.total ?? 0 : 0,
    canApprove: Boolean(data?.actionAvailability?.approve) && (auditLoaded || auditDenied) };
}

/** No action or financial details may survive an identity/record switch or reload. */
export function canSubmitFinancialReview(input: { loading: boolean; busy: boolean; owner: string; recordId: string;
  payloadId: string; review?: { owner: string; record: { id: string }; canApprove: boolean } | null }) {
  const { review } = input;
  return !input.loading && !input.busy && Boolean(review?.canApprove) && review?.owner === input.owner
    && review.record.id === input.recordId && input.payloadId === input.recordId;
}
