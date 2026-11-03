// Read-only probe: evaluates the real source search block and loader callback.
// Run from repository root: node reports/qa/accounting-performance-20261017/contracts-search-reproduction.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(transpile(read('backend/src/services/crmCustomerSearch.ts')), sandbox);
const normalize = sandbox.exports.normalizePersianSearchTokens;
const service = read('backend/src/services/accountingService.ts');
const from = service.indexOf('  if (search) {', service.indexOf('export const listAccountingContracts'));
const block = service.slice(from, service.indexOf('  if (query.sourceStatus', from));
assert(from !== -1 && block.includes('items.filter'), 'Real search source seam must exist');
const searchActual = new Function('items', 'search', 'normalizePersianSearchTokens', 'partnerTrackingCode', 'getTehranDateKey', transpile(block) + '; return items;');
const fixture = [{ contractNumber: '1001', customer: { displayName: 'حسن محمد زارع' }, accounting: {} }];
let defects = 0;
for (const query of ['حسن', 'زارع', 'حسن محمد', 'حسن زارع', 'زارع حسن', '1001 زارع']) {
  const matches = searchActual(fixture, query, normalize, () => '', () => '').length;
  console.log(JSON.stringify({ scenario: 'search', query, matches, expected: 1 }));
  if (matches !== 1) defects++;
}
const page = read('frontend/src/app/dashboard/accounting/contracts/page.tsx');
const marker = '  const loadContracts = useCallback(async () => {';
const body = page.slice(page.indexOf(marker) + marker.length, page.indexOf('  }, [pagination.pageSize', page.indexOf(marker)));
assert(page.includes(marker) && body.includes('setRows'), 'Real loader source seam must exist');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const build = new AsyncFunction('query', 'pagination', 'accountingAPI', 'accountingContractsResponse', 'setRows', 'setPagination', 'setLoading', 'setLoadError', 'accountingFailureMessage', body);
async function race(order) {
  const pending = [], history = [];
  const api = { getContracts: params => new Promise(resolve => pending.push({ params, resolve })) };
  const start = search => build({ search, page: 1, status: 'ALL', sourceStatus: 'ALL' }, { pageSize: 50 }, api, x => x,
    items => history.push({ event: 'rows', items }), () => {}, loading => history.push({ event: 'loading', loading }), () => {}, () => 'error');
  const promises = [start(''), start('حسن زارع')];
  for (const index of order) {
    pending[index].resolve({ data: { items: [index === 0 ? 'FULL LIST' : 'SEARCHED RESULT'], page: 1, pageSize: 50, total: index === 0 ? 100 : 1 } });
    await promises[index];
    if (index === order[0]) console.log(JSON.stringify({ scenario: 'race-after-first-response', order, history }));
  }
  console.log(JSON.stringify({ scenario: 'race-completed', order, history }));
  const rowWrites = history.filter(item => item.event === 'rows');
  if (rowWrites.some(item => item.items[0] === 'FULL LIST')) defects++;
}
(async () => {
  await race([0, 1]);
  await race([1, 0]);
  console.log(JSON.stringify({ verdict: defects ? 'FAIL: reproduced reported defects' : 'PASS', defects }));
  process.exitCode = defects ? 1 : 0;
})();
