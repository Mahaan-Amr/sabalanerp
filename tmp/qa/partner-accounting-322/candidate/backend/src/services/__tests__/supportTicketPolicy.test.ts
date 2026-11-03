import assert from 'node:assert/strict';
import {
  canAccessSensitiveEvidence,
  canAccessTicket,
  deriveSuggestedPriority,
  sanitizeDiagnosticSnapshot,
  sanitizeSensitiveEvidenceSnapshot,
  canMutateTicket,
  canTransitionTicket,
  shouldAutoCloseWaitingTicket,
} from '../supportTicketPolicy';
import { buildSupportDiagnosticBundle, routeToSourceFiles } from '../supportDiagnosticBundle';
import { addSupportMinutes, defaultSupportCalendar, supportDeadlines, defaultSupportTargets } from '../supportSlaPolicy';

const baseTicket = {
  reporterId: 'reporter',
  workspace: 'sales',
  feature: 'sales.contracts.view',
  restrictedIncident: false,
  participants: [{ userId: 'assigned', role: 'HANDLER' as const }],
};

assert.equal(canAccessTicket({ id: 'admin', role: 'ADMIN', managedWorkspaces: [] }, baseTicket), true);
assert.equal(canAccessTicket({
  id: 'manager',
  role: 'MANAGER',
  managedWorkspaces: ['sales'],
  managedFeatures: ['sales:sales.contracts.view'],
}, baseTicket), true);
assert.equal(canAccessTicket({ id: 'manager', role: 'MANAGER', managedWorkspaces: ['sales'], managedFeatures: [] }, baseTicket), false);
assert.equal(canAccessTicket({ id: 'assigned', role: 'USER', managedWorkspaces: [] }, baseTicket), true);
assert.equal(canAccessTicket({ id: 'other', role: 'USER', managedWorkspaces: [] }, baseTicket), false);
assert.equal(
  canAccessTicket(
    { id: 'manager', role: 'MANAGER', managedWorkspaces: ['sales'], securityIncidentHandler: false },
    { ...baseTicket, restrictedIncident: true },
  ),
  false,
);

assert.ok(routeToSourceFiles('/dashboard/accounting/contracts/1').includes('backend/src/routes/accounting.ts'));
const bundle = buildSupportDiagnosticBundle({
  id: 'ticket-1',
  referenceCode: 'SUP-1',
  title: 'اشکال قرارداد',
  type: 'TECHNICAL_ERROR',
  impact: 'SINGLE_TASK',
  workaroundExists: false,
  reportedWorkspace: 'sales',
  reportedFeature: 'sales.contracts.view',
  originRoute: '/dashboard/sales/contracts/1',
  releaseBuild: 'abc123',
  diagnosticSnapshot: { errors: ['safe error', 'token=do-not-export'], recordIdentifiers: { contractId: '1' } },
  entries: [{ kind: 'REPORT', body: 'صفحه باز نمی‌شود', redactedAt: null }],
  auditEvents: [{ action: 'CREATED', afterData: { steps: 'کلیک روی قرارداد', expectedResult: 'نمایش جزئیات' } }],
});
assert.equal(JSON.stringify(bundle).includes('do-not-export'), false);
assert.equal(bundle.data.selectedSensitiveEvidence.length, 0);
assert.equal(
  addSupportMinutes(new Date('2026-08-01T04:30:00.000Z'), 15, defaultSupportCalendar).toISOString(),
  '2026-08-01T04:45:00.000Z',
);
assert.equal(
  supportDeadlines({
    triagedAt: new Date('2026-08-01T04:30:00.000Z'),
    priority: 'URGENT',
    calendar: defaultSupportCalendar,
    targets: defaultSupportTargets,
  }).resolutionDueAt.toISOString(),
  '2026-08-01T06:30:00.000Z',
);

assert.equal(
  canAccessSensitiveEvidence(
    {
      id: 'assigned',
      role: 'USER',
      managedWorkspaces: [],
      accessibleWorkspaces: ['sales'],
      accessibleFeatures: ['sales:sales.contracts.view'],
    },
    baseTicket,
  ),
  true,
);
assert.equal(
  canAccessSensitiveEvidence(
    { id: 'assigned', role: 'USER', managedWorkspaces: [], accessibleWorkspaces: [] },
    baseTicket,
  ),
  false,
);
assert.equal(
  canAccessSensitiveEvidence(
    { id: 'watcher', role: 'USER', managedWorkspaces: [], accessibleWorkspaces: ['sales'] },
    { ...baseTicket, participants: [{ userId: 'watcher', role: 'WATCHER' }] },
  ),
  false,
);

