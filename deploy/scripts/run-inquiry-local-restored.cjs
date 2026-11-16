'use strict';

// Local recovery only: schema preparation and seeding are separate operations.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function supervise({ coordination, database, args, pollMs = 500, spawnChild = spawn }) {
  if (!fs.statSync(database).isFile()) throw new Error('LOCAL_INQUIRY_DATABASE_MISSING');
  const header = Buffer.alloc(16), fd = fs.openSync(database, 'r');
  try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (header.toString('binary') !== 'SQLite format 3\0') throw new Error('LOCAL_INQUIRY_DATABASE_INVALID');
  const stopped = path.join(coordination, 'inquiry-stopped');
  const restart = path.join(coordination, 'restart-inquiry');
  let child = null, closing = false, stopping = false, timer, startupFailed = false;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  function mayRun() {
    try {
      return !fs.existsSync(restart)
        && JSON.parse(fs.readFileSync(path.join(coordination, 'state.json'), 'utf8')).mode === 'NORMAL';
    } catch { return false; }
  }
  function markStopped() { fs.writeFileSync(stopped, '', { mode: 0o600 }); }
  function stop() {
    if (child && !stopping) { stopping = true; child.kill('SIGTERM'); }
  }
  function close(code) {
    clearInterval(timer);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
    finish(code);
  }
  function shutdown() {
    closing = true;
    if (child) stop(); else { markStopped(); close(0); }
  }
  function tick() {
    if (closing) return;
    if (child) { if (!mayRun()) stop(); return; }
    if (!mayRun()) { markStopped(); return; }
    fs.rmSync(stopped, { force: true });
    // A controller may have observed the previous stopped marker while we
    // checked NORMAL. Withdraw the acknowledgement before checking again.
    if (!mayRun()) { markStopped(); return; }
    stopping = false;
    child = spawnChild(process.execPath, args, { stdio: 'inherit' });
    child.once('error', () => { closing = true; startupFailed = true; });
    child.once('close', (code) => {
      const requested = stopping;
      child = null;
      markStopped();
      if (closing) close(startupFailed ? 1 : 0);
      else if (!requested) close(code || 1);
    });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  timer = setInterval(tick, pollMs);
  tick();
  return { done, shutdown };
}

module.exports = { supervise };
if (require.main === module) {
  const managed = ['BACKEND_ONLINE_SCOPE_FILE', 'BACKEND_ONLINE_SCOPE_SHA256',
    'INQUIRY_NATIVE_AUTHORITY_FILE', 'INQUIRY_NATIVE_CLAIM_SHA256', 'INQUIRY_RUNTIME_GENERATION', 'BACKEND_RUNTIME_ROLE'];
  if (process.env.INQUIRY_LOCAL_RESTORED !== '1' || managed.some(key => Object.hasOwn(process.env, key))) {
    throw new Error('LOCAL_INQUIRY_STARTUP_SCOPE_REFUSED');
  }
  supervise({
    coordination: process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination',
    database: '/data/inquiry.db',
    args: ['/app/node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '-p', '3001'],
  }).done.then(code => { process.exitCode = code; });
}
