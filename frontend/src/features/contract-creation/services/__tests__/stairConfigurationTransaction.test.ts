import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeStairCreateTransaction,
  hasMeaningfulStairDraft,
  shouldConfirmStairDraftDiscard,
  type StairDraftBuildResult
} from '../stairConfigurationTransaction';

import { createStairDraftForStone, hasStairEntryChanges } from '../stairStoneSelection';
import type { Product, StairStepperPart } from '../../types/contract.types';

type TestRow = {
  rowId: string;
};

const built = (rows: TestRow[]): StairDraftBuildResult<TestRow> => ({
  ok: true,
  sessionItems: rows
});

test('finish commits the visible active draft without a prior stage action', () => {
  const outcome = executeStairCreateTransaction<TestRow>({
    action: 'finish',
    stagedItems: [],
    activeDraftMeaningful: true,
    buildActiveDraft: () => built([{ rowId: 'visible-tread' }])
  });

  assert.deepEqual(outcome, {
    status: 'committed',
    sessionItems: [{ rowId: 'visible-tread' }]
  });
});

test('finish commits staged rows when the visible active draft is pristine', () => {
  const outcome = executeStairCreateTransaction<TestRow>({
    action: 'finish',
    stagedItems: [{ rowId: 'staged-tread' }],
    activeDraftMeaningful: false,
    buildActiveDraft: () => {
      throw new Error('a pristine active draft must not be built');
    }
  });

  assert.deepEqual(outcome, {
    status: 'committed',
    sessionItems: [{ rowId: 'staged-tread' }]
  });
});

test('empty finish is rejected without closing or changing session rows', () => {
  const outcome = executeStairCreateTransaction<TestRow>({
    action: 'finish',
    stagedItems: [],
    activeDraftMeaningful: false,
    buildActiveDraft: () => {
      throw new Error('an empty finish must not build a draft');
    }
  });

  assert.equal(outcome.status, 'rejected');
  if (outcome.status !== 'rejected') return;
  assert.equal(outcome.issue.code, 'STAIR_FINISH_EMPTY');
  assert.equal(outcome.issue.focusTarget, 'stair-active-part');
  assert.deepEqual(outcome.preservedSessionItems, []);
});

test('validation rejection preserves staged rows and exposes its exact diagnostic', () => {
  const stagedItems = [{ rowId: 'staged-riser' }];
  const outcome = executeStairCreateTransaction<TestRow>({
    action: 'finish',
    stagedItems,
    activeDraftMeaningful: true,
    buildActiveDraft: () => ({
      ok: false,
      issue: {
        code: 'STAIR_LAYER_SOURCE_INVALID',
        message: 'منبع سنگ لایه معتبر نیست',
        focusTarget: 'stair-layer-source',
        phase: 'validate'
      }
    })
  });

  assert.equal(outcome.status, 'rejected');
  if (outcome.status !== 'rejected') return;
  assert.equal(outcome.issue.code, 'STAIR_LAYER_SOURCE_INVALID');
  assert.deepEqual(outcome.preservedSessionItems, stagedItems);
});

test('stage keeps the modal session open with the newly built rows', () => {
  const outcome = executeStairCreateTransaction<TestRow>({
    action: 'stage',
    stagedItems: [{ rowId: 'staged-tread' }],
    activeDraftMeaningful: true,
    buildActiveDraft: () => built([
      { rowId: 'staged-tread' },
      { rowId: 'visible-landing' }
    ])
  });

  assert.deepEqual(outcome, {
    status: 'staged',
    sessionItems: [
      { rowId: 'staged-tread' },
      { rowId: 'visible-landing' }
    ]
  });
});

