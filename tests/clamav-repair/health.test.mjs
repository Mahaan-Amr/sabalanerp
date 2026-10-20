import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
const command = new URL('../../deploy/clamav/health.sh',import.meta.url).pathname;
test('scanner availability alone cannot hide a stopped updater or a failed update', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabalan-clamav-health-'));
  const child = spawn('sleep', ['30']);
  try {
    mkdirSync(path.join(root, 'bin')); mkdirSync(path.join(root, 'run')); mkdirSync(path.join(root, 'db'));
    writeFileSync(path.join(root, 'bin/clamdscan'), '#!/bin/sh\nprintf "PONG\\n"\n', { mode: 0o755 });
    writeFileSync(path.join(root, 'run/clamd.pid'), String(child.pid));
    const env = { ...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH,
      CLAMAV_RUN_DIRECTORY: path.join(root, 'run'), CLAMAV_DATABASE_DIRECTORY: path.join(root, 'db') };
    const check = () => spawnSync('sh', [command], { env, encoding: 'utf8' });
    assert.equal(check().status, 1, 'missing updater must fail despite PONG');
    writeFileSync(path.join(root, 'run/updater.pid'), String(child.pid));
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(path.join(root, 'db/.sabalan-updater-state'), `${now} ${now} 0 ${now + 7200}\n`);
    assert.equal(check().status, 1, 'an exit code of zero without update evidence must fail');
    writeFileSync(path.join(root, 'db/.sabalan-freshclam-result'), ['main','daily','bytecode'].map(name=>`${name}.cvd database is up-to-date (version: 1)`).join('\n'));
    assert.equal(check().status, 0, 'a live updater with a recent successful cycle must pass');
    const successes=['main','daily','bytecode'].map(name=>`${name}.cvd database is up-to-date (version: 1)`).join('\n');
    writeFileSync(path.join(root, 'db/.sabalan-freshclam-result'), 'WARNING: Cool-down expired, ok to try again.\n'+successes);
    assert.equal(check().status, 0, 'a real complete success after naturally expired cooldown is not an active refusal');
    writeFileSync(path.join(root, 'db/.sabalan-freshclam-result'), 'WARNING: Cool-down expired, ok to try again.\nWARNING: You are still on cool-down until after: tomorrow\n'+successes);
    assert.equal(check().status, 1, 'expiry text must never mask a subsequent refusal');
    writeFileSync(path.join(root, 'db/.sabalan-updater-state'), `${now} ${now - 7200} 17 ${now + 7200}\n`);
    assert.equal(check().status, 1, 'a CDN refusal must not reuse an older successful result');
  } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});
