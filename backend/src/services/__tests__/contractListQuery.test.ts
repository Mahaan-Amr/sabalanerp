import assert from 'node:assert/strict';
import { parseContractStatuses } from '../contractListQuery';

assert.deepEqual(parseContractStatuses('SIGNED'), ['SIGNED']);
assert.deepEqual(parseContractStatuses('CANCELLED,EXPIRED'), ['CANCELLED', 'EXPIRED']);
assert.deepEqual(parseContractStatuses('SIGNED,UNKNOWN,SIGNED'), ['SIGNED']);
assert.deepEqual(parseContractStatuses(undefined), []);

console.log('backend contract list query tests passed');
