import assert from 'node:assert/strict';
import { assertWorkScheduleAction } from '../hrWorkScheduleGovernance';

assert.doesNotThrow(() => assertWorkScheduleAction('PROPOSE', { isResponsibleSupervisor: true }));
assert.throws(() => assertWorkScheduleAction('PROPOSE', { isResponsibleSupervisor: false }), /سرپرست/);
assert.doesNotThrow(() => assertWorkScheduleAction('PREPARE', { hasHrProcessor: true, status: 'PROPOSED' }));
assert.doesNotThrow(() => assertWorkScheduleAction('SUBMIT', { hasHrProcessor: true, status: 'DRAFT', actorId: 'processor' }));
assert.throws(
  () => assertWorkScheduleAction('APPROVE', { hasHrManager: true, status: 'SUBMITTED', actorId: 'processor', preparedBy: 'processor' }),
  /دیگری/
);
assert.doesNotThrow(() => assertWorkScheduleAction('APPROVE', { hasHrManager: true, status: 'SUBMITTED', actorId: 'manager', preparedBy: 'processor' }));
assert.throws(() => assertWorkScheduleAction('RETURN', { hasHrManager: true, status: 'SUBMITTED', returnReason: '' }), /دلیل/);

console.log('HR work-schedule governance tests passed.');
