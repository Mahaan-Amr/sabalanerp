import assert from 'node:assert/strict';
import test from 'node:test';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import type { PartnerCommandPort } from '@sabalanerp/partner-sales-contracts';
import { createPartnerCaseSubmission, type PartnerSubmitCommand } from '../../contract-creation/partner/partnerCaseSubmission';

const fixture = createPartnerFixtures();
const intent = () => ({
  ...fixture.draftSubmissionReference, contractDate: fixture.customer.contractDate,
  rows: [{ productRowId: fixture.configurationDraft.productRowId,
    approvedRowBinding: fixture.inquiry.rows[0].approvedRowBinding!,
    retailUnitPrice: { amount: '1000', currency: 'IRR' as const } }],
  customerPaymentPlan: fixture.partner.customerPaymentPlan,
  retailDiscount: { amount: '0', currency: 'IRR' as const },
  belowCostConfirmed: false, deliveries: fixture.partner.deliveries,
});

test('lost final-submit response retains one durable command, and retry discovers the same Case', async () => {
  let pending: PartnerSubmitCommand | null = null;
  const commands: PartnerSubmitCommand[] = [];
  let clears = 0;
  const port: PartnerCommandPort = { execute: async command => {
    assert.equal(command.type, 'CASE_SUBMIT');
    commands.push(command as PartnerSubmitCommand);
    if (commands.length === 1) throw new Error('connection lost after commit');
    return { ok: true, value: { commandId: command.commandId, replayed: true, case: fixture.partner, eventIds: [] } };
  } };
  const submission = createPartnerCaseSubmission({
    actorId: fixture.profile.partnerSellerId, commands: port,
    recovery: {
      pending: () => pending,
      savePending: async command => { pending = command; },
      clearPending: async () => { pending = null; },
      finalizeCommitted: async () => { clears++; pending = null; },
    },
  });
  const original = intent();
  await submission.submit(original);
  assert.equal(submission.getSnapshot().phase, 'uncertain');
  assert.equal(clears, 0);
  assert.ok(pending);
  await submission.retry();
  assert.deepEqual(commands[1], commands[0]);
  assert.equal(submission.getSnapshot().phase, 'created');
  assert.equal(submission.getSnapshot().case?.caseNumber, 'FIXTURE-CASE-313');
  assert.equal(clears, 1);
  assert.deepEqual(original, intent());
});

test('double click checkpoints and submits once, and a failed checkpoint sends nothing', async () => {
  let release!: () => void;
  let calls = 0;
  let pending: PartnerSubmitCommand | null = null;
  const submission = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
    commands: { execute: async command => {
      calls++;
      return { ok: true, value: { commandId: command.commandId, replayed: false, case: fixture.partner, eventIds: [] } };
    } },
    recovery: {
      pending: () => pending,
      savePending: async command => { await new Promise<void>(resolve => { release = resolve; }); pending = command; },
      clearPending: async () => { pending = null; }, finalizeCommitted: async () => { pending = null; },
    },
  });
  const first = submission.submit(intent());
  const second = submission.submit(intent());
  assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 30));
  release();
  await first;
  assert.equal(calls, 1);
  await submission.submit(intent());
  assert.equal(calls, 1);

  const blocked = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
    commands: { execute: async () => { assert.fail('a revoked writer must not submit'); } },
    recovery: { pending: () => null, savePending: async () => { throw new Error('lease revoked'); }, clearPending: async () => undefined, finalizeCommitted: async () => undefined },
  });
  await blocked.submit(intent());
  assert.equal(blocked.getSnapshot().phase, 'editing');
});

test('expiry rejection preserves the draft and a successful Case remains successful if local cleanup fails', async () => {
  let pending: PartnerSubmitCommand | null = null;
  let expires = true;
  const submission = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
    commands: { execute: async command => expires
      ? { ok: false, error: { code: 'APPROVAL_EXPIRED', status: 409, message: 'اعتبار قیمت پایان یافته است؛ دوباره استعلام بگیرید.' } }
      : { ok: true, value: { commandId: command.commandId, replayed: false, case: fixture.partner, eventIds: [] } } },
    recovery: { pending: () => pending, savePending: async command => { pending = command; }, clearPending: async () => { pending = null; }, finalizeCommitted: async () => { throw new Error('storage unavailable'); } },
  });
  const original = intent();
  await submission.submit(original);
  assert.equal(submission.getSnapshot().phase, 'editing');
  assert.match(submission.getSnapshot().message!, /دوباره استعلام/);
  assert.deepEqual(original, intent());
  expires = false;
  await submission.submit(original);
  assert.equal(submission.getSnapshot().phase, 'created');
  assert.equal(submission.getSnapshot().cleanupPending, true);
});

test('recovery replay refuses a different actor or changed intent without clearing evidence', async () => {
  let pending: PartnerSubmitCommand | null = null;
  const recovery = { pending: () => pending, savePending: async (command: PartnerSubmitCommand) => { pending = command; },
    clearPending: async () => { assert.fail('invalid replay must retain evidence'); }, finalizeCommitted: async () => undefined };
  const original = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
    recovery, commands: { execute: async () => { throw new Error('offline'); } } });
  await original.submit(intent());
  let crossActorSent = false;
  const otherActor = createPartnerCaseSubmission({ actorId: 'other-actor', recovery,
    commands: { execute: async () => { crossActorSent = true; throw new Error('cross-actor replay'); } } });
  await otherActor.retry();
  assert.equal(crossActorSent, false);
  assert.equal(otherActor.getSnapshot().phase, 'uncertain');
  pending!.intent.retailDiscount.amount = '123';
  let sent = false;
  const changed = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId, recovery,
    commands: { execute: async () => { sent = true; throw new Error('unexpected replay'); } } });
  await changed.retry();
  assert.equal(sent, false);
  assert.ok(pending);
});