assert.equal(deriveSuggestedPriority({ impact: 'BLOCKED', workaroundExists: false, restrictedIncident: false }), 'HIGH');
assert.equal(deriveSuggestedPriority({ impact: 'WIDESPREAD', workaroundExists: true, restrictedIncident: false }), 'URGENT');
assert.equal(deriveSuggestedPriority({ impact: 'MINOR', workaroundExists: true, restrictedIncident: true }), 'URGENT');
assert.equal(
  deriveSuggestedPriority({
    impact: 'SINGLE_TASK',
    workaroundExists: true,
    restrictedIncident: false,
    workspace: 'accounting',
  }),
  'HIGH',
);

const snapshot = sanitizeDiagnosticSnapshot({
  route: '/dashboard/sales/contracts/123?token=secret',
  pageTitle: 'قرارداد ۱۲۳',
  buildCommit: 'abc123',
  errors: ['Request failed', 'password=hunter2'],
  rawFormValues: { customer: 'Example', password: 'hidden' },
  cookie: 'session=secret',
});
assert.equal(snapshot.route, '/dashboard/sales/contracts/123');
assert.equal(snapshot.pageTitle, 'قرارداد ۱۲۳');
assert.equal(snapshot.buildCommit, 'abc123');
assert.deepEqual(snapshot.errors, ['Request failed']);
assert.equal('rawFormValues' in snapshot, false);
assert.equal('cookie' in snapshot, false);
const sensitiveSnapshot = sanitizeSensitiveEvidenceSnapshot({
  pageText: 'مبلغ قرارداد ۱۰۰',
  formValues: { customerName: 'نمونه', password: 'hidden', tokenValue: 'hidden', amount: 100 },
  uploadedFileMetadata: [{ name: 'invoice.pdf', size: 1000, type: 'application/pdf' }],
});
assert.equal(sensitiveSnapshot.pageText, 'مبلغ قرارداد ۱۰۰');
assert.deepEqual(sensitiveSnapshot.formValues, { customerName: 'نمونه', amount: 100 });
assert.equal(sensitiveSnapshot.uploadedFileMetadata?.[0].name, 'invoice.pdf');
const scrubbedSecrets = sanitizeSensitiveEvidenceSnapshot({
  pageText: 'کد تأیید شما ۱۲۳۴۵۶ است',
  formValues: {
    harmless: 'visible',
    note: '-----BEGIN PRIVATE KEY-----',
    otpDescription: 'کد امنیتی: 654321',
  },
  uploadedFileMetadata: [
    { name: 'invoice.pdf', size: 1000, type: 'application/pdf' },
    { name: 'رمز-ورود.txt', size: 30, type: 'text/plain' },
  ],
});
assert.equal(scrubbedSecrets.pageText, undefined);
assert.deepEqual(scrubbedSecrets.formValues, { harmless: 'visible' });
assert.deepEqual(scrubbedSecrets.uploadedFileMetadata, [
  { name: 'invoice.pdf', size: 1000, type: 'application/pdf' },
]);
assert.equal(sanitizeSensitiveEvidenceSnapshot({ pageText: 'PIN: 1234' }).pageText, undefined);
assert.equal(sanitizeSensitiveEvidenceSnapshot({ pageText: 'access code: 123456' }).pageText, undefined);
assert.equal(sanitizeSensitiveEvidenceSnapshot({ pageText: 'کد ورود شما ۱۲۳۴۵۶' }).pageText, undefined);

assert.equal(canMutateTicket('WATCHER', false, false), false);
assert.equal(canMutateTicket('COLLABORATOR', false, false), true);
assert.equal(canMutateTicket(null, true, false), true);
assert.equal(canTransitionTicket('NEW', 'IN_PROGRESS'), true);
assert.equal(canTransitionTicket('CLOSED', 'IN_PROGRESS'), false);
assert.equal(canTransitionTicket('WAITING_REPORTER', 'CLOSED'), true);
assert.equal(
  shouldAutoCloseWaitingTicket({
    restrictedIncident: false,
    waitingSince: new Date('2026-07-01T00:00:00Z'),
    now: new Date('2026-07-10T00:00:00Z'),
    elapsedSupportDays: 7,
  }),
  true,
);
assert.equal(
  shouldAutoCloseWaitingTicket({
    restrictedIncident: true,
    waitingSince: new Date('2026-07-01T00:00:00Z'),
    now: new Date('2026-07-20T00:00:00Z'),
    elapsedSupportDays: 15,
  }),
  false,
);

console.log('support ticket policy tests passed');
