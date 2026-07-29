import assert from 'node:assert/strict';
import { buildHiringDocumentIndex } from '../hrHiringDocumentIndex';

const application = {
  preIdentityChecklistItems: [{ id: 'pre-1', title: 'گواهی پیش از استخدام', attempt: 1, status: 'COMPLETE', originalName: 'pre.pdf', recordedBy: 'hr-1', recordedAt: new Date('2026-07-19') }],
  documents: [
    { id: 'identity-1', category: 'NATIONAL_CARD', side: 'FRONT', version: 2, status: 'VERIFIED', originalName: 'id.pdf', uploadedBy: 'hr-1', createdAt: new Date('2026-07-20') },
    { id: 'identity-original', category: 'OTHER', customTitle: 'گواهی سلامت', side: null, version: 1, status: 'RECEIVED', originalName: null, uploadedBy: 'hr-1', createdAt: new Date('2026-07-20') },
  ],
  assessments: [
    { id: 'assessment-1', assessmentType: 'DISC', version: 1, status: 'ACTIVE', originalName: 'disc.pdf', recordedBy: 'hr-2', recordedAt: new Date('2026-07-21') },
    { id: 'medical-1', assessmentType: 'OTHER', version: 1, status: 'ACTIVE', originalName: 'medical.pdf', recordedBy: 'hr-2', recordedAt: new Date('2026-07-21') },
  ],
  contracts: [{ id: 'contract-1', version: 3, originalName: 'contract.pdf', uploadedBy: 'finance-1', createdAt: new Date('2026-07-22'), approvedAt: null, submittedAt: new Date('2026-07-22') }],
  collateralItems: [{ id: 'collateral-1', type: 'CHECK', version: 1, status: 'RECEIVED', originalName: 'check.pdf', recordedBy: 'finance-2', createdAt: new Date('2026-07-22') }],
};

const hr = buildHiringDocumentIndex(application, new Set(['HR_MANAGER']));
assert.equal(hr.find((item) => item.id === 'identity-1')?.canOpen, true);
assert.equal(hr.find((item) => item.id === 'identity-original')?.title, 'گواهی سلامت');
assert.equal(hr.find((item) => item.id === 'identity-original')?.canOpen, false);
assert.equal(hr.find((item) => item.id === 'contract-1')?.canOpen, false);
assert.equal(hr.find((item) => item.id === 'contract-1')?.originalName, undefined);

const manager = buildHiringDocumentIndex(application, new Set(['COMPANY_MANAGER']));
assert.equal(manager.find((item) => item.id === 'assessment-1')?.canOpen, true);
assert.equal(manager.find((item) => item.id === 'identity-1')?.canOpen, false);
assert.equal(manager.find((item) => item.id === 'pre-1')?.canOpen, false);
assert.equal(manager.find((item) => item.id === 'medical-1')?.canOpen, false);

console.log('HR hiring document-index policy tests passed.');
