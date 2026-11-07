import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLoadingDocumentPart, issueLoadingDocuments } from '../loadingDocumentIssuance';

test('legacy or incomplete bundles block issuance while a complete bundle is retained', () => {
  const pending = { id: 'r', sealedAt: new Date(), candidate: { id: 'c', status: 'PENDING', waybills: [] } };
  assert.equal(classifyLoadingDocumentPart(pending, false).state, 'BLOCKED');
  assert.equal(classifyLoadingDocumentPart(pending, true).state, 'PENDING');
  const issued = { ...pending, candidate: { id: 'c', status: 'ACCEPTED', waybills: [{ status: 'ISSUED', documentArtifacts: [{ kind: 'WAYBILL' }] }] } };
  assert.equal(classifyLoadingDocumentPart(issued, true).state, 'BLOCKED');
  issued.candidate.waybills[0].documentArtifacts.push({ kind: 'STATEMENT' });
  assert.equal(classifyLoadingDocumentPart(issued, true).state, 'COMPLETE');
  assert.equal(classifyLoadingDocumentPart({ ...issued, sealedAt: null }, true).state, 'BLOCKED');
  assert.equal(classifyLoadingDocumentPart(issued, false).state, 'BLOCKED');
  issued.candidate.waybills.push(issued.candidate.waybills[0]);
  assert.equal(classifyLoadingDocumentPart(issued, true).state, 'BLOCKED');
});

test('partial failure retries only the unfinished waybill and then issues the invoice', async () => {
  const parts = [{ candidateId: 'a', revisionId: 'ra', state: 'PENDING' as const },
    { candidateId: 'b', revisionId: 'rb', state: 'PENDING' as const }];
  const issued: string[] = [];
  let fail = true;
  const command = { loadingId: 'loading', parts, invoicePredecessorId: null,
    async issueWaybill(id: string) { if (id === 'b' && fail) throw Error('offline'); issued.push(id); },
    async issueInvoice() { issued.push('invoice'); } };
  await assert.rejects(issueLoadingDocuments(command));
  fail = false;
  await issueLoadingDocuments({ ...command, parts: [{ ...parts[0], state: 'COMPLETE' }, parts[1]] });
  assert.deepEqual(issued, ['a', 'b', 'invoice']);
});

test('a blocked part prevents every mutation', async () => {
  let calls = 0;
  await assert.rejects(issueLoadingDocuments({ loadingId: 'loading', invoicePredecessorId: null,
    parts: [{ candidateId: 'a', revisionId: 'ra', state: 'PENDING' }, { candidateId: 'b', revisionId: 'rb', state: 'BLOCKED' }],
    issueWaybill: async () => { calls++; }, issueInvoice: async () => { calls++; } }));
  assert.equal(calls, 0);
});

test('invoice retry uses stable identity and a replacement gets a new identity', async () => {
  const keys: string[] = [];
  const input = { loadingId: 'loading', parts: [{ candidateId: 'a', revisionId: 'ra', state: 'COMPLETE' as const }],
    invoicePredecessorId: null, issueWaybill: async () => {}, issueInvoice: async (key: string) => { keys.push(key); } };
  await issueLoadingDocuments(input);
  await issueLoadingDocuments(input);
  await issueLoadingDocuments({ ...input, invoicePredecessorId: 'voided-invoice' });
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});

test('legacy retry reconstructs only the missing document and does not issue another waybill', async () => {
  const calls: string[] = [];
  let fail = true;
  const pending = { candidateId: 'driver', revisionId: 'revision', state: 'PENDING' as const, legacy: true };
  const command = { loadingId: 'loading', invoicePredecessorId: null, parts: [pending],
    issueWaybill: async () => { calls.push('waybill'); },
    reconstructWaybill: async () => { calls.push('reconstruct'); if (fail) throw Error('render failed'); },
    issueInvoice: async () => { calls.push('invoice'); } };
  await assert.rejects(issueLoadingDocuments(command));
  fail = false;
  await issueLoadingDocuments({ ...command, parts: [{ ...pending, state: 'RECONSTRUCT' }] });
  assert.deepEqual(calls, ['waybill', 'reconstruct', 'reconstruct', 'invoice']);
});
