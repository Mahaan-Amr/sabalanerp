import assert from 'node:assert/strict';
import {
  parsePersonnelListState,
  personnelListSearch,
  safePersonnelOrigin,
} from './personnelListState';

const parsed = parsePersonnelListState(new URLSearchParams(
  'view=archived&q=%20%D8%B3%D8%A7%D8%B1%D8%A7%20&page=3&focus=p-1&panel=schedule&unknown=drop-me',
));
assert.deepEqual(parsed, {
  view: 'archived',
  search: 'سارا',
  page: 3,
  focus: 'p-1',
  panel: 'schedule',
  relationshipStatus: '',
  attention: '',
  organizationalUnitId: '',
  workplaceId: '',
  costCenterId: '',
  dependencyAt: '',
  origin: '',
});

assert.equal(personnelListSearch({ ...parsed, page: 1, focus: '', panel: '' }), 'view=archived&q=%D8%B3%D8%A7%D8%B1%D8%A7');
assert.equal(safePersonnelOrigin('/dashboard/hr?section=personnel'), '/dashboard/hr?section=personnel');
assert.equal(safePersonnelOrigin('/dashboard/accounting/deadlines'), '/dashboard/accounting/deadlines');
assert.equal(safePersonnelOrigin('https://evil.example/dashboard/hr'), '');
assert.equal(safePersonnelOrigin('//evil.example/dashboard/hr'), '');
assert.equal(safePersonnelOrigin('/api/hr/personnel'), '');

console.log('Personnel list URL state tests passed.');
