import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalGoPayload, verifyCustomerAllocationGoManifest } from '../../deploy/scripts/lib/customer-allocation-go-manifest.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const h = c => c.repeat(64);
const observed = {
  releaseId: 'release-456', deploymentId: 'deployment-456', candidateCommit: 'a'.repeat(40),
  candidateTree: 'b'.repeat(40), inquiryCommit: 'c'.repeat(40), migrationSha256: h('d'),
  candidateImages: { backend: `sha256:${h('1')}`, frontend: `sha256:${h('2')}`, inquiry: `sha256:${h('3')}` },
  predecessorImages: { backend: `sha256:${h('4')}`, frontend: `sha256:${h('5')}`, inquiry: `sha256:${h('6')}` },
  cohortSha256: h('e'), evidence: { reader: h('7'), populatedQa: h('8'), rollback: h('9') },
  controlState: 'CLOSED', phase: 'MIGRATIONS_APPLIED', activeKey: 'production', leaseToken: 'lease-456',
  targetCommit: 'a'.repeat(40),
  leaseExpiresAt: '2026-11-16T12:03:00.000Z', dbClock: '2026-11-16T12:00:00.000Z',
};
const payload = () => ({ schemaVersion: 1, decision: 'GO', operation: 'GROUPED_ALLOCATION',
  keyId: 'independent-approver-1', issuedAt: '2026-11-16T11:59:00.000Z', expiresAt: '2026-11-16T12:01:00.000Z',
  releaseId: observed.releaseId, deploymentId: observed.deploymentId, candidateCommit: observed.candidateCommit,
  candidateTree: observed.candidateTree, inquiryCommit: observed.inquiryCommit, migrationSha256: observed.migrationSha256,
  candidateImages: observed.candidateImages, predecessorImages: observed.predecessorImages,
  cohortSha256: observed.cohortSha256, evidence: observed.evidence });
const envelope = p => ({ payload: p, signature: sign(null, Buffer.from(canonicalGoPayload(p)), privateKey).toString('base64') });
const verify = (signed, context = observed) => verifyCustomerAllocationGoManifest(signed, context,
  { keyId: 'independent-approver-1', publicKey });

test('exact signed and fresh protected decision verifies', () => {
  assert.equal(verify(envelope(payload())).manifestSha256.length, 64);
});

test('unsigned, changed, stale, and mismatched decisions fail closed', () => {
  const valid = payload();
  const cases = [
    [{ payload: valid }, observed],
    [{ ...envelope(valid), payload: { ...valid, decision: 'NO_GO' } }, observed],
    [envelope({ ...valid, expiresAt: '2026-11-16T11:59:59.000Z' }), observed],
    [envelope({ ...valid, candidateImages: { ...valid.candidateImages, backend: `sha256:${h('f')}` } }), observed],
    [envelope({ ...valid, predecessorImages: { ...valid.predecessorImages, inquiry: `sha256:${h('f')}` } }), observed],
    [envelope({ ...valid, candidateImages: { backend: valid.candidateImages.backend } }),
      { ...observed, candidateImages: { backend: observed.candidateImages.backend } }],
    [envelope({ ...valid, predecessorImages: { backend: valid.predecessorImages.backend } }),
      { ...observed, predecessorImages: { backend: observed.predecessorImages.backend } }],
    [envelope({ ...valid, evidence: { ...valid.evidence, rollback: h('f') } }), observed],
    [envelope(valid), { ...observed, phase: 'RELEASE_STARTED' }],
    [envelope(valid), { ...observed, leaseExpiresAt: observed.dbClock }],
    [envelope(valid), { ...observed, targetCommit: 'f'.repeat(40) }],
    [envelope({ ...valid, cohortSha256: h('f') }), observed],
    [envelope({ ...valid, migrationSha256: h('f') }), observed],
    [envelope({ ...valid, issuedAt: '2026-11-16T12:01:00.000Z' }), observed],
    [envelope({ ...valid, expiresAt: '2026-11-16T12:10:00.000Z' }), observed],
    [envelope(valid), { ...observed, controlState: 'ACTIVE' }],
  ];
  for (const [signed, context] of cases) assert.throws(() => verify(signed, context), /CUSTOMER_ALLOCATION_GO_REJECTED/);
});

test('approval requires the independent Ed25519 key and exact key identity', () => {
  const signed = envelope(payload());
  const unrelated = generateKeyPairSync('ed25519');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const trusted of [
    { keyId: 'other-approver', publicKey },
    { keyId: 'independent-approver-1', publicKey: unrelated.publicKey },
    { keyId: 'independent-approver-1', publicKey: rsa.publicKey },
  ]) assert.throws(() => verifyCustomerAllocationGoManifest(signed, observed, trusted), /CUSTOMER_ALLOCATION_GO_REJECTED/);
});
