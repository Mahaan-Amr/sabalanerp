import {
  IdSchema,
  InquiryBatchResultSchema,
  PartnerCommandSchema,
  PartnerErrorSchema,
  partnerError,
  type PartnerCommandPort,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type HttpResponse = { data: unknown };
export interface PartnerRuntimeCommandHttpClient {
  post(path: string, body: unknown): Promise<HttpResponse>;
}

function failure(error: unknown): Result<never> | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') return null;
  const row = response.data as { code?: unknown; error?: unknown };
  const parsed = PartnerErrorSchema.safeParse({ code: row.code, status: response.status, message: row.error });
  return parsed.success ? { ok: false, error: parsed.data } : null;
}

export function createPartnerRuntimeCommandPort(
  client: PartnerRuntimeCommandHttpClient = api,
): PartnerCommandPort {
  return { async execute(input) {
    const parsed = PartnerCommandSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const command = parsed.data;
    let path: string;
    switch (command.type) {
      case 'PROFILE_TRANSITION': path = '/partner/management/commands'; break;
      case 'INQUIRY_REASSIGN': path = '/partner/inquiries/commands'; break;
      case 'CUSTOMER_TRANSFER_DECIDE': path = `/crm/partner/customer-transfers/${command.transferId}/decision`; break;
      default: return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    try {
      const response = await client.post(path, command);
      const envelope = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
        ? response.data as { success?: unknown; data?: unknown } : undefined;
      const value = envelope?.success === true && envelope.data && typeof envelope.data === 'object' &&
        !Array.isArray(envelope.data) ? envelope.data as Record<string, unknown> : undefined;
      const commandId = IdSchema.safeParse(value?.commandId);
      const eventIds = Array.isArray(value?.eventIds) ? value.eventIds.map(item => IdSchema.safeParse(item)) : [];
      const batch = value?.batch === undefined ? undefined : InquiryBatchResultSchema.safeParse(value.batch);
      if (!value || !commandId.success || commandId.data !== command.commandId || !Array.isArray(value.eventIds) ||
          eventIds.some(item => !item.success) || (batch && !batch.success) ||
          (value.replayed !== undefined && typeof value.replayed !== 'boolean')) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      return { ok: true, value: {
        commandId: commandId.data,
        replayed: value.replayed === true,
        eventIds: eventIds.map(item => item.success ? item.data : ''),
        ...(batch?.success ? { batch: batch.data } : {}),
      } };
    } catch (error) {
      const business = failure(error);
      if (business) return business;
      throw error;
    }
  } };
}
