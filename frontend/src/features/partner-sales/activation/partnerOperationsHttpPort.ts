import { PartnerErrorSchema, canonicalHash, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type Client = { post(path: string, body: unknown): Promise<{ data: unknown }> };
export type PartnerOperationsState = { revision: number; enrollmentPaused: boolean; operationalPaused: boolean;
  cohort: { id: string; name: string; sellerIds: string[] } | null };

function state(value: unknown): PartnerOperationsState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, cohort = row.cohort;
  if (!Number.isSafeInteger(row.revision) || typeof row.enrollmentPaused !== 'boolean' ||
      typeof row.operationalPaused !== 'boolean') return null;
  if (cohort !== null) {
    if (!cohort || typeof cohort !== 'object' || Array.isArray(cohort)) return null;
    const cohortRow = cohort as Record<string, unknown>, sellerIds = cohortRow.sellerIds;
    if (typeof cohortRow.id !== 'string' || typeof cohortRow.name !== 'string' || !Array.isArray(sellerIds)
        || !sellerIds.every(id => typeof id === 'string')) return null;
  }
  return value as PartnerOperationsState;
}

function failure(value: unknown): Result<never> {
  const envelope = value && typeof value === 'object' ? value as { error?: unknown } : null;
  const row = envelope?.error && typeof envelope.error === 'object' ? envelope.error as Record<string, unknown> : null;
  const parsed = PartnerErrorSchema.safeParse(row ? { code: row.code, status: row.status, message: row.message } : null);
  return { ok: false, error: parsed.success ? parsed.data : partnerError('INTEGRITY_CONFLICT') };
}

export function createPartnerOperationsHttpPort(client: Client = api) {
  const post = async (path: string, body: unknown): Promise<Result<PartnerOperationsState>> => {
    try {
      const response = await client.post(path, body);
      const envelope = response.data as { ok?: unknown; value?: unknown } | null;
      const parsed = envelope?.ok === true ? state(envelope.value) : null;
      return parsed ? { ok: true, value: parsed } : failure(response.data);
    } catch (error) {
      const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
      if (data) return failure(data);
      throw error;
    }
  };
  return {
    defineCohort: (input: { id: string; name: string; expectedRevision: number; reason: string }) =>
      post('/partner/operations/cohort', input),
    enroll: (input: { sellerId: string; expectedRevision: number; reason: string }) =>
      post('/partner/operations/cohort/enroll', input),
    pause: async (input: { actorId: string; kind: 'ENROLLMENT' | 'OPERATIONAL'; paused: boolean;
      expectedRevision: number; reason: string }) => {
      const intent = { kind: input.kind, paused: input.paused, expectedRevision: input.expectedRevision, reason: input.reason };
      const commandId = crypto.randomUUID();
      return post('/partner/operations/pause', { schemaVersion: 1, type: 'OPERATIONS_PAUSE', commandId,
        correlationId: commandId, ...intent, idempotency: { actorId: input.actorId, operation: 'OPERATIONS_PAUSE',
          targetId: 'partner-operations', key: crypto.randomUUID(), payloadHash: await canonicalHash(intent) } });
    },
  };
}
