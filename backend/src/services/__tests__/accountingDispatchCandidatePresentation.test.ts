import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAccountingDispatchCandidateSummary } from '../accountingDispatchCandidatePresentation';

test('projects a readable internal-driver summary from immutable allocation evidence', () => {
  assert.deepEqual(projectAccountingDispatchCandidateSummary({
    loading: { number: 'L-20260920-0001' },
    queueTurn: {
      driverSource: 'INTERNAL',
      admissionSnapshot: {
        driver: { firstName: 'ماهان', lastName: 'امیریان' },
        plate: { plate: 'CUT-c843c6ba' },
      },
    },
  }), {
    driverName: 'ماهان امیریان',
    driverSource: 'INTERNAL',
    loadingNumber: 'L-20260920-0001',
    plate: 'CUT-c843c6ba',
  });
});

test('fails closed for malformed snapshots without leaking the source object', () => {
  assert.deepEqual(projectAccountingDispatchCandidateSummary({ unexpected: 'secret' }), {
    driverName: null,
    driverSource: null,
    loadingNumber: null,
    plate: null,
  });
});
