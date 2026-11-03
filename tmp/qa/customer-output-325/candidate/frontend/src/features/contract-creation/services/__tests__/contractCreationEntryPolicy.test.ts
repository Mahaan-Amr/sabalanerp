import assert from 'node:assert/strict';
import {
  contractCreationEntryDecision,
  contractCreationPrimaryPending,
} from '../contractCreationEntryPolicy';

assert.equal(
  contractCreationPrimaryPending({
    creationComplete: true,
    mutationPending: false,
    recoveryReady: false,
  }),
  false,
  'a completed contract must keep the finish-and-return action clickable after recovery release',
);

assert.equal(
  contractCreationPrimaryPending({
    creationComplete: false,
    mutationPending: false,
    recoveryReady: false,
  }),
  true,
  'an unfinished contract must wait for safe recovery ownership before submission',
);

assert.equal(
  contractCreationEntryDecision({ hasRecoverableDraft: true, freshRequested: false }),
  'OFFER_RESUME',
  'ordinary entry must offer recovery instead of silently restoring the previous draft',
);

assert.equal(
  contractCreationEntryDecision({ hasRecoverableDraft: false, freshRequested: false }),
  'START_EMPTY',
);

assert.equal(
  contractCreationEntryDecision({ hasRecoverableDraft: true, freshRequested: true }),
  'START_EMPTY',
  'an explicitly fresh entry must not restore the previous draft',
);

console.log('Contract creation entry policy tests passed.');
