import assert from 'node:assert/strict';
import test from 'node:test';
import { markOriginalSalesContractPrinted } from '../accounting';

const snapshot = { id: 'qa-print', commercialFlowVersion: 0, commercialRevision: 0,
  status: 'SIGNED', updatedAt: new Date('2026-01-01'), signatures: { approve: { by: 'sales' } } };
const record = async (current: any, generatedFrom: any) => {
  const writes: any[] = [];
  let locked = false;
  const tx = { $queryRaw: async () => { locked = true; }, salesContract: {
    findUnique: async () => { assert.ok(locked); return current; },
    update: async (input: any) => { writes.push(input.data); return current; },
  } };
  await markOriginalSalesContractPrinted({ user: { id: 'accountant' } } as any, generatedFrom,
    generatedFrom.signatures, '/fixture.pdf', 'fixture-fingerprint', null,
    { $transaction: async (work: any) => work(tx) } as any);
  return writes;
};
test('legacy PDF cannot overwrite a contract adopted to the new commercial flow during generation', async () => {
  assert.deepEqual(await record({ ...snapshot, commercialFlowVersion: 1, commercialRevision: 1, status: 'DRAFT' }, snapshot), []);
});
test('older revision PDF cannot become print evidence for the edited commercial revision', async () => {
  const generated = { ...snapshot, commercialFlowVersion: 1, commercialRevision: 1 };
  assert.deepEqual(await record({ ...generated, commercialRevision: 2, status: 'DRAFT' }, generated), []);
});
test('same revision printing preserves latest approval evidence and current commercial status', async () => {
  const generated = { ...snapshot, commercialFlowVersion: 1, commercialRevision: 1, status: 'APPROVED' };
  const writes = await record({ ...generated, status: 'SIGNED', signatures: { approve: { by: 'new-sales' }, customer: { method: 'PAPER' } } }, generated);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, undefined);
  assert.equal(writes[0].signatures.approve.by, 'new-sales');
  assert.equal(writes[0].signatures.customer.method, 'PAPER');
  assert.equal(writes[0].signatures.print.revision, 1);
});
