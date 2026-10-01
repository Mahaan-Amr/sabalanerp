import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';

const databaseUrl = process.env.ORDINARY_CONTRACT_QA_DATABASE_URL
  || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10';
const target = new URL(databaseUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55432' && target.pathname === '/sabalanerp');
// Set the explicit local URL before dynamically importing the application's shared client.
process.env.DATABASE_URL = databaseUrl;

test('an OTP request waiting behind an edit cannot accept the old session or revive approval authority', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const { ContractConfirmationService } = await import('../contractConfirmationService');
  const lifecycle = await import('../ordinaryContractLifecycle');
  const runtime = await import('../../lib/prisma');
  const sessionDelegate = runtime.prisma.contractPublicConfirmation;
  const originalLookup = sessionDelegate.findUnique;
  let contractId: string | undefined;
  try {
    const source = await database.salesContract.findFirst({ where: { partnerKind: null, partnerCaseId: null }, include: { productGraphState: true } });
    assert.ok(source);
    const contract = await database.salesContract.create({ data: {
      contractNumber: `QA-OTP-RACE-${randomUUID()}`, title: 'Isolated OTP concurrency QA', titlePersian: 'آزمون همزمانی پذیرش',
      content: 'QA', customerId: source.customerId, departmentId: source.departmentId, createdBy: source.createdBy,
      responsibleSellerId: source.responsibleSellerId, ...await lifecycle.commercialStartFields(database),
    } });
    contractId = contract.id;
    const token = randomUUID(); const code = '784123';
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const session = await database.contractPublicConfirmation.create({ data: {
      contractId, commercialRevision: 1, tokenHash: hash(token), phoneNumber: '09120000000', otpCodeHash: hash(code),
      otpExpiresAt: new Date(Date.now() + 60_000), linkExpiresAt: new Date(Date.now() + 60_000), createdBy: source.createdBy,
    } });
    let verifying: Promise<any> | undefined;
    await database.$transaction(async tx => {
      await lifecycle.lockOrdinaryContract(tx, contractId!);
      let observeLookup: () => void;
      const lookupObserved = new Promise<void>(resolve => { observeLookup = resolve; });
      (sessionDelegate as any).findUnique = async (args: any) => {
        const result = await originalLookup.call(sessionDelegate, args);
        if (args.where.tokenHash === hash(token)) observeLookup();
        return result;
      };
      verifying = new ContractConfirmationService().verifyPublicOtp({ token, code }).then(
        result => ({ result }), error => ({ error }));
      await Promise.race([lookupObserved, new Promise((_, reject) => setTimeout(() => reject(new Error('OTP lookup did not complete')), 5_000))]);
      await tx.salesContract.update({ where: { id: contractId }, data: { status: 'DRAFT', commercialRevision: 2,
        salesApprovalRevision: null, customerAcceptanceRevision: null } });
      await lifecycle.invalidateCommercialApprovals(tx, contractId!);
    }, { timeout: 15_000 });
    const verification = await verifying;
    assert.ok(verification.error || verification.result?.success === false, 'The old OTP must fail after the edit commits');
    const current = await database.salesContract.findUniqueOrThrow({ where: { id: contractId } });
    assert.equal(current.commercialRevision, 2);
    assert.equal(current.status, 'DRAFT');
    assert.equal(current.customerAcceptanceRevision, null);
    assert.equal((await database.contractPublicConfirmation.findUniqueOrThrow({ where: { id: session.id } })).status, 'CANCELLED');
    assert.equal(await database.accountingAuditLog.count({ where: { contractId, action: 'COMMERCIAL_CUSTOMER_DIGITAL_ACCEPTED' } }), 0);
  } finally {
    (sessionDelegate as any).findUnique = originalLookup;
    if (contractId) {
      await database.contractConfirmationAuditLog.deleteMany({ where: { contractId } });
      await database.contractPublicConfirmation.deleteMany({ where: { contractId } });
      await database.accountingAuditLog.deleteMany({ where: { contractId } });
      await database.salesContract.deleteMany({ where: { id: contractId } });
    }
    await database.$disconnect(); await runtime.disconnectDatabase();
  }
});
