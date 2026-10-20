import assert from 'node:assert/strict';
import test from 'node:test';
import * as application from '../../backend/src/application';

test('canonical online constructor refuses invented composition before constructing a listener', () => {
  const factory = (application as unknown as { createOnlineApplication?: (input: unknown) => unknown }).createOnlineApplication;
  assert.equal(typeof factory, 'function');
  for (const runtime of [undefined, {}, { admission: {}, boundary: {} }]) {
    assert.throws(() => factory!({ runtime, isShuttingDown: () => false }), /ONLINE_RUNTIME_ROOT_INVENTORY_UNPROVEN/);
  }
  assert.throws(() => application.createApplication({ runtimeRole: 'serving' as never, isShuttingDown: () => false }),
    /BACKEND_RUNTIME_ROLE_INVALID/, 'a role string must not substitute for original composed admission');
});
