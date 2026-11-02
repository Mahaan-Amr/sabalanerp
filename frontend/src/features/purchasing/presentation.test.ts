import assert from 'node:assert/strict';
import {test} from 'node:test';
import {purchaseNumber,purchaseDigits,purchaseText,purchaseTitle} from './presentation';
test('quantities and toman show grouping without rounding long exact fractions',()=>{
 assert.equal(purchaseNumber('12345678901234567890.000000000000000000000000000001'),'۱۲,۳۴۵,۶۷۸,۹۰۱,۲۳۴,۵۶۷,۸۹۰.۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۱');
 assert.equal(purchaseNumber('۱۲۳۴۵.۶۷۸۹'),'۱۲,۳۴۵.۶۷۸۹');
 assert.equal(purchaseDigits('00100312'),'۰۰۱۰۰۳۱۲');
});
test('visible titles remove database identities, retaining actual names and document numbers',()=>{
 assert.equal(purchaseText('کارخانه الف · 6dfa538d-0ace-4511-a166-114fa74b2c86'),'کارخانه الف');
 assert.equal(purchaseText('cmvxrhcn500zb10yig96w8i2d'),'');
 assert.equal(purchaseTitle({displayTitle:'تراورتن یزد · استعلام مستقل',data:{}}),'تراورتن یزد · استعلام مستقل');
});
