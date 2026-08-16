import assert from 'node:assert/strict';
import { createClientRequestId } from './requestIdentity';

const withoutWebCrypto = createClientRequestId({}, {
  now: () => 1_723_456_789_000,
  random: () => 0.25,
});

assert.match(
  withoutWebCrypto,
  /^client-[a-z0-9]+-[a-z0-9]+$/,
  'mutations still receive an identifier when randomUUID is unavailable',
);

const withRandomUuid = createClientRequestId(
  { randomUUID: () => 'known-browser-uuid' },
  { now: () => 0, random: () => 0 },
);
assert.equal(withRandomUuid, 'known-browser-uuid', 'native randomUUID is preferred when available');

console.log('Client request identity tests passed.');
