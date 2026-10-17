import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingContractSearch } from '../accountingContractSearch';

test('all words can be separated, reordered or spread over contract fields', () => {
  const fields = ['1001', 'حسن محمد زارع', 'SIGNED'];
  for (const query of ['حسن زارع', 'زارع حسن', '۱۰۰۱ زارع', 'زارع ١٠٠١', 'حسن حسن', '  حسن   زارع  ', 'SIGNED زارع']) {
    assert.equal(accountingContractSearch(query)(fields), true, query);
  }
  for (const query of ['حسن احمد', '1002 زارع', 'حسن CANCELLED']) assert.equal(accountingContractSearch(query)(fields), false, query);
});

test('normalization preserves Arabic letter variants, invisible separators and empty search', () => {
  assert.equal(accountingContractSearch('علي كريمي')(['علی', 'کریمی']), true);
  assert.equal(accountingContractSearch('علی\u200cکریمی')(['علي كريمي']), true);
  assert.equal(accountingContractSearch('   ')([]), true);
  assert.equal(accountingContractSearch(undefined)([]), true);
  assert.equal(accountingContractSearch('حسن')([null, undefined]), false);
});
