const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tokens = bytes => bytes.toString().replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  .replace(/^generator client\s*\{[\s\S]*?^\}\s*/m, '').match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s]/g)
  .filter(token => !/^\s/.test(token) && !token.startsWith('//') && !token.startsWith('/*')).join('');

async function main() {
  let fixture, db;
  try {
    assert.equal(process.env.SABALAN_PRODUCTION_IMAGE_CUSTOMER_OVERLAP, '1');
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.getuid(), 0); assert.equal(process.getgid(), 0);
    const nativeStatus = fs.readFileSync('/proc/self/status', 'utf8');
    assert.match(nativeStatus, /^CapEff:\s+0000000000000000$/m);
    assert.match(nativeStatus, /^NoNewPrivs:\s+1$/m);
    const url = new URL(process.env.DATABASE_URL);
    assert.equal(url.hostname, 'localhost'); assert.equal(url.searchParams.get('host'), '/qa-pg-socket');
    assert.match(url.pathname, /^\/qa_customer_expansion_[a-f0-9]{32}$/);
    assert.equal(url.username, 'sabalanerp'); assert.equal(url.password, '');
    assert.equal(url.searchParams.get('connection_limit'), '2'); assert.equal(url.searchParams.get('pool_timeout'), '5');
    assert.match(url.searchParams.get('application_name'), /^actual-image-customer-[a-f0-9]{16}$/);
    const schema = fs.readFileSync('/app/node_modules/.prisma/client/schema.prisma');
    assert.equal(sha(tokens(schema)), 'c8021f3262a99c80f5a6f741f17ee05a210a785457fdf85e37a56b66f026ec12');
    // The fixture owns its pool before the historical module is imported. The
    // historical module reuses that same platform pool and immutable image Prisma
    // runtime, rather than receiving SQL fragments from a different generation.
    fixture = require('/qa-fixture.cjs');
    const { PrismaClient, Prisma } = require('/app/node_modules/@prisma/client');
    assert.equal(Prisma.prismaVersion.client, '5.22.0');
    db = new PrismaClient({ datasources: { db: { url: url.href } } });
    const workspace = require('/app/dist/services/accountingCustomerWorkspace.js');
    const identity = await db.$queryRawUnsafe(`SELECT system_identifier::text AS cluster FROM pg_control_system()`);
    assert.deepEqual(identity, [{ cluster: '7609810350852628513' }]);
    const retainedHistorySha256 = '7e095386a618dda9ac3d2491772f5c473e91dc97fe4f12eb19a1b0004addefe2';
    const history = () => db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      await tx.$executeRawUnsafe("SET LOCAL datestyle='ISO, YMD'");
      return tx.$queryRawUnsafe(`SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS active,
        string_agg(encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),',' ORDER BY id)
          FILTER (WHERE rolled_back_at IS NOT NULL) AS retained_hash FROM public._prisma_migrations m`);
    });
    assert.deepEqual(await history(), [{ total: 428, active: 427, retained_hash: retainedHistorySha256 }]);
    const sourceBusiness = () => db.$queryRawUnsafe(`SELECT
      (SELECT count(*)::integer FROM public.users) AS users,
      (SELECT encode(sha256(convert_to(string_agg(to_jsonb(u)::text,E'\\n' ORDER BY id),'UTF8')),'hex') FROM public.users u) AS user_hash,
      (SELECT count(*)::integer FROM public.sales_contracts) AS contracts,
      (SELECT encode(sha256(convert_to(string_agg(to_jsonb(c)::text,E'\\n' ORDER BY id),'UTF8')),'hex') FROM public.sales_contracts c) AS contract_hash`);
    const sourceBefore = await sourceBusiness();
    assert.equal(sourceBefore[0].users, 30); assert.equal(sourceBefore[0].contracts, 761);
    assert.equal(await db.accountingLedgerVoucher.count(), 0);
    const configurationModels = ['accountingLegalEntity', 'accountingBook', 'accountingCodeScheme',
      'accountingFiscalYear', 'accountingPostingPeriod', 'accountingLedgerAccount',
      'accountingCustomerPostingRule', 'accountingFinancialAccount'];
    const originalConfiguration = Object.fromEntries(await Promise.all(configurationModels.map(async model =>
      [model, await db[model].findMany({ orderBy: { id: 'asc' } })])));
    assert.equal(originalConfiguration.accountingLegalEntity.length, 1);
    const verifyOriginalConfiguration = async () => {
      for (const model of configurationModels) assert.deepEqual(await db[model].findMany({
        where: { id: { in: originalConfiguration[model].map(row => row.id) } }, orderBy: { id: 'asc' },
      }), originalConfiguration[model], `Original configured ledger changed: ${model}`);
    };
    const f = await fixture.customerFinanceData(db, { reuseConfiguredLedger: true }), id = await f.customer();
    await verifyOriginalConfiguration();
    await workspace.recordCustomerAccountOperation(db, id, { ...f.common, kind: 'DEBIT', amountRials: 200n, idempotencyKey: randomUUID() });
    await workspace.recordCustomerAccountOperation(db, id, { ...f.common, kind: 'CREDIT', amountRials: 80n, idempotencyKey: randomUUID() });
    const read = () => workspace.readCustomerWorkspace(db, { id, asOf: new Date(), userId: f.actor.id });
    const initial = await read(), debt = initial.openItems.find(row => row.kind === 'RECEIVABLE'), credit = initial.openItems.find(row => row.kind === 'CREDIT');
    assert.ok(debt && credit);
    const command = { ...f.common, kind: 'RECEIPT', amountRials: 150n, financialAccountId: f.financial.id,
      bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() };
    const receipt = await workspace.recordCustomerWorkspaceTreasury(db, id, command);
    const allocation = await workspace.recordCustomerWorkspaceTreasury(db, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n,
      receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 100n }], idempotencyKey: randomUUID() });
    await workspace.recordCustomerWorkspaceTreasury(db, id, { ...f.common, kind: 'REVERSE_ALLOCATION', amountRials: 0n,
      allocationId: allocation.id, allocations: [], idempotencyKey: randomUUID() });
    for (const [source, amountRials] of [[{ creditItemId: credit.id }, 30n], [{ receiptId: receipt.id }, 20n]])
      await workspace.recordCustomerAccountOperation(db, id, { ...f.common, ...source, kind: 'REFUND', amountRials,
        financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    assert.equal((await read()).netBalanceRials, 20n);
    const snapshot = async () => sha(JSON.stringify({
      allocations: await db.accountingSettlementAllocation.findMany({ include: { lines: { orderBy: { id: 'asc' } }, transaction: true }, orderBy: { id: 'asc' } }),
      transactions: await db.accountingTreasuryTransaction.findMany({ orderBy: { id: 'asc' } }),
      items: await db.accountingCustomerOpenItem.findMany({ orderBy: { id: 'asc' } }),
      vouchers: await db.accountingLedgerVoucher.findMany({ include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    }));
    const acknowledged = await snapshot(), sql = fs.readFileSync('/qa-financial.sql', 'utf8');
    await db.$executeRawUnsafe(`CREATE FUNCTION public.qa_actual_image_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.migration_name='20261019010000_customer_semantic_barrier' THEN RAISE EXCEPTION 'QA_ACTUAL_IMAGE_LATE_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER qa_actual_image_late_failure BEFORE INSERT ON public._prisma_migrations
      FOR EACH ROW EXECUTE FUNCTION public.qa_actual_image_late_failure()`);
    // Establish the deadline BEFORE the active DO statement; setting it inside
    // a running statement cannot establish that statement's time budget.
    const install = () => db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10s'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='250ms'");
      await tx.$executeRawUnsafe(sql);
    }, { maxWait: 1000, timeout: 15000 });
    await assert.rejects(install(), /QA_ACTUAL_IMAGE_LATE_FAILURE/);
    assert.deepEqual(await history(), [{ total: 428, active: 427, retained_hash: retainedHistorySha256 }]); assert.equal(await snapshot(), acknowledged);
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT to_regclass('public.online_financial_compatibility_barriers')::text AS name`), [{ name: null }]);
    await db.$executeRawUnsafe('DROP TRIGGER qa_actual_image_late_failure ON public._prisma_migrations');
    await db.$executeRawUnsafe('DROP FUNCTION public.qa_actual_image_late_failure()');
    await install(); assert.deepEqual(await history(), [{ total: 436, active: 435, retained_hash: retainedHistorySha256 }]); assert.equal(await snapshot(), acknowledged);
    assert.equal((await read()).netBalanceRials, 20n);
    const additional = { ...command, amountRials: 10n, idempotencyKey: randomUUID() };
    const saved = await workspace.recordCustomerWorkspaceTreasury(db, id, additional);
    assert.equal((await workspace.recordCustomerWorkspaceTreasury(db, id, additional)).id, saved.id);
    assert.equal((await read()).netBalanceRials, 10n);
    await assert.rejects(db.$queryRawUnsafe('SELECT public.sabalan_require_customer_source_shares()'), /CUSTOMER_SOURCE_SHARES_CLOSED/);
    assert.deepEqual(await sourceBusiness(), sourceBefore);
    await verifyOriginalConfiguration();
    const modules = Object.fromEntries(Object.keys(require.cache).filter(file => file.startsWith('/app/dist/'))
      .sort().map(file => [file, sha(fs.readFileSync(file))]));
    assert.ok(Object.hasOwn(modules, '/app/dist/services/accountingCustomerWorkspace.js'));
    const imageWorkspacePackages = Object.fromEntries(Object.keys(require.cache).filter(file => file.startsWith('/packages/'))
      .sort().map(file => [file, sha(fs.readFileSync(file))]));
    assert.equal(imageWorkspacePackages['/packages/contract-product-graph/dist/index.js'], 'e11b3367896c71be7766aa85972663f338c5ee5c728d7de83fe80630d7d491d7');
    assert.equal(imageWorkspacePackages['/packages/partner-sales-contracts/dist/index.js'], '84ce45c53ebddca60c63793454093109996ef8923beee9156b0987c6a69858c4');
    console.log(JSON.stringify({ format: 'sabalan-actual-image-customer-overlap/v1', actualImageModuleAcceptance: true,
      modules, imageWorkspacePackages, runtimeUid: process.getuid(), effectiveCapabilitiesZero: true, noNewPrivileges: true,
      generatedSchemaSha256: sha(schema), oldSchemaTokensSha256: sha(tokens(schema)), prismaVersion: Prisma.prismaVersion,
      predecessorMigrations: 427, finalMigrations: 435, predecessorHistoryRows: 428, finalHistoryRows: 436,
      retainedHistorySha256, retainedHistoryPreserved: true, financialSnapshotsPreserved: true, legacyReceiptRetryPreserved: true,
      originalUsersAndContractsPreserved: true, originalLedgerConfigurationPreserved: true,
      fullApplicationRestore: false, productionAdmission: false }));
  } finally {
    try { await db?.$disconnect(); } finally {
      if (fixture) await fixture.disconnectDatabase();
      else await globalThis.sabalanPrismaClient?.$disconnect();
    }
    console.log(JSON.stringify({ actualImageCustomerClientsClosed: true }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
