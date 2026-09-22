import assert from 'node:assert/strict';
import test from 'node:test';
import { operationalStatusLabel } from './operationalStatusPresentation';

test('uses one Persian vocabulary across dispatch, contracts, vehicles, and accounting', () => {
  assert.equal(operationalStatusLabel('ACTIVE'), 'فعال');
  assert.equal(operationalStatusLabel('ELIGIBLE'), 'مجاز به رانندگی');
  assert.equal(operationalStatusLabel('FINALIZED'), 'نهایی‌شده');
  assert.equal(operationalStatusLabel('ISSUED'), 'صادرشده');
  assert.equal(operationalStatusLabel('WAITING_AT_GATE'), 'در انتظار پذیرش گارد');
  assert.equal(operationalStatusLabel('EXIT_RECORDED'), 'خروج از مجموعه ثبت شده');
});

test('never leaks an unknown backend enum into the normal interface', () => {
  assert.equal(operationalStatusLabel('FUTURE_INTERNAL_STATE'), 'وضعیت ثبت‌شده');
  assert.equal(operationalStatusLabel(null), 'بدون وضعیت');
});
