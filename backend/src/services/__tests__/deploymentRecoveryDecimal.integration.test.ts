import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertRecoveryBusinessProof, captureRecoveryBusinessProof } from '../deploymentRecoveryDataProof';

test('business proof preserves exact numeric value when a migration widens scale', async () => {
  const client = new PrismaClient();
  const table = `contract_recovery_probe_${randomBytes(8).toString('hex')}`;
  const rollback = new Error('ROLLBACK_ISOLATED_RECOVERY_PROBE');
  try {
    await assert.rejects(client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE public."${table}" (id integer PRIMARY KEY, quantity numeric(18,3))`);
      await tx.$executeRawUnsafe(`INSERT INTO public."${table}" VALUES (1, 1.230), (2, 0.000), (3, NULL)`);
      const expected = await captureRecoveryBusinessProof(tx, [{ table, columns: ['id', 'quantity'], rows: '', sha256: '' }]);
      await tx.$executeRawUnsafe(`ALTER TABLE public."${table}" ALTER COLUMN quantity TYPE numeric(65,30)`);
      await assertRecoveryBusinessProof(tx, expected);
      await tx.$executeRawUnsafe(`UPDATE public."${table}" SET quantity = 1.230000000000000000000000000001 WHERE id = 1`);
      await assert.rejects(assertRecoveryBusinessProof(tx, expected), { code: 'DEPLOYMENT_DRILL_BUSINESS_DATA_MISMATCH' });
      throw rollback;
    }, { timeout: 120_000 }), (error) => error === rollback);
  } finally {
    await client.$disconnect();
  }
});
