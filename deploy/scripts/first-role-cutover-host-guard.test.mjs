import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertNoInterruptedFirstRoleCutover } from './first-role-cutover-host-guard.mjs';

test('ordinary host recovery refuses dedicated role ownership even after the active session file is lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-host-guard-'));
  const session = path.join(dir, 'active-deployment-session.json');
  const journal = path.join(dir, 'active-deployment.jsonl');
  const intent = path.join(dir, 'first-role-cutover-open-intent.json');
  const rejected = /FIRST_ROLE_CUTOVER_REQUIRES_ITS_ORIGINAL_OWNER/;
  try {
    assert.doesNotThrow(() => assertNoInterruptedFirstRoleCutover(session));
    fs.writeFileSync(session, '{"deploymentId":"deploy-ordinary"}');
    fs.writeFileSync(journal, '{"details":{"clamavOperation":"repair"}}\n');
    assert.doesNotThrow(() => assertNoInterruptedFirstRoleCutover(session));
    fs.writeFileSync(session, '{"purpose":"first-database-role-cutover"}');
    assert.throws(() => assertNoInterruptedFirstRoleCutover(session), rejected);
    fs.unlinkSync(session);
    fs.writeFileSync(journal, '{"details":{"firstRoleCutover":{}}}\n');
    assert.throws(() => assertNoInterruptedFirstRoleCutover(session), rejected);
    fs.unlinkSync(journal);
    fs.writeFileSync(intent, '{}');
    assert.throws(() => assertNoInterruptedFirstRoleCutover(session), rejected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
