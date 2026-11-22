import {catalogSupportsFamily,type CatalogFamily} from '@sabalanerp/partner-sales-contracts';
import {Prisma} from '@prisma/client';
import {prisma} from '../../lib/prisma';
import {accessFor,assertCapability,type Actor} from './access';
import {hash,json,asDoc,type Tx} from './repository';
import {PurchasingError,text,label,type JsonObject} from './domain';

// Purchasing reads the same catalog identities without inheriting Sales price
// fields or requiring the caller to have access to the Sales workspace.
const fields={id:true,code:true,name:true,namePersian:true,widthValue:true,thicknessValue:true,stoneTypeNamePersian:true,finishNamePersian:true,qualityNamePersian:true,preparedSalesUnit:true,cuttingDimensionNamePersian:true,cuttingDimensionName:true,availableInLongitudinalContracts:true,availableInStairContracts:true,availableInSlabContracts:true,availableInVolumetricContracts:true} as const;
const unit=(value:string)=>({count:'عدد',squareMeter:'مترمربع',square_meter:'مترمربع',meter:'متر طول',ton:'تن',kg:'کیلوگرم'} as Record<string,string>)[value]||'مترمربع';
const productUnit=(p:{name:string;namePersian:string;cuttingDimensionNamePersian:string;preparedSalesUnit:string})=>/کیوبیک|قطعات آماده|حجمی|cubic|prepared|cnc/i.test([p.name,p.namePersian,p.cuttingDimensionNamePersian].join(' '))?unit(p.preparedSalesUnit):'مترمربع';
export async function catalogInquirySource(tx:Tx,input:JsonObject,reason:string,q:string|null) {
  const product=await tx.product.findFirst({where:{id:text(input.productId),isActive:true,deletedAt:null},select:fields});
  if(!product)throw new PurchasingError('CATALOG_PRODUCT_UNAVAILABLE','این کالا در کاتالوگ فعال نیست؛ کالای دیگری انتخاب کنید.',409,'productId');
  const stone=product.namePersian||product.name,u=text(input.unit)||productUnit(product);
  const dimensions=text(input.dimensions),quoteScope=input.quoteScope==='specific'||dimensions?'specific':'general';
  const technical={width:product.widthValue.toFixed(),widthUnit:'cm',thicknessValue:product.thicknessValue.toFixed(),stoneType:product.stoneTypeNamePersian,finish:product.finishNamePersian,quality:product.qualityNamePersian,...(quoteScope==='specific'?{dimensions}:{})};
  return {contractId:null,customerId:null,itemId:null,sourceRowId:null,sourceVersion:null,productId:product.id,productCode:product.code,stone,unit:u,quantity:q,technical,quoteScope,reason,specKey:hash({productId:product.id,stone,unit:u,technical})};
}
export async function purchasingCatalog(actor:Actor,q='',cursor='',db:typeof prisma|Prisma.TransactionClient=prisma,family='') {
  const access=await accessFor(db,actor);assertCapability(access.requester||access.prices);
  const query=text(q,100);
  const products=await db.product.findMany({where:{isActive:true,deletedAt:null,...(query?{OR:[{code:{contains:query,mode:'insensitive'}},{namePersian:{contains:query,mode:'insensitive'}},{name:{contains:query,mode:'insensitive'}}]}:{})},select:fields,orderBy:[{code:'asc'},{id:'asc'}]});
  const families:CatalogFamily[]=['longitudinal','stair','slab','prepared'];
  const filtered=families.includes(family as CatalogFamily)?products.filter(p=>catalogSupportsFamily(p,family as CatalogFamily)):products;
  const start=cursor?Math.max(0,filtered.findIndex(p=>p.id===cursor)+1):0;
  const page=filtered.slice(start,start+60),ids=page.map(p=>p.id);
  const types=families.map(id=>({id,label:({longitudinal:'طولی',stair:'پله',slab:'اسلب',prepared:'آماده'})[id],count:products.filter(p=>catalogSupportsFamily(p,id)).length}));
  const inquiries=access.prices&&ids.length?(await db.purchasingDocument.findMany({where:{kind:'INQUIRY',status:'OPEN',OR:ids.map(id=>({data:{path:['productId'],equals:id}}))},orderBy:{updatedAt:'desc'}})).map(asDoc):[];
  return json({items:page.map(p=>{
    const sources=inquiries.filter(i=>i.data.productId===p.id),offers=sources.flatMap(i=>(i.data.offers||[]).map((offer:JsonObject)=>({...offer,inquiryId:i.id,scope:i.data.quoteScope||'specific',specification:i.data.technical?.dimensions||null,number:label(i)})));
    offers.sort((a,b)=>String(b.recordedAt||'').localeCompare(String(a.recordedAt||'')));
    const valid=(o:JsonObject)=>o.status==='VALID'&&(!o.validUntil||new Date(`${o.validUntil}T23:59:59.999+03:30`).getTime()>=Date.now());
    const latest=offers[0];
    return {id:p.id,code:p.code,name:p.namePersian||p.name,unit:productUnit(p),facts:`${p.stoneTypeNamePersian} · عرض ${p.widthValue.toFixed()} · ضخامت ${p.thicknessValue.toFixed()} · ${p.finishNamePersian}`,...(access.prices?{validCount:offers.filter(valid).length,latest:latest?{inquiryId:latest.inquiryId,supplierName:latest.supplierName,price:latest.price,unit:sources.find(i=>i.id===latest.inquiryId)!.data.unit,recordedAt:latest.recordedAt,validUntil:latest.validUntil,valid:valid(latest),scope:latest.scope,specification:latest.specification}:null}:{})};
  }),types,nextCursor:filtered.length>start+60?page.at(-1)!.id:null});
}

export function quoteMatch(source:JsonObject,target:JsonObject):'exact'|'general'|null {
  if(source.specKey===target.specKey)return 'exact';
  if(source.productId&&source.productId===target.productId&&source.unit===target.unit&&source.quoteScope==='general')return 'general';
  return null;
}
export function validSpecReview(source:JsonObject,target:JsonObject,review:JsonObject|undefined) {
  return source.specKey===target.specKey||quoteMatch(source,target)==='general'&&review?.targetSpecKey===target.specKey&&review?.sourceSpecKey===source.specKey&&Boolean(review?.confirmation);
}
