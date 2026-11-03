const assert=require('node:assert/strict');
const {prisma}=require('/app/accounting-qa-after/src/lib/prisma');
const before=require('/app/accounting-qa-before/src/services/accountingService');
const after=require('/app/accounting-qa-after/src/services/accountingService');
const oldDates=require('/app/accounting-qa-before/src/services/accountingListProjection');
const newDates=require('/app/accounting-qa-after/src/services/accountingListProjection');
(async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sabalanerp_accounting_perf_20261017');
 const actor={userId:'historical-admin'};
 let scopes=0;const transaction=prisma.$transaction.bind(prisma);
 prisma.$transaction=(...args)=>{scopes++;return transaction(...args)};
 let previous,current;
 try{
  scopes=0;previous=await before.listAccountingContracts({},actor);const oldScopes=scopes;
  scopes=0;current=await after.listAccountingContracts({},actor);const newScopes=scopes;
  assert.deepEqual(current,previous);assert.equal(oldScopes,2);assert.equal(newScopes,1);
  console.log(JSON.stringify({scopeTransactionsBefore:oldScopes,scopeTransactionsAfter:newScopes}));
 }finally{prisma.$transaction=transaction;}
 for(const search of ['زارع حسن','800123 حسن','زارع ۸۰۰۱۲۳','زارع SIGNED','زارع NONE','زارع NOT_READY',
  'زارع 2026','زارع T00','زارع 0012345678','زارع 998877','محمد حسن زارع','ناموجود زارع']){
  const result=await after.listAccountingContracts({search,pageSize:100},actor);
  if(search==='ناموجود زارع')assert.equal(result.total,0);
  else if(search.includes('800123')||search.includes('۸۰۰۱۲۳'))assert.equal(result.total,1);
  else assert(result.total>0,search);
 }
 const results=await Promise.all(Array.from({length:6},(_,i)=>after.listAccountingContracts({page:i%2+1,pageSize:50},actor)));
 for(const result of results)assert.equal(result.total,current.total);
 // PostgreSQL's JSON extraction must keep all old malformed/legacy fallbacks.
 for(const shape of [null,'legacy',[{date:'2026-01-01'}],42,{}, {date:'1405/01/01'},
  {contractDate:null,date:false,contract:{date:123}}, {contractDate:{nested:true},contract:'bad'}]){
  const rollback=new Error('rollback date fixture');
  await assert.rejects(prisma.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
   await tx.salesContract.update({where:{id:'perf-0'},data:{contractData:shape===null?require('@prisma/client').Prisma.JsonNull:shape}});
   assert.deepEqual(await newDates.attachAccountingListDates(tx,[{id:'perf-0'}]),await oldDates.attachAccountingListDates(tx,[{id:'perf-0'}]));
   throw rollback;
  }),e=>e===rollback);
 }
 console.log(JSON.stringify({verdict:'PASS',multiwordQueries:12,concurrentReads:6,dateShapes:8,total:current.total}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
