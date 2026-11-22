import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAccountingDispatchCandidateSummary, projectAccountingDispatchLines } from '../accountingDispatchCandidatePresentation';

test('projects a readable internal-driver summary from immutable allocation evidence', () => {
  assert.deepEqual(projectAccountingDispatchCandidateSummary({
    loading: { number: 'L-20260920-0001', customer: { name: 'محمد صابری' }, project: { name: 'صابری', address: 'کودیان' } },
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
    customerName: 'محمد صابری',
    projectName: 'صابری',
    projectAddress: 'کودیان',
  });
});

test('projects only frozen line identity and exact quantity', () => {
  assert.deepEqual(projectAccountingDispatchLines([{ snapshot: { contractNumber: '100313', productName: 'سنگ', privateValue: 'hidden' }, quantity: { toString: () => '1.23456789' }, unit: 'meter' }]), [
    { contractNumber: '100313', productName: 'سنگ', quantity: '1.23456789', unit: 'meter' },
  ]);
});

test('fails closed for malformed snapshots without leaking the source object', () => {
  assert.deepEqual(projectAccountingDispatchCandidateSummary({ unexpected: 'secret' }), {
    driverName: null,
    driverSource: null,
    loadingNumber: null,
    plate: null,
    customerName: null,
    projectName: null,
    projectAddress: null,
  });
});
