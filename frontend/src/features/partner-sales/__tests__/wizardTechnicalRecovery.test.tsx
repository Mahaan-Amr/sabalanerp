import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema, type PartnerTechnicalCheckpoint,
  type PartnerTechnicalCheckpointReceipt, type PartnerTechnicalSave, type Result, partnerError } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalSession, openPartnerTechnicalSession } from '../../contract-creation/partner/partnerTechnicalSession';

const access = { schemaVersion: 1 as const, recoveryId: 'technical-session',
  browserSessionId: 'browser-session', leaseToken: 'writer-token', baseRevision: 0 };
const draft = (inputRevision: number, text: string) => PartnerTechnicalDraftSchema.parse({
  schemaVersion: 1, inputRevision, rows: [],
  editingValues: [{ entityId: 'unfinished-product', field: 'quantity', text }],
});

test('checkpoint acknowledges only the submitted revision and never overwrites newer visible editing text', async () => {
  let acknowledge!: (value: Result<PartnerTechnicalCheckpointReceipt>) => void;
  let sent: PartnerTechnicalCheckpoint | undefined;
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 4,
      updatedAt: '2026-08-29T00:00:00.000Z', draft: draft(7, '1.') },
    recovery: { read: async () => { throw new Error('No implicit reload'); },
      checkpoint: async command => { sent = command; return new Promise(resolve => { acknowledge = resolve; }); } },
  });
  const pending = session.checkpoint();
  await Promise.resolve();
  assert.equal(session.getSnapshot().phase, 'saving');
  assert.equal(session.getSnapshot().recoveryRevision, 4);
  session.edit(draft(8, '2.'));
  assert.ok(sent);
  acknowledge({ ok: true, value: { schemaVersion: 1, recoveryId: access.recoveryId,
    recoveryRevision: 5, inputRevision: 7, updatedAt: '2026-08-29T00:00:01.000Z', replayed: false } });
  await pending;
  assert.equal(session.getSnapshot().recoveryRevision, 5);
  assert.equal(session.getSnapshot().draft.inputRevision, 8);
  assert.equal(session.getSnapshot().draft.editingValues?.[0].text, '2.');
  assert.equal(session.getSnapshot().checkpointedInputRevision, 7);
  assert.equal('configurationRef' in session.getSnapshot(), false);
});

test('an uncertain checkpoint retries the exact command before sending newer edits', async () => {
  const sent: PartnerTechnicalCheckpoint[] = [];
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 0,
      updatedAt: '2026-08-29T00:00:00.000Z', draft: null },
    recovery: { read: async () => { throw new Error('No implicit reload'); }, checkpoint: async command => {
      sent.push(structuredClone(command));
      if (sent.length === 1) throw new Error('Response lost after commit');
      return { ok: true, value: { schemaVersion: 1, recoveryId: access.recoveryId,
        recoveryRevision: command.expectedRecoveryRevision + 1, inputRevision: command.draft.inputRevision,
        updatedAt: '2026-08-29T00:00:01.000Z', replayed: sent.length === 2 } };
    } },
  });
  session.edit(draft(1, '1.'));
  await session.checkpoint();
  assert.equal(session.getSnapshot().phase, 'uncertain');
  session.edit(draft(2, '2.'));
  await session.checkpoint();
  assert.equal(sent.length, 1);
  await session.retry();
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(session.getSnapshot().draft.editingValues?.[0].text, '2.');
  await session.checkpoint();
  assert.equal(sent[2].expectedRecoveryRevision, 1);
  assert.notEqual(sent[2].idempotencyKey, sent[0].idempotencyKey);
  assert.equal(sent[2].draft.inputRevision, 2);
});

test('revoked writer is blocked without losing visible text or repeatedly resubmitting', async () => {
  let writes = 0;
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 2,
      updatedAt: '2026-08-29T00:00:00.000Z', draft: draft(4, 'ناقص') },
    recovery: { read: async () => { throw new Error('No implicit takeover'); }, checkpoint: async () => {
      writes += 1;
      return { ok: false, error: partnerError('FORBIDDEN') };
    } },
  });
  await session.checkpoint();
  assert.equal(session.getSnapshot().phase, 'blocked');
  assert.equal(session.getSnapshot().error?.code, 'FORBIDDEN');
  assert.equal(session.getSnapshot().draft.editingValues?.[0].text, 'ناقص');
  await session.retry();
  await session.checkpoint();
  assert.equal(writes, 1);
});

