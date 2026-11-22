import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import axios, { AxiosHeaders } from 'axios';

const mode = process.argv[2];

async function exerciseAnonymousVerification() {
  const build = process.env.NEXT_PUBLIC_BROWSER_BUILD_ID || null;
  let calls = 0;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const adapter = axios.defaults.adapter;
  const common = axios.defaults.headers.common['x-deployment-id'];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: '/apply' } } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem() { throw Error('ANONYMOUS_OTP_MUST_NOT_READ_APPLICANT_TOKEN'); },
  } });
  if (mode === 'conflict') axios.defaults.headers.common['x-deployment-id'] = 'erp_conflicting_otp_caller';
  axios.defaults.adapter = async config => {
    calls++;
    assert.equal(axios.getUri(config), 'https://isolated.invalid/api/hr-hiring/public/invitations/verify');
    assert.equal(config.method, 'post');
    assert.deepEqual(JSON.parse(config.data), { mobile: '09120000000', otp: '123456' });
    assert.equal(config.headers.get('x-deployment-id') ?? null, build);
    assert.equal(config.headers.get('Authorization'), undefined);
    assert.equal(config.headers.get('x-sabalan-expected-user'), undefined);
    assert.equal(config.headers.get('x-sabalan-expected-session'), undefined);
    assert.equal(config.withCredentials, undefined);
    assert.equal(config.timeout, 0);
    assert.equal(config.headers.get('Content-Type'), 'application/json');
    return { config, data: { success: true, data: { session: 'private-test-token' } }, status: 200,
      statusText: 'OK', headers: new AxiosHeaders() };
  };
  try {
    const { applicantHiringAPI } = await import('./hiringApi');
    if (mode === 'conflict') {
      await assert.rejects(applicantHiringAPI.verify('09120000000', '123456'), { code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT' });
      assert.equal(calls, 0);
    } else {
      const response = await applicantHiringAPI.verify('09120000000', '123456');
      assert.equal(response.data.data.session, 'private-test-token'); assert.equal(calls, 1);
    }
  } finally {
    axios.defaults.adapter = adapter;
    if (common === undefined) delete axios.defaults.headers.common['x-deployment-id'];
    else axios.defaults.headers.common['x-deployment-id'] = common;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
}

if (mode) {
  exerciseAnonymousVerification().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  test('anonymous OTP verification retains its compiled producer without staff or applicant authentication', () => {
    for (const childMode of ['new', 'legacy', 'conflict']) {
      const env: NodeJS.ProcessEnv = { ...process.env, NEXT_PUBLIC_API_URL: 'https://isolated.invalid/api' };
      if (childMode === 'legacy') delete env.NEXT_PUBLIC_BROWSER_BUILD_ID;
      else env.NEXT_PUBLIC_BROWSER_BUILD_ID = 'erp_otp_identity_20261019';
      const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), childMode], { env, encoding: 'utf8' });
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, JSON.stringify({ childMode, stdout: result.stdout, stderr: result.stderr }));
    }
  });
}
