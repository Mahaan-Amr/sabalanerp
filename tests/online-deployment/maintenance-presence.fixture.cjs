'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
assert.equal(process.platform, 'linux');
const modulePath = process.argv[2];
assert.ok(path.isAbsolute(modulePath));
const { deploymentMaintenanceActive, DEPLOYMENT_MAINTENANCE_FILE } = require(modulePath);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-maintenance-presence-'));
const marker = path.join(root, DEPLOYMENT_MAINTENANCE_FILE);
const blocked = path.join(root, 'unreadable');
try {
  assert.equal(deploymentMaintenanceActive(root), false);
  fs.writeFileSync(marker, 'not valid JSON');
  assert.equal(deploymentMaintenanceActive(root), true);
  fs.unlinkSync(marker);
  fs.mkdirSync(marker);
  assert.equal(deploymentMaintenanceActive(root), true);
  fs.rmdirSync(marker);
  fs.symlinkSync(path.join(root, 'absent'), marker);
  assert.equal(fs.existsSync(marker), false); // The preceding implementation opened admission here.
  assert.equal(deploymentMaintenanceActive(root), true);
  fs.unlinkSync(marker);
  fs.mkdirSync(blocked, { mode: 0o000 });
  assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /^CapEff:\s+0+$/m);
  assert.equal(deploymentMaintenanceActive(blocked), true);
  console.log(JSON.stringify({ status: 'MAINTENANCE_PRESENCE_VERIFIED', cases: ['absent', 'malformed-file', 'directory', 'dangling-link', 'permission-denied'],
    moduleSha256: crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex') }));
} finally {
  if (fs.existsSync(blocked)) fs.chmodSync(blocked, 0o700);
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(root, { recursive: true });
}
