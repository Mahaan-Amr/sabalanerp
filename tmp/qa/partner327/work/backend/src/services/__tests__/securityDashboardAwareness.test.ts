import assert from 'node:assert/strict';
import { buildDashboardRecentReports, buildSecurityDashboardAwareness } from '../securityDashboardAwareness';

const manager = { userId: 'manager-user', role: 'ADMIN', workspacePermission: 'view' };
const activeGuard = { userId: 'guard-user', role: 'USER', workspacePermission: 'view' };
const ordinaryViewer = { userId: 'viewer-user', role: 'USER', workspacePermission: 'view' };
const now = new Date('2026-07-22T08:00:00.000Z');

const planned = { id: 'planned', position: 'نگهبان', user: { id: 'planned-user', firstName: 'نگهبان', lastName: 'برنامه' } };
const replacement = { id: 'replacement', position: 'جانشین', user: { id: 'guard-user', firstName: 'نگهبان', lastName: 'جایگزین' } };
const temporary = { id: 'temporary', position: 'پوشش موقت', user: { id: 'temporary-user', firstName: 'نگهبان', lastName: 'موقت' } };

const activeSlot = {
  id: 'slot-active',
  startsAt: '2026-07-22T07:00:00.000Z',
  endsAt: '2026-07-22T19:00:00.000Z',
  plannedPersonnelId: planned.id,
  replacementPersonnelId: replacement.id,
  plannedPersonnel: planned,
  replacementPersonnel: replacement,
  temporaryCoverage: [],
  plan: { lateAlertMinutes: 15 },
};

const activeSession = {
  id: 'session-active',
  status: 'ACTIVE',
  startedAt: '2026-07-22T07:02:00.000Z',
  personnelId: replacement.id,
  personnel: replacement,
  slot: activeSlot,
};

const managerView = buildSecurityDashboardAwareness({ actor: manager, activeSession, currentSlot: activeSlot, now });
assert.equal(managerView.authorized, true);
assert.equal(managerView.access, 'manager');
assert.equal(managerView.overview?.state, 'ACTIVE');
assert.equal(managerView.overview?.effectivePersonnel.id, replacement.id);
assert.equal(managerView.overview?.coverageKind, 'REPLACEMENT');
assert.equal(managerView.overview?.plannedPersonnel?.id, planned.id);

const guardView = buildSecurityDashboardAwareness({ actor: activeGuard, activeSession, currentSlot: activeSlot, now });
assert.equal(guardView.authorized, true);
assert.equal(guardView.access, 'operator');

const hiddenView = buildSecurityDashboardAwareness({ actor: ordinaryViewer, activeSession, currentSlot: activeSlot, now });
assert.deepEqual(hiddenView, { authorized: false, access: null, overview: null });

const scheduledSlot = {
  ...activeSlot,
  id: 'slot-scheduled',
  replacementPersonnelId: null,
  replacementPersonnel: null,
  startsAt: '2026-07-22T07:00:00.000Z',
  temporaryCoverage: [{ personnelId: temporary.id, startsAt: '2026-07-22T07:30:00.000Z', endsAt: '2026-07-22T09:00:00.000Z', personnel: temporary }],
};
const scheduledView = buildSecurityDashboardAwareness({ actor: manager, activeSession: null, currentSlot: scheduledSlot, now });
assert.equal(scheduledView.overview?.state, 'SCHEDULED_NOT_STARTED');
assert.equal(scheduledView.overview?.effectivePersonnel.id, temporary.id);
assert.equal(scheduledView.overview?.coverageKind, 'TEMPORARY');
assert.equal(scheduledView.overview?.overdue, true);

const noSlot = buildSecurityDashboardAwareness({ actor: manager, activeSession: null, currentSlot: null, now });
assert.equal(noSlot.authorized, true);
assert.equal(noSlot.overview?.state, 'NONE');

const recentReports = buildDashboardRecentReports([
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `entry-${index + 1}`,
    rowNumber: index + 1,
    status: 'ACTIVE',
    categoryNameSnapshot: 'رویداد',
    reportTypeNameSnapshot: null,
    description: `شرح ${index + 1}`,
    createdAt: `2026-07-22T0${index + 1}:00:00.000Z`,
    voidReason: null,
    voidedAt: null,
    participants: [],
    attachments: [],
  })),
  {
    id: 'entry-6',
    rowNumber: 6,
    status: 'VOIDED',
    categoryNameSnapshot: 'حادثه',
    reportTypeNameSnapshot: 'ایمنی',
    description: 'آخرین گزارش',
    createdAt: '2026-07-22T06:00:00.000Z',
    voidReason: 'ثبت اشتباه',
    voidedAt: '2026-07-22T06:05:00.000Z',
    participants: [{ user: { firstName: 'علی', lastName: 'رضایی' }, personnel: null }],
    attachments: [{ id: 'attachment-1' }],
  },
]);
assert.deepEqual(recentReports.map((entry) => entry.id), ['entry-6', 'entry-5', 'entry-4', 'entry-3', 'entry-2']);
assert.equal(recentReports[0].title, 'حادثه / ایمنی');
assert.deepEqual(recentReports[0].participants, ['علی رضایی']);
assert.equal(recentReports[0].attachmentCount, 1);
assert.equal(recentReports[0].status, 'VOIDED');

console.log('securityDashboardAwareness tests passed');
