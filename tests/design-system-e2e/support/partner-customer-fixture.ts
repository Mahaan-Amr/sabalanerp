import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession } from '../../../backend/src/services/identitySessionService';
import { previewCustomerDeletion, deleteCustomerInTransaction } from '../../../backend/src/services/crmCustomerManagement';

/** Only the existing local Compose database. Auth tokens stay in memory. */
export async function createPartnerCustomerBrowserFixture() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local Compose database required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const owner = `qa-crm-owner-${randomUUID()}`;
  let customerId: string | undefined;
  try {
    const seeded = await db.$transaction(async tx => {
      const admin = await tx.user.findUniqueOrThrow({ where: { username: 'admin' }, select: { id: true } });
      await tx.user.create({ data: { id: owner, username: owner, email: `${owner}@example.invalid`, password: 'not-a-login', firstName: 'آزمون محلی', lastName: 'مالک مشتری', role: 'USER' } });
      await tx.partnerProfile.create({ data: { id: owner, userId: owner, state: 'ACTIVE' } });
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
    if (customerId) await db.user.update({ where: { id: owner }, data: { isActive: false } });
    await db.$disconnect(); throw error;
  }
}
