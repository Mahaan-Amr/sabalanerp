import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertStandardLocalStartup, localCompose, startStandardLocal } from '../../scripts/lib/standard-local-docker.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const recoveryOverlay = 'docker-compose.local-inquiry-recovery.yml';
const baseFile = localCompose[2];

for (const [name, files] of [
  ['ordinary', []],
  ['development', ['-f', 'docker-compose.dev.yml']],
  ['acceptance', ['-f', 'docker-compose.performance-acceptance.yml']],
]) {
  test(`blocks ${name} startup before Docker ps or up when recovery is selected`, () => {
    const compose = [...localCompose, ...files];
    for (const output of [
      'LOCAL_INQUIRY_DATA_SUBPATH=local-recovered-fixture\r\n',
      'LOCAL_INQUIRY_RESTORED=1\nLOCAL_INQUIRY_DATA_SUBPATH=\n',
    ]) {
      const calls = [];
      const run = (_, args) => {
        calls.push(args);
        return { status: 0, stdout: output };
      };
      assert.throws(() => startStandardLocal(compose, ['--wait'], { run }), /Recovered Inquiry is selected/);
      assert.deepEqual(calls, [[...compose, 'config', '--environment']]);
    }
  });
}

test('standard startup verifies project status before up and preserves arguments', () => {
  const compose = [...localCompose, '-f', 'docker-compose.performance-acceptance.yml'];
  const upArgs = ['-d', '--wait', 'frontend'];
  const calls = [];
  const run = (_, args) => {
    calls.push(args);
    return { status: 0, stdout: 'LOCAL_INQUIRY_DATA_SUBPATH=\nLOCAL_INQUIRY_RESTORED=0\n' };
  };
  assert.equal(startStandardLocal(compose, upArgs, { run }), 0);
  assert.deepEqual(calls, [
    [...compose, 'config', '--environment'],
    [...localCompose, 'ps'],
    [...compose, 'up', ...upArgs],
  ]);
});

test('startup blocks on an unresolved Compose environment without exposing it', () => {
  const run = () => ({ status: 1, stdout: 'SECRET=private\n', stderr: 'private detail' });
  assert.throws(() => startStandardLocal(localCompose, [], { run }), {
    message: 'Could not resolve the local Compose environment. Startup was blocked.',
  });
});

let composeAvailable;
try {
  composeAvailable = spawnSync('docker', ['compose', 'version'], { cwd: root }).status === 0;
} catch {
  composeAvailable = false;
}
const composeSkip = composeAvailable ? false : 'Docker Compose CLI is unavailable';

function withDirectory(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabalanerp-inquiry-compose-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cleanEnvironment = { ...process.env };
for (const key of Object.keys(cleanEnvironment)) {
  if (/^(?:COMPOSE_|LOCAL_INQUIRY_|LOCAL_RECOVERY_COORDINATION_SOURCE$)/i.test(key)) {
    delete cleanEnvironment[key];
  }
}

test('Compose detects selection in project .env with shell precedence', { skip: composeSkip }, () => {
  withDirectory((cwd) => {
    writeFileSync(path.join(cwd, baseFile), 'name: sabalanerp-local\nservices:\n  fixture:\n    image: scratch\n');
    writeFileSync(path.join(cwd, '.env'), 'RECOVERY_ID=fixture\nLOCAL_INQUIRY_DATA_SUBPATH="local-recovered-${RECOVERY_ID}"\n');
    const run = (command, args, options) => spawnSync(command, args, { ...options, env: cleanEnvironment });
    assert.throws(() => assertStandardLocalStartup(localCompose, { cwd, run }), /Recovered Inquiry is selected/);
    const shellOverride = (command, args, options) => spawnSync(command, args, {
      ...options, env: { ...cleanEnvironment, LOCAL_INQUIRY_DATA_SUBPATH: '' },
    });
    assert.doesNotThrow(() => assertStandardLocalStartup(localCompose, { cwd, run: shellOverride }));
  });
});

test('the check-only command needs no Docker Engine and blocks a legacy recovery selection', { skip: composeSkip }, () => {
  withDirectory((cwd) => {
    writeFileSync(path.join(cwd, baseFile), 'name: sabalanerp-local\nservices:\n  fixture:\n    image: scratch\n');
    const env = { ...cleanEnvironment };
    delete env.DOCKER_CONTEXT;
    env.DOCKER_HOST = process.platform === 'win32'
      ? `npipe:////./pipe/${path.basename(cwd)}`
      : `unix://${path.join(cwd, 'absent-engine.sock')}`;
    const check = () => spawnSync(process.execPath, [path.join(root, 'scripts/start-local-docker.mjs'), '--check'], {
      cwd, env, encoding: 'utf8',
    });
    const ordinary = check();
    assert.equal(ordinary.status, 0, ordinary.stderr);
    writeFileSync(path.join(cwd, '.env'), 'LOCAL_INQUIRY_RESTORED=1\n');
    const recovered = check();
    assert.equal(recovered.status, 1);
    assert.match(recovered.stderr, /Recovered Inquiry is selected/);
  });
});

test('recovery overlay selects one data subpath and preserves coordination mount type and source', { skip: composeSkip }, () => {
  withDirectory((dir) => {
    const envFile = path.join(dir, 'test.env');
    writeFileSync(envFile, 'LOCAL_INQUIRY_DATA_SUBPATH=local-recovered-fixture\n');
    const config = (overlays, source) => {
      const args = ['compose', '--env-file', envFile, '-f', baseFile, ...overlays,
        'config', '--no-env-resolution', '--format', 'json'];
      const env = source ? { ...cleanEnvironment, LOCAL_RECOVERY_COORDINATION_SOURCE: source } : cleanEnvironment;
      const result = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).services;
    };
    const mount = (service, target) => {
      const found = service.volumes.filter((volume) => volume.target === target);
      assert.equal(found.length, 1, target);
      return found[0];
    };
    for (const source of [undefined, './coordination fixture']) {
      const base = config([], source);
      const restored = config(['-f', recoveryOverlay], source);
      const target = '/app/recovery-coordination';
      const original = mount(base.backend, target);
      assert.equal(original.type, source ? 'bind' : 'volume');
      assert.deepEqual(mount(restored.backend, target), original);
      assert.deepEqual(mount(restored.inquiry, target), original);
      for (const [service, dataTarget] of [
        [restored.backend, '/app/recovery-sources/inquiry'],
        [restored.inquiry, '/data'],
      ]) {
        const data = mount(service, dataTarget);
        assert.equal(data.type, 'volume');
        assert.equal(data.source, 'inquiry_data');
        assert.equal(data.volume.subpath, 'local-recovered-fixture');
      }
    }
  });
});
