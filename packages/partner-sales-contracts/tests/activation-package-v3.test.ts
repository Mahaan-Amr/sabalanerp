import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PartnerActivationCommandV3Schema,
  PartnerActivationReceiptV3Schema,
  PartnerActivationViewV3Schema,
} from '@sabalanerp/partner-sales-contracts';

const hash = `sha256-v1:${'a'.repeat(64)}`;
const idempotency = (operation: string, targetId: string) => ({
  actorId: 'admin-user', operation, targetId, key: `${operation.toLowerCase()}-key`, payloadHash: hash,
});

test('activation v3 commands keep release, bootstrap and activation evidence strict', () => {
  const publication = {
    schemaVersion: 3, type: 'RELEASE_READINESS_PUBLISH', commandId: 'command-publish',
    correlationId: 'correlation-publish', reason: 'انتشار شواهد معتبر آمادگی فروش همکار',
    verifiedPackageId: 'verified-package', expectedControlRevision: 1,
    idempotency: idempotency('RELEASE_READINESS_PUBLISH', 'verified-package'),
  };
  assert.equal(PartnerActivationCommandV3Schema.safeParse(publication).success, true);
  assert.equal(PartnerActivationCommandV3Schema.safeParse({ ...publication, ready: true }).success, false);

  const bootstrap = {
    schemaVersion: 3, type: 'PROFILE_BOOTSTRAP', commandId: 'command-bootstrap',
    correlationId: 'correlation-bootstrap', reason: 'آماده‌سازی حساب فریبا برای فروش همکار',
    userId: 'fariba-user', expectedControlRevision: 2, cohortId: 'partner-cohort', cohortName: 'فروشندگان همکار تأییدشده',
    identityEvidenceId: 'verified-fariba-identity',
    commercialTermsPolicyId: 'commercial-policy', creditTermsPolicyId: 'credit-policy', responderId: 'yaghoobi-user',
    idempotency: idempotency('PROFILE_BOOTSTRAP', 'fariba-user'),
  };
  assert.equal(PartnerActivationCommandV3Schema.safeParse(bootstrap).success, true);
  assert.equal(PartnerActivationCommandV3Schema.safeParse({ ...bootstrap, identityEvidenceId: undefined }).success, false);

  const activation = {
    schemaVersion: 3, type: 'PROFILE_ACTIVATE', commandId: 'command-activate',
    correlationId: 'correlation-activate', reason: 'فعال‌سازی نهایی فروشنده همکار',
    profileId: 'fariba-profile', expectedProfileRevision: 6, expectedControlRevision: 4,
    idempotency: idempotency('PROFILE_ACTIVATE', 'fariba-profile'),
  };
  assert.equal(PartnerActivationCommandV3Schema.safeParse(activation).success, true);
  assert.equal(PartnerActivationCommandV3Schema.safeParse({ ...activation,
    activationBundleId: 'caller-authored-bundle', activationBundleHash: hash }).success, false);
  assert.equal(PartnerActivationCommandV3Schema.safeParse({ ...activation,
    idempotency: idempotency('PROFILE_ACTIVATE', 'another-profile') }).success, false);
});

test('activation view exposes current gates while the server compiles the bundle atomically on activation', () => {
  const view = {
    schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', actorId: 'admin-user',
    release: { controlRevision: 4, status: 'READY', publicationId: 'publication-1',
      releaseId: 'release-1', expiresAt: '2026-09-10T00:00:00.000Z', actions: [] },
    cohort: { id: 'partner-cohort', name: 'فروشندگان همکار تأییدشده', enrollmentOpen: true, operationsOpen: false },
    subject: { userId: 'fariba-user', displayName: 'فریبا پورشهید',
      profileId: 'fariba-profile', profileRevision: 6,
      gates: [{ id: 'IDENTITY', label: 'تأیید هویت', ready: true }],
      actions: [{ action: 'PROFILE_ACTIVATE', enabled: true }] },
    candidates: [{ userId: 'fariba-user', displayName: 'فریبا پورشهید' }],
    identityEvidence: [{ id: 'verified-fariba-identity', label: 'فریبا پورشهید', personType: 'NATURAL' }],
    commercialTerms: [{ id: 'commercial-policy', label: 'شرایط استاندارد فروش همکار' }],
    creditTerms: [{ id: 'credit-policy', label: 'پرداخت نقدی فروش همکار' }],
    responders: [{ id: 'yaghoobi-user', label: 'محمد یعقوبی' }],
  };
  assert.equal(PartnerActivationViewV3Schema.safeParse(view).success, true);
  assert.equal(PartnerActivationViewV3Schema.safeParse({ ...view, subject: {
    ...view.subject, activationBundleId: 'leaked-server-bundle' } }).success, false);
  assert.equal(PartnerActivationViewV3Schema.safeParse({ ...view, subject: {
    ...view.subject, profileRevision: undefined } }).success, false);
});

test('activation receipt is versioned and rejects hidden extra state', () => {
  const receipt = { schemaVersion: 3, commandId: 'command-activate', replayed: false,
    userId: 'fariba-user', profileId: 'fariba-profile', cohortId: 'partner-cohort',
    profileRevision: 7, controlRevision: 5, eventIds: ['profile-event', 'membership-event'] };
  assert.equal(PartnerActivationReceiptV3Schema.safeParse(receipt).success, true);
  assert.equal(PartnerActivationReceiptV3Schema.safeParse({ ...receipt, gateEvidenceIds: ['secret'] }).success, false);
});
