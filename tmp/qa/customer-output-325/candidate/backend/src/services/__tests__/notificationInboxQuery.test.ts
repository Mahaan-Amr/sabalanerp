import assert from 'node:assert/strict';
import {
  notificationCategory,
  normalizePersianSearchText,
  notificationMatchesSearch,
} from '../notificationInboxQuery';

assert.equal(normalizePersianSearchText('  كاربَر يک  '), 'کاربر یک');
assert.equal(normalizePersianSearchText('اعلان ۱۲۳'), 'اعلان 123');
assert.equal(notificationMatchesSearch({ title: 'ورود از مرورگر جدید', message: 'کاربر یک' }, 'كاربَر يک'), true);
assert.equal(notificationMatchesSearch({ title: 'ورود از مرورگر جدید', message: 'کاربر یک' }, 'شناسه پنهان'), false);
assert.equal(notificationCategory('NEW_BROWSER_LOGIN'), 'SECURITY');
assert.equal(notificationCategory('SUPPORT_TICKET_RESPONSE'), 'SUPPORT');
assert.equal(notificationCategory('HIRING_CHECKLIST_OVERDUE'), 'HIRING');
assert.equal(notificationCategory('RECOVERY_BACKUP_STALE'), 'RECOVERY');
assert.equal(notificationCategory('SALES_CONTRACT_READY_FOR_ACCOUNTING'), 'SALES');
assert.equal(notificationCategory('ACCOUNTING_RECORD_SUBMITTED'), 'ACCOUNTING');
assert.equal(notificationCategory('ACCOUNTING_CONTRACT_CORRECTION_EDITED'), 'ACCOUNTING');

console.log('notification inbox query tests passed');
