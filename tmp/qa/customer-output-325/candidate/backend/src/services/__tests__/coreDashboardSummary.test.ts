import assert from 'node:assert/strict';
import { summarizeCoreDashboard } from '../coreDashboardSummary';

const contracts = [
  { id: 'signed', status: 'SIGNED', customerId: 'customer-1', createdAt: new Date('2026-01-07T10:00:00Z') },
  { id: 'printed', status: 'PRINTED', customerId: 'customer-2', createdAt: new Date('2026-01-06T10:00:00Z') },
  { id: 'cancelled', status: 'CANCELLED', customerId: 'customer-3', createdAt: new Date('2026-01-05T10:00:00Z') },
  { id: 'expired', status: 'EXPIRED', customerId: 'customer-4', createdAt: new Date('2026-01-04T10:00:00Z') },
  { id: 'draft', status: 'DRAFT', customerId: 'customer-5', createdAt: new Date('2026-01-03T10:00:00Z') },
  { id: 'approved', status: 'APPROVED', customerId: 'customer-6', createdAt: new Date('2026-01-02T10:00:00Z') },
  { id: 'pending', status: 'PENDING_APPROVAL', customerId: 'customer-7', createdAt: new Date('2026-01-01T10:00:00Z') },
];

const summary = summarizeCoreDashboard({
  contracts,
  totalCustomers: 9,
  realizedSales: { total: 280, average: 140, successRate: 50, realizedContracts: 2 },
});

assert.deepEqual(summary.contracts, {
  total: 7,
  pending: 1,
  signed: 1,
  draft: 1,
  approved: 1,
  printed: 1,
  cancelled: 1,
  expired: 1,
});
assert.equal(summary.customers.total, 9);
assert.deepEqual(summary.realizedSales, {
  total: 280,
  average: 140,
  successRate: 50,
  realizedContracts: 2,
});

const empty = summarizeCoreDashboard({
  contracts: [],
  totalCustomers: 0,
  realizedSales: { total: 0, average: null, successRate: null, realizedContracts: 0 },
});
assert.deepEqual(empty.realizedSales, {
  total: 0,
  average: null,
  successRate: null,
  realizedContracts: 0,
});

console.log('core dashboard summary tests passed');
