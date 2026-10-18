import assert from 'node:assert/strict';
import test from 'node:test';
import { customerAccountInsights } from './customerAccountInsights';
import type { CustomerAccount, AccountItem } from './customerAccountModel';

test('insights keep exact rial totals and age only posted debts, without counting contracts or credits', () => {
  const debt = (originalRials: string, remainingRials: string, agingDays: number) => ({kind:'RECEIVABLE',originalRials,remainingRials,agingDays}) as AccountItem;
  const account = { activityItems: [debt('90071992547409930','9007199254740993',0),debt('200','100',31),
    {kind:'CREDIT',originalRials:'999999',remainingRials:'999999',agingDays:70}], contracts:[{totalAmount:'999999999999999999999'}] } as CustomerAccount;
  const result = customerAccountInsights(account);
  assert.equal(result.original,BigInt('90071992547410130'));
  assert.equal(result.remaining,BigInt('9007199254741093'));
  assert.equal(result.overdueRials,'100');
  assert.equal(result.buckets[0].amountRials,'9007199254740993');
  assert.equal(result.buckets[2].amountRials,'100');
  assert.ok(result.percent >= 0 && result.percent <= 100);
});

test('empty accounts and fully settled debts produce finite chart percentages', () => {
  assert.equal(customerAccountInsights({activityItems:[]} as unknown as CustomerAccount).percent,0);
  const result = customerAccountInsights({activityItems:[{kind:'RECEIVABLE',originalRials:'100',remainingRials:'0',agingDays:80}]} as CustomerAccount);
  assert.equal(result.percent,100);
  assert.equal(result.overdueRials,'0');
});
