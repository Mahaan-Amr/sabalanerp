'use strict';
// Image-owned diagnostic observation/fault injection. Never bundled into the
// ordinary Inquiry image or production startup; refuses all non-private roots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const http = require('node:http');
const directory = process.env.INQUIRY_QA_ARRIVAL_ROOT;
assert.match(directory || '', /^\/app\/online-runtime-acceptance\/inquiry-next-[a-f0-9]{32}\/arrivals$/);
assert.equal(directory, path.dirname(process.env.RECOVERY_COORDINATION_DIR) + '/arrivals');
assert.equal(fs.realpathSync(directory), directory);
const stat = fs.lstatSync(directory);
assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
assert.ok(process.env.INQUIRY_NATIVE_AUTHORITY_FILE && process.env.INQUIRY_NATIVE_CLAIM_SHA256);
assert.ok([undefined, '1'].includes(process.env.INQUIRY_QA_DISABLE_CLOSING));
const negativeControl = process.env.INQUIRY_QA_DISABLE_CLOSING === '1', requests = new AsyncLocalStorage();
function observe(caseId, phase) {
  const value = JSON.stringify({ caseId, phase, pid: process.pid, negativeControl }) + '\n';
  const file = path.join(directory, caseId + '.' + phase + '.json');
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(fs.readFileSync(file, 'utf8'), value); return;
  }
  try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  const parent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...arguments_) {
  if (event !== 'request') return emit.call(this, event, ...arguments_);
  const request = arguments_[0], delay = request.headers['x-sabalan-qa-delay'];
  // Browsers may retain overridden headers on a redirect GET. Observe only
  // native action POSTs; instrumentation must not break their normal redirect.
  if (request.method !== 'POST' || !request.headers['next-action']) return emit.call(this, event, ...arguments_);
  const caseId = request.headers['x-sabalan-qa-case'] ?? delay;
  if (caseId === undefined) return emit.call(this, event, ...arguments_);
  assert.match(caseId, /^[a-f0-9]{16}$/);
  assert.equal(request.url, delay ? '/admin/import' : '/admin/products/new');
  assert.ok(!(delay && request.headers['x-sabalan-qa-case']));
  observe(caseId, delay ? 'delay-arrived' : 'arrived');
  return requests.run({ caseId, delay: Boolean(delay), paused: false }, () => emit.call(this, event, ...arguments_));
};
const { RuntimeTaskAdmission } = require('/app/online-runtime/services/runtimeTaskAdmission.js');
const acquire = RuntimeTaskAdmission.prototype.acquire;
RuntimeTaskAdmission.prototype.acquire = function (...arguments_) {
  // Deliberately faulty private negative control. It does not bypass EX10;
  // it reproduces an invalid new root joining an already-running SH epoch.
  if (negativeControl) this.canJoin = () => true;
  const promise = acquire.apply(this, arguments_);
  const request = requests.getStore();
  if (request && !request.delay) observe(request.caseId, 'acquire');
  return promise;
};
const { RuntimeWorkContext } = require('/app/online-runtime/services/runtimeWorkContext.js');
const run = RuntimeWorkContext.prototype.run;
RuntimeWorkContext.prototype.run = function (body) {
  const request = requests.getStore();
  if (request?.delay && !request.paused && this.storage.getStore()?.active) {
    request.paused = true;
    return run.call(this, async () => {
      // Delay an admitted nested callback, not SQLite's engine or a database
      // transaction. It retains the real root lease without a busy timeout.
      observe(request.caseId, 'delayed');
      const release = path.join(directory, request.caseId + '.release');
      while (!fs.existsSync(release)) await new Promise(resolve => setTimeout(resolve, 5));
      return body();
    });
  }
  return run.call(this, body);
};
