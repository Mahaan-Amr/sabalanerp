import {
  PartnerInquiryViewV2Schema, PartnerQueryV2Schema, ResponderInquiryViewV2Schema, partnerError,
  type PartnerQueryV2Port,
} from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';
import { parseInquiryDefinition } from './definition';
import type { PartnerInquiryDependencies } from './service';

/** Builds the two safe purpose-specific views from private persistence. Pricing
 * identity is available only in the responder view; recovery refs only in the
 * owning Partner view. */
export function createPartnerInquiryQuery(dependencies: PartnerInquiryDependencies): PartnerQueryV2Port['query'] {
  return async input => {
    const parsed = PartnerQueryV2Schema.safeParse(input);
    if (!parsed.success || (parsed.data.purpose !== 'PARTNER_INQUIRY' && parsed.data.purpose !== 'RESPONDER_INQUIRY')) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') } as never;
    }
    const inquiryId = parsed.data.inquiryId;
    return dependencies.transaction(async tx => {
      const inquiry = await tx.partnerInquiry.findUnique({ where: { id: inquiryId }, select: {
        id: true, profileId: true, profile: { select: { user: { select: { firstName: true, lastName: true } } } },
        assignments: { orderBy: { revision: 'desc' }, take: 1, select: { id: true, revision: true, responderId: true } },
        events: { orderBy: { revision: 'asc' }, select: { type: true, reason: true, evidence: true } },
        rows: { orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], include: {
          predecessor: { select: { id: true, revision: true } },
          successor: { select: { id: true, revision: true, outcome: true, approval: { select: { expiresAt: true } } } },
          approval: { include: { usages: { include: { binding: { include: {
            caseRevision: { include: { case: { select: { caseNumber: true } } },
            } } } } } } },
        } },
      } });
      if (!inquiry) return { ok: false, error: partnerError('NOT_FOUND') } as never;
      const responderPurpose = parsed.data.purpose === 'RESPONDER_INQUIRY';
      const allowed = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'INQUIRY_READ',
        purpose: responderPurpose ? 'RESPONDER' : 'PARTNER', root: { kind: 'INQUIRY', id: inquiry.id } });
      if (!allowed.ok) return allowed as never;
      const rollout = await authorizePartnerTechnicalRollout(tx, inquiry.profileId, 'READ');
      if (!rollout.ok) return rollout as never;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const state = (outcome: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', expiresAt?: Date,
        superseded = false): 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED' | 'CANCELLED' =>
        outcome !== 'APPROVED' ? outcome : superseded ? 'SUPERSEDED'
          : expiresAt && clock.now.getTime() >= expiresAt.getTime() ? 'EXPIRED' : 'APPROVED';
      const reasons = new Map<string, string>();
      for (const event of inquiry.events) {
        if (event.type === 'INQUIRY_CANCELLED' && event.reason) {
          const evidence = event.evidence as { rowIds?: unknown };
          if (Array.isArray(evidence.rowIds)) for (const rowId of evidence.rowIds) if (typeof rowId === 'string') reasons.set(rowId, event.reason);
        }
        if (event.type === 'INQUIRY_DECIDED' || event.type === 'INQUIRY_PARTIALLY_DECIDED') {
          const evidence = event.evidence as { decisions?: unknown };
          if (Array.isArray(evidence.decisions)) for (const decision of evidence.decisions) {
            if (decision && typeof decision === 'object' && (decision as { outcome?: unknown }).outcome === 'REJECTED' &&
                typeof (decision as { rowId?: unknown }).rowId === 'string' && typeof (decision as { reason?: unknown }).reason === 'string') {
              reasons.set((decision as { rowId: string }).rowId, (decision as { reason: string }).reason);
            }
          }
        }
      }
      if (responderPurpose) {
        const assignment = inquiry.assignments[0];
        if (!assignment || assignment.responderId !== dependencies.actorId) return { ok: false, error: partnerError('NOT_ASSIGNED') } as never;
        const responseRows = inquiry.rows.map(row => {
          const definition = parseInquiryDefinition(row.definition);
          if (!definition) return null;
          const currentState = state(row.outcome, row.approval?.expiresAt, row.successor?.outcome === 'APPROVED');
          return { rowId: row.id, revision: row.revision, identity: definition.identity,
            ...(row.approval ? { approvedPrice: { amount: row.approval.wholesaleUnitPrice.toString(), currency: row.approval.currency },
              approvedAt: row.approval.approvedAt.toISOString(), expiresAt: row.approval.expiresAt.toISOString(),
              ...(row.approval.note ? { noteOrReason: row.approval.note } : {}) } :
              reasons.get(row.id) ? { noteOrReason: reasons.get(row.id) } : {}),
            used: Boolean(row.approval?.usages.length), state: currentState,
            actions: currentState === 'PENDING' ? [{ action: 'INQUIRY_RESPOND' as const, enabled: true }] : [],
          };
        });
        if (responseRows.some(row => row === null)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
        const view = ResponderInquiryViewV2Schema.safeParse({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId: inquiry.id,
          partnerDisplayName: `${inquiry.profile.user.firstName} ${inquiry.profile.user.lastName}`.trim(),
          assignmentId: assignment.id, assignmentRevision: assignment.revision,
          actions: responseRows.some(row => row?.state === 'PENDING') ? [{ action: 'INQUIRY_RESPOND', enabled: true }] : [], rows: responseRows });
        return view.success ? { ok: true, value: view.data } as never : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      }
      const rows = inquiry.rows.map(row => {
        const definition = parseInquiryDefinition(row.definition);
        if (!definition) return null;
        const currentState = state(row.outcome, row.approval?.expiresAt, row.successor?.outcome === 'APPROVED');
        const successor = row.successor;
        return { rowId: row.id, revision: row.revision, description: definition.description,
          state: currentState, configuration: definition.configuration, configurationRef: definition.configurationRef,
          ...(row.approval ? { approvedPrice: { amount: row.approval.wholesaleUnitPrice.toString(), currency: row.approval.currency },
            approvedAt: row.approval.approvedAt.toISOString(), expiresAt: row.approval.expiresAt.toISOString(),
            ...(row.approval.note ? { noteOrReason: row.approval.note } : {}),
            approvedRowBinding: { inquiryId: inquiry.id, rowId: row.id, revision: row.revision } } : {}),
          ...(!row.approval && definition.predecessorReason ? { noteOrReason: definition.predecessorReason } : {}),
          usedCaseNumbers: row.approval?.usages.map(usage => usage.binding.caseRevision.case.caseNumber) ?? [],
          ...(row.predecessor ? { predecessor: { inquiryId: inquiry.id, rowId: row.predecessor.id,
            revision: row.predecessor.revision, reason: definition.predecessorReason! } } : {}),
          ...(successor ? { successor: { inquiryId: inquiry.id, rowId: successor.id, revision: successor.revision,
            state: state(successor.outcome, successor.approval?.expiresAt) } } : {}),
        };
      });
      if (rows.some(row => row === null)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      const view = PartnerInquiryViewV2Schema.safeParse({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: inquiry.id, rows });
      return view.success ? { ok: true, value: view.data } as never : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
    });
  };
}
