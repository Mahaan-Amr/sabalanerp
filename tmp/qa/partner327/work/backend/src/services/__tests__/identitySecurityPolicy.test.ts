import assert from 'node:assert/strict';
import { sessionExpiry, shouldPersistActivity, failedLoginAlertKind } from '../identitySecurityPolicy';

const loginAt = new Date('2026-07-21T08:00:00.000Z');
const expiry = sessionExpiry(loginAt);
assert.equal(expiry.idleExpiresAt.toISOString(), '2026-07-21T20:00:00.000Z');
assert.equal(expiry.absoluteExpiresAt.toISOString(), '2026-07-28T08:00:00.000Z');

assert.equal(shouldPersistActivity(loginAt, new Date('2026-07-21T08:04:59.000Z')), false);
assert.equal(shouldPersistActivity(loginAt, new Date('2026-07-21T08:05:00.000Z')), true);

assert.equal(failedLoginAlertKind({ identifierFailures: 9, ipFailures: 24 }), null);
assert.equal(failedLoginAlertKind({ identifierFailures: 10, ipFailures: 24 }), 'IDENTIFIER_THRESHOLD');
assert.equal(failedLoginAlertKind({ identifierFailures: 2, ipFailures: 25 }), 'IP_THRESHOLD');

console.log('identity security policy tests passed');
