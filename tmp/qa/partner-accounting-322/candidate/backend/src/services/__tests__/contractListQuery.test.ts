import assert from 'node:assert/strict';
import { buildContractSearchConditions, parseContractStatuses } from '../contractListQuery';

assert.deepEqual(parseContractStatuses('SIGNED'), ['SIGNED']);
assert.deepEqual(parseContractStatuses('CANCELLED,EXPIRED'), ['CANCELLED', 'EXPIRED']);
assert.deepEqual(parseContractStatuses('SIGNED,UNKNOWN,SIGNED'), ['SIGNED']);
assert.deepEqual(parseContractStatuses(undefined), []);

const creatorSearchConditions = buildContractSearchConditions('فروشنده نمونه');
assert.ok(creatorSearchConditions.some((condition) => condition.createdByUser?.firstName));
assert.ok(creatorSearchConditions.some((condition) => condition.createdByUser?.lastName));
assert.ok(creatorSearchConditions.some((condition) => condition.createdByUser?.username));
assert.ok(creatorSearchConditions.some((condition) => condition.AND?.length === 2));
assert.ok(!creatorSearchConditions.some((condition) => condition.creatorSequenceNumber));

const numericSearchConditions = buildContractSearchConditions('1002');
assert.ok(numericSearchConditions.some((condition) => condition.creatorSequenceNumber === 1002));

console.log('backend contract list query tests passed');
