import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPartnerRetailCollectionRoutes, type CollectionHandler } from '../../routes/partner-retail-collections';

test('retail collection routes expose shared receipt commands and revision-bound reads through a request-bound service', async () => {
  const handlers = new Map<string, CollectionHandler>();
  const router = {
    get(path: string, handler: CollectionHandler) { handlers.set(`GET ${path}`, handler); },
    post(path: string, handler: CollectionHandler) { handlers.set(`POST ${path}`, handler); },
  };
  const calls: { method: string; input: unknown }[] = [];
  const command = { type: 'RETAIL_RECEIPT', commandId: 'command-324' };
  registerPartnerRetailCollectionRoutes(router, {
    serviceFor: async () => ({
      execute: async input => { calls.push({ method: 'execute', input }); return { ok: true, value: { commandId: 'command-324' } }; },
      read: async input => { calls.push({ method: 'read', input }); return { ok: true, value: { caseId: input.caseId } }; },
    }),
  });
  const response = () => {
    const state = { status: 200, body: undefined as unknown, headers: new Map<string, string>() };
    return { state, api: { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; },
      setHeader(name: string, value: string) { state.headers.set(name, value); } } };
  };
  const commandResponse = response();
  await handlers.get('POST /commands')!({ params: {}, query: {}, body: command }, commandResponse.api);
  const revision = { caseId: 'case-324', revision: 1,
    integrityHash: `sha256-v1:${'a'.repeat(64)}` };
  const queryResponse = response();
  await handlers.get('POST /query')!({ params: {}, query: {}, body: revision }, queryResponse.api);
  assert.deepEqual([...handlers.keys()], ['POST /commands', 'POST /query']);
  assert.deepEqual(calls, [{ method: 'execute', input: command }, { method: 'read', input: revision }]);
  assert.deepEqual(commandResponse.state.body, { success: true, data: { commandId: 'command-324' } });
  assert.deepEqual(queryResponse.state.body, { success: true, data: { caseId: 'case-324' } });
  assert.equal(commandResponse.state.headers.get('Cache-Control'), 'private, no-store');
});
