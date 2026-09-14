import {
  PartnerActivationCommandV3Schema,
  PartnerActivationReceiptV3Schema,
  PartnerActivationViewV3Schema,
  PartnerErrorSchema,
  partnerError,
  type PartnerActivationPackageV3Port,
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

export function createPartnerActivationHttpPort(client: Client = api): PartnerActivationPackageV3Port {
  return {
    async query(input) {
      try {
        const response = await client.post('/partner/activation/query-v3', input);
        const envelope = response.data as { success?: unknown; data?: unknown } | null;
        const parsed = PartnerActivationViewV3Schema.safeParse(envelope?.success === true ? envelope.data : undefined);
        return parsed.success ? { ok: true, value: parsed.data }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      } catch (error) { const business = failure(error); if (business) return business; throw error; }
    },
    async execute(input) {
      const command = PartnerActivationCommandV3Schema.safeParse(input);
      if (!command.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      try {
        const response = await client.post('/partner/activation/commands-v3', command.data);
        const envelope = response.data as { success?: unknown; data?: unknown } | null;
        const parsed = PartnerActivationReceiptV3Schema.safeParse(envelope?.success === true ? envelope.data : undefined);
        return parsed.success && parsed.data.commandId === command.data.commandId
          ? { ok: true, value: parsed.data }
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      } catch (error) { const business = failure(error); if (business) return business; throw error; }
    },
  };
}