test('leaving an actor/recovery session ignores its late acknowledgement and disables further writes', async () => {
  let acknowledge!: (value: Result<PartnerTechnicalCheckpointReceipt>) => void;
  let writes = 0;
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 0,
      updatedAt: '2026-08-29T00:00:00.000Z', draft: draft(1, '1.') },
    recovery: { read: async () => { throw new Error('No implicit reload'); }, checkpoint: async () => {
      writes += 1; return new Promise(resolve => { acknowledge = resolve; });
    } },
  });
  const pending = session.checkpoint();
  const duplicate = session.checkpoint();
  assert.equal(pending, duplicate);
  await Promise.resolve();
  session.dispose();
  acknowledge({ ok: true, value: { schemaVersion: 1, recoveryId: access.recoveryId,
    recoveryRevision: 1, inputRevision: 1, updatedAt: '2026-08-29T00:00:01.000Z', replayed: false } });
  await pending;
  assert.equal(session.getSnapshot().phase, 'closed');
  assert.equal(session.getSnapshot().recoveryRevision, 0);
  await session.checkpoint();
  await session.retry();
  assert.equal(writes, 1);
});

test('validated save returns owner-issued references but does not infer approval impact from a later edit', async () => {
  let sent: PartnerTechnicalSave | undefined;
  const currentDraft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 5,
    rows: [{ productRowId: 'configured-row', catalogItemId: 'catalog-row',
      catalogSnapshotVersion: '2026-08-29T00:00:00.000Z', family: 'prepared',
      configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }],
  });
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 3,
      updatedAt: '2026-08-29T00:00:00.000Z', draft: currentDraft },
    recovery: { read: async () => { throw new Error('No implicit reload'); }, checkpoint: async () => { throw new Error('Not used'); } },
    saved: { readSaved: async () => { throw new Error('Not used'); }, save: async command => {
      sent = command;
      return { ok: true, value: { schemaVersion: 1, recoveryId: command.recoveryId,
        recoveryRevision: 6, inputRevision: command.draft.inputRevision, updatedAt: '2026-08-29T00:00:01.000Z', replayed: false,
        rows: [{ configurationRef: { recoveryId: command.recoveryId, recoveryRevision: 6, productRowId: 'configured-row' },
          quantity: '2', unit: 'count', configurationChange: 'UNCHANGED' }] } };
    } },
  });
  await session.save();
  assert.ok(sent);
  assert.equal(session.getSnapshot().validated?.rows[0].configurationRef.recoveryRevision, 6);
  assert.equal(session.getSnapshot().isCurrentValidated, true);
  session.edit(PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 6,
    rows: [{ productRowId: 'configured-row', catalogItemId: 'catalog-row',
      catalogSnapshotVersion: '2026-08-29T00:00:00.000Z', family: 'prepared',
      configuration: { kind: 'readyPiece', unit: 'count', quantity: '3' } }],
  }));
  assert.equal(session.getSnapshot().isCurrentValidated, false);
  assert.equal(session.getSnapshot().validated?.rows[0].configurationChange, 'UNCHANGED');
  assert.equal('approvalMismatch' in session.getSnapshot(), false);
});

test('reload can restore the exact validated view and double save shares one flight', async () => {
  let acknowledge!: (value: any) => void;
  let writes = 0;
  const currentDraft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 5,
    rows: [{ productRowId: 'configured-row', catalogItemId: 'catalog-row',
      catalogSnapshotVersion: '2026-08-29T00:00:00.000Z', family: 'prepared',
      configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }],
  });
  const validated = { schemaVersion: 1 as const, recoveryId: access.recoveryId, recoveryRevision: 4,
    inputRevision: 5, updatedAt: '2026-08-29T00:00:01.000Z', rows: [{
      configurationRef: { recoveryId: access.recoveryId, recoveryRevision: 4, productRowId: 'configured-row' },
      quantity: '2', unit: 'count' as const, configurationChange: 'UNCHANGED' as const,
    }] };
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 4,
      updatedAt: '2026-08-29T00:00:01.000Z', draft: currentDraft }, validated,
    recovery: { read: async () => { throw new Error('Not used'); }, checkpoint: async () => { throw new Error('Not used'); } },
    saved: { readSaved: async () => ({ ok: true, value: validated }), save: async () => {
      writes += 1; return new Promise(resolve => { acknowledge = resolve; });
    } },
  });
  assert.equal(session.getSnapshot().isCurrentValidated, true);
  const first = session.save();
  const second = session.save();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(writes, 1);
  acknowledge({ ok: true, value: { ...validated, replayed: true, recoveryRevision: 5,
    rows: validated.rows.map(row => ({ ...row, configurationRef: { ...row.configurationRef, recoveryRevision: 5 } })) } });
  await first;
  assert.equal(writes, 1);
});

