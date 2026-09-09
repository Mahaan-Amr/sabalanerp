import assert from 'node:assert/strict';
import { projectHrOperationalReference } from '../hrOperationalReferenceProjection';

const positions = [
  {
    id: 'position-active',
    title: 'کارشناس منابع انسانی',
    jobId: 'job-active',
    jobTitle: 'کارشناس',
    jobIsActive: true,
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
    jobId: 'job-retired',
    jobTitle: 'شغل پیشین',
    jobIsActive: false,
    isActive: false,
    vacancy: 0,
    lifecycle: [{ id: 'history-secret-2' }],
  },
  {
    id: 'position-with-inactive-job',
    title: 'جایگاه با شغل غیرفعال',
    jobId: 'job-retired',
    jobTitle: 'شغل پیشین',
    jobIsActive: false,
    isActive: true,
    vacancy: 1,
  },
];

const viewProjection = projectHrOperationalReference(positions, { includeAvailableCapacity: false });
assert.deepEqual(viewProjection, {
  jobs: [
    { id: 'job-active', title: 'کارشناس', isActive: true },
    { id: 'job-retired', title: 'شغل پیشین', isActive: false },
  ],
  positions: [
    { id: 'position-active', title: 'کارشناس منابع انسانی', isActive: true, jobId: 'job-active' },
    { id: 'position-inactive', title: 'جایگاه پیشین', isActive: false, jobId: 'job-retired' },
    { id: 'position-with-inactive-job', title: 'جایگاه با شغل غیرفعال', isActive: false, jobId: 'job-retired' },
  ],
});

const actionProjection = projectHrOperationalReference(positions, { includeAvailableCapacity: true });
assert.deepEqual(actionProjection, {
  jobs: [
    { id: 'job-active', title: 'کارشناس', isActive: true },
    { id: 'job-retired', title: 'شغل پیشین', isActive: false },
  ],
  positions: [
    { id: 'position-active', title: 'کارشناس منابع انسانی', isActive: true, jobId: 'job-active', availableCapacity: 2 },
    { id: 'position-inactive', title: 'جایگاه پیشین', isActive: false, jobId: 'job-retired', availableCapacity: 0 },
    { id: 'position-with-inactive-job', title: 'جایگاه با شغل غیرفعال', isActive: false, jobId: 'job-retired', availableCapacity: 1 },
  ],
});

assert.equal('availableUsers' in actionProjection, false, 'operational reference must never expose unlinked ERP users');

console.log('HR operational reference projection tests passed.');
