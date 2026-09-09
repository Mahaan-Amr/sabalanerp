import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { canAccessPerformanceOperationalAlert } from '../performanceOperationalNotificationAccess';

test('operational alerts follow current explicit ownership, never ADMIN or workspace inheritance', async () => {
  let recipient = 'non-admin';
  let active = true;
  let incidentExists = true;
  let routeExists = true;
  const database = {
    user: { findUnique: async () => ({ isActive: active }) },
    performanceOperationalIncident: { findUnique: async () => incidentExists ? { routeKey: 'SYSTEM_OWNER' } : null },
    performanceOperationalRoute: { findUnique: async () => routeExists ? { recipientUserId: recipient } : null },
  } as unknown as Prisma.TransactionClient;
  const event = { resourceType: 'PERFORMANCE_OPERATIONAL_INCIDENT', resourceId: 'incident' };
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'non-admin', event), true);
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'admin', event), false);
  recipient = 'admin';
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'non-admin', event), false);
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'admin', event), true);
  recipient = 'replacement';
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'admin', event), false);
  active = false;
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'replacement', event), false);
  active = true; routeExists = false;
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'replacement', event), false);
  routeExists = true; incidentExists = false;
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'replacement', event), false);
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'replacement', null), false);
  assert.equal(await canAccessPerformanceOperationalAlert(database, 'replacement', { ...event, resourceType: 'OTHER' }), false);
});

test('infrastructure failures propagate rather than inventing authorization', async () => {
  const failure = new Error('database unavailable');
  const database = {
    user: { findUnique: async () => { throw failure; } },
    performanceOperationalIncident: { findUnique: async () => null },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => canAccessPerformanceOperationalAlert(database, 'owner', {
    resourceType: 'PERFORMANCE_OPERATIONAL_INCIDENT', resourceId: 'incident',
  }), error => error === failure);
});
