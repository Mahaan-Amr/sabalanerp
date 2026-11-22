import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession } from '../../../backend/src/services/identitySessionService';
import { previewCustomerDeletion, deleteCustomerInTransaction } from '../../../backend/src/services/crmCustomerManagement';
import {sdsDatabaseScope,assertSdsDatabaseIdentity} from './sds-database-scope';

/** Only the existing local Compose database. Auth tokens stay in memory. */
export async function createPartnerCustomerBrowserFixture(options: { customerCreation?: boolean } = {}) {
  const scope=sdsDatabaseScope(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp');
  const {url}=scope;
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const owner = `qa-crm-owner-${randomUUID()}`;
  let customerId: string | undefined;
  try {
    await assertSdsDatabaseIdentity(db,scope);
    const seeded = await db.$transaction(async tx => {
      const admin = await tx.user.findUniqueOrThrow({ where: { username: scope.adminUsername }, select: { id: true } });
      await tx.user.create({ data: { id: owner, username: owner, email: `${owner}@example.invalid`, password: 'not-a-login', firstName: 'آزمون محلی', lastName: 'مالک مشتری', role: 'USER' } });
      await tx.partnerProfile.create({ data: { id: owner, userId: owner, state: 'ACTIVE' } });
      if (options.customerCreation) {
        // Model an already directly activated test Partner. Legacy profiles
        // without conversion evidence correctly remain outside contract entry.
        await tx.partnerConversionDisposition.create({ data: { profileId: owner,
          sourceType: 'PARTNER_ACTIVATION', sourceId: owner, disposition: 'DIRECT_V4', actorId: admin.id,
          evidence: { fixture: 'local-customer-activity-acceptance' } } });
      }
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${owner}, true)`;
      const customer = await tx.crmCustomer.create({ data: { firstName: 'آزمون محلی CRM', lastName: 'مشتری همکار', ownerUserId: owner, partnerOwnerProfileId: owner, partnerRevision: 1,
        phoneNumbers: { create: { number: '09129990001', type: 'mobile', isActive: true, isPrimary: true } } } });
      const session = await createAuthoritativeSession(tx, owner, { userAgent: 'Local Partner CRM acceptance' });
      return { adminId: admin.id, customerId: customer.id, token: session.token };
    });
    customerId = seeded.customerId;
    const cleanup = async () => {
      try {
        const preview = await previewCustomerDeletion(db, seeded.adminId, seeded.customerId);
        await db.$transaction(tx => deleteCustomerInTransaction(tx, { actorId: seeded.adminId, customerId: seeded.customerId,
          reason: 'پایان آزمون محلی CRM مشتری همکار', confirmed: true, previewToken: preview.previewToken }), { timeout: 30000 });
      } finally {
        try {
          await db.authSession.updateMany({ where: { userId: owner, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: 'Local CRM acceptance complete' } });
          await db.user.update({ where: { id: owner }, data: { isActive: false } });
        } finally { await db.$disconnect(); }
      }
    };
    return { ...seeded, cleanup };
  } catch (error) {
    // Keep any partially committed history identifiable; never remove audit evidence.
    const failures:unknown[]=[error];
    try {
      if (customerId) await db.user.update({ where: { id: owner }, data: { isActive: false } });
    } catch(cleanupError) { failures.push(cleanupError); }
    finally {
      try { await db.$disconnect(); } catch(disconnectError) { failures.push(disconnectError); }
    }
    if(failures.length>1)throw new AggregateError(failures,'Partner fixture failed; original and cleanup errors retained');
    throw error;
  }
}
