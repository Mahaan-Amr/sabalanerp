const url=new URL(process.env.DATABASE_URL);
url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=15000');
url.searchParams.set('connection_limit','1');process.env.DATABASE_URL=url.toString();
const {prisma}=require('/app/dist/lib/prisma');
const {Prisma}=require('/app/node_modules/@prisma/client');
(async()=>{
 const roots=await prisma.partnerSaleCase.count({where:{internalRecordId:{not:null},customerContractId:{not:null}}});
 const controls=await prisma.partnerOperationsControl.count({where:{id:'partner-operations'}});
 const activeQueries=await prisma.$queryRaw`SELECT state, wait_event_type, wait_event, count(*)::int AS count
 FROM pg_stat_activity WHERE datname=current_database() GROUP BY state,wait_event_type,wait_event`;
 const connections=new URL(process.env.DATABASE_URL);
 console.log(JSON.stringify({partnerRoots:roots,globalLockRows:controls,probePool:connections.searchParams.get('connection_limit'),activeQueries}));
 const contracts=await prisma.salesContract.findMany({where:{partnerCaseId:null,partnerKind:null,isInactive:false},select:{id:true}});
 const ids=Prisma.join(contracts.map(row=>row.id));
 const plans=await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
 SELECT id,jsonb_build_object('contractDate',"contractData"->'contractDate','date',"contractData"->'date',
 'contract',jsonb_build_object('date',"contractData"->'contract'->'date')) AS "contractData"
 FROM sales_contracts WHERE id IN (${ids})`);
 const plan=plans[0]['QUERY PLAN'][0];
 function compact(p){return {node:p['Node Type'],relation:p['Relation Name'],rows:p['Actual Rows'],ms:p['Actual Total Time'],
 hits:p['Shared Hit Blocks'],reads:p['Shared Read Blocks'],children:p.Plans?.map(compact)}}
 console.log(JSON.stringify({label:'actual-list-date-projection',contracts:contracts.length,planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],plan:compact(plan.Plan)}));
 const simple=await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM sales_contracts WHERE id IN (${ids})`);
 const p=simple[0]['QUERY PLAN'][0];
 console.log(JSON.stringify({label:'same-ids-without-json-date-extraction',planningMs:p['Planning Time'],executionMs:p['Execution Time'],plan:compact(p.Plan)}));
})().catch(e=>{console.log(JSON.stringify({error:e.name,code:e.code||null}));process.exitCode=1}).finally(()=>prisma.$disconnect());
