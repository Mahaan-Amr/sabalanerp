import assert from 'node:assert/strict';
import { getSecurityDashboardDescription } from './securityDashboardViewModel';

assert.equal(
  getSecurityDashboardDescription({
    name: 'مدیر سیستم',
    position: 'سرپرست حراست',
    department: 'حراست'
  }),
  'مدیر سیستم - سرپرست حراست'
);

assert.equal(
  getSecurityDashboardDescription(null),
  'مدیریت حراست - بدون عضویت عملیاتی در شیفت'
);

console.log('securityDashboardViewModel tests passed');
