import assert from 'node:assert/strict';
import {
  notificationEventDefinition,
  materializeNotificationEvent,
  registeredNotificationEventTypes,
  renderNotificationPolicy,
  privacySafeWebPushPayload,
  validateNotificationPolicyDraft,
} from '../notificationPolicy';

const newBrowser = notificationEventDefinition('NEW_BROWSER_LOGIN');
assert.equal(newBrowser.mandatory, true);
assert.deepEqual(newBrowser.allowedRecipientResolvers, ['DIRECT_USER']);

const rendered = renderNotificationPolicy({
  definition: newBrowser,
  payload: {
    browser: 'Chrome',
    operatingSystem: 'Windows',
    ipAddress: '192.0.2.10',
  },
});
assert.equal(rendered.title, 'ورود از مرورگر جدید');
assert.equal(rendered.message, 'Chrome · Windows · 192.0.2.10');
assert.equal(rendered.priority, 'URGENT');

assert.deepEqual(
  validateNotificationPolicyDraft(newBrowser, {
    enabled: false,
    titleTemplate: 'ورود جدید',
    messageTemplate: '{{browser}}',
    priority: 'NORMAL',
    channels: ['IN_APP'],
    recipientResolvers: ['DIRECT_USER'],
  }),
  {
    valid: false,
    errors: ['اعلان الزامی را نمی‌توان غیرفعال کرد.'],
  },
);

const unsafeVariable = validateNotificationPolicyDraft(newBrowser, {
  enabled: true,
  titleTemplate: 'ورود {{sessionToken}}',
  messageTemplate: '{{browser}}',
  priority: 'URGENT',
  channels: ['IN_APP', 'REALTIME'],
  recipientResolvers: ['DIRECT_USER'],
});
assert.equal(unsafeVariable.valid, false);
assert.deepEqual(unsafeVariable.errors, ['متغیر «sessionToken» برای این رویداد مجاز نیست.']);

const materialized = materializeNotificationEvent({
  definition: newBrowser,
  actorId: 'user-actor',
  recipientIds: ['user-actor', 'user-owner', 'user-owner'],
  payload: {
    browser: 'Firefox',
    operatingSystem: 'Android',
    ipAddress: '198.51.100.8',
  },
  actionUrl: '/dashboard/personal',
});
assert.deepEqual(materialized.recipientIds, ['user-owner']);
assert.equal(materialized.title, 'ورود از مرورگر جدید');
assert.equal(materialized.actionUrl, '/dashboard/personal');
assert.throws(
  () => materializeNotificationEvent({
    definition: newBrowser,
    recipientIds: ['user-owner'],
    payload: { browser: 'Firefox', operatingSystem: 'Android', ipAddress: '198.51.100.8' },
    actionUrl: 'https://attacker.example/ticket',
  }),
  /پیوند اعلان باید داخلی باشد/,
);

assert.deepEqual(privacySafeWebPushPayload('/dashboard/support/tickets/ticket-1'), {
  title: 'سبلان ERP',
  body: 'یک اعلان جدید در سبلان دارید.',
  url: '/dashboard/support/tickets/ticket-1',
});
assert.equal(JSON.stringify(privacySafeWebPushPayload('/dashboard')).includes('ticket-1'), false);

assert.deepEqual(registeredNotificationEventTypes(), [
  'ACCOUNTING_CORRECTION_REQUIRED',
  'ACCOUNTING_RECORD_SUBMITTED',
  'DEPLOYMENT_COMPLETED',
  'DEPLOYMENT_FAILED',
  'FAILED_LOGIN_ALERT',
  'HIRING_CHECKLIST_OVERDUE',
  'HIRING_INVITATION_SMS_FAILED',
  'HIRING_OFFER_DECLINED',
  'HIRING_SHARED_WORK_AVAILABLE',
  'HR_DUTY_ASSIGNED',
  'HR_DUTY_MANAGER_ESCALATION',
  'HR_DUTY_NEAR_DUE',
  'HR_DUTY_OVERDUE',
  'HR_DUTY_REASSIGNED',
  'HR_DUTY_RESULT',
  'HR_DUTY_UNASSIGNED_TRIAGE',
  'NEW_BROWSER_LOGIN',
  'RECOVERY_BACKUP_STALE',
  'SALES_CONTRACT_READY_FOR_ACCOUNTING',
  'SUPPORT_TICKET_ASSIGNED',
  'SUPPORT_TICKET_CREATED',
  'SUPPORT_TICKET_REPORTER_REMINDER',
  'SUPPORT_TICKET_RESPONSE',
  'SUPPORT_TICKET_SLA_BREACHED',
  'SUPPORT_TICKET_SLA_WARNING',
  'SYSTEM_RECOVERY_COMPLETED',
  'SYSTEM_RECOVERY_STARTED',
]);

console.log('notification policy tests passed');
