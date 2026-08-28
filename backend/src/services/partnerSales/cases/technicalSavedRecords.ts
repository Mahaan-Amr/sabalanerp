import { parseCanonicalProductGraph, type CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { canonicalHash, InquiryIdentitySchema, PartnerTechnicalDraftSchema, PartnerTechnicalSavedViewSchema,
  type InquiryIdentity, type PartnerTechnicalDraft, type PartnerTechnicalSavedView } from '@sabalanerp/partner-sales-contracts';
import { technicalRecoveryJson } from './technicalRecovery';

export interface TechnicalSavedSnapshot {
  version: 1; sessionId: string; view: PartnerTechnicalSavedView; draft: PartnerTechnicalDraft;
  graph: CanonicalProductGraph; context: unknown;
  identities: { productRowId: string; identity: InquiryIdentity }[];
}

export function decodeTechnicalSaveOutcome(value: unknown): { version: 1; sessionId: string; recoveryRevision: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['version', 'sessionId', 'recoveryRevision'].includes(key)) ||
      record.version !== 1 || typeof record.sessionId !== 'string' || !record.sessionId ||
      typeof record.recoveryRevision !== 'number' || !Number.isSafeInteger(record.recoveryRevision) || record.recoveryRevision < 1) return undefined;
  return { version: 1, sessionId: record.sessionId, recoveryRevision: record.recoveryRevision };
}

/** Private recovery evidence, not a public DTO. Hash is corruption detection;
 * authenticity still comes from the owning transaction and protected journal. */
export async function encodeTechnicalSavedSnapshot(value: TechnicalSavedSnapshot) {
  const payload = technicalRecoveryJson(value);
  return { payload, integrityHash: await canonicalHash(payload) };
}

export async function decodeTechnicalSavedSnapshot(value: unknown): Promise<TechnicalSavedSnapshot | undefined> {
  try {
    const envelope = value as { payload: TechnicalSavedSnapshot; integrityHash: string };
    if (!envelope || Object.keys(envelope).some(key => !['payload', 'integrityHash'].includes(key)) ||
        await canonicalHash(envelope.payload) !== envelope.integrityHash) return undefined;
    const payload = envelope.payload;
    if (payload.version !== 1 || typeof payload.sessionId !== 'string' || !payload.sessionId ||
        !Array.isArray(payload.identities)) return undefined;
    const view = PartnerTechnicalSavedViewSchema.parse(payload.view);
    const draft = PartnerTechnicalDraftSchema.parse(payload.draft);
    const graph = parseCanonicalProductGraph(payload.graph);
    const identities = payload.identities.map(item => ({ productRowId: item.productRowId, identity: InquiryIdentitySchema.parse(item.identity) }));
    if (draft.inputRevision !== view.inputRevision || graph.rows.length !== view.rows.length || identities.length !== graph.rows.length ||
        new Set(identities.map(item => item.productRowId)).size !== identities.length ||
        graph.rows.some(row => !view.rows.some(item => item.configurationRef.productRowId === row.productRowId) ||
          !identities.some(item => item.productRowId === row.productRowId))) return undefined;
    return { version: 1, sessionId: payload.sessionId, view, draft, graph, context: payload.context, identities };
  } catch { return undefined; }
}
