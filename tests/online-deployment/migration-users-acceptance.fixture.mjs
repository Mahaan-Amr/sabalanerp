// Read-only acceptance port for the coordinator's existing COMPLETE restore /
// compatible-update harness. It neither performs a migration nor issues native
// authority. Credentials stay inside the observer; only outcomes cross this port.
const censusNames = ['users', 'relationships', 'grants', 'revocations',
  'business', 'audit', 'files', 'appliedHistoryPrefix'];
const fail = () => { throw Error('MIGRATION_USERS_ACCEPTANCE_REFUSED'); };
const requireFact = value => { if (!value) fail(); };
function keys(value, names) {
  requireFact(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === [...names].sort().join(','));
}
function cases(rows, fields) {
  requireFact(Array.isArray(rows) && rows.length > 0);
  const ids = new Set();
  for (const row of rows) {
    keys(row, ['caseId', ...fields]);
    requireFact(typeof row.caseId === 'string' && /^[a-z0-9-]{1,64}$/.test(row.caseId) && !ids.has(row.caseId));
    ids.add(row.caseId);
    for (const field of fields) requireFact(typeof row[field] === 'boolean');
  }
  return rows.map(row => Object.fromEntries(['caseId', ...fields].map(key => [key, row[key]])))
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
}
function observation(value) {
  keys(value, ['format', 'backupKind', 'census', 'passwords', 'authorization', 'sessions', 'drafts', 'credentialBytesUnchanged']);
  requireFact(value.format === 'sabalan-migration-users-observation/v1' && value.backupKind === 'COMPLETE');
  keys(value.census, censusNames);
  for (const name of censusNames) {
    const row = value.census[name];
    keys(row, ['rows', 'sha256']);
    requireFact(typeof row.rows === 'string' && /^(0|[1-9][0-9]*)$/.test(row.rows)
      && typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
    if (['users', 'business', 'audit', 'files', 'appliedHistoryPrefix'].includes(name)) requireFact(BigInt(row.rows) > 0n);
  }
  const passwords = cases(value.passwords, ['valid', 'invalid']);
  requireFact(passwords.every(row => row.valid === true && row.invalid === false));
  const authorization = cases(value.authorization, ['allowed']);
  requireFact(authorization.some(row => row.allowed) && authorization.some(row => !row.allowed));
  const sessions = cases(value.sessions, ['continuing', 'revoked', 'signedIn']);
  requireFact(sessions.every(row => row.revoked === false && row.signedIn === true));
  const drafts = cases(value.drafts, ['preserved', 'otherOwnerDenied', 'reviewRequired', 'revokedSessionDenied']);
  requireFact(drafts.every(row => row.preserved && row.otherOwnerDenied && row.reviewRequired && row.revokedSessionDenied));
  requireFact(value.credentialBytesUnchanged === true);
  // Detach from the observer's mutable state before it runs another stage.
  return structuredClone({ ...value, passwords, authorization, sessions, drafts });
}

/** observe(stage) executes the existing SQL, password-verifier, authorization,
 * authoritative-session and draft interfaces in the retained coordinator scope.
 * Call only around a coordinator-scheduled transition. There is deliberately no
 * JSON-file CLI: saved observations cannot replace genuine restored execution.
 * Transition failure propagates and never produces an acceptance result. */
export async function qualifyMigrationUsers({ policy, observe, transition }) {
  requireFact(['COMPATIBLE', 'DISASTER'].includes(policy)
    && typeof observe === 'function' && typeof transition === 'function');
  const before = observation(await observe('before'));
  requireFact(before.sessions.every(row => row.continuing));
  await transition();
  const after = observation(await observe('after'));
  const same = (a, b) => requireFact(JSON.stringify(a) === JSON.stringify(b));
  for (const name of censusNames) {
    same(before.census[name].rows, after.census[name].rows);
    same(before.census[name].sha256, after.census[name].sha256);
  }
  for (const name of ['passwords', 'authorization', 'drafts']) same(before[name], after[name]);
  same(before.sessions.map(row => row.caseId), after.sessions.map(row => row.caseId));
  requireFact(after.sessions.every(row => row.continuing === (policy === 'COMPATIBLE')));
  // Only aggregate, non-authoritative facts leave this helper. Never serialize
  // observations, password hashes, session tokens, user data or assertion diffs.
  return Object.freeze({ format: 'sabalan-migration-users-comparison/v1', policy,
    comparedCensuses: censusNames.length, passwordCases: after.passwords.length,
    authorizationCases: after.authorization.length, sessionCases: after.sessions.length,
    draftCases: after.drafts.length, productionAdmission: false, nativeAuthority: false });
}
