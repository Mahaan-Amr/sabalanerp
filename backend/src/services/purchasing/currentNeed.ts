import {ordinaryPurchaseDemands} from './ordinaryDemand';
import {partnerPurchaseSource} from './source';
import {add,sub,max,min,type Doc} from './domain';
import type {Tx} from './repository';
/** Internal projection only. Public callers authorize the containing document. */
export async function currentRequestNeed(tx:Tx,request:Doc) {
  if(!request.contractId)return {quantity:request.data.quantity,version:request.data.sourceVersion};
  const identity=await tx.salesContract.findUnique({where:{id:request.contractId},select:{partnerCaseId:true}});
  if(identity?.partnerCaseId)await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id=${identity.partnerCaseId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id=${request.contractId} FOR UPDATE`;
  const contract=await tx.salesContract.findUnique({where:{id:request.contractId},include:{productGraphState:true,items:{where:{retiredAt:null},include:{product:true}}}});
  if(!contract||contract.isInactive||['CANCELLED','EXPIRED'].includes(contract.status)||request.status==='CANCELLED')return {quantity:'0',version:contract?.commercialRevision??request.data.sourceVersion};
  let total:string,version=contract.commercialRevision;
  if(contract.partnerCaseId){const views=await partnerPurchaseSource(tx,contract.partnerCaseId);total=views.partner.products.find(p=>p.productRowId===request.data.itemId)?.quantity||'0';version=views.row.headRevision;}
  else total=ordinaryPurchaseDemands(contract).get(request.data.itemId)?.quantity.toFixed()||'0';
  const peers=await tx.purchasingDocument.findMany({where:{kind:'REQUEST',contractId:request.contractId,status:{not:'CANCELLED'},data:{path:['itemId'],equals:request.data.itemId}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,data:true}});
  const index=peers.findIndex(p=>p.id===request.id),before=add(...peers.slice(0,Math.max(0,index)).map(p=>(p.data as any).quantity));
  return {quantity:min(request.data.quantity||total,max('0',sub(total,before))),version};
}
