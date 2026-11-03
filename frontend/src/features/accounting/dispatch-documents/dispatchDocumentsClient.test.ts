import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchDocumentsHttpClient, DispatchDocumentsAuthorizationError } from './dispatchDocumentsClient';
import type { DispatchDocumentWorkspace } from './dispatchDocumentsViewModel';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('production adapter uses only authenticated permission projection from the response', async () => {
  const projected: DispatchDocumentWorkspace = { permission: 'VIEW', cases: [], retrievedAt: '2026-08-09T12:00:00Z' };
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: projected }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await createDispatchDocumentsHttpClient().load(), projected);
});

test('production adapter fails closed instead of substituting fixture data', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'مجاز نیست' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => createDispatchDocumentsHttpClient().load(), (error) => error instanceof DispatchDocumentsAuthorizationError && error.status === 403);
});

test('production adapter retains ordered artifacts in PRINT_BOTH response', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { artifacts: [
    { kind: 'WAYBILL', url: '/waybill', fileName: 'waybill.pdf' },
    { kind: 'STATEMENT', url: '/statement', fileName: 'statement.pdf' },
  ] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await createDispatchDocumentsHttpClient().handoff('case', { kind: 'PRINT_BOTH' });
  assert.deepEqual(result.artifacts.map((item) => item.kind), ['WAYBILL', 'STATEMENT']);
});
