const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { prisma } = require('/app/accounting-qa-after/src/lib/prisma');
const before = require('/app/accounting-qa-before/src/services/accountingService');
const after = require('/app/accounting-qa-after/src/services/accountingService');
const { normalizePersianSearchTokens } = require('/app/accounting-qa-after/src/services/crmCustomerSearch');
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function history() {
  const rows = [];
  for (const table of ['accounting_financial_records', 'accounting_receivables', 'accounting_payment_statuses',
    'accounting_tax_records', 'accounting_audit_logs', 'partner_case_revisions', 'partner_payment_plans']) {
    rows.push(await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM ${table} t`));
  }
  return digest(rows);
}
(async()=>{
  const initialHistory = await history();
  const actor = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  let checks = 0;
  const queries = [{}, {page:2}, {page:3}, {lifecycleView:'inactive'}, {lifecycleView:'pending'}, {view:'reviewable'},
    {sort:'amount_desc'}, {sort:'amount_asc'}, {sort:'oldest'}, {sort:'attention'},
    ...['ELIGIBLE','VISIBLE_ONLY','NEEDS_CORRECTION','HAS_FINANCIAL_RECORDS'].map(sourceStatus=>({sourceStatus})),
    ...['DRAFT','SIGNED','CANCELLED'].map(status=>({status})),
    ...['NONE','ISSUED','NOT_READY','VOIDED','2026','__diagnostic_no_match_20261017__'].map(search=>({search})),
    {dateFrom:'2026-01-01',dateTo:'2026-10-17'}, {taxStatus:'NOT_READY'}];
  for (const query of queries) {
    const a = await before.listAccountingContracts(query, {userId:actor.id});
    const b = await after.listAccountingContracts(query, {userId:actor.id});
    assert.deepEqual(b, a, `semantic drift: ${JSON.stringify(query)}`); checks++;
  }
  const all = [];
  for (let page=1;;page++) {
    const response = await before.listAccountingContracts({page,pageSize:100}, {userId:actor.id});
    all.push(...response.items); if(all.length>=response.total)break;
  }
  const sample = all.find(r=>r.sourceKind!=='PARTNER_INTERNAL_RECORD' && r.customer.displayName.split(/\s+/).length>1);
  assert(sample);
  const words = sample.customer.displayName.split(/\s+/);
  for(const search of [`${words.at(-1)} ${words[0]}`, `${sample.contractNumber} ${words[0]}`]) {
    const result=await after.listAccountingContracts({search,pageSize:100},{userId:actor.id});
    assert(result.items.some(r=>r.contractId===sample.contractId),'separated words must find the fixture'); checks++;
  }
  const now=new Date('2026-10-17T06:00:00.000Z');
  for(const range of ['1m','3m','6m','1y']) {
    assert.deepEqual(await after.getAccountingDashboard({},range,now,{userId:actor.id}),
      await before.getAccountingDashboard({},range,now,{userId:actor.id}),`dashboard drift ${range}`);checks++;
  }
  const {readPartnerPreparationDocument}=require('/app/accounting-qa-after/src/services/partnerSales/accounting/preFinancialDocument');
  const {withAccountingReadScope}=require('/app/accounting-qa-after/src/services/partnerSales/accounting/readScope');
  await withAccountingReadScope(prisma,{userId:actor.id},async scope=>{
    const roots=await scope.database.partnerSaleCase.findMany({where:{internalRecordId:{not:null},customerContractId:{not:null}},select:{id:true}});
    for(const root of roots){
      const full=await readPartnerPreparationDocument(scope.database,actor.id,root.id);
      const list=await readPartnerPreparationDocument(scope.database,actor.id,root.id,'list');
      if(!full){assert.equal(list,null);continue;}
      assert(list);
      for(const key of ['amount','amountKnown','commercial','canRegister','owner','partnerContext','contractDate','totals','paymentPlan'])
        assert.deepEqual(list[key],full[key],`summary drift ${key}`);
      assert.deepEqual(list.items,[]);checks++;
    }
  });
  assert.equal(await history(),initialHistory,'read paths must not rewrite financial records or retained history');
  console.log(JSON.stringify({verdict:'PASS',checks,ordinaryAndPartnerRows:all.length,financialHistoryUnchanged:true}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
