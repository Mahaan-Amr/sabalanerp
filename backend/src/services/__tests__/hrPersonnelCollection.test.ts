import assert from 'node:assert/strict';
import {
  PERSONNEL_COLLECTION_PAGE_SIZE,
  buildPersonnelCollection,
  normalizePersonnelSearch,
} from '../hrPersonnelCollection';

const people = [
  { id: '3', firstName: 'كيوان', lastName: 'ياسمي', nationalCode: '0034567890', employeeNumber: 'EMP-30' },
  { id: '1', firstName: 'آرمان', lastName: 'احمدی', nationalCode: '0012345678', employeeNumber: 'EMP-10' },
  { id: '2', firstName: 'سارا', lastName: 'رضایی', nationalCode: '0023456789', employeeNumber: 'EMP-20' },
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `extra-${index}`,
    firstName: `نام ${index}`,
    lastName: 'موسوی',
    nationalCode: `100000000${index}`,
    employeeNumber: `EX-${index}`,
  })),
];

assert.equal(PERSONNEL_COLLECTION_PAGE_SIZE, 10);
assert.equal(normalizePersonnelSearch('  كيوان\u200c  ياسمي  '), 'کیوان یاسمی');

const normalizedMatch = buildPersonnelCollection(people, { search: 'کیوان یاسمی', page: 1 });
assert.deepEqual(normalizedMatch.rows.map((person) => person.id), ['3']);

const employeeMatch = buildPersonnelCollection(people, { search: '  emp-20 ', page: 1 });
assert.deepEqual(employeeMatch.rows.map((person) => person.id), ['2']);

const ordered = buildPersonnelCollection(people.slice(0, 3), { page: 1 });
assert.deepEqual(ordered.rows.map((person) => person.id), ['1', '2', '3']);

const clamped = buildPersonnelCollection(people, { page: 99 });
assert.equal(clamped.meta.page, 2);
assert.equal(clamped.meta.totalPages, 2);

const focused = buildPersonnelCollection(people, { page: 1, focusId: '3' });
assert.equal(focused.meta.page, 2, 'a moved focused row canonicalizes to its filtered page');
assert.equal(focused.meta.focus, 'present');

const removed = buildPersonnelCollection(people, { search: 'سارا', page: 2, focusId: '3' });
assert.equal(removed.meta.page, 1);
assert.equal(removed.meta.focus, 'removed');

console.log('HR Personnel collection policy tests passed.');
