import assert from 'node:assert/strict';
import { evaluatePerformanceRetention, PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';

const decision = evaluatePerformanceRetention({
  policy: PERFORMANCE_RETENTION_SCHEDULE_V1, classification: 'ACCEPTED_EVIDENCE',
  relationshipEndedAt: new Date('2018-01-01Z'), closedAt: new Date('2017-01-01Z'),
  now: new Date('2026-09-05Z'), dependencies: [], legalHold: false,
});
assert.equal(decision.state, 'ELIGIBLE');
assert.equal(decision.deleteAfter?.toISOString(), '2025-01-01T00:00:00.000Z');
assert.equal(evaluatePerformanceRetention({
  policy: PERFORMANCE_RETENTION_SCHEDULE_V1, classification: 'ACCEPTED_EVIDENCE',
  relationshipEndedAt: null, now: new Date('2026-09-05Z'), dependencies: [], legalHold: false,
}).state, 'REQUIRES_RETENTION_DECISION');
console.log('Performance retention tests passed.');

const base = { policy: PERFORMANCE_RETENTION_SCHEDULE_V1, classification: 'ACCEPTED_EVIDENCE',
  relationshipEndedAt: new Date('2018-01-01Z'), now: new Date('2026-09-05Z'), dependencies: [], legalHold: false };
assert.equal(evaluatePerformanceRetention({ ...base, legalHold: true }).state, 'LEGAL_HOLD');
assert.equal(evaluatePerformanceRetention({ ...base, policy: { schemaVersion: 99 } }).state, 'REQUIRES_RETENTION_DECISION');
assert.equal(evaluatePerformanceRetention({ ...base, dependencies: [{ closedAt: null }] }).state, 'DEPENDENCY_OPEN');
assert.equal(evaluatePerformanceRetention({ ...base, dependencies: [{ closedAt: new Date('2026-01-01Z') }] }).deleteAfter?.toISOString(), '2033-01-01T00:00:00.000Z');
assert.equal(evaluatePerformanceRetention({ ...base, classification: 'DRAFT', closedAt: new Date('2026-07-01Z') }).deleteAfter?.toISOString(), '2026-09-29T00:00:00.000Z');
assert.equal(evaluatePerformanceRetention({ ...base, classification: 'REJECTED_EVIDENCE', closedAt: new Date('2024-02-29Z') }).deleteAfter?.toISOString(), '2026-02-28T00:00:00.000Z');
assert.equal(evaluatePerformanceRetention({ ...base, classification: 'EXPORT_FILE', createdAt: new Date('2026-09-05T10:00:00Z'), downloadedAt: new Date('2026-09-05T10:05:00Z'), now: new Date('2026-09-05T10:06:00Z') }).state, 'ELIGIBLE');
assert.equal(evaluatePerformanceRetention({ ...base, classification: 'PUBLISHED_POLICY' }).state, 'PERMANENT_POLICY_TEXT');
assert.equal(evaluatePerformanceRetention({ ...base, classification: 'ANONYMOUS_ANALYTICS', anonymityVerified: false }).state, 'REQUIRES_RETENTION_DECISION');
assert.equal(evaluatePerformanceRetention({ ...base, classification: 'SERVER_LOG', createdAt: new Date('invalid') }).state, 'REQUIRES_RETENTION_DECISION');
