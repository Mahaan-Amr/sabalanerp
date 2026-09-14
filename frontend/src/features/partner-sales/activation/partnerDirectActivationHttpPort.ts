import {
  PartnerDirectActivationCommandV4Schema,
  PartnerDirectActivationReceiptV4Schema,
  PartnerDirectActivationRevertCommandV4Schema,
  PartnerDirectActivationRevertReceiptV4Schema,
  PartnerDirectActivationViewV4Schema,
  PartnerErrorSchema,
  partnerError,
  type PartnerDirectActivationV4Port,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type Client = { post(path: string, body: unknown): Promise<{ data: unknown }> };

function failure(error: unknown): Result<never> | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') return null;
  const row = response.data as { code?: unknown; error?: unknown };
  const parsed = PartnerErrorSchema.safeParse({ code: row.code, status: response.status, message: row.error });
  return parsed.success ? { ok: false, error: parsed.data } : null;
}

export function createPartnerDirectActivationHttpPort(client: Client = api): PartnerDirectActivationV4Port {
  return {
    async query(input) {
      try {
        const response = await client.post('/partner/activation/query-v4', input);
        const envelope = response.data as { success?: unknown; data?: unknown } | null;
        const parsed = PartnerDirectActivationViewV4Schema.safeParse(envelope?.success === true ? envelope.data : undefined);
        return parsed.success ? { ok: true, value: parsed.data }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      } catch (error) { const business = failure(error); if (business) return business; throw error; }
    },
    async execute(input) {
      const command = PartnerDirectActivationCommandV4Schema.safeParse(input);
      if (!command.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      try {
        const response = await client.post('/partner/activation/commands-v4', command.data);
        const envelope = response.data as { success?: unknown; data?: unknown } | null;
        const parsed = PartnerDirectActivationReceiptV4Schema.safeParse(envelope?.success === true ? envelope.data : undefined);
        return parsed.success && parsed.data.commandId === command.data.commandId
          ? { ok: true, value: parsed.data }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      } catch (error) { const business = failure(error); if (business) return business; throw error; }
    },
    async revert(input) {
      const command = PartnerDirectActivationRevertCommandV4Schema.safeParse(input);
      if (!command.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      try {
        const response = await client.post('/partner/activation/revert-v4', command.data);
        const envelope = response.data as { success?: unknown; data?: unknown } | null;
        const parsed = PartnerDirectActivationRevertReceiptV4Schema.safeParse(
          envelope?.success === true ? envelope.data : undefined);
        return parsed.success && parsed.data.commandId === command.data.commandId
          ? { ok: true, value: parsed.data }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      } catch (error) { const business = failure(error); if (business) return business; throw error; }
    },
  };
}
