import assert from 'node:assert/strict';
import { parseContractStatusQuery } from './contractListQuery';

assert.deepEqual(parseContractStatusQuery('SIGNED'), ['SIGNED']);
assert.deepEqual(parseContractStatusQuery('CANCELLED,EXPIRED'), ['CANCELLED', 'EXPIRED']);
assert.deepEqual(parseContractStatusQuery('SIGNED,UNKNOWN,SIGNED'), ['SIGNED']);
assert.deepEqual(parseContractStatusQuery(null), []);

console.log('contract list query tests passed');
