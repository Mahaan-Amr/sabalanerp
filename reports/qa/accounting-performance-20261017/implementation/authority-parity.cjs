const assert=require('node:assert/strict');
const {prisma}=require('/app/accounting-qa-after/src/lib/prisma');
const {resolvePartnerScopedAuthority:full,resolvePartnerAccountingScopedAuthority:narrow}=require('/app/accounting-qa-after/src/services/partnerSales/authorization/centralAuthority');
const {FEATURES}=require('/app/accounting-qa-after/src/middleware/feature');
const {grantScopedAction}=require('/app/accounting-qa-after/src/services/effectiveAuthorization/scopedActions');
const normalize=value=>JSON.stringify(value.grants.filter(g=>g.purpose==='ACCOUNTING').sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
(async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sabalanerp_accounting_perf_20261017');
 let comparisons=0;
 const check=async(tx,actorId)=>{
  for(const kind of ['CASE','PROFILE']){
   const input={actorId,root:{kind,id:kind==='CASE'?'historical-case':'historical-profile'}};
   const old=await full(tx,input),next=await narrow(tx,input);
   assert.equal(next.authorizationRevision,old.authorizationRevision);assert.equal(normalize(next),normalize(old));comparisons++;
  }
 };
 for(const actorId of ['historical-admin','historical-partner'])await prisma.$transaction(tx=>check(tx,actorId));
 for(const mode of ['none','view','edit','admin','disabled','expired','deny','narrow','report','inactive']){
  const rollback=new Error('rollback permission fixture');
  await assert.rejects(prisma.$transaction(async tx=>{
   const id=`authority-parity-${mode}`;
   await tx.user.create({data:{id,username:id,email:`${id}@example.invalid`,password:'not-a-login',firstName:'Parity',lastName:'Fixture',role:'USER',isActive:mode!=='inactive'}});
   if(mode!=='none'){
    await tx.workspacePermission.create({data:{userId:id,workspace:'accounting',permissionLevel:['view','edit','admin'].includes(mode)?mode:'admin',
     ...(mode==='expired'?{expiresAt:new Date('2020-01-01')}: {})}});
    for(const feature of [FEATURES.ACCOUNTING_CONTRACTS_VIEW,FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE,
      FEATURES.ACCOUNTING_CORRECTIONS_MANAGE,FEATURES.ACCOUNTING_CORRECTIONS_APPROVE,FEATURES.ACCOUNTING_CORRECTIONS_VERIFY,
      FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE].filter(Boolean))
     await tx.featurePermission.create({data:{userId:id,workspace:'accounting',feature,permissionLevel:mode==='disabled'?'none':mode==='view'?'view':'admin'}});
   }
   if(['deny','narrow','report'].includes(mode))for(const rootKind of mode==='report'?['CASE','PROFILE']:['CASE'])
    await grantScopedAction(tx,{actorId:'historical-admin',reason:'isolated parity test',correlationId:id+rootKind},{principal:{kind:'USER',id},domain:'PARTNER',
     action:mode==='report'?'REPORT_READ':'ACCOUNTING_READ',rootKind,purpose:'ACCOUNTING',scope:mode==='narrow'?'PURPOSE_BOUND':'COMPANY',
     ...(mode==='narrow'?{boundRootId:'historical-case'}:{}),effect:mode==='deny'?'DENY':'ALLOW'});
   await check(tx,id);throw rollback;
  },{timeout:30000}),e=>e===rollback);
 }
 console.log(JSON.stringify({verdict:'PASS',comparisons,scenarios:12,note:'Same Accounting-purpose grants and authorization revisions for CASE/PROFILE; every fixture mutation rolled back.'}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
