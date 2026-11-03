import assert from 'node:assert/strict';
import { createActionAvailabilityHandler } from '../dashboard';
import { WORKSPACE_ACTION_RULES } from '../../services/workspaceActionAvailability';

const invoke = async (workspace: string) => {
  let status = 200;
  let body: any;
  const calls: string[] = [];
  const handler = createActionAvailabilityHandler(async (_prisma, input) => {
    calls.push(input.workspace);
    return Object.fromEntries(Object.keys(WORKSPACE_ACTION_RULES[input.workspace]).map((action) => [action, {
      visible: true, enabled: true, reason: null,
    }]));
  });
  await handler(
    { query: { workspace }, user: { id: 'admin', role: 'ADMIN' } },
    { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } },
  );
  return { status, body, calls };
};

const run = async () => {
  for (const workspace of Object.keys(WORKSPACE_ACTION_RULES)) {
    const response = await invoke(workspace);
    assert.equal(response.status, 200);
    assert.deepEqual(response.calls, [workspace]);
    assert.deepEqual(Object.keys(response.body.data), Object.keys(WORKSPACE_ACTION_RULES[workspace as keyof typeof WORKSPACE_ACTION_RULES]));
    assert.ok(Object.values(response.body.data).every((decision: any) => (
      decision.visible === true && decision.enabled === true && decision.reason === null
    )));
  }
  const invalid = await invoke('unknown');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.calls.length, 0);
  assert.match(invalid.body.message, /فضای کاری/);
  console.log('Dashboard action-availability HTTP contract tests passed.');
};

void run();
