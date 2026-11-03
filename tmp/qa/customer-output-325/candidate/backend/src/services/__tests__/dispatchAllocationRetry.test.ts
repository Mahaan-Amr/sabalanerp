import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { isRetryableDispatchTransactionError } from '../dispatchAllocation';

const known = (code: string, databaseCode?: string) => new Prisma.PrismaClientKnownRequestError('test', {
  code, clientVersion: 'test', meta: databaseCode ? { code: databaseCode } : undefined,
});

assert.equal(isRetryableDispatchTransactionError(known('P2034')), true);
assert.equal(isRetryableDispatchTransactionError(known('P2010', '40001')), true);
assert.equal(isRetryableDispatchTransactionError(known('P2010', '40P01')), true);
assert.equal(isRetryableDispatchTransactionError(known('P2010', '23505')), false);
assert.equal(isRetryableDispatchTransactionError(new Error('40001')), false);

console.log('dispatch allocation retry tests passed');
