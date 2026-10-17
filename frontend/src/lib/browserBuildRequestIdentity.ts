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