test('meaningful draft detection ignores fresh defaults but detects entered geometry and layers', () => {
  assert.equal(hasMeaningfulStairDraft({
    layerConfigurations: [],
    lengthUnit: 'm',
    widthUnit: 'cm',
    widthCm: 30,
    tools: [],
    layerSourceKind: null,
    layerSelectedRemainingStoneIds: [],
    finishingEnabled: false,
    calibrationCutEnabled: false,
    calibrationSelection: 'automatic',
    useMandatory: false,
    mandatoryPercentage: null,
    description: ''
  }), false);

  assert.equal(hasMeaningfulStairDraft({
    layerConfigurations: [],
    lengthUnit: 'm',
    widthUnit: 'cm',
    widthCm: 30,
    lengthValue: '' as unknown as number,
    quantity: '' as unknown as number,
    pricePerSquareMeter: '' as unknown as number,
    standardLengthValue: '' as unknown as number,
    numberOfLayersPerStair: '' as unknown as number,
    tools: [],
    layerSourceKind: null,
    layerSelectedRemainingStoneIds: [],
    finishingEnabled: false,
    calibrationCutEnabled: false,
    calibrationSelection: 'automatic',
    useMandatory: false,
    mandatoryPercentage: null,
    description: ''
  }), false);

  assert.equal(hasMeaningfulStairDraft({
    layerConfigurations: [],
    lengthUnit: 'm',
    widthUnit: 'cm',
    widthCm: 30,
    lengthValue: 1.18,
    tools: [],
    layerSourceKind: null,
    layerSelectedRemainingStoneIds: [],
    finishingEnabled: false,
    calibrationCutEnabled: false,
    calibrationSelection: 'automatic',
    useMandatory: false,
    mandatoryPercentage: null,
    description: ''
  }), true);
});

test('discard confirmation is required for either a changed draft or staged row', () => {
  const pristine = {
    layerConfigurations: [],
    lengthUnit: 'm' as const,
    widthUnit: 'cm' as const,
    widthCm: 30,
    tools: [],
    layerSourceKind: null,
    layerSelectedRemainingStoneIds: [],
    finishingEnabled: false,
    calibrationCutEnabled: false,
    calibrationSelection: 'automatic' as const,
    useMandatory: false,
    mandatoryPercentage: null,
    description: ''
  };
  assert.equal(shouldConfirmStairDraftDiscard({
    drafts: [pristine],
    stagedRowCount: 0
  }), false);
  assert.equal(shouldConfirmStairDraftDiscard({
    drafts: [pristine],
    stagedRowCount: 1
  }), true);
  assert.equal(shouldConfirmStairDraftDiscard({
    drafts: [{ ...pristine, description: 'changed' }],
    stagedRowCount: 0
  }), true);
});


test('retained stone finishes without duplication; incomplete next rows still reject atomically', () => {
  const stone: Product = {
    id: 'stone-selection-test', code: 'QA-STONE', name: 'Stone', namePersian: 'گوهره',
    currency: 'تومان', isAvailable: true, cuttingDimensionNamePersian: 'طولی',
    stoneTypeNamePersian: 'مرمریت', widthValue: 40, thicknessValue: 2,
    widthName: '40', thicknessName: '2', mineNamePersian: 'خرم آباد',
    finishNamePersian: 'صیقل', colorNamePersian: '', qualityNamePersian: ''
  };
  const baseline = createStairDraftForStone('riser', stone, 40);
  const staged = [{ rowId: 'already-staged-riser' }];
  const result = executeStairCreateTransaction({
    action: 'finish', stagedItems: staged,
    activeDraftMeaningful: hasStairEntryChanges(baseline, baseline),
    buildActiveDraft: () => { throw new Error('retained stone is not another row'); }
  });
  assert.equal(result.status, 'committed');
  assert.deepEqual('sessionItems' in result && result.sessionItems, staged);
  for (const change of [{ lengthValue: 1.35 }, { widthCm: 14.5 },
    { pricePerSquareMeter: 1000000 }, { quantity: 39 }, { description: 'ردیف بعدی' }]) {
    const incomplete = { ...baseline, ...change };
    const rejected = executeStairCreateTransaction({
      action: 'finish', stagedItems: staged,
      activeDraftMeaningful: hasStairEntryChanges(incomplete, baseline),
      buildActiveDraft: () => ({ ok: false, issue: {
        code: 'REQUIRED_INPUT', message: 'complete the row', phase: 'validate', focusTarget: 'length'
      } })
    });
    assert.equal(rejected.status, 'rejected');
    assert.deepEqual('preservedSessionItems' in rejected && rejected.preservedSessionItems, staged);
  }
  const nextStone = { ...stone, id: 'next-stone', namePersian: 'تراورتن', widthValue: 35 };
  const drafts = (['tread', 'riser', 'landing'] as StairStepperPart[]).map(part =>
    createStairDraftForStone(part, nextStone));
  assert.ok(drafts.every(draft => draft.stoneId === nextStone.id &&
    draft.contractualTitle && draft.pricePerSquareMeter === null &&
    !draft.lengthValue && !draft.description && !draft.tools?.length));
  assert.notEqual(drafts[0].operationPolicyInput?.productRowId, drafts[1].operationPolicyInput?.productRowId);
});
