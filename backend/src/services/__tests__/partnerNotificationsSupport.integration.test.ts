import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createPartnerSupportDutyAdapter } from '../crossWorkspaceDutyAdapters/partnerSupportDutyAdapter';
import { partnerNotificationsTestDatabaseUrl } from './partnerNotificationsTestDatabase';

const load = createRequire(resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const contract: typeof import('../../../../packages/partner-sales-contracts') = load('@sabalanerp/partner-sales-contracts');

test('one unavailable responder episode creates one tracked support task across retries and workers', async () => {
  const database = new PrismaClient({ datasources: { db: { url: partnerNotificationsTestDatabaseUrl() } } });
  const prefix = `partner-support-327-${randomUUID()}`;
  let userId = '';
  try {
    const user = await database.user.create({ data: {
      email: `${prefix}@example.invalid`, username: prefix, password: 'not-a-login-secret',
      firstName: 'Support', lastName: 'Fixture',
    } });
    userId = user.id;
    let unavailable = true;
    const adapter = createPartnerSupportDutyAdapter(contract, database, {
      async lockUnavailable() { return unavailable ? {
        inquiryId: prefix, assignmentRevision: 3, reporterUserId: userId, handlerUserIds: [],
      } : null; },
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => adapter.ensureUnavailable(prefix)));
    assert.ok(results.every(result => result.ok));
    assert.equal(new Set(results.map(result => result.ok && result.value?.referenceCode)).size, 1);
    const tickets = await database.supportTicket.findMany({ where: { reporterId: userId }, include: { auditEvents: true } });
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].auditEvents.length, 1);
    assert.equal(tickets[0].title, 'تعیین پاسخ‌دهنده استعلام');
    assert.equal(tickets[0].type, 'ACCESS_PROBLEM');
    assert.equal(JSON.stringify(tickets[0].diagnosticSnapshot).includes(prefix), false);
    assert.equal(await database.notification.count({ where: { userId } }), 0);
    unavailable = false;
    assert.deepEqual(await adapter.ensureUnavailable(prefix), { ok: true, value: null });
    assert.equal(await database.supportTicket.count({ where: { reporterId: userId } }), 1);
  } finally {
    if (userId) {
      await database.supportTicket.deleteMany({ where: { reporterId: userId } });
      await database.user.delete({ where: { id: userId } });
    }
    await database.$disconnect();
  }
});
