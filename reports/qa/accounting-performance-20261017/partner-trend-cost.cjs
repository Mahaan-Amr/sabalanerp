const url=new URL(process.env.DATABASE_URL);
url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=15000');
url.searchParams.set('connection_limit','2');process.env.DATABASE_URL=url.toString();
const {prisma}=require('/app/dist/lib/prisma');
console.info=()=>{};
const {readPartnerAccountingTrend}=require('/app/dist/services/partnerSales/accounting/history');
const {resolveFinancialTrendPeriods}=require('/app/dist/services/accountingFinancialTrend');
let count=0;
if(prisma.$use)prisma.$use(async(p,next)=>{count++;return next(p)});
(async()=>{
 const invoices=await prisma.accountingFinancialRecord.findMany({where:{sourceKind:'PARTNER_INTERNAL_RECORD'},select:{id:true,financiallyApprovedAt:true}});
 for(let i=0;i<2;i++){
  count=0;const now=new Date(),start=performance.now();
  const result=await readPartnerAccountingTrend(prisma,{invoiceIds:invoices.map(r=>r.id),periods:resolveFinancialTrendPeriods('6m',now),asOf:now});
  console.log(JSON.stringify({label:'partner-history-6m-component',ms:Math.round(performance.now()-start),queries:count,invoiceCount:invoices.length,
   approvedInvoiceCount:invoices.filter(r=>r.financiallyApprovedAt).length,currencySeries:result.length,
   note:'Diagnostic component only, not an actor-authorized HTTP timing. No amounts or identities printed.'}));
 }
})().catch(e=>{console.log(JSON.stringify({error:e.name,code:e.code||null}));process.exitCode=1}).finally(()=>prisma.$disconnect());
