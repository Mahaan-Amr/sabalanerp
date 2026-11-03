const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {prisma}=require('/app/accounting-qa-after/src/lib/prisma');
const sources={before:require('/app/accounting-qa-before/src/services/accountingService'),after:require('/app/accounting-qa-after/src/services/accountingService')};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const witness=result=>result.items?{ids:result.items.map(r=>r.contractId),total:result.total,totals:result.totals}
 :{commandCenter:result.workspace.commandCenter,deadlines:result.workspace.deadlines.typeCounts,trend:result.trend,trendError:result.trendError};
(async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sabalanerp_accounting_perf_20261017');
 const actor={userId:'historical-admin'},now=new Date('2026-10-17T06:00:00.000Z');
 const cases=[['contracts-first-page',s=>s.listAccountingContracts({page:1,pageSize:50},actor)],
  ['contracts-no-match',s=>s.listAccountingContracts({search:'ناموجود آزمایشی',page:1,pageSize:50},actor)],
  ['contracts-matched-search',s=>s.listAccountingContracts({search:'800123',page:1,pageSize:50},actor)],
  ['dashboard-6m',s=>s.getAccountingDashboard({},'6m',now,actor)],
  ['three-concurrent-contract-reads',s=>Promise.all(Array.from({length:3},()=>s.listAccountingContracts({page:1,pageSize:50},actor))).then(r=>r[0])]];
 const report={time:new Date().toISOString(),ordinary:800,partnerCases:await prisma.partnerSaleCase.count(),snapshotBytes:402883,
  methodology:'Actual frozen service implementations, same existing Docker backend/PostgreSQL, isolated schema-identical synthetic DB; alternating order, one warmup pair then five timed pairs per case. No other QA/build jobs during final measurement. Not browser or production p95.',results:[]};
 report.sourceHashes={};
 for(const variant of ['before','after'])report.sourceHashes[variant]=Object.fromEntries([
  'accountingService.ts','accountingListProjection.ts','partnerSales/accounting/preFinancialDocument.ts',
  'partnerSales/accounting/internalDocumentContent.ts','partnerSales/authorization/audited.ts',
  'partnerSales/authorization/centralAuthority.ts','partnerSales/authorization/workspaceAuthority.ts',
 ].map(file=>[file,hash(fs.readFileSync(`/app/accounting-qa-${variant}/src/services/${file}`,'utf8'))]));
 for(const [name,read] of cases){
  const samples={before:[],after:[]},witnesses={};
  for(let round=0;round<6;round++)for(const variant of round%2?['after','before']:['before','after']){
   const start=performance.now(),result=await read(sources[variant]);
   if(round>0)samples[variant].push(Math.round(performance.now()-start));
   witnesses[variant]=hash(witness(result));
  }
  assert.equal(witnesses.before,witnesses.after,`semantic mismatch ${name}`);
  const median=a=>[...a].sort((x,y)=>x-y)[2];
  const row={name,beforeMs:samples.before,afterMs:samples.after,beforeMedianMs:median(samples.before),afterMedianMs:median(samples.after),
   improvementPercent:Math.round((1-median(samples.after)/median(samples.before))*100),witnessHash:witnesses.after};
  report.results.push(row);console.log(JSON.stringify(row));
 }
 fs.writeFileSync('/app/accounting-qa-after/final-comparison.json',JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
