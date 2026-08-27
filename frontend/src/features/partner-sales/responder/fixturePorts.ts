/** Synthetic command outcomes for UI QA. This adapter never invokes a production service. */
import { createPartnerWorkspaceFixturesV2 } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerCommandSchema, ResponderWorkspaceViewV2Schema, partnerError } from '@sabalanerp/partner-sales-contracts';
import type { InquiryBatchResult, PartnerCommandPort, PartnerQueryV2Port, PartnerQueryV2Results, Result, ResponderWorkspaceViewV2 } from '@sabalanerp/partner-sales-contracts';

export type ResponderScenario = 'RESPONDER' | 'PARTIAL' | 'UNCERTAIN' | 'PAUSED' | 'REASSIGNED' | 'EXPIRED' | 'UNASSIGNED' | 'MULTIPLE' | 'REFRESH_DENIED';

export function createResponderFixture(scenario: ResponderScenario) {
  const seed = createPartnerWorkspaceFixturesV2();
  const pendingRow = seed.responder.rows.find(row => row.state === 'PENDING')!;
  let view: ResponderWorkspaceViewV2 = ResponderWorkspaceViewV2Schema.parse({ ...seed.responderWorkspace,
    inquiries: scenario === 'UNASSIGNED' ? [] : [{ ...seed.responder, inquiryId: 'fixture-331-inquiry', partnerDisplayName: 'همکار آزمایشی آریا',
      actions: [{ action: 'INQUIRY_RESPOND', enabled: true, ...(scenario === 'EXPIRED' ? { expiresAt: '2020-01-01T00:00:00.000Z' } : {}) }],
      rows: [1, 2].map(index => ({ ...pendingRow, rowId: `fixture-331-row-${index}`, identity: { ...pendingRow.identity,
        unit: 'متر مربع', configuration: [{ key: 'width', value: index === 1 ? '۴۰ سانتی‌متر' : '۶۰ سانتی‌متر' }] },
        actions: [{ action: 'INQUIRY_RESPOND', enabled: true }] })),
    }],
  });
  if (scenario === 'MULTIPLE') {
    const second = structuredClone(view.inquiries[0]);
    second.inquiryId = 'fixture-331-inquiry-second'; second.partnerDisplayName = 'همکار آزمایشی سپید';
    second.rows = second.rows.map((row, index) => ({ ...row, rowId: `fixture-331-other-row-${index + 1}`,
      identity: { ...row.identity, partnerSellerId: 'fixture-331-second-partner' } }));
    view.inquiries.push(second);
  }
  let denyNextRefresh = false;
  const queryPort: PartnerQueryV2Port = { async query<P extends keyof PartnerQueryV2Results>(query: Parameters<PartnerQueryV2Port['query']>[0]) {
    if (denyNextRefresh && query.purpose === 'RESPONDER_WORKSPACE') {
      denyNextRefresh = false;
      return { ok: false, error: partnerError('FORBIDDEN') };
    }
    const result = query.purpose === 'RESPONDER_WORKSPACE' ? { ok: true as const, value: structuredClone(view) } : { ok: false as const, error: partnerError('NOT_FOUND') };
    return result as Result<PartnerQueryV2Results[P]>;
  } };
  type CommandResult = Awaited<ReturnType<PartnerCommandPort['execute']>>;
  const ledger = new Map<string, { hash: string; result: CommandResult }>();
  let injectedConflict = false;
  let transportFailed = false;
  const commandPort: PartnerCommandPort = { async execute(input) {
    const command = PartnerCommandSchema.parse(input);
    if (command.idempotency.actorId !== view.actorId || command.type !== 'INQUIRY_DECIDE') return { ok: false, error: partnerError('FORBIDDEN') };
    const key = JSON.stringify([command.idempotency.actorId, command.type, command.idempotency.targetId, command.idempotency.key]);
    const previous = ledger.get(key);
    if (previous) {
      if (previous.hash !== command.idempotency.payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
      const replay = structuredClone(previous.result); if (replay.ok) replay.value.replayed = true; return replay;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    const inquiry = view.inquiries.find(item => item.inquiryId === command.inquiryId);
    let result: CommandResult;
    if (!inquiry) result = { ok: false, error: partnerError('NOT_FOUND') };
    else if (scenario === 'EXPIRED') result = { ok: false, error: partnerError('FORBIDDEN') };
    else if (scenario === 'PAUSED' || scenario === 'REASSIGNED') {
      const error = partnerError(scenario === 'PAUSED' ? 'OPERATIONAL_PAUSE' : 'NOT_ASSIGNED');
      inquiry.assignmentRevision++; inquiry.actions = [{ action: 'INQUIRY_RESPOND', enabled: false, disabledReason: error }];
      result = { ok: false, error };
    } else if (inquiry.assignmentRevision !== command.expectedAssignmentRevision) result = { ok: false, error: partnerError('NOT_ASSIGNED') };
    else {
      const outcomes: InquiryBatchResult['outcomes'] = [];
      for (const decision of command.decisions) {
        const row = inquiry.rows.find(item => item.rowId === decision.rowId);
        if (scenario === 'PARTIAL' && decision.rowId === 'fixture-331-row-2' && !injectedConflict) {
          injectedConflict = true; if (row) row.revision++;
          outcomes.push({ ok: false, rowId: decision.rowId, error: partnerError('ROW_STALE') }); continue;
        }
        if (!row || row.revision !== decision.expectedRevision || row.state !== 'PENDING') {
          outcomes.push({ ok: false, rowId: decision.rowId, error: partnerError('ROW_STALE') }); continue;
        }
        row.revision++; row.state = decision.outcome; row.actions = [];
        if (decision.outcome === 'APPROVED') {
          row.approvedPrice = decision.wholesaleUnitPrice; row.approvedAt = new Date().toISOString();
          row.expiresAt = new Date(Date.parse(row.approvedAt) + 48 * 60 * 60 * 1000).toISOString();
          if (decision.note) row.noteOrReason = decision.note;
        } else row.noteOrReason = decision.reason;
        outcomes.push({ ok: true, rowId: row.rowId, revision: row.revision, outcome: decision.outcome, outcomeId: `fixture-331-outcome-${row.rowId}` });
      }
      view = ResponderWorkspaceViewV2Schema.parse(view);
      result = { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: ['fixture-331-response-event'],
        batch: { schemaVersion: 1, commandId: command.commandId, outcomes } } };
    }
    ledger.set(key, { hash: command.idempotency.payloadHash, result: structuredClone(result) });
    if (scenario === 'REFRESH_DENIED') denyNextRefresh = true;
    if (scenario === 'UNCERTAIN' && !transportFailed) { transportFailed = true; throw new Error('Simulated lost transport acknowledgement'); }
    return structuredClone(result);
  } };
  return { queryPort, commandPort };
}
