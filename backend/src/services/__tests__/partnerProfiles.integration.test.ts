import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPrismaPartnerProfileStore } from '../partnerSales/profiles/prismaStore';

function localDatabase() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local DB required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

test('Prisma profile gates re-read current identity, terms, responder, cohort and incompatible authority', async () => {
  const database = localDatabase();
  const rollback = new Error('rollback partner profile fixture');
  try {
    await database.$transaction(async tx => {
      const prefix = `partner-profile-${randomUUID()}`;
      const ids = { partner: `${prefix}-partner`, responder: `${prefix}-responder`, actor: `${prefix}-actor`,
        profile: `${prefix}-profile`, account: `${prefix}-account`, cohort: `${prefix}-cohort` };
      await tx.user.createMany({ data: [ids.partner, ids.responder, ids.actor].map(id => ({ id, username: id,
        email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Profile', lastName: 'Fixture',
        ...(id === ids.responder ? { role: 'ADMIN' as const } : {}) })) });
      await tx.partnerProfile.create({ data: { id: ids.profile, userId: ids.partner } });
      await tx.partnerIdentityEvidence.create({ data: { id: `${prefix}-evidence`, userId: ids.partner,
        legalName: 'فروشنده همکار تست', personType: 'NATURAL', identifiers: { fixture: true },
        phone: '+989120000000', address: 'تهران، نشانی تست', integrityHash: `sha256-v1:${'1'.repeat(64)}`,
        issuedBy: ids.actor } });
      await tx.partnerTermsPolicy.createMany({ data: [
        { id: `${prefix}-commercial-policy`, purpose: 'PARTNER_TECHNICAL_PRICING', label: 'شرایط تجاری تست',
          effectiveDate: new Date('2026-01-01'), terms: { fixture: true }, integrityHash: `sha256-v1:${'2'.repeat(64)}`,
          issuedBy: ids.actor },
        { id: `${prefix}-credit-policy`, purpose: 'PARTNER_CREDIT_TERMS', label: 'شرایط اعتباری تست',
          effectiveDate: new Date('2026-01-01'), terms: { fixture: true }, integrityHash: `sha256-v1:${'3'.repeat(64)}`,
          issuedBy: ids.actor },
      ] });
      await tx.partnerCommercialAccount.create({ data: { id: ids.account, profileId: ids.profile } });
      await tx.partnerCommercialIdentity.create({ data: { id: `${prefix}-identity`, accountId: ids.account,
        version: 1, legalName: 'فروشنده همکار تست', identifiers: { evidenceId: `${prefix}-evidence` },
        phone: '+989120000000', address: 'تهران، نشانی تست', integrityHash: `sha256-v1:${'1'.repeat(64)}`,
        actorId: ids.actor } });
      await tx.partnerCommercialTerms.createMany({ data: [
        { id: `${prefix}-commercial`, accountId: ids.account, version: 1, effectiveDate: new Date('2026-01-01'),
          terms: { purpose: 'PARTNER_TECHNICAL_PRICING', policyId: `${prefix}-commercial-policy` }, integrityHash: `sha256-v1:${'2'.repeat(64)}`,
          actorId: ids.actor, reason: 'شرایط تجاری تست' },
        { id: `${prefix}-credit`, accountId: ids.account, version: 2, effectiveDate: new Date('2026-01-01'),
          terms: { purpose: 'PARTNER_CREDIT_TERMS', policyId: `${prefix}-credit-policy` }, integrityHash: `sha256-v1:${'3'.repeat(64)}`,
          actorId: ids.actor, reason: 'شرایط اعتباری تست' },
      ] });
      await tx.partnerProfileResponderAssignment.create({ data: { id: `${prefix}-assignment`, profileId: ids.profile,
        revision: 1, responderId: ids.responder, actorId: ids.actor, reason: 'پاسخ‌دهنده تست', eligibilityEvidence: {} } });
      await tx.partnerReleaseCohort.create({ data: { id: ids.cohort, name: ids.cohort,
        activationEnabled: true, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerCohortMembership.create({ data: { id: `${prefix}-membership`, profileId: ids.profile,
        cohortId: ids.cohort, actorId: ids.actor, eligibilityEvidence: {} } });
      const store = createPrismaPartnerProfileStore(database);
      const profile = await store.lockProfile(tx, ids.profile);
      assert.ok(profile);
      const ready = await store.readActivationGates(tx, profile);
      assert.deepEqual(ready, { identityVerified: true, commercialTermsReady: true, creditTermsReady: true,
        responderReady: true, conversionCleared: true, cohortReady: true, userActive: true,
        conflictingInternalAuthority: false, evidenceIds: [`${prefix}-evidence`, `${prefix}-commercial-policy`,
          `${prefix}-credit-policy`, `${prefix}-assignment`, `${prefix}-membership`] });
      await tx.workspacePermission.create({ data: { userId: ids.partner, workspace: 'sales',
        permissionLevel: 'EDIT', grantedBy: ids.actor } });
      const staleUiMustLose = await store.readActivationGates(tx, profile);
      assert.equal(staleUiMustLose.conversionCleared, false);
      assert.equal(staleUiMustLose.conflictingInternalAuthority, true);
      await tx.workspacePermission.delete({ where: { userId_workspace: { userId: ids.partner, workspace: 'sales' } } });
      await tx.effectiveActionGrant.create({ data: { id: `${prefix}-future-grant`, principalKind: 'USER',
        principalId: ids.partner, subjectUserId: ids.partner, domain: 'SALES', action: 'CONTRACT_CREATE',
        rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'OWN', effect: 'ALLOW',
        effectiveFrom: new Date('2099-01-01'), grantedBy: ids.actor, reason: 'مجوز آینده تست',
        correlationId: `${prefix}-future-grant` } });
      assert.equal((await store.readActivationGates(tx, profile)).conversionCleared, false,
        'a future incompatible grant cannot wake up after irreversible conversion');
      await tx.effectiveActionGrant.update({ where: { id: `${prefix}-future-grant` }, data: {
        revokedAt: new Date(), revokedBy: ids.actor, revocationReason: 'پایان fixture آینده',
        revocationCorrelationId: `${prefix}-future-grant-revoked`,
      } });
      await tx.partnerCommercialTerms.create({ data: { id: `${prefix}-future-credit`, accountId: ids.account,
        version: 3, effectiveDate: new Date('2099-01-01'), terms: { purpose: 'PARTNER_CREDIT_TERMS' },
        integrityHash: `sha256-v1:${'4'.repeat(64)}`, actorId: ids.actor, reason: 'شرایط آینده تست' } });
      assert.equal((await store.readActivationGates(tx, profile)).evidenceIds.includes(`${prefix}-future-credit`), false,
        'future terms never replace the latest effective evidence');
      await tx.partnerReleaseCohort.update({ where: { id: ids.cohort }, data: { operationalPaused: true } });
      assert.equal((await store.readActivationGates(tx, profile)).cohortReady, false,
        'operational pause freezes activation');
      await tx.partnerProfile.update({ where: { id: ids.profile }, data: { irreversibleAt: new Date() } });
      await tx.$executeRawUnsafe('SAVEPOINT partner_persona_guard');
      await assert.rejects(tx.workspacePermission.create({ data: { userId: ids.partner, workspace: 'accounting',
        permissionLevel: 'EDIT', grantedBy: ids.actor } }), /irreversible Partner persona/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT partner_persona_guard');
      await tx.$executeRawUnsafe('SAVEPOINT partner_draft_guard');
      await assert.rejects(tx.salesContractEditSession.create({ data: { draftId: `${prefix}-draft`,
        ownerUserId: ids.partner, browserSessionId: `${prefix}-browser`, leaseToken: `${prefix}-lease`,
        schemaVersion: 1, baseRevision: 0 } }), /irreversible Partner persona/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT partner_draft_guard');
      await tx.partnerProfile.update({ where: { id: ids.profile }, data: { state: 'ACTIVE' } });
      const technicalSession = await tx.salesContractEditSession.create({ data: {
        draftId: `${prefix}-technical-draft`, ownerUserId: ids.partner, purpose: 'PARTNER_TECHNICAL',
        browserSessionId: `${prefix}-technical-browser`, leaseToken: `${prefix}-technical-lease`,
        schemaVersion: 1, baseRevision: 0,
      } });
      assert.equal(technicalSession.purpose, 'PARTNER_TECHNICAL',
        'an active Partner retains its owner-scoped technical recovery path');
      const mismatchedProtected = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM sales_contract_edit_sessions
        WHERE recovery->>'kind' = 'partner-technical-recovery'
          AND (purpose <> 'PARTNER_TECHNICAL' OR "contractId" IS NOT NULL)`;
      assert.equal(mismatchedProtected[0]?.count, 0n,
        'the upgrade invariant never strands a protected recovery as an ordinary draft');
      await tx.partnerProfile.update({ where: { id: ids.profile }, data: { state: 'SUSPENDED' } });
      await tx.$executeRawUnsafe('SAVEPOINT partner_suspended_draft_guard');
      await assert.rejects(tx.salesContractEditSession.update({ where: { id: technicalSession.id },
        data: { updatedAt: new Date() } }), /irreversible Partner persona/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT partner_suspended_draft_guard');
      await tx.partnerReleaseCohort.update({ where: { id: ids.cohort }, data: { operationalPaused: false } });
      const suspendedProfile = await store.lockProfile(tx, ids.profile);
      assert.ok(suspendedProfile);
      assert.equal((await store.readActivationGates(tx, suspendedProfile)).conversionCleared, true,
        'a frozen Partner technical recovery is preserved and does not block reactivation');
      const revokedAt = new Date();
      await tx.partnerIdentityEvidence.update({ where: { id: `${prefix}-evidence` }, data: { revokedAt } });
      await tx.partnerTermsPolicy.updateMany({ where: { id: { in: [`${prefix}-commercial-policy`, `${prefix}-credit-policy`] } },
        data: { revokedAt } });
      const revoked = await store.readActivationGates(tx, suspendedProfile);
      assert.equal(revoked.identityVerified, false);
      assert.equal(revoked.commercialTermsReady, false);
      assert.equal(revoked.creditTermsReady, false);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});
