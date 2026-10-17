import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

test('actual HTTP interceptors bind private clients, preserve the tab, and reject stale outcomes without replay', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const previousAdapter = axios.defaults.adapter, previousApi = process.env.NEXT_PUBLIC_API_URL;
  const previousBuild = process.env.NEXT_PUBLIC_BROWSER_BUILD_ID;
  const previousFetch = globalThis.fetch;
  let owner = 'owner_a', session = 'session_a', businessWrites = 0, redirects = 0, probes = 0;
  let anonymousBootstrap = false;
  let finishRead!: () => void, failLate!: () => void, failLogin!: () => void;
  const storage = new Map<string, string>();
  const browser = { location: { pathname: '/dashboard/test', origin: 'http://localhost:3101', replace() { redirects++; } },
    sessionStorage: {getItem: () => 'diagnostic-applicant-session'},
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key) } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'sessionStorage', {configurable: true, value: browser.sessionStorage});
  process.env.NEXT_PUBLIC_API_URL = '/api';
  process.env.NEXT_PUBLIC_BROWSER_BUILD_ID = 'erp_request_identity_20261017';
  const reply = (config: InternalAxiosRequestConfig, data: unknown, status = 200) => ({ data, status, statusText: String(status), headers: new AxiosHeaders(), config });
  const deny = (config: InternalAxiosRequestConfig, status = 401) => new AxiosError('denied', 'ERR_BAD_REQUEST', config, undefined,
    reply(config, { code: 'AUTH_CONTEXT_CHANGED', error: 'همان حساب قبلی' }, status));
  axios.defaults.adapter = async config => {
    assert.equal(config.headers.get('x-deployment-id'), 'erp_request_identity_20261017');
    if (String(config.baseURL).endsWith('/hr-hiring') && config.url?.startsWith('/public/')) {
      assert.equal(config.headers.Authorization, 'Bearer diagnostic-applicant-session');
      return reply(config, {success: true, data: {}});
    }
    if (String(config.baseURL).endsWith('/public')) {
      assert.equal(config.headers.get('x-sabalan-expected-user'), undefined);
      return reply(config, { success: true, data: {} });
    }
    if (config.url === '/auth/me') {
      probes++;
      if (anonymousBootstrap) throw deny(config);
      const expected = config.headers.get('x-sabalan-expected-user');
      if (expected && expected !== owner) throw deny(config);
      return reply(config, { success: true, data: { id: owner }, session: { id: session } });
    }
    if (config.url === '/auth/login') {
      const body = JSON.parse(config.data);
      assert.equal(body.expectedUserId, 'owner_a');
      if (body.password === 'delayed-invalid-password') return new Promise((_resolve, reject) => { failLogin = () => reject(deny(config)); });
      if (body.identifier !== 'owner_a') throw deny(config, 409);
      owner = 'owner_a'; session = 'session_recovered';
      return reply(config, { success: true, data: { user: { id: owner } }, session: { id: session } });
    }
    assert.equal(config.headers.get('x-sabalan-expected-user'), owner);
    assert.equal(config.headers.get('x-sabalan-expected-session'), session);
    if (config.url === '/qa-delayed-read') return new Promise(resolve => { finishRead = () => resolve(reply(config, { private: 'old result' })); });
    if (config.url === '/qa-late-denial') return new Promise((_resolve, reject) => { failLate = () => reject(deny(config)); });
    if (config.url === '/qa-denied') throw deny(config);
    if (config.method === 'post') businessWrites++;
    return reply(config, { success: true, data: [] });
  };
  try {
    const { default: api, authAPI, publicContractsAPI, browserSessionContinuation: scope } = await import('./api');
    const { hiringAPI, applicantHiringAPI } = await import('./hiringApi');
    anonymousBootstrap = true;
    for (const pathname of ['/', '/about', '/contact']) {
      browser.location.pathname = pathname; await assert.rejects(authAPI.getMe());
      assert.equal(redirects, 0, 'An anonymous public document must not be replaced by the login page');
    }
    browser.location.pathname = '/dashboard/test'; await assert.rejects(authAPI.getMe());
    assert.equal(redirects, 1, 'An anonymous private route still requires login');
    anonymousBootstrap = false; redirects = 0;
    await applicantHiringAPI.get();
    await assert.rejects(api.post('/qa-business', {unsaved: 'preserved'}, {headers: {'x-deployment-id': 'erp_other_request_identity'}}),
      {code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT'});
    assert.equal(businessWrites, 0);
    await api.post('/qa-business', { unsaved: 'preserved' }); assert.equal(businessWrites, 1);
    await hiringAPI.list(); assert.ok(probes >= 2);
    owner = 'owner_b'; session = 'session_b';
    await assert.rejects(api.post('/qa-business', { unsaved: 'preserved' }));
    assert.equal(scope.snapshot(), 'owner_a'); assert.equal(businessWrites, 1); assert.equal(redirects, 0);
    await publicContractsAPI.lookupConfirmationContract('public-contract', 'public-phone');
    await assert.rejects(authAPI.login('owner_b', 'valid-other-password'));
    assert.equal(owner, 'owner_b'); assert.equal(scope.snapshot(), 'owner_a');
    await authAPI.login('owner_a', 'valid-original-password');
    assert.equal(scope.snapshot(), null); assert.equal(businessWrites, 1, 'reauthentication never replays a business write');
    await api.post('/qa-business', { unsaved: 'preserved' }); assert.equal(businessWrites, 2);
    const delayed = api.get('/qa-delayed-read');
    while (!finishRead) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(api.get('/qa-denied'));
    finishRead(); await assert.rejects(delayed, { code: 'AUTH_CONTEXT_CHANGED' });
    await authAPI.login('owner_a', 'valid-original-password');
    const oldFailure = api.get('/qa-late-denial');
    while (!failLate) await new Promise(resolve => setTimeout(resolve, 1));
    await authAPI.login('owner_a', 'valid-original-password');
    failLate(); await assert.rejects(oldFailure);
    assert.equal(scope.snapshot(), null, 'an obsolete request cannot invalidate the recovered generation');
    const oldLogin = authAPI.login('owner_a', 'delayed-invalid-password');
    while (!failLogin) await new Promise(resolve => setTimeout(resolve, 1));
    await authAPI.login('owner_a', 'valid-original-password');
    failLogin(); await assert.rejects(oldLogin);
    assert.equal(scope.snapshot(), null, 'a late failed login cannot invalidate a newer successful login');
    assert.equal(redirects, 0);
    const { browserScopedFetch } = await import('./browserScopedFetch');
    let nativeCalls = 0, finishBody!: (body: unknown) => void;
    globalThis.fetch = (async (_url, init) => {
      nativeCalls++;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-deployment-id'), 'erp_request_identity_20261017');
      assert.equal(headers.get('x-sabalan-expected-user'), 'owner_a');
      assert.equal(headers.get('x-sabalan-expected-session'), 'session_recovered');
      return { status: 200, ok: true, headers: new Headers(), json: () => new Promise(resolve => { finishBody = resolve; }) } as Response;
    }) as typeof fetch;
    const native = await browserScopedFetch('/api/accounting/private-document');
    const body = native.json(); scope.invalidate(); finishBody({ private: 'obsolete document' });
    await assert.rejects(body, { code: 'AUTH_CONTEXT_CHANGED' });
    await assert.rejects(browserScopedFetch('https://foreign.example.invalid/private'), /ORIGIN_INVALID/);
    await assert.rejects(browserScopedFetch('/api/accounting/private-document', {headers: {'x-deployment-id': 'erp_other_request_identity'}}),
      {code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT'});
    assert.equal(nativeCalls, 1); scope.clear();
  } finally {
    globalThis.fetch = previousFetch;
    axios.defaults.adapter = previousAdapter;
    if (previousApi === undefined) delete process.env.NEXT_PUBLIC_API_URL; else process.env.NEXT_PUBLIC_API_URL = previousApi;
    if (previousBuild === undefined) delete process.env.NEXT_PUBLIC_BROWSER_BUILD_ID; else process.env.NEXT_PUBLIC_BROWSER_BUILD_ID = previousBuild;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', previousSessionStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
