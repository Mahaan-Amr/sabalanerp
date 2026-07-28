import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CuttingType,
  StoneFinishing,
  SubService
} from '../../../types/contract.types';
import {
  filterStandaloneServiceCatalog,
  nextStandaloneServiceCatalogState
} from '../../../services/standaloneServiceCatalog';

const tool = {
  id: 'tool-1',
  name: 'Tool',
  namePersian: 'ابزار یک'
} as SubService;
const cutting = {
  id: 'cut-1',
  name: 'Cut',
  namePersian: 'برش یک'
} as CuttingType;
const finishing = {
  id: 'finish-1',
  name: 'Finish',
  namePersian: 'پرداخت یک'
} as StoneFinishing;

test('an empty search shows the complete active service category', () => {
  assert.deepEqual(
    filterStandaloneServiceCatalog({
      sourceType: 'tool',
      query: '',
      subServices: [tool],
      cuttingTypes: [cutting],
      stoneFinishings: [finishing]
    }),
    [tool]
  );
});

test('choosing a category clears search and keeps the catalog open with search focus requested', () => {
  assert.deepEqual(
    nextStandaloneServiceCatalogState(
      { open: true, sourceType: 'tool', query: 'قبلی' },
      { type: 'select-category', sourceType: 'cutting' }
    ),
    {
      open: true,
      sourceType: 'cutting',
      query: '',
      focusSearch: true
    }
  );
});

test('adding a service keeps the list open, clears search, and requests search focus', () => {
  assert.deepEqual(
    nextStandaloneServiceCatalogState(
      { open: true, sourceType: 'finishing', query: 'ساب' },
      { type: 'service-added' }
    ),
    {
      open: true,
      sourceType: 'finishing',
      query: '',
      focusSearch: true
    }
  );
});
