import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mode = process.argv[2];
if (mode) {
  void import('./api').then(({ resolveBackendAssetUrl }) => {
    const build = process.env.NEXT_PUBLIC_BROWSER_BUILD_ID;
    for (const input of ['/files/uploads/images/photo.png', '/api/security/shift-log/attachments/example?inline=1',
      'https://isolated.invalid/files/private.pdf']) {
      const output = new URL(resolveBackendAssetUrl(input), 'https://isolated.invalid');
      assert.equal(output.searchParams.get('__sabalan_build'), build || null);
      assert.equal(output.pathname, new URL(input, 'https://isolated.invalid').pathname);
      if (input.includes('inline=1')) assert.equal(output.searchParams.get('inline'), '1');
      assert.equal(resolveBackendAssetUrl(output.href), output.href, 'binding is idempotent');
    }
    for (const input of ['data:image/png;base64,AAAA', 'https://cdn.invalid/photo.png?x=1', '//cdn.invalid/photo.png']) {
      assert.equal(resolveBackendAssetUrl(input), input, 'foreign and embedded resources retain their exact URL');
    }
    for (const raw of ['/files/a?', '/files/a?signature=a%2Bb&']) {
      assert.equal(resolveBackendAssetUrl(raw), build ? raw + '&__sabalan_build=' + build : raw);
    }
    const signed = '/files/a.pdf?signature=a%2Bb%20c&part=1#page=2';
    assert.equal(resolveBackendAssetUrl(signed), signed.replace('#', build ? '&__sabalan_build=' + build + '#' : '#'));
    assert.equal(resolveBackendAssetUrl('https://[bad/files/a.png'), 'https://[bad/files/a.png');
    if (build) assert.throws(() => resolveBackendAssetUrl('/files/a.png?__sabalan_build=erp_another_browser'),
      { code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT' });
    assert.throws(() => resolveBackendAssetUrl('/files/a.png?__sabalan_build=x&__sabalan_build=x'),
      { code: 'BROWSER_BUILD_REQUEST_IDENTITY_CONFLICT' });
  }).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  test('real backend resource URLs retain their compiled producer for images, media and downloads', () => {
    for (const childMode of ['identified', 'legacy']) {
      const env: NodeJS.ProcessEnv = { ...process.env, NEXT_PUBLIC_API_URL: 'https://isolated.invalid/api' };
      if (childMode === 'identified') env.NEXT_PUBLIC_BROWSER_BUILD_ID = 'erp_resource_identity_20261019';
      else delete env.NEXT_PUBLIC_BROWSER_BUILD_ID;
      const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), childMode],
        { env, encoding: 'utf8' });
      assert.equal(child.signal, null); assert.equal(child.status, 0, child.stdout + child.stderr);
    }
  });
}
