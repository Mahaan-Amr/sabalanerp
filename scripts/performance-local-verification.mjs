import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function runProcessGroup(check, logFd) {
  // This local harness supports macOS/Linux. Never run a weaker timeout on another platform.
  if (process.platform === 'win32') throw new Error('PROCESS_GROUP_UNAVAILABLE');
  const child = spawn(check.command, check.args, {
    cwd: check.cwd, env: { ...process.env, ...check.env },
    stdio: ['ignore', logFd, logFd], detached: true,
  });
  let timedOut = false;
  let interrupted = false;
  let forceTimer;
  const signalGroup = (signal) => {
    if (!child.pid) return false;
    try { process.kill(-child.pid, signal); return true; }
    catch (error) {
      if (error.code === 'ESRCH') return false;
      if (signal === 0 && error.code === 'EPERM') return true;
      throw error;
    }
  };
  const terminate = () => {
    if (forceTimer) return;
    signalGroup('SIGTERM');
    forceTimer = setTimeout(() => signalGroup('SIGKILL'), 500);
  };
  const interrupt = () => { interrupted = true; terminate(); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const deadline = setTimeout(() => { timedOut = true; terminate(); }, check.timeoutMs ?? 30 * 60_000);
  try {
    const result = await new Promise((resolve) => {
      child.on('error', () => resolve({ exitCode: null, signal: null, failedToStart: true }));
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    // A successful npm exit does not prove that its descendants have stopped writing.
    let shutdownStarted;
    while (signalGroup(0)) {
      if (timedOut || interrupted) {
        shutdownStarted ??= performance.now();
        if (performance.now() - shutdownStarted > 5_000) throw new Error('PROCESS_GROUP_SHUTDOWN_UNCONFIRMED');
      }
      await delay(20);
    }
    return { ...result, timedOut, interrupted };
  } finally {
    clearTimeout(deadline);
    clearTimeout(forceTimer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

// This is software regression evidence, never a nine-gate promotion attestation.
export async function runPerformanceVerification({ directory, checks, identity }) {
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), status: 'RUNNING',
    productionActivationAuthorized: false, promotionDecision: 'NOT_EVALUATED',
    identity: await identity(), checks: [],
  };
  const reportPath = path.join(directory, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  for (const [index, check] of checks.entries()) {
    const log = `${index}.log`;
    const handle = await open(path.join(directory, log), 'wx', 0o600);
    const start = performance.now();
    let result;
    try {
      result = await runProcessGroup(check, handle.fd);
    } finally { await handle.close(); }
    report.checks.push({
      name: check.name, command: [check.command, ...check.args],
      status: result.exitCode === 0 && !result.timedOut && !result.interrupted ? 'PASS' : 'FAIL', ...result,
      durationMs: performance.now() - start, observedAt: new Date().toISOString(), log,
      logHash: createHash('sha256').update(await readFile(path.join(directory, log))).digest('hex'),
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (result.interrupted) break;
  }
  report.status = report.checks.length > 0 && report.checks.every(({ status }) => status === 'PASS') ? 'PASS' : 'FAIL';
  report.blockers = [];
  try {
    report.finalIdentity = await identity();
    if (JSON.stringify(report.identity) !== JSON.stringify(report.finalIdentity)) report.blockers.push('CANDIDATE_CHANGED');
  } catch { report.blockers.push('CANDIDATE_IDENTITY_UNAVAILABLE'); }
  if (report.blockers.length) report.status = 'BLOCKED';
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
