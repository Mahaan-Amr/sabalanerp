import assert from 'node:assert/strict';
import { buildBiAnalysisPage } from '../biAnalysisService';

const rows = [
  { id: '1', contractNumber: '100', customer: 'آلفا', status: 'APPROVED', amount: 200, createdAt: '2026-01-01' },
  { id: '2', contractNumber: '200', customer: 'بتا', status: 'SIGNED', amount: 500, createdAt: '2026-02-01' },
  { id: '3', contractNumber: '300', customer: 'آلفا', status: 'PENDING_APPROVAL', amount: 100, createdAt: '2026-03-01' },
];

assert.deepEqual(
  buildBiAnalysisPage({ rows, view: 'pipeline', search: 'آلفا', sort: 'amount', direction: 'desc', page: 1, pageSize: 1 }),
  { rows: [rows[0]], page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
);

console.log('biAnalysisService tests passed');
