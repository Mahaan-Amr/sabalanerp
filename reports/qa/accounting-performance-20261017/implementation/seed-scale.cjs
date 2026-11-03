const assert=require('node:assert/strict');
const {prisma}=require('/app/accounting-qa-after/src/lib/prisma');
const {seedHistoricalAccountingRead}=require('/app/accounting-qa-after/src/services/__tests__/partnerAccountingHistoricalReadSeed');
(async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sabalanerp_accounting_perf_20261017');
 await seedHistoricalAccountingRead(prisma);
 await prisma.partnerOperationsControl.create({data:{id:'partner-operations'}});
 await prisma.crmCustomer.create({data:{id:'perf-customer',firstName:'حسن محمد',lastName:'زارع',nationalCode:'0012345678',
  customFields:{economicCode:'998877'},createdBy:'historical-admin'}});
 const body={contractDate:'1405/07/01',date:'2026-09-23',contract:{date:'2026-09-23'},
  technicalHistory:Array.from({length:1500},(_,i)=>({revision:i,description:`historical geometry ${i}`,facts:'saved technical evidence '.repeat(8)}))};
 for(let start=0;start<800;start+=25)await prisma.salesContract.createMany({data:Array.from({length:25},(_,offset)=>{
  const index=start+offset;return {id:`perf-${index}`,contractNumber:String(800000+index),title:'Performance fixture',
   titlePersian:`قرارداد آزمایشی ${index}`,content:'Local performance fixture only',customerId:'perf-customer',
   departmentId:'historical-department',createdBy:'historical-admin',responsibleSellerId:'historical-admin',
   status:index%10===0?'DRAFT':'SIGNED',totalAmount:String(100000+index),currency:'RIAL',
   contractData:body,createdAt:new Date(Date.UTC(2026,8,1,0,0,index))};})});
 console.log(JSON.stringify({seededOrdinary:800,partnerCases:1,bytesPerTechnicalSnapshot:Buffer.byteLength(JSON.stringify(body))}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
