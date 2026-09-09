import assert from 'node:assert/strict';
import { assertDispatchDocumentsMigrationTarget } from './dispatchDocumentsTemporaryDatabase';

// Invoked only by the monitoring harness, after its committed race fixtures.
// Validate before importing runtime modules: their shared client must use the clone too.
const main = async () => {
  const databaseName = process.argv[2];
  assertDispatchDocumentsMigrationTarget(process.env.DATABASE_URL ?? '', databaseName);
  const { prisma } = await import('../../lib/prisma');
  try {
    const [{ name }] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(name, databaseName);
    const { filterCurrentlyAuthorizedNotifications } = await import('../notificationAuthorization');
    const route = await prisma.performanceOperationalRoute.findUniqueOrThrow({ where: { routeKey: 'SYSTEM_OWNER' } });
    const oldOwner = await prisma.user.findUniqueOrThrow({ where: { id: route.recipientUserId } });
    assert.equal(oldOwner.role, 'ADMIN');
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: oldOwner.id, type: 'PERFORMANCE_OPERATIONAL_ALERT' }, include: { event: true },
    });
    assert.equal(notification.actionUrl, '/dashboard/personal/notifications');
    assert.equal(notification.event?.feature, null);
    const visible = (user: typeof oldOwner) => filterCurrentlyAuthorizedNotifications(prisma, user, [notification]);
    assert.equal((await visible(oldOwner)).length, 1, 'the current designated ADMIN owner receives the alert');
    const newOwner = await prisma.user.create({ data: {
      email: `${databaseName}-owner@example.invalid`, username: `${databaseName}-owner`,
      password: 'not-used', firstName: 'Inbox', lastName: 'Owner', role: 'USER',
    } });
    await prisma.performanceOperationalRoute.update({ where: { routeKey: route.routeKey }, data: { recipientUserId: newOwner.id } });
    assert.equal((await visible(newOwner)).length, 1, 'a designated non-ADMIN owner passes the actual inbox filter without feature grants');
    assert.equal((await visible(oldOwner)).length, 0, 'reassignment revokes the old ADMIN owner despite the retained notification');
    const unrelatedAdmin = await prisma.user.create({ data: {
      email: `${databaseName}-admin@example.invalid`, username: `${databaseName}-admin`,
      password: 'not-used', firstName: 'Unrelated', lastName: 'Admin', role: 'ADMIN',
    } });
    assert.equal((await visible(unrelatedAdmin)).length, 0, 'unrelated ADMIN cannot bypass incident ownership');
    await prisma.user.update({ where: { id: newOwner.id }, data: { isActive: false } });
    assert.equal((await visible(newOwner)).length, 0, 'an inactive route recipient is denied even with a stale active caller');
    await prisma.user.update({ where: { id: newOwner.id }, data: { isActive: true } });
    await prisma.performanceOperationalRoute.delete({ where: { routeKey: route.routeKey } });
    assert.equal((await visible(newOwner)).length, 0, 'a deleted incident route denies access');
    console.log('PASS operational inbox: current non-ADMIN owner, unrelated ADMIN denial, reassignment revocation, inactive recipient and deleted route');
  } finally {
    await prisma.$disconnect();
  }
};

void main();
