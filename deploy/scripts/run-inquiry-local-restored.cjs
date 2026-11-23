'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function supervise({ coordination, verifyDatabase, args, env = process.env, pollMs = 500 }) {
  const stopped = path.join(coordination, 'inquiry-stopped');
  const stateFile = path.join(coordination, 'state.json');
  const holds = ['restart-inquiry', 'pending-restore.json', 'deployment-maintenance.json'];
  let child;
  let stopping = false;
  let closing = false;
  let complete;
  const done = new Promise(resolve => { complete = resolve; });

  function mayRun() {
    try {
      if (holds.some(hold => fs.lstatSync(path.join(coordination, hold), { throwIfNoEntry: false }))) return false;
      const stat = fs.lstatSync(stateFile);
      if (!stat.isFile() || stat.size > 8192) return false;
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return state.mode === 'NORMAL' && typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt))
        && (state.operationId === undefined || typeof state.operationId === 'string')
        && (state.message === undefined || typeof state.message === 'string');
    } catch {
      return false;
    }
  }

  function finish(code) {
    closing = true;
    clearInterval(timer);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
    complete(code);
  }

  function acknowledgeStop() {
    try {
      fs.writeFileSync(stopped, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  function fail(error) {
    console.error(error.message);
    finish(1);
  }

  function stopChild() {
    if (stopping) return;
    stopping = true;
    child.kill('SIGTERM');
  }

  function shutdown() {
    if (closing) return;
    closing = true;
    if (child) {
      stopChild();
      return;
    }
    try {
      acknowledgeStop();
      finish(0);
    } catch (error) {
      fail(error);
    }
  }

  function tick() {
    if (closing) return;
    if (child) {
      if (!mayRun()) stopChild();
      return;
    }
    try {
      if (!mayRun()) {
        acknowledgeStop();
        return;
      }
      // Controllers can act on the stopped marker until it is withdrawn.
      // Recheck admission before verification and again before launching.
      fs.rmSync(stopped, { force: true });
      if (!mayRun()) {
        acknowledgeStop();
        return;
      }
      verifyDatabase();
      if (!mayRun()) {
        acknowledgeStop();
        return;
      }
      stopping = false;
      child = spawn(process.execPath, args, { env, stdio: 'inherit' });
      let spawnError;
      child.once('error', error => { spawnError = error; });
      child.once('close', code => {
        child = undefined;
        try {
          acknowledgeStop();
          if (spawnError) fail(spawnError);
          else if (closing) finish(0);
          else if (!stopping) finish(code || 1);
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      try {
        acknowledgeStop();
      } catch (markerError) {
        console.error(markerError.message);
      }
      fail(error);
    }
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const timer = setInterval(tick, pollMs);
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
  if (!/^local-recovered-[A-Za-z0-9_-]+$/.test(process.env.INQUIRY_LOCAL_DATA_SUBPATH || '')) {
    throw new Error('LOCAL_INQUIRY_DATA_SUBPATH_REFUSED');
  }
  const database = '/data/inquiry.db';
  if (process.env.DATABASE_URL !== `file:${database}`) throw new Error('LOCAL_INQUIRY_DATABASE_URL_REFUSED');

  const { readInquiryCompiledBrowser, inquiryRuntimeBuildEnvironment } = require('./inquiry-compiled-browser.cjs');
  const { verifyInquiryDatabase } = require('./verify-inquiry-database.cjs');
  const compiled = readInquiryCompiledBrowser('/app');
  const buildEnvironment = inquiryRuntimeBuildEnvironment(compiled);
  const env = { ...process.env };
  for (const key of ['SABALAN_INQUIRY_BUILD_ID', 'NEXT_PUBLIC_INQUIRY_BUILD_ID', 'NEXT_DEPLOYMENT_ID']) {
    if (buildEnvironment[key] === undefined) delete env[key];
    else env[key] = buildEnvironment[key];
  }

  supervise({
    coordination: process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination',
    verifyDatabase: () => verifyInquiryDatabase(database),
    args: ['/app/node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '-p', '3001'],
    env,
  }).done.then(code => { process.exitCode = code; });
}
