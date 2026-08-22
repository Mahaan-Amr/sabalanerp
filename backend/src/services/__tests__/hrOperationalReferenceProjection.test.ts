import assert from 'node:assert/strict';
import { projectHrOperationalReference } from '../hrOperationalReferenceProjection';

const positions = [
  {
    id: 'position-active',
    title: 'کارشناس منابع انسانی',
    isActive: true,
    vacancy: 2,
    organizationalUnit: { id: 'unit-secret', title: 'واحد محرمانه' },
    costCenter: { id: 'cost-secret', title: 'مرکز هزینه محرمانه' },
    lifecycle: [{ id: 'history-secret' }],
    capacityBreakdown: { capacity: 5, inUse: 3 },
  },
  {
    id: 'position-inactive',
    title: 'جایگاه پیشین',
    isActive: false,
    vacancy: 0,
    lifecycle: [{ id: 'history-secret-2' }],
  },
];

const viewProjection = projectHrOperationalReference(positions, { includeAvailableCapacity: false });
assert.deepEqual(viewProjection, {
  positions: [
    { id: 'position-active', title: 'کارشناس منابع انسانی', isActive: true },
    { id: 'position-inactive', title: 'جایگاه پیشین', isActive: false },
  ],
});

const actionProjection = projectHrOperationalReference(positions, { includeAvailableCapacity: true });
assert.deepEqual(actionProjection, {
  positions: [
    { id: 'position-active', title: 'کارشناس منابع انسانی', isActive: true, availableCapacity: 2 },
    { id: 'position-inactive', title: 'جایگاه پیشین', isActive: false, availableCapacity: 0 },
  ],
});

assert.equal('availableUsers' in actionProjection, false, 'operational reference must never expose unlinked ERP users');

console.log('HR operational reference projection tests passed.');
