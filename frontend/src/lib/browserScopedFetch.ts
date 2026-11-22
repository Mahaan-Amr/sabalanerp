import { API_ORIGIN, browserSessionContinuation } from './api';
import { bindBrowserBuildRequestIdentity } from './browserBuildRequestIdentity';

/** Native-response adapter for authenticated browser downloads/JSON. Public
 * verification and the localhost hardware connector use their own transports.
 * No retries: a lost mutation response remains an ambiguous business outcome. */
export async function browserScopedFetch(url: string, init: RequestInit = {}): Promise<Pick<Response, 'json' | 'blob' | 'status' | 'ok' | 'headers'>> {
  if (typeof window === 'undefined') return fetch(url, init);
  const target = new URL(url, window.location.origin);
  const expectedOrigin = new URL(API_ORIGIN || window.location.origin, window.location.origin).origin;
  if (target.origin !== expectedOrigin || target.username || target.password) throw new Error('PRIVATE_FETCH_ORIGIN_INVALID');
  const headers = new Headers(init.headers);
  bindBrowserBuildRequestIdentity(headers);
  const lease = await browserSessionContinuation.acquire();
  for (const [key, value] of [['x-sabalan-expected-user', lease.userId], ['x-sabalan-expected-session', lease.sessionId]]) {
    if (headers.has(key) && headers.get(key) !== value) throw new Error('PRIVATE_FETCH_SCOPE_CONFLICT');
    headers.set(key, value);
  }
  const response = await fetch(url, { ...init, credentials: 'include', headers });
  if (response.status === 401) browserSessionContinuation.invalidate(lease);
  browserSessionContinuation.assertCurrent(lease);
  return { status: response.status, ok: response.ok, headers: response.headers,
    json: async () => { const body = await response.json(); browserSessionContinuation.assertCurrent(lease); return body; },
    blob: async () => { const body = await response.blob(); browserSessionContinuation.assertCurrent(lease); return body; } };
}
