import {
  PartnerTechnicalCatalogPageSchema, PartnerTechnicalCatalogQuerySchema,
  PartnerTechnicalCheckpointReceiptSchema, PartnerTechnicalCheckpointSchema,
  PartnerTechnicalLeaseRequestSchema, PartnerTechnicalLeaseReceiptSchema,
  PartnerTechnicalRecoveryAccessSchema, PartnerTechnicalRecoveryViewSchema,
  PartnerTechnicalSaveReceiptSchema, PartnerTechnicalSaveSchema,
  PartnerTechnicalSavedReadSchema, PartnerTechnicalSavedViewSchema,
  PartnerTechnicalPolicyPublishSchema, PartnerTechnicalPolicyReceiptSchema,
  PartnerTechnicalPolicyViewSchema, IdSchema,
  partnerError, type PartnerErrorCode, type Result,
  type PartnerTechnicalCatalogPort, type PartnerTechnicalLeasePort, type PartnerTechnicalRecoveryPort,
  type PartnerTechnicalSavePort,
  type PartnerTechnicalPolicyPort,
} from '@sabalanerp/partner-sales-contracts';
import api from '@/lib/api';

type HttpResponse = { data: unknown };
export interface PartnerTechnicalHttpClient {
  post(path: string, body: unknown): Promise<HttpResponse>;
  put(path: string, body: unknown): Promise<HttpResponse>;
}
export interface PartnerTechnicalPolicyHttpClient {
  get(path: string): Promise<HttpResponse>;
  post(path: string, body: unknown): Promise<HttpResponse>;
}

type PublicSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

const invalid = () => ({ ok: false, error: partnerError('INVALID_PAYLOAD') } as const);
const corrupt = () => ({ ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const);

function successful<T>(response: HttpResponse, schema: PublicSchema<T>): Result<T> {
  const envelope = response.data;
  if (!envelope || typeof envelope !== 'object' || (envelope as { success?: unknown }).success !== true) return corrupt();
  const parsed = schema.safeParse((envelope as { data?: unknown }).data);
  return parsed.success ? { ok: true, value: parsed.data } : corrupt();
}

function businessFailure(error: unknown): Result<never> | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!response || typeof response.status !== 'number' || !response.data || typeof response.data !== 'object') return null;
  if (response.status === 404) return { ok: false, error: partnerError('NOT_FOUND') };
  const code = (response.data as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  try {
    const canonical = partnerError(code as PartnerErrorCode);
    return canonical.status === response.status ? { ok: false, error: canonical } : null;
  } catch {
    return null;
  }
}

async function request<T>(operation: () => Promise<HttpResponse>, schema: PublicSchema<T>): Promise<Result<T>> {
  try {
    return successful(await operation(), schema);
  } catch (error) {
    const failure = businessFailure(error);
    if (failure) return failure;
    throw error;
  }
}

/** Strict browser adapter for the authenticated, private technical transport.
 * It returns only public package views; network ambiguity remains throwable so
 * the session coordinator retries the same idempotent command. */
export function createPartnerTechnicalHttpPorts(client: PartnerTechnicalHttpClient = api) {
  const lease: PartnerTechnicalLeasePort = { async acquire(input) {
    const parsed = PartnerTechnicalLeaseRequestSchema.safeParse(input);
    if (!parsed.success) return invalid();
    return request(() => client.post('/partner/technical/recoveries/acquire', parsed.data),
      PartnerTechnicalLeaseReceiptSchema);
  } };
  const catalog: PartnerTechnicalCatalogPort = { async read(input) {
    const parsed = PartnerTechnicalCatalogQuerySchema.safeParse(input);
    if (!parsed.success) return invalid();
    return request(() => client.post('/partner/technical/catalog/query', parsed.data), PartnerTechnicalCatalogPageSchema);
  } };
  const recovery: PartnerTechnicalRecoveryPort = {
    async read(input) {
      const parsed = PartnerTechnicalRecoveryAccessSchema.safeParse(input);
      if (!parsed.success) return invalid();
      return request(() => client.post('/partner/technical/recoveries/read', parsed.data), PartnerTechnicalRecoveryViewSchema);
    },
    async checkpoint(input) {
      const parsed = PartnerTechnicalCheckpointSchema.safeParse(input);
      if (!parsed.success) return invalid();
      return request(() => client.put('/partner/technical/recoveries/checkpoint', parsed.data), PartnerTechnicalCheckpointReceiptSchema);
    },
  };
  const saved: PartnerTechnicalSavePort = {
    async save(input) {
      const parsed = PartnerTechnicalSaveSchema.safeParse(input);
      if (!parsed.success) return invalid();
      return request(() => client.post('/partner/technical/recoveries/save', parsed.data), PartnerTechnicalSaveReceiptSchema);
    },
    async readSaved(input) {
      const parsed = PartnerTechnicalSavedReadSchema.safeParse(input);
      if (!parsed.success) return invalid();
      return request(() => client.post('/partner/technical/recoveries/read-saved', parsed.data), PartnerTechnicalSavedViewSchema);
    },
  };
  return { lease, catalog, recovery, saved };
}

export function createPartnerTechnicalPolicyHttpPort(client: PartnerTechnicalPolicyHttpClient = api): PartnerTechnicalPolicyPort {
  return {
    async read(profileId) {
      const parsed = IdSchema.safeParse(profileId);
      if (!parsed.success) return invalid();
      return request(() => client.get(`/partner/management/technical-policy/${encodeURIComponent(parsed.data)}`),
        PartnerTechnicalPolicyViewSchema);
    },
    async publish(input) {
      const parsed = PartnerTechnicalPolicyPublishSchema.safeParse(input);
      if (!parsed.success) return invalid();
      return request(() => client.post('/partner/management/technical-policy', parsed.data),
        PartnerTechnicalPolicyReceiptSchema);
    },
  };
}
