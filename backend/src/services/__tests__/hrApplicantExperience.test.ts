import assert from 'node:assert/strict';
import {
  buildCandidateClosedState,
  normalizeCoveredHiringAmounts,
  normalizeHiringRial,
  projectApplicantClosureSummary,
  projectApplicantFullInformation,
  validateApplicantReturnContext,
} from '../hrApplicantExperience';

const source = {
  id: 'application-1',
  stage: 'CLOSED',
  outcome: 'REJECTED',
  outcomeReason: 'internal decision explanation',
  preClosureStage: 'ASSESSMENT',
  candidate: {
    firstName: 'سارا',
    lastName: 'احمدی',
    mobile: '09120000000',
    nationalCode: '0012345678',
    foreignIdentityType: null,
    foreignIdentityNumber: null,
    postalCode: '1234567890',
    hasSocialSecurityHistory: true,
    profileJson: { protectedProfileNote: 'profile secret' },
  },
  position: { title: 'کارشناس فروش', job: { title: 'فروش' } },
  formRevisions: [
    {
      id: 'revision-2',
      revisionNumber: 2,
      status: 'SUBMITTED',
      submittedAt: new Date('2026-08-08T10:00:00.000Z'),
      dataJson: {
        birthDate: '1995-01-01',
        address: 'private address',
        fatherName: 'private family value',
        workHistory: [{ organization: 'Sabalan', lastSalaryBenefits: '۱۲٬۳۴۵' }],
        skills: [{ name: 'Excel' }],
        questions: ['private answer'],
        desiredSalary: '١٢,٣٤٥',
      },
    },
  ],
  documents: [
    {
      id: 'document-1',
      category: 'OTHER',
      customTitle: 'گواهی مستقل',
      version: 1,
      originalName: 'identity.pdf',
      storageName: 'never-serialize-storage-name',
      sha256: 'never-serialize-sha',
    },
  ],
  identityChecks: [{ fieldKey: 'nationalCode', status: 'VERIFIED', note: 'protected evidence' }],
};

const restricted = projectApplicantFullInformation(source, new Set());
assert.deepEqual(
  restricted.groups.map((group) => ({ key: group.key, status: group.status })),
  [
    { key: 'PROFILE_IDENTITY', status: 'RESTRICTED' },
    { key: 'EXPERIENCE_QUALIFICATIONS', status: 'RESTRICTED' },
    { key: 'APPLICATION_ANSWERS', status: 'RESTRICTED' },
    { key: 'DOCUMENT_EVIDENCE', status: 'RESTRICTED' },
  ],
);
const restrictedJson = JSON.stringify(restricted);
for (const secret of ['09120000000', '0012345678', 'private address', 'private family value', 'private answer', 'identity.pdf', 'never-serialize-storage-name', 'never-serialize-sha', 'protected evidence']) {
  assert.equal(restrictedJson.includes(secret), false, `restricted projection serialized ${secret}`);
}

const full = projectApplicantFullInformation(source, new Set([
  'PROFILE_IDENTITY',
  'EXPERIENCE_QUALIFICATIONS',
  'APPLICATION_ANSWERS',
  'DOCUMENT_EVIDENCE',
]));
assert.equal(full.groups[0].status, 'AVAILABLE');
assert.equal((full.groups[0] as any).revisions[0].contact.mobile, '09120000000');
assert.equal((full.groups[1] as any).revisions[0].workHistory[0].lastSalaryBenefits, '۱۲٬۳۴۵');
assert.equal((full.groups[2] as any).revisions[0].answers[0], 'private answer');
assert.deepEqual((full.groups[3] as any).documents[0], {
  id: 'document-1',
  category: 'OTHER',
  customTitle: 'گواهی مستقل',
  version: 1,
  originalName: 'identity.pdf',
});

assert.equal(normalizeHiringRial('۱۲٬۳۴۵'), '12345');
assert.equal(normalizeHiringRial('١٢,٣٤٥'), '12345');
assert.equal(normalizeHiringRial(' 0 '), '0');
assert.equal(normalizeHiringRial(''), '');
assert.throws(() => normalizeHiringRial('-1'), /non-negative whole Rial/);
assert.throws(() => normalizeHiringRial('12.5'), /non-negative whole Rial/);
assert.deepEqual(normalizeCoveredHiringAmounts({
  desiredSalary: '۱۲٬۳۴۵',
  workHistory: [{ organization: 'Sabalan', lastSalaryBenefits: '١٠,٠٠٠' }],
  untouched: 'value',
}), {
  desiredSalary: '12345',
  workHistory: [{ organization: 'Sabalan', lastSalaryBenefits: '10000' }],
  untouched: 'value',
});

const closureAudit = {
  actorUserId: 'manager-1',
  createdAt: new Date('2026-08-08T12:30:00.000Z'),
  payloadJson: { outcome: 'REJECTED', reason: 'immutable reason' },
};
assert.deepEqual(projectApplicantClosureSummary(source, closureAudit, { canViewExplanation: false, actorDisplayName: 'مدیر منابع انسانی' }), {
  available: true,
  outcome: 'REJECTED',
  previousStage: 'ASSESSMENT',
  closedAt: '2026-08-08T12:30:00.000Z',
  closedBy: 'مدیر منابع انسانی',
  explanationRestricted: true,
});
assert.equal((projectApplicantClosureSummary(source, closureAudit, { canViewExplanation: true, actorDisplayName: 'مدیر منابع انسانی' }) as any).explanation, 'immutable reason');

assert.deepEqual(buildCandidateClosedState(source), {
  closed: true,
  outcome: 'REJECTED',
  candidateMessageCode: 'APPLICATION_NOT_SELECTED',
  positionTitle: 'کارشناس فروش',
});
assert.equal(JSON.stringify(buildCandidateClosedState(source)).includes('internal decision explanation'), false);

assert.equal(
  validateApplicantReturnContext('/dashboard/hr/hiring?archived=true&search=%D8%B3%D8%A7%D8%B1%D8%A7&page=2&focus=application-1', 'application-1'),
  '/dashboard/hr/hiring?archived=true&search=%D8%B3%D8%A7%D8%B1%D8%A7&page=2&focus=application-1',
);
assert.equal(validateApplicantReturnContext('https://attacker.example/steal', 'application-1'), '/dashboard/hr/hiring?focus=application-1');
assert.equal(validateApplicantReturnContext('/dashboard/hr/hiring?unknown=secret', 'application-1'), '/dashboard/hr/hiring?focus=application-1');

console.log('HR Applicant experience tests passed.');
