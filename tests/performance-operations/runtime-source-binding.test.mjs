import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertInquiryCheckoutMatchesGitlink } from '../../scripts/performance-source-identity.mjs';
import {
  capturePerformanceRuntimeSourceBinding,
  verifyPerformanceRuntimeSourceBinding,
} from '../../scripts/performance-runtime-source-binding.mjs';

const commit = 'a'.repeat(40);
const sourceHash = 'b'.repeat(64);
const image = (index) => `sha256:${String(index).repeat(64)}`;
const responses = new Map([
  ['sabalanerp-local-backend-1', image(1)],
  ['sabalanerp-local-frontend-1', image(2)],
  ['sabalanerp-local-inquiry-1', image(3)],
]);
const command = (_name, args) => {
  const container = args.at(-1);
  if (args[2] === '{{.Image}}') return responses.get(container);
  if (args[2].includes('source-commit')) return commit;
  if (args[2].includes('source-hash')) return sourceHash;
  throw new Error(`Unexpected command: ${args.join(' ')}`);
};

test('inquiry checkout must be clean and exactly match the recorded gitlink', () => {
  assert.equal(assertInquiryCheckoutMatchesGitlink({ recordedCommit: commit, checkoutCommit: commit, checkoutStatus: '' }), commit);
  assert.throws(() => assertInquiryCheckoutMatchesGitlink({ recordedCommit: commit, checkoutCommit: 'c'.repeat(40), checkoutStatus: '' }),
    /INQUIRY_CHECKOUT_COMMIT_MISMATCH/);
  assert.throws(() => assertInquiryCheckoutMatchesGitlink({ recordedCommit: commit, checkoutCommit: commit, checkoutStatus: ' M app/page.tsx' }),
    /INQUIRY_CHECKOUT_DIRTY/);
});

test('runtime proof binds live immutable image identities as well as labels', () => {
  const proof = capturePerformanceRuntimeSourceBinding({ commit, sourceHash, command });
  assert.equal(proof.runtimeSourceBinding.status, 'LIVE_IMAGE_IDENTITIES_MATCH_SOURCE');
  assert.doesNotThrow(() => verifyPerformanceRuntimeSourceBinding(proof, { commit, sourceHash, command }));
  assert.throws(() => verifyPerformanceRuntimeSourceBinding({ ...proof, images: { ...proof.images, frontend: image(9) } },
    { commit, sourceHash, command }), /RUNTIME_SOURCE_BINDING_CHANGED/);
});

test('frontend production image carries source labels on the final runtime stage', async () => {
  const dockerfile = await readFile(new URL('../../frontend/Dockerfile', import.meta.url), 'utf8');
  const runner = dockerfile.slice(dockerfile.indexOf('FROM node:20-alpine AS runner'));
  assert.match(runner, /ARG PERFORMANCE_SOURCE_COMMIT=unattested/);
  assert.match(runner, /LABEL io\.sabalan\.performance\.source-commit=\$PERFORMANCE_SOURCE_COMMIT/);
  assert.match(runner, /io\.sabalan\.performance\.source-hash=\$PERFORMANCE_SOURCE_HASH/);
});
