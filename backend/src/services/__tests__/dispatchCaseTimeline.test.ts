import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDispatchCaseTimeline } from '../dispatchCaseTimeline';

const events = [
  { id: 'later', station: 'ACCOUNTING', eventType: 'WAYBILL_ISSUED', occurredAt: '2026-08-07T10:02:00.000Z', actorId: 'accountant', detail: { phone: '09120000000' } },
  { id: 'first', station: 'GUARD', eventType: 'ADMITTED', occurredAt: '2026-08-07T10:00:00.000Z', actorId: 'guard', detail: { driverName: 'Driver One' } },
];

test('shared case timeline is chronological, read-only and strips protected values', () => {
  const result = projectDispatchCaseTimeline(events, { workspace: 'accounting', permission: 'edit' });
  assert.deepEqual(result.events.map((event) => event.id), ['first', 'later']);
  assert.equal(result.capabilities.canMutateTimeline, false);
  assert.equal('phone' in result.events[1].detail, false);
});

test('view-only timeline redacts actor and driver identity without hiding case state', () => {
  const result = projectDispatchCaseTimeline(events, { workspace: 'security', permission: 'view' });
  assert.equal(result.events[0].actorId, null);
  assert.equal(result.events[0].detail.driverName, undefined);
  assert.equal(result.events[0].eventType, 'ADMITTED');
});

test('view-only timeline recursively removes identity fields from nested evidence', () => {
  const projected = projectDispatchCaseTimeline([{
    id: 'nested', station: 'GUARD', eventType: 'AUDIT', occurredAt: '2026-08-08T10:00:00.000Z', actorId: 'actor-1',
    detail: { recordedBy: 'actor-2', national_code: '0012345678', snapshot: { driverName: 'Private Driver',
      nested: { personnelId: 'person-1', approvedBy: 'actor-3', guardActorId: 'actor-4', safeState: 'READY' } }, safeTopLevel: true },
  }], { workspace: 'security', permission: 'view' });
  assert.deepEqual(projected.events[0].detail, { snapshot: { nested: { safeState: 'READY' } }, safeTopLevel: true });
});
