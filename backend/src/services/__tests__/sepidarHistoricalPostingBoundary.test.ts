import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { LedgerVoucherRecord } from '../accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from '../accountingLedgerPrismaRepository';

test('repository rejects production Sepidar posting before querying source or allocating anything', async () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalUrl = process.env.DATABASE_URL;
  let databaseTouched = false;
  const database = new Proxy({}, { get() { databaseTouched = true; throw new Error('Database must not be touched'); } });
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:local@postgres:5432/sabalanerp?application_name=sabalanerp-backend-local';
    const repository = createAccountingLedgerPrismaRepository(database as PrismaClient);
    await assert.rejects(() => repository.confirmSepidarPostingSource!({ bookId: 'cmub2hd63007zrqlphrzi5eey' } as LedgerVoucherRecord), /فقط در دفتر توسعه/);
    assert.equal(databaseTouched, false);
    process.env.NODE_ENV = 'development';
    await assert.rejects(() => repository.confirmSepidarPostingSource!({ bookId: 'another-book' } as LedgerVoucherRecord), /فقط در دفتر توسعه/);
    assert.equal(databaseTouched, false);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnvironment;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});