test('owner save may jump a permanent revision counter and older validated refs remain historical', async () => {
  const oldDraft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 2,
    rows: [{ productRowId: 'old-row', catalogItemId: 'catalog-row', catalogSnapshotVersion: '2026-08-29T00:00:00.000Z',
      family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '1' } }],
  });
  const old = { schemaVersion: 1 as const, recoveryId: access.recoveryId, recoveryRevision: 5, inputRevision: 2,
    updatedAt: '2026-08-29T00:00:01.000Z', rows: [{ configurationRef: {
      recoveryId: access.recoveryId, recoveryRevision: 5, productRowId: 'old-row' },
      quantity: '1', unit: 'count' as const, configurationChange: 'NEW' as const }] };
  const current = PartnerTechnicalDraftSchema.parse({ ...oldDraft, inputRevision: 3 });
  const session = createPartnerTechnicalSession({ access,
    recovered: { schemaVersion: 1, recoveryId: access.recoveryId, recoveryRevision: 6,
      updatedAt: '2026-08-29T00:00:02.000Z', draft: current }, validated: old,
    recovery: { read: async () => { throw new Error('Not used'); }, checkpoint: async () => { throw new Error('Not used'); } },
    saved: { readSaved: async () => ({ ok: true, value: old }), save: async command => ({ ok: true, value: {
      schemaVersion: 1, recoveryId: command.recoveryId, recoveryRevision: 7,
      inputRevision: command.draft.inputRevision, updatedAt: '2026-08-29T00:00:03.000Z', replayed: false,
      rows: [{ configurationRef: { recoveryId: command.recoveryId, recoveryRevision: 7, productRowId: 'old-row' },
        quantity: '1', unit: 'count', configurationChange: 'UNCHANGED' }],
    } }) },
  });
  assert.equal(session.getSnapshot().validated?.recoveryRevision, 5);
  assert.equal(session.getSnapshot().isCurrentValidated, false);
  await session.save();
  assert.equal(session.getSnapshot().phase, 'editing');
  assert.equal(session.getSnapshot().validated?.recoveryRevision, 7);
  assert.equal(session.getSnapshot().isCurrentValidated, true);
});

test('authenticated host opens one technical session from the current lease and restores only its exact saved revision', async () => {
  const currentDraft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 3,
    rows: [{ productRowId: 'configured-row', catalogItemId: 'catalog-row',
      catalogSnapshotVersion: '2026-08-29T00:00:00.000Z', family: 'prepared',
      configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }] });
  const validated = { schemaVersion: 1 as const, recoveryId: access.recoveryId, recoveryRevision: 4,
    inputRevision: 3, updatedAt: '2026-08-29T00:00:01.000Z', rows: [{
      configurationRef: { recoveryId: access.recoveryId, recoveryRevision: 4, productRowId: 'configured-row' },
      quantity: '2', unit: 'count' as const, configurationChange: 'NEW' as const,
    }] };
  const reads: number[] = [];
  const opened = await openPartnerTechnicalSession({ access,
    recovery: { read: async () => ({ ok: true, value: { schemaVersion: 1, recoveryId: access.recoveryId,
      recoveryRevision: 4, updatedAt: '2026-08-29T00:00:01.000Z', draft: currentDraft } }),
      checkpoint: async () => { throw new Error('unused'); } },
    saved: { readSaved: async input => { reads.push(input.recoveryRevision); return { ok: true, value: validated }; },
      save: async () => { throw new Error('unused'); } },
  });
  assert.ok(opened.ok);
  assert.deepEqual(reads, [4]);
  assert.equal(opened.value.getSnapshot().isCurrentValidated, true);
  assert.equal(opened.value.getSnapshot().validated?.rows[0].configurationRef.productRowId, 'configured-row');
});
