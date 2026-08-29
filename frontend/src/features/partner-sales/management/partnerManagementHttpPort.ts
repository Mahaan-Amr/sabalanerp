import { IdSchema, PartnerErrorSchema, PartnerManagementCommandV2Schema, RevisionSchema, partnerError,
  type PartnerManagementCommandV2Port, type Result } from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type HttpResponse = { data: unknown };
export interface PartnerManagementHttpClient { post(path: string, body: unknown): Promise<HttpResponse> }

function failure(error: unknown): Result<never> | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') return null;
  const row = response.data as { code?: unknown; error?: unknown };
  const parsed = PartnerErrorSchema.safeParse({ code: row.code, status: response.status, message: row.error });
  return parsed.success ? { ok: false, error: parsed.data } : null;
}

export function createPartnerManagementHttpPort(client: PartnerManagementHttpClient = api): PartnerManagementCommandV2Port {
  return { async execute(input) {
    const command = PartnerManagementCommandV2Schema.safeParse(input);
    if (!command.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    try {
      const response = await client.post('/partner/management/commands-v2', command.data);
      const envelope = response.data as { success?: unknown; data?: unknown } | null;
      const value = envelope && envelope.success === true ? envelope.data : undefined;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const row = value as Record<string, unknown>;
      const commandId = IdSchema.safeParse(row.commandId), profileId = IdSchema.safeParse(row.profileId), revision = RevisionSchema.safeParse(row.revision);
      const eventIds = Array.isArray(row.eventIds) ? row.eventIds.map(id => IdSchema.safeParse(id)) : [];
      if (!commandId.success || commandId.data !== command.data.commandId || !profileId.success || !revision.success ||
          typeof row.replayed !== 'boolean' || !Array.isArray(row.eventIds) || eventIds.some(id => !id.success) ||
          Object.keys(row).some(key => !['commandId', 'replayed', 'profileId', 'revision', 'eventIds'].includes(key))) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      return { ok: true, value: { commandId: commandId.data, replayed: row.replayed, profileId: profileId.data,
        revision: revision.data, eventIds: eventIds.map(id => id.success ? id.data : '') } };
    } catch (error) {
      const business = failure(error); if (business) return business; throw error;
    }
  } };
}
