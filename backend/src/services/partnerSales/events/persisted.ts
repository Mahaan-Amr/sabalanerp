import { PartnerEventSchema, type PartnerEvent, type RevisionRef } from '@sabalanerp/partner-sales-contracts';

const publicTypes = new Set<string>(PartnerEventSchema.options.map(schema => schema.shape.type.value));
export class PartnerEventIntegrityError extends Error {}
export const ownsPartnerRevision = (owner: RevisionRef, expected: RevisionRef) =>
  owner.caseId === expected.caseId && owner.revision === expected.revision && owner.integrityHash === expected.integrityHash;

/** Public evidence must bind to its persisted event and Case; damaged facts cannot disappear. */
export function readPersistedPartnerEvents(root: { id: string; internalRecordId: string }, records: readonly {
  id: string; type: string; caseRevision: number; integrityHash: string; evidence: unknown;
}[]): PartnerEvent[] {
  return records.flatMap(record => {
    const evidence = record.evidence && typeof record.evidence === 'object' && !Array.isArray(record.evidence)
      ? record.evidence as Record<string, unknown> : undefined;
    if (!publicTypes.has(record.type) && !Object.prototype.hasOwnProperty.call(evidence ?? {}, 'publicEvent')) return [];
    const parsed = PartnerEventSchema.safeParse(evidence?.publicEvent);
    if (!parsed.success) throw new PartnerEventIntegrityError('Partner public event integrity conflict');
    const event = parsed.data;
    if (event.eventId !== record.id || event.type !== record.type ||
        !ownsPartnerRevision(event.owner, { caseId: root.id, revision: record.caseRevision, integrityHash: record.integrityHash }) ||
        ('internalRecordId' in event && event.internalRecordId !== root.internalRecordId)) {
      throw new PartnerEventIntegrityError('Partner public event ownership integrity conflict');
    }
    return [event];
  });
}
