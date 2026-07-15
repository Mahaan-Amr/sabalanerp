import assert from 'node:assert/strict';
import { chartTickInterval, resolveChartLabel } from '../RtlCharts';

assert.equal(resolveChartLabel({ label: 'امضاشده' }), 'امضاشده');
assert.equal(resolveChartLabel({ statusLabel: 'تأییدشده' }), 'تأییدشده');
assert.equal(resolveChartLabel({ status: 'APPROVED' }), 'APPROVED');
assert.equal(resolveChartLabel({}), 'نامشخص');

assert.equal(chartTickInterval(7), 0);
assert.equal(chartTickInterval(31), 3);
assert.ok(Math.ceil(31 / (chartTickInterval(31) + 1)) <= 8);

console.log('RTL chart regression tests passed');
