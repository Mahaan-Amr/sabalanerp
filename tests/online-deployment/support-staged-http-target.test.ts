import assert from 'node:assert/strict';
import test from 'node:test';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { SUPPORT_STAGED_HTTP_CLIENT_SOURCE, SUPPORT_STAGED_HTTP_TARGET_SOURCE } from './support-staged-http-client.fixture';

const validate = new Function('require', SUPPORT_STAGED_HTTP_TARGET_SOURCE + '\nreturn validateSupportHttpTarget;')(require);
const ownPrivateHost = Object.values(networkInterfaces()).flat().find(value => value && !value.internal
  && value.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address))?.address;

test('fixed HTTP child target requires the current assigned private interface and an exact clean URL', t => {
  for (const host of [undefined, '127.0.0.1', 'localhost', '8.8.8.8', '::1', '10.999.1.1']) {
    assert.throws(() => validate('http://127.0.0.1:3197/', host));
  }
  if (!ownPrivateHost) { t.diagnostic('No host RFC1918 interface; native container run owns the positive interface case.'); return; }
  const base = `http://${ownPrivateHost}:3197/`;
  assert.equal(validate(base, ownPrivateHost).origin, base.slice(0, -1));
  for (const url of ['http://127.0.0.1:3197/', 'http://8.8.8.8:3197/', `https://${ownPrivateHost}:3197/`,
    `http://user:password@${ownPrivateHost}:3197/`, base + '?token=bad', base + '#bad', base + 'other',
    `http://${ownPrivateHost}/`, `http://${ownPrivateHost}:80/`]) {
    assert.throws(() => validate(url, ownPrivateHost));
  }
});

test('actual original HTTP-only child rejects a foreign target before using the private session', async () => {
  const child = spawn(process.execPath, ['-e', SUPPORT_STAGED_HTTP_CLIENT_SOURCE], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { errors += bytes; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const token = 'diagnostic-only-no-real-session';
  child.stdin.end(JSON.stringify({ format: 'sabalan-support-staged-http-client-input/v2',
    baseUrl: 'http://8.8.8.8:3197/', expectedHost: ownPrivateHost ?? '127.0.0.1', sessionToken: token }));
  assert.deepEqual(await closed, { code: 1, signal: null });
  assert.equal(output, '');
  assert.ok(errors.includes(ownPrivateHost ? 'SUPPORT_HTTP_ENROLLED_HOST_CHANGED' : 'SUPPORT_HTTP_PRIVATE_HOST_REQUIRED'));
  assert.equal(errors.includes(token), false);
});
