import {
  IdSchema, InquiryBatchResultSchema, PartnerCommandSchema, PartnerErrorSchema,
  PartnerInquiryViewV2Schema, PartnerQueryV2Schema, ResponderInquiryViewV2Schema,
  partnerError, type PartnerCommandPort, type PartnerQueryV2Port, type Result,
} from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type HttpResponse = { data: unknown };
export interface PartnerInquiryHttpClient { post(path: string, body: unknown): Promise<HttpResponse> }

function businessFailure(error: unknown): Result<never> | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') return null;
  const parsed = PartnerErrorSchema.safeParse(response.data);
  if (parsed.success && parsed.data.status === response.status) return { ok: false, error: parsed.data };
  const code = (response.data as { code?: unknown }).code;
  const canonical = typeof code === 'string' ? PartnerErrorSchema.safeParse({ code, status: response.status,
    message: (response.data as { error?: unknown }).error }) : { success: false as const };
  return canonical.success ? { ok: false, error: canonical.data } : null;
}

function successData(response: HttpResponse): unknown | undefined {
  return response.data && typeof response.data === 'object' && (response.data as { success?: unknown }).success === true
    ? (response.data as { data?: unknown }).data : undefined;
}

export function createPartnerInquiryHttpPorts(client: PartnerInquiryHttpClient = api): {
  commands: PartnerCommandPort; queries: PartnerQueryV2Port;
} {
  const commands: PartnerCommandPort = { async execute(input) {
    const command = PartnerCommandSchema.safeParse(input);
    if (!command.success || !['INQUIRY_SUBMIT', 'INQUIRY_DECIDE', 'INQUIRY_CANCEL', 'INQUIRY_REASSIGN'].includes(command.data.type)) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    try {
      const value = successData(await client.post('/partner/inquiries/commands', command.data));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const row = value as Record<string, unknown>;
      const commandId = IdSchema.safeParse(row.commandId), eventIds = Array.isArray(row.eventIds) ? row.eventIds.map(id => IdSchema.safeParse(id)) : [];
      const batch = row.batch === undefined ? undefined : InquiryBatchResultSchema.safeParse(row.batch);
      if (!commandId.success || typeof row.replayed !== 'boolean' || !Array.isArray(row.eventIds) || eventIds.some(id => !id.success) ||
          (batch && !batch.success) || Object.keys(row).some(key => !['commandId', 'replayed', 'eventIds', 'batch'].includes(key))) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      return { ok: true, value: { commandId: commandId.data, replayed: row.replayed,
        eventIds: eventIds.map(id => id.success ? id.data : ''), ...(batch?.success ? { batch: batch.data } : {}) } };
    } catch (error) {
      const failure = businessFailure(error);
      if (failure) return failure;
      throw error;
    }
  } };
  const queries: PartnerQueryV2Port = { async query(input) {
    const query = PartnerQueryV2Schema.safeParse(input);
    if (!query.success || !['PARTNER_INQUIRY', 'RESPONDER_INQUIRY'].includes(query.data.purpose)) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') } as never;
    }
    try {
      const value = successData(await client.post('/partner/inquiries/query-v2', query.data));
      const parsed = query.data.purpose === 'PARTNER_INQUIRY'
        ? PartnerInquiryViewV2Schema.safeParse(value) : ResponderInquiryViewV2Schema.safeParse(value);
      return parsed.success ? { ok: true, value: parsed.data } as never
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
    } catch (error) {
      const failure = businessFailure(error);
      if (failure) return failure as never;
      throw error;
    }
  } };
  return { commands, queries };
}
