import assert from 'node:assert/strict';
import {
  destinationDutySourceVersionLabel,
  initialDestinationDutyState,
  reduceDestinationDutyState,
} from './destinationDutyState';

assert.equal(destinationDutySourceVersionLabel(5), 'نسخه ۵');

const first = [{ id: 'duty-1', status: 'OPEN' }];
const available = reduceDestinationDutyState(initialDestinationDutyState, { type: 'success', data: first });
assert.deepEqual(available, { data: first, loading: false, stale: false, error: null });

const refreshing = reduceDestinationDutyState(available, { type: 'start' });
assert.deepEqual(refreshing, { data: first, loading: true, stale: false, error: null });

const failedRefresh = reduceDestinationDutyState(refreshing, { type: 'failure', message: 'ارتباط برقرار نشد' });
assert.deepEqual(failedRefresh, { data: first, loading: false, stale: true, error: 'ارتباط برقرار نشد' });

const firstFailure = reduceDestinationDutyState(initialDestinationDutyState, { type: 'failure', message: 'در دسترس نیست' });
assert.deepEqual(firstFailure, { data: null, loading: false, stale: false, error: 'در دسترس نیست' });

console.log('Destination duty Last Successful View tests passed.');
