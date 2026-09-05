import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runPerformanceVerification } from '../../scripts/performance-local-verification.mjs';

test('verification preserves failed command evidence and cannot claim promotion readiness', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-verification-'));
  try {
    const report = await runPerformanceVerification({ directory,
      identity: async () => ({ commit: 'fixture', sourceHash: 'fixture' }),
      checks: [
        { name: 'failure', command: process.execPath, args: ['-e', 'process.exit(7)'] },
        { name: 'next-check', command: process.execPath, args: ['-e', 'process.exit(0)'] },
      ],
    });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.productionActivationAuthorized, false);
    assert.equal(report.promotionDecision, 'NOT_EVALUATED');
    assert.deepEqual(report.checks.map(({ status, exitCode }) => [status, exitCode]), [['FAIL', 7], ['PASS', 0]]);
    assert.match(report.checks[0].logHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')), report);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('timeout stops inherited log writers before the evidence is finalized', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-verification-'));
  try {
    const descendant = "process.on('SIGTERM', () => {}); console.log('descendant-ready'); setInterval(() => console.log('still-running'), 50)";
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`;
    const report = await runPerformanceVerification({ directory,
      identity: async () => ({ commit: 'fixture', sourceHash: 'fixture' }),
      checks: [{ name: 'timeout', command: process.execPath, args: ['-e', parent], timeoutMs: 500 }],
    });
    const log = path.join(directory, report.checks[0].log);
    const before = await readFile(log, 'utf8');
    assert.match(before, /descendant-ready/);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks[0].timedOut, true);
    await delay(200);
    assert.equal(await readFile(log, 'utf8'), before, 'no surviving process may mutate hashed logs');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('successful commands cannot pass a candidate that changes while checks execute', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-verification-'));
  let version = 0;
  try {
    const report = await runPerformanceVerification({ directory,
      identity: async () => ({ commit: 'fixture', sourceHash: String(version++) }),
      checks: [{ name: 'success', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
    });
    assert.equal(report.checks[0].status, 'PASS');
    assert.equal(report.status, 'BLOCKED');
    assert.deepEqual(report.blockers, ['CANDIDATE_CHANGED']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
