import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../../deploy/scripts/run-recovery-drill.sh', import.meta.url));

test('supervised role drill selects the sealed sidecar and refuses escaped or unpinned paths', {
  skip: process.platform !== 'linux',
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-drill-launcher-'));
  try {
    const remote = path.join(root, 'remote');
    const app = path.join(root, 'app');
    fs.mkdirSync(remote);
    fs.mkdirSync(path.join(app, 'backend'), { recursive: true });
    fs.mkdirSync(path.join(app, 'deploy/scripts'), { recursive: true });
    fs.writeFileSync(path.join(app, 'deploy/scripts/with-backend-control-ownership.sh'),
      'printf "%s\\n" "$DEPLOYMENT_DRILL_METADATA_PATH"\n');
    const sealed = path.join(remote, 'sealed.sabrec.json');
    const latest = path.join(remote, 'latest.sabrec.json');
    const outside = path.join(root, 'outside.sabrec.json');
    for (const file of [sealed, latest, outside]) fs.writeFileSync(file, '{}');
    fs.utimesSync(sealed, 100, 100);
    fs.utimesSync(latest, 200, 200);
    const alias = path.join(remote, 'alias.sabrec.json');
    fs.symlinkSync(sealed, alias);

    const launch = (metadata = '', target = '', sha = '') => spawnSync('sh', [launcher], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SABALANERP_DRILL_APP_ROOT: app,
        DEPLOYMENT_REMOTE_MOUNT: remote,
        DEPLOYMENT_DRILL_DATABASE_MARKER: 'isolated-fixture-marker',
        DEPLOYMENT_DRILL_METADATA_PATH: metadata,
        DEPLOYMENT_DRILL_ROLE_TARGET_FILE: target,
        DEPLOYMENT_DRILL_ROLE_TARGET_SHA256: sha,
      },
    });
    const automatic = launch();
    assert.equal(automatic.status, 0, automatic.stderr);
    assert.equal(automatic.stdout.trim(), latest);

    const plan = path.join(root, 'sealed-target.json');
    const digest = 'a'.repeat(64);
    const supervised = launch(sealed, plan, digest);
    assert.equal(supervised.status, 0, supervised.stderr);
    assert.equal(supervised.stdout.trim(), sealed);
    for (const result of [launch(sealed), launch(outside, plan, digest), launch(alias, plan, digest)]) {
      assert.ifError(result.error);
      assert.ok(result.status === 1 || result.status === 2, result.stderr);
      assert.equal(result.stdout, '');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
