'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [root, name] = process.argv.slice(2);
process.chdir(root);
process.env.INQUIRY_RUNTIME_GENERATION = '1';
const { initializeInquiryWork, runInquiryWork } = require('./app-lib/runtime-work');
const { prisma } = require('./app-lib/prisma');
const wait = file => new Promise((resolve, reject) => {
  const deadline = performance.now() + 12000;
  const poll = () => fs.existsSync(file) ? resolve() : performance.now() > deadline
    ? reject(Error('PRISMA_FIXTURE_TIMEOUT')) : setTimeout(poll, 5);
  poll();
});
const write = (suffix, value) => fs.writeFileSync(path.join(root, name + suffix), value, { flag: 'wx', mode: 0o600 });

(async () => {
  try {
    await initializeInquiryWork();
    let transaction;
    await runInquiryWork(async () => {
      transaction = prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('INSERT INTO native_probes VALUES(?,?,?)', name, '123456789.12345678', '0.00000001');
        write('.sql-ready', 'actual-prisma-sqlite-transaction');
        await wait(path.join(root, name + '.finish'));
      }, { timeout: 15000 });
      await wait(path.join(root, name + '.sql-ready'));
      write('.body-returned', 'parent-body-returned-before-query');
    });
    await transaction;
    write('.sql-committed', 'actual-transaction-completion');
    await prisma.$transaction([
      prisma.$executeRawUnsafe('INSERT INTO native_probes VALUES(?,?,?)', name + '-batch-a', '9.12345678', '0.00000002'),
      prisma.$executeRawUnsafe('INSERT INTO native_probes VALUES(?,?,?)', name + '-batch-b', '8.12345678', '0.00000003'),
    ]);
    const failure = Error('INTENTIONAL_TRANSACTION_ROLLBACK');
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('INSERT INTO native_probes VALUES(?,?,?)', name + '-rolled-back', '7', '7');
      throw failure;
    }), error => error === failure);
    const values = await prisma.$queryRawUnsafe('SELECT id,amount,quantity FROM native_probes WHERE id LIKE ? ORDER BY id', name + '%');
    assert.deepEqual(values, [
      { id: name, amount: '123456789.12345678', quantity: '0.00000001' },
      { id: name + '-batch-a', amount: '9.12345678', quantity: '0.00000002' },
      { id: name + '-batch-b', amount: '8.12345678', quantity: '0.00000003' },
    ]);
    write('.prisma-proof', JSON.stringify({ exactValues: true, interactiveTransaction: true, lazyBatch: true, rollback: true, standaloneRead: true }));
    write('.action-completed', 'parent-completed-with-query');
  } finally { await prisma.$disconnect(); } // Isolated diagnostic database only.
})().catch(() => { console.error('INQUIRY_PRISMA_FIXTURE_FAILED'); process.exitCode = 1; });
