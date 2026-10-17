import assert from 'node:assert/strict';
import test from 'node:test';
import {AxiosHeaders} from 'axios';
import {bindBrowserBuildRequestIdentity} from './browserBuildRequestIdentity';

test('native and Axios transports retain the compiled producer identity and reject substitution', () => {
  const expected = process.env.NEXT_PUBLIC_BROWSER_BUILD_ID || null;
  for (const headers of [new Headers(), new AxiosHeaders()]) {
    bindBrowserBuildRequestIdentity(headers);
    assert.equal(headers.get('x-deployment-id') ?? null, expected);
    bindBrowserBuildRequestIdentity(headers);
    headers.set('x-deployment-id', 'erp_conflicting_caller_identity');
    assert.throws(() => bindBrowserBuildRequestIdentity(headers), {code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT'});
  }
});
