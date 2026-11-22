import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { resolvePartnerTechnicalServices } from '../partnerSales/cases/technicalServices';
import { partnerCustomerGraphTotal } from '../partnerSales/cases/customerGraphTotal';
import { compilePartnerTechnicalGraph } from '../partnerSales/cases/technicalGraph';
import type { TechnicalSavedSnapshot } from '../partnerSales/cases/technicalSavedRecords';
const version = '2026-10-03T00:00:00.000Z';
const source = {id: 'service', namePersian: 'ساب', isActive: true, updatedAt: new Date(version), pricePerMeter: new Prisma.Decimal(100), calculationBase: 'length'};
const draft = PartnerTechnicalDraftSchema.parse({schemaVersion:1,inputRevision:1,rows:[], serviceRows:[{serviceRowId:'service-row',sourceType:'tool',catalogItemId:'service',catalogSnapshotVersion:version,title:'خدمت قرارداد',unit:'meter',quantity:'2.5',retailUnitPrice:{amount:'2000',currency:'IRR'}}]});
const tx = {subService: {findUnique: async () => source}} as unknown as Prisma.TransactionClient;
test('service-only uses genuine retail input and trusted frozen service rate without stone inquiry', async () => {
  const result = await resolvePartnerTechnicalServices(tx,draft);
  assert.equal(result.ok,true); if (!result.ok) return;
  assert.equal(result.value[0].retailUnitPrice.amount,'200');
  assert.equal(result.value[0].wholesaleUnitPriceAmount,'100');
  assert.equal(result.value[0].title,'خدمت قرارداد');
  const graph = compilePartnerTechnicalGraph(draft,{catalog:{products:[],operations:[],sawKerfMeters:'0'},products:[],policy:{calculation:'c',packing:'p',pricing:'p',rounding:'r'}});
  assert.equal(graph.ok,true); if (!graph.ok) return;
  assert.equal(graph.value.graph.rows.length,0);
  assert.deepEqual(partnerCustomerGraphTotal(graph.value.graph,draft,{amount:'0',currency:'IRT'}),{amount:'500',currency:'IRT'});
});
test('service save rejects stale rates, unit spoofing, zero input and identity collision',async()=>{
  for(const change of [{catalogSnapshotVersion:'2026-10-02T00:00:00.000Z'}, {unit:'squareMeter'}, {quantity:'0'}, {retailUnitPrice:{amount:'0',currency:'IRT'}}]) {
    const result=await resolvePartnerTechnicalServices(tx,PartnerTechnicalDraftSchema.parse({...draft,serviceRows:[{...draft.serviceRows![0],...change}]}));
    assert.equal(result.ok,false); if(!result.ok)assert.equal(result.error.code,'catalogSnapshotVersion' in change?'ROW_STALE':'INVALID_PAYLOAD');
  }
  const repeated = await resolvePartnerTechnicalServices(tx,{...draft,serviceRows:[draft.serviceRows![0],draft.serviceRows![0]]}); assert.equal(repeated.ok,false);
});

test('a product/service edit refreshes an existing service rate and records its new source version', async () => {
  const current = { ...source };
  const database = { subService: { findUnique: async () => current } } as unknown as Prisma.TransactionClient;
  const first = await resolvePartnerTechnicalServices(database, draft);
  assert.ok(first.ok);
  const previous = { draft, serviceRows: first.value } as TechnicalSavedSnapshot;
  current.updatedAt = new Date('2026-10-13T00:00:00Z');
  current.pricePerMeter = new Prisma.Decimal('300');
  const nextDraft = PartnerTechnicalDraftSchema.parse({ ...draft, serviceRows: [{ ...draft.serviceRows![0], quantity: '3' }] });
  const next = await resolvePartnerTechnicalServices(database, nextDraft, previous);
  assert.ok(next.ok);
  assert.equal(next.value[0].wholesaleUnitPriceAmount, '300');
  assert.equal(next.value[0].retailUnitPrice.amount, '200');
  assert.equal(next.value[0].rateCatalogSnapshotVersion, current.updatedAt.toISOString());
  assert.notEqual(next.value[0].rateEvidenceId, first.value[0].rateEvidenceId);
  assert.equal(first.value[0].wholesaleUnitPriceAmount, '100');
  const noReads = new Proxy({}, { get: () => { throw new Error('No service edit'); } });
  const unchanged = await resolvePartnerTechnicalServices(noReads as Prisma.TransactionClient, { ...draft, inputRevision: 999 }, previous);
  assert.deepEqual(unchanged, first);
  current.isActive = false;
  const inactive = await resolvePartnerTechnicalServices(database, nextDraft, previous);
  assert.ok(!inactive.ok);
  assert.match(inactive.error.message, /خدمت.*ساب.*غیرفعال/);
});
