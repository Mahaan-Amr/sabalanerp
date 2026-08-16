import assert from 'node:assert/strict';
import { candidateIdentityMatches } from '../hrCandidateIdentityPolicy';

const existing = {
  firstName: 'امیر',
  lastName: 'ماهانیان',
  mobile: '09398373570',
};

assert.equal(
  candidateIdentityMatches(existing, {
    firstName: 'علی',
    lastName: 'رضایی',
    mobile: '09398373570',
  }),
  false,
  'an existing national code must not silently replace a different entered name',
);

assert.equal(
  candidateIdentityMatches(existing, {
    firstName: ' امیر ',
    lastName: 'ماهانيان',
    mobile: '+98 939 837 3570',
  }),
  true,
  'equivalent Persian spelling and mobile formatting identify the same candidate',
);

assert.equal(
  candidateIdentityMatches(existing, {
    firstName: 'امیر',
    lastName: 'ماهانیان',
    mobile: '09120000000',
  }),
  false,
  'an existing national code with another mobile must be rejected',
);

console.log('HR candidate identity policy tests passed.');
