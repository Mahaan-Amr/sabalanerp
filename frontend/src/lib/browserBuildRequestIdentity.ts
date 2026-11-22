// Next substitutes this value while compiling the immutable browser artifact.
// It identifies a request's producer; it never grants authentication or release
// admission. A legacy/unidentified build deliberately keeps its absent identity.
const buildId = process.env.NEXT_PUBLIC_BROWSER_BUILD_ID || null;
if (buildId !== null && !/^erp_[a-z0-9_-]{8,90}$/.test(buildId)) throw new Error('BROWSER_BUILD_REQUEST_IDENTITY_INVALID');

export function bindBrowserBuildRequestIdentity(headers: {
  get(name: string): unknown;
  set(name: string, value: string): unknown;
}) {
  const supplied = headers.get('x-deployment-id');
  if (supplied !== null && supplied !== undefined && supplied !== buildId) {
    throw Object.assign(new Error('هویت نسخهٔ این صفحه با درخواست مطابقت ندارد.'), {code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT'});
  }
  if (buildId !== null) headers.set('x-deployment-id', buildId);
}

/** Native image/media/download requests cannot set a producer header. Bind
 * only our configured backend's resource URLs, preserving every original query
 * byte (including signed tokens). This value grants no session or permission. */
export function bindBrowserBuildResourceUrl(value: string, backendOrigin: string): string {
  if (value.startsWith('//') || /^(?:data|blob):/i.test(value)) return value;
  const absolute = /^https?:\/\//i.test(value);
  let parsed: URL;
  try {
    parsed = new URL(value, 'https://sabalan-resource.invalid');
    if (absolute && (!backendOrigin || parsed.origin !== new URL(backendOrigin).origin)) return value;
  } catch { return value; }
  if (!['/api', '/files'].some(prefix => parsed.pathname === prefix || parsed.pathname.startsWith(prefix + '/'))) return value;
  const supplied = parsed.searchParams.getAll('__sabalan_build');
  if (supplied.length > 1 || (supplied.length === 1 && supplied[0] !== buildId)) {
    throw Object.assign(new Error('هویت نسخهٔ این صفحه با درخواست مطابقت ندارد.'), { code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT' });
  }
  if (supplied.length || buildId === null) return value;
  const hashAt = value.indexOf('#'), address = hashAt < 0 ? value : value.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : value.slice(hashAt);
  const separator = address.includes('?') ? '&' : '?';
  return address + separator + '__sabalan_build=' + encodeURIComponent(buildId) + fragment;
}
