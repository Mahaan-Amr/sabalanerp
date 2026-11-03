import assert from 'node:assert/strict';
import { buildBiRecommendations, rankBiSellers } from '../biRecommendationService';

const recommendations = buildBiRecommendations({
  overdueReceivables: { count: 2, value: 800 },
  overdueDeliveries: { count: 1 },
  overdueFollowUps: { count: 2 },
  dueSoonDeliveries: { count: 2 },
  stalledPipeline: { count: 3, value: 1_200 },
  currentNetRealized: 600,
  previousNetRealized: 1_000,
  promisedWithoutLoading: { count: 2 },
  finalizedWithoutExit: { count: 1 },
  legacyUnassigned: { count: 1, value: 400 },
  crmWonWithoutContract: { count: 1 },
});

assert.deepEqual(
  recommendations.map((row) => row.id),
  [
    'overdue-collections', 'overdue-deliveries', 'overdue-follow-ups', 'stalled-pipeline', 'delivery-due-soon',
    'realized-deterioration', 'delivery-not-linked', 'guard-exit-not-linked',
    'legacy-attribution', 'crm-won-not-linked',
  ],
  'breaches lead, then imminent risk, deterioration, and reconciliation',
);
assert.equal(
  buildBiRecommendations({
    overdueReceivables: { count: 0, value: 0 }, overdueDeliveries: { count: 0 },
    stalledPipeline: { count: 0, value: 0 }, currentNetRealized: 0, previousNetRealized: 0,
    promisedWithoutLoading: { count: 0 }, finalizedWithoutExit: { count: 0 },
    legacyUnassigned: { count: 0, value: 0 },
  }).length,
  0,
  'a recommendation disappears with its source condition',
);

const sellerBase = { deteriorationPercent: null, lossRate: 0, netRealized: 0 };
assert.deepEqual(
  rankBiSellers([
    { ...sellerBase, name: 'فروشنده پرفروش', overdueFollowUpCount: 0, stalledPipelineCount: 0, netRealized: 1_000 },
    { ...sellerBase, name: 'فروشنده دارای توقف', overdueFollowUpCount: 0, stalledPipelineCount: 2, netRealized: 100 },
    { ...sellerBase, name: 'فروشنده دارای تعهد نقض‌شده', overdueFollowUpCount: 1, stalledPipelineCount: 0, netRealized: 50 },
  ]).map((row) => row.name),
  ['فروشنده دارای تعهد نقض‌شده', 'فروشنده دارای توقف', 'فروشنده پرفروش'],
  'seller ordering is exception-led without a composite score',
);

console.log('biRecommendationPolicy tests passed');
