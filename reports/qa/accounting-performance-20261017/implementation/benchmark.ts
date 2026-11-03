import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const { prisma } = require(`${process.env.ACCOUNTING_QA_SOURCE_ROOT}/lib/prisma`);
const { listAccountingContracts, getAccountingDashboard } = require(`${process.env.ACCOUNTING_QA_SOURCE_ROOT}/services/accountingService`);

const fixedNow = new Date('2026-10-17T06:00:00.000Z');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.ACCOUNTING_QA_IN_CONTAINER !== '1' || url.hostname !== 'postgres') throw new Error('Existing local Docker only');
  const actor = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  const counts = { ordinary: await prisma.salesContract.count({ where: { partnerCaseId: null, partnerKind: null, isInactive: false } }),
    partner: await prisma.partnerSaleCase.count(), financial: await prisma.accountingFinancialRecord.count() };
  const sample = await prisma.salesContract.findFirstOrThrow({ where: {partnerCaseId:null,partnerKind:null,isInactive:false}, select:{contractNumber:true} });
  const cases = [
    { name: 'contracts-first-page', read: () => listAccountingContracts({ page: 1, pageSize: 50 }, { userId: actor.id }) },
    { name: 'contracts-no-match', read: () => listAccountingContracts({ search: '__diagnostic_no_match_20261017__', page: 1, pageSize: 50 }, { userId: actor.id }) },
    { name: 'contracts-matched-search', read: () => listAccountingContracts({ search: sample.contractNumber, page: 1, pageSize: 50 }, { userId: actor.id }) },
    { name: 'dashboard-6m', read: () => getAccountingDashboard({}, '6m', fixedNow, { userId: actor.id }) },
  ];
  const results: any[] = [];
  for (const entry of cases) {
    const samples: number[] = []; let witness: unknown;
    for (let i = 0; i < 6; i++) {
      const start = performance.now(); const result: any = await entry.read();
      const ms = Math.round(performance.now() - start);
      // First call is warmup. Hash only semantic summaries, never customer data.
      witness = result.items ? { ids: result.items.map((r: any) => r.contractId), total: result.total, totals: result.totals }
        : { commandCenter: result.workspace.commandCenter, deadlines: result.workspace.deadlines.typeCounts,
          trend: result.trend, trendError: result.trendError };
      if (i > 0) samples.push(ms);
    }
    results.push({ name: entry.name, samplesMs: samples, medianMs: [...samples].sort((a,b)=>a-b)[2], witnessHash: hash(witness) });
    console.log(JSON.stringify(results.at(-1)));
  }
  const started = performance.now();
  await Promise.all(Array.from({ length: 3 }, () => cases[0].read()));
  results.push({ name: 'three-concurrent-contract-reads', totalMs: Math.round(performance.now() - started) });
  console.log(JSON.stringify(results.at(-1)));
  const report = { checkedAt: new Date().toISOString(), fixedNow, counts, results,
    note: 'Frozen before/after source inside existing local backend and PostgreSQL, authenticated ADMIN service calls. Five warm samples after one warmup. Not browser/network p95.' };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
}
main().catch(e => { console.error({ code: e.code, message: e.message }); process.exitCode=1; }).finally(()=>prisma.$disconnect());
