const fs = require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {PrismaClient}=require('/app/node_modules/@prisma/client');
const {createAccountingLedgerAdministration,validateAccountDefinition}=require('/app/dist/services/accountingLedgerAdministration');
const {createCustomerPostingRulePrisma}=require('/app/dist/services/accountingCustomerTreasuryPrisma');
const {createAccountingLedgerPrismaRepository,verifyLedgerAuditChain}=require('/app/dist/services/accountingLedgerPrismaRepository');
const {getEffectiveUserAccess}=require('/app/dist/services/effectiveAccessService');
const {readCustomerWorkspaceContext}=require('/app/dist/services/accountingCustomerWorkspace');
const db=new PrismaClient();
const bytes=fs.readFileSync('/tmp/accounting-setup-plan-20261006.json');
const planHash=createHash('sha256').update(bytes).digest('hex');
if(planHash!=='34ac0ecbf764c28114c57baf9027fd127f2111c33184c3ef244f600da6f208e2')throw Error('Reviewed setup plan checksum mismatch');
const plan=JSON.parse(bytes);
const effectiveFrom=new Date(plan.effectiveFrom);
const ruleCode='SEPIDAR_CUSTOMER_IRR';
const actor={id:plan.actorId,profile:'ACCOUNTING_MANAGER',isGlobalAdmin:true};
const sameAccount=(row,a)=>['code','titlePersian','level','statementRole','normalSide','partyRequirement','financialAccountRequirement'].every(k=>row[k]===a[k]) && row.codeSchemeId===plan.codeSchemeId && row.effectiveFrom.getTime()===effectiveFrom.getTime() && row.retiredAt===null;
async function preflight(){
  const user=await db.user.findUnique({where:{id:actor.id},select:{id:true,username:true,role:true,isActive:true}});
  if(!user?.isActive||user.username!=='admin'||user.role!=='ADMIN')throw Error('Expected active administrator not found');
  const access=await getEffectiveUserAccess(db,{userId:user.id,userRole:user.role});
  if(!access.workspaces.some(w=>w.workspace==='accounting'&&w.permission==='admin'))throw Error('Accounting manager authority required');
  if(await db.deploymentOperation.count({where:{activeKey:{not:null}}}))throw Error('Active deployment boundary; configuration refused');
  const book=await db.accountingBook.findUnique({where:{id:plan.bookId},include:{legalEntity:true,codeSchemes:true}});
  const scheme=book?.codeSchemes.find(s=>s.id===plan.codeSchemeId);
  if(!book?.isPrimary||book.legalEntityId!==plan.legalEntityId||book.baseCurrency!=='IRR'||book.legalEntity.namePersian!=='سنگ سبلان'||!scheme||scheme.retiredAt||scheme.groupLength!==2||scheme.kolLength!==2||scheme.moinLength!==2)throw Error('Production book identity or code scheme mismatch');
  const existing=await db.accountingLedgerAccount.findMany({where:{bookId:plan.bookId}});
  for(const a of plan.accounts){
    validateAccountDefinition(scheme,{code:a.code,level:a.level,parent:a.parentCode?plan.accounts.find(p=>p.code===a.parentCode):null});
    const row=existing.find(r=>r.code===a.code);if(row&&!sameAccount(row,a))throw Error(`Existing account meaning conflict: ${a.code}`);
  }
  if(existing.some(r=>!plan.accounts.some(a=>a.code===r.code)))throw Error('Independently maintained chart detected; review required');
  if(!(await verifyLedgerAuditChain(db)).valid)throw Error('Audit chain invalid');
  const year=await db.accountingFiscalYear.findFirst({where:{bookId:book.id,status:'ACTIVE',startsAt:{lte:new Date()},endsAt:{gte:new Date()}},include:{periods:true}});
  if(!year?.periods.some(p=>p.status==='OPEN'&&p.startsAt<=new Date()&&p.endsAt>=new Date()))throw Error('Current open fiscal period required');
  return {user,book,existing,year};
}
(async()=>{
  const before=await preflight();
  console.log(JSON.stringify({phase:'preflight',accountCount:plan.accounts.length,existingAccountCount:before.existing.length,currentYear:before.year.titlePersian,sourceHashesVerified:true,apply:process.argv.includes('--apply')}));
  if(!process.argv.includes('--apply'))return;
  const administration=createAccountingLedgerAdministration(db);
  const byCode=new Map(before.existing.map(r=>[r.code,r]));
  for(const level of ['GROUP','KOL','MOIN'])for(const a of plan.accounts.filter(a=>a.level===level)){
    if(byCode.has(a.code))continue;
    const created=await administration.createAccount({bookId:plan.bookId,codeSchemeId:plan.codeSchemeId,code:a.code,titlePersian:a.titlePersian,level:a.level,normalSide:a.normalSide,statementRole:a.statementRole,currencyBehavior:'BASE_ONLY',parentId:a.parentCode?byCode.get(a.parentCode).id:undefined,partyRequirement:a.partyRequirement,financialAccountRequirement:a.financialAccountRequirement,effectiveFrom,actorId:actor.id});
    byCode.set(a.code,created);
  }
  const accountFields=Object.fromEntries(Object.entries(plan.roles).map(([role,code])=>[`${role}AccountId`,byCode.get(code).id]));
  const rule=await db.$transaction(async tx=>{
    const existing=await tx.accountingCustomerPostingRule.findUnique({where:{legalEntityId_code_version:{legalEntityId:plan.legalEntityId,code:ruleCode,version:1}}});
    if(existing){if(!Object.entries(accountFields).every(([k,v])=>existing[k]===v)||existing.effectiveFrom.getTime()!==effectiveFrom.getTime()||existing.effectiveTo)throw Error('Existing customer rule conflict');return existing;}
    const created=await createCustomerPostingRulePrisma(tx,{legalEntityId:plan.legalEntityId,code:ruleCode,version:1,...accountFields,effectiveFrom,actor});
    await createAccountingLedgerPrismaRepository(tx,true).appendAudit({action:'CUSTOMER_POSTING_RULE_CONFIGURED',result:'SUCCEEDED',actorId:actor.id,effectiveProfile:actor.profile,entityType:'CUSTOMER_POSTING_RULE',entityId:created.id,correlationId:randomUUID(),reason:'پیکربندی تخصیص دریافت بر اساس حساب‌های واقعی بکاپ سپیدار به درخواست مالک پروژه',payloadHash:planHash,sessionContext:{purpose:'PRODUCTION_CUSTOMER_ACCOUNTING_CONFIGURATION',sourceProposalHash:plan.sourceProposalHash,sourceSnapshotId:plan.sourceSnapshotId,sourcePackageHash:plan.sourcePackageHash,accounts:plan.accounts.map(a=>({targetId:byCode.get(a.code).id,code:a.code,sourceTable:'ACC.Account',sourceId:a.sourceId,sourceHash:a.sourceHash}))}});
    return created;
  },{isolationLevel:'Serializable',timeout:30000});
  await preflight();
  const context=await readCustomerWorkspaceContext(db,'cmutt5gof097hyntykj8ksoqg');
  const audit=await verifyLedgerAuditChain(db);
  if(!context.rules.some(r=>r.id===rule.id)||context.accounts.length!==7||!audit.valid)throw Error('Post-configuration verification failed');
  console.log(JSON.stringify({phase:'verified',accounts:byCode.size,postingAccounts:context.accounts.length,rule:{id:rule.id,code:rule.code,version:rule.version},openPeriods:context.periods.length,financialAccounts:context.financialAccounts.length,audit,receipts:await db.accountingTreasuryTransaction.count(),openItems:await db.accountingCustomerOpenItem.count(),vouchers:await db.accountingLedgerVoucher.count()}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
