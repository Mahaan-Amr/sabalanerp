import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyMigrationUsers } from './migration-users-acceptance.fixture.mjs';

// Synthetic observations test this port's refusals, never restored-data approval.
function sample() {
  return { format: 'sabalan-migration-users-observation/v1', backupKind: 'COMPLETE',
    census: Object.fromEntries(['users', 'relationships', 'grants', 'revocations',
      'business', 'audit', 'files', 'appliedHistoryPrefix'].map(name => [name, { rows: '3', sha256: 'a'.repeat(64) }])),
    passwords: [{ caseId: 'existing-user', valid: true, invalid: false }],
    authorization: [{ caseId: 'effective-grant', allowed: true }, { caseId: 'effective-revocation', allowed: false }],
    sessions: [{ caseId: 'existing-session', continuing: true, revoked: false, signedIn: true }],
    drafts: [{ caseId: 'scoped-draft', preserved: true, otherOwnerDenied: true, reviewRequired: true, revokedSessionDenied: true }],
    credentialBytesUnchanged: true };
}
function run(mutate = () => {}, policy = 'COMPATIBLE') {
  const before = sample(), after = sample();
  if (policy === 'DISASTER') after.sessions[0].continuing = false;
  mutate(after, before);
  return qualifyMigrationUsers({ policy, observe: async stage => stage === 'before' ? before : after, transition: async () => {} });
}

test('COMPLETE compatible comparison preserves existing users, denials, sessions and reviewed drafts', async () => {
  const result = await run();
  assert.equal(result.comparedCensuses, 8);
  assert.equal(result.authorizationCases, 2);
  assert.equal(result.productionAdmission, false);
  assert.equal(result.nativeAuthority, false);
  assert.equal(Object.isFrozen(result), true);
  assert.ok(!JSON.stringify(result).includes('sha256'));
});

test('disaster revokes the old continuing session while fresh sign-in and scoped draft recovery remain required', async () => {
  assert.equal((await run(() => {}, 'DISASTER')).policy, 'DISASTER');
  await assert.rejects(run(a => { a.sessions[0].continuing = true; }, 'DISASTER'), /ACCEPTANCE_REFUSED/);
  await assert.rejects(run(a => { a.sessions[0].continuing = false; }), /ACCEPTANCE_REFUSED/);
});

test('probe order and JSON property order do not change semantic comparison', async () => {
  await run(a => {
    a.authorization.reverse();
    a.passwords[0] = { invalid: false, valid: true, caseId: 'existing-user' };
    a.census.users = { sha256: 'a'.repeat(64), rows: '3' };
  });
});

for (const name of ['users', 'relationships', 'grants', 'revocations', 'business', 'audit', 'files', 'appliedHistoryPrefix']) {
  test(`refuses changed ${name} bytes even when counts are unchanged`, async () => {
    await assert.rejects(run(a => { a.census[name].sha256 = 'b'.repeat(64); }), /ACCEPTANCE_REFUSED/);
    await assert.rejects(run(a => { a.census[name].rows = '4'; }), /ACCEPTANCE_REFUSED/);
  });
}

test('refuses blanket resets, lost password verification, elevated denials and missing probe cases', async () => {
  for (const mutate of [a => { a.credentialBytesUnchanged = false; },
    a => { a.passwords[0].valid = false; }, a => { a.passwords[0].invalid = true; },
    a => { a.authorization[1].allowed = true; }, a => { a.sessions[0].revoked = true; },
    a => { a.sessions[0].signedIn = false; }, a => { a.passwords = []; },
    a => { a.passwords[0].caseId = 'replacement-user'; }]) {
    await assert.rejects(run(mutate), /ACCEPTANCE_REFUSED/);
  }
});

test('refuses sanitized/empty data, duplicate probes, omitted fields and credential-shaped extra fields without echoing them', async () => {
  for (const mutate of [a => { a.backupKind = 'SANITIZED'; }, a => { a.census.users.rows = '0'; },
    a => { a.passwords.push({ ...a.passwords[0] }); }, a => { delete a.census.audit; },
    a => { a.password = 'DO_NOT_ECHO_PRIVATE_MATERIAL'; }]) {
    await assert.rejects(run(mutate), error => error.message === 'MIGRATION_USERS_ACCEPTANCE_REFUSED'
      && !JSON.stringify(error).includes('DO_NOT_ECHO'));
  }
});

test('every draft predicate is mandatory, including refusal of revoked-session use', async () => {
  for (const key of ['preserved', 'otherOwnerDenied', 'reviewRequired', 'revokedSessionDenied']) {
    await assert.rejects(run(a => { a.drafts[0][key] = false; }), /ACCEPTANCE_REFUSED/);
  }
});

test('captures before mutation, observes after completion, and retains a detached baseline', async () => {
  const current = sample(), calls = [];
  await assert.rejects(qualifyMigrationUsers({ policy: 'COMPATIBLE',
    observe: async stage => { calls.push(stage); return current; },
    transition: async () => { calls.push('transition'); current.census.users.sha256 = 'b'.repeat(64); },
  }), /ACCEPTANCE_REFUSED/);
  assert.deepEqual(calls, ['before', 'transition', 'after']);
});

test('failed/interrupted transition cannot emit a successful comparison or trigger another transition', async () => {
  const calls = [];
  await assert.rejects(qualifyMigrationUsers({ policy: 'COMPATIBLE',
    observe: async stage => { calls.push(stage); return sample(); },
    transition: async () => { calls.push('interrupted'); throw Error('INTERRUPTED'); },
  }), /INTERRUPTED/);
  assert.deepEqual(calls, ['before', 'interrupted']);
  await assert.rejects(qualifyMigrationUsers({ policy: 'UNKNOWN' }), /ACCEPTANCE_REFUSED/);
});
