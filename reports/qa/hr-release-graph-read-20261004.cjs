const fs=require('node:fs');
const {prisma,disconnectDatabase}=require('/app/dist/lib/prisma');
const {buildLegacyContractMigrationPlan}=require('/app/dist/services/contractProductGraphMigration');
const {readCurrentPartnerCaseViews}=require('/app/dist/services/partnerSales/cases/lifecycle');
const {canonicalHash}=require('/app/node_modules/@sabalanerp/partner-sales-contracts');
const {auditPartnerContractProductGraph}=require('/tmp/hr-release-product-audit-probe-20261005.cjs');
(async()=>{
 const c=await prisma.salesContract.findUnique({where:{contractNumber:'100634'},select:{id:true,contractNumber:true,status:true,isSigned:true,partnerKind:true,partnerCaseId:true,createdAt:true,totalAmount:true,contractData:true,items:{select:{id:true,productId:true,quantity:true,totalPrice:true}}}});
 if(!c)throw Error('Contract not found');
 const data=c.contractData||{};
 const fixture={id:c.id,totalAmount:String(c.totalAmount),contractData:{products:data.products}};
 const views=await prisma.$transaction(tx=>readCurrentPartnerCaseViews(tx,c.partnerCaseId),{isolationLevel:'RepeatableRead'});
 console.log(JSON.stringify({releaseAudit:await prisma.$transaction(tx=>auditPartnerContractProductGraph(tx,c.id),{isolationLevel:'RepeatableRead'})}));
 console.log(JSON.stringify({partnerOwnerVerified:Boolean(views),reciprocalContract:views?.row.customerContractId===c.id,customerProjectionMatches:views?await canonicalHash(c.contractData)===await canonicalHash(views.row.head.customerProjection):false}));
 fs.writeFileSync('/tmp/hr-blocked-contract-products.json',JSON.stringify(fixture));
 console.log(JSON.stringify({contractNumber:c.contractNumber,status:c.status,isSigned:c.isSigned,partnerKind:c.partnerKind,createdAt:c.createdAt,keys:Object.keys(data),items:c.items,products:data.products?.map(p=>({keys:Object.keys(p),productId:p.productId,id:p.id,productType:p.productType,catalogProductId:p.catalogProductId,product:p.product,metaKeys:Object.keys(p.meta||{})})),plan:buildLegacyContractMigrationPlan(fixture)}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(disconnectDatabase);
