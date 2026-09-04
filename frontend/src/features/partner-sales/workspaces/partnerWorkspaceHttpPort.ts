import {
  PartnerErrorSchema,
  PartnerManagementWorkspaceViewV2Schema,
  PartnerQueryV2Schema,
  ResponderWorkspaceViewV2Schema,
  partnerError,
  type PartnerQueryV2Port,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type HttpResponse = { data: unknown };
export interface PartnerWorkspaceHttpClient {
  post(path: string, body: unknown): Promise<HttpResponse>;
}

function businessFailure(error: unknown): Result<never> | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') return null;
  const row = response.data as { code?: unknown; error?: unknown };
  const parsed = PartnerErrorSchema.safeParse({ code: row.code, status: response.status, message: row.error });
  return parsed.success ? { ok: false, error: parsed.data } : null;
}

export function createPartnerWorkspaceHttpPort(
  client: PartnerWorkspaceHttpClient = api,
): PartnerQueryV2Port {
  return { async query(input) {
    const query = PartnerQueryV2Schema.safeParse(input);
    if (!query.success || (query.data.purpose !== 'PARTNER_MANAGEMENT' &&
        query.data.purpose !== 'RESPONDER_WORKSPACE')) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') } as never;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.post('/partner/workspaces/query-v2', query.data);
        const envelope = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
          ? response.data as { success?: unknown; data?: unknown } : undefined;
        if (envelope?.success !== true) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
        const parsed = query.data.purpose === 'PARTNER_MANAGEMENT'
          ? PartnerManagementWorkspaceViewV2Schema.safeParse(envelope.data)
          : ResponderWorkspaceViewV2Schema.safeParse(envelope.data);
        return parsed.success ? { ok: true, value: parsed.data } as never
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      } catch (error) {
        const failure = businessFailure(error);
        if (failure) return failure as never;
        if (attempt === 1) throw error;
        // Read-only query: one bounded retry recovers a replaced local/runtime
        // upstream connection without replaying a command or weakening denial.
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    throw new Error('Unreachable workspace query retry state');
  } };
}
