const {PrismaClient}=require('/app/node_modules/@prisma/client');
const {resolveSavedTechnicalConfiguration,createSavedTechnicalConfigurationResolver}=require('/tmp/sabalan-performance-candidate-20261011/candidate-resolver.cjs');
const db=new PrismaClient();
(async()=>{
 const [selected]=await db.$queryRawUnsafe(`SELECT r."inquiryId" FROM partner_inquiry_rows r JOIN sales_contract_edit_sessions s ON s."draftId"=r.definition->'configurationRef'->>'recoveryId' ORDER BY octet_length(s.recovery::text) DESC LIMIT 1`);
 if(!selected)throw new Error('No matching frozen technical reference');
 const rows=await db.partnerInquiryRow.findMany({where:{inquiryId:selected.inquiryId},select:{definition:true}});
 const inputs=[];for(const row of rows){const ref=row.definition.configurationRef;const session=await db.salesContractEditSession.findUnique({where:{draftId:ref.recoveryId},select:{ownerUserId:true}});if(session)inputs.push({actorId:session.ownerUserId,reference:ref});}
 for(const mode of ['candidate-operation-cache']){
  const resolver=mode==='current-uncached'?resolveSavedTechnicalConfiguration:createSavedTechnicalConfigurationResolver();
  const start=performance.now();let good=0;
  await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');for(const input of inputs){const result=await resolver(tx,input);if(result.ok)good++;}},{timeout:90000});
  console.log(JSON.stringify({mode,rows:inputs.length,ok:good,durationMs:Math.round(performance.now()-start)}));
 }
})().catch(e=>{console.error(JSON.stringify({error:e.code||e.name}));process.exitCode=1;}).finally(()=>db.$disconnect());
