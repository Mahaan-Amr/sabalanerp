import {Prisma} from '@prisma/client';
import {parseCanonicalProductGraph,projectCanonicalProductGraph} from '@sabalanerp/contract-product-graph';
import {PurchasingError,quantity,type JsonObject} from './domain';

type Item={id:string;productId?:string;productRowId?:string|null;productType?:string|null;quantity:Prisma.Decimal;product?:{preparedSalesUnit:string;volumetricSalesUnit:string}};
type Source={items:Item[];productGraphState?:{graph:unknown;revision:number;schemaVersion:number}|null};
const unitName=(unit:string)=>({squareMeter:'مترمربع',square_meter:'مترمربع',meter:'متر طول',count:'عدد',physicalPiece:'عدد',piece:'عدد',ton:'تن',kg:'کیلوگرم',cubicMeter:'مترمکعب'} as Record<string,string>)[unit] || unit;
const unavailable=()=>new PurchasingError('PURCHASE_QUANTITY_SOURCE_UNVERIFIED','مقدار یا واحد این ردیف از نسخه معتبر قرارداد قابل تأیید نیست؛ از مسئول فروش برای بررسی اطلاعات قلم پیگیری کنید.');
/** Purchasing demand is finished requested area, not legacy piece-count sentinels or billed mother-stone consumption. No contract/financial evidence is rewritten. */
export function ordinaryPurchaseDemands(source:Source) {
  const result=new Map<string,{quantity:Prisma.Decimal;unit:string;description?:string;technical?:JsonObject}>();
  if(!source.productGraphState){
    for(const item of source.items){
      // Unclassified legacy rows with an already explicit positive demand retain their recorded meaning.
      if(item.productType || !item.quantity.gt(0))throw unavailable();
      result.set(item.id,{quantity:new Prisma.Decimal(quantity(item.quantity.toFixed())),unit:'مترمربع'});
    }
    return result;
  }
  try {
    const state=source.productGraphState, graph=parseCanonicalProductGraph(state.graph);
    if(graph.revision!==state.revision || graph.schemaVersion!==state.schemaVersion)throw unavailable();
    const projection=projectCanonicalProductGraph(graph,'confirmation');
    for(const item of source.items){
      const raw=graph.rows.find(r=>r.productRowId===item.productRowId), row=projection.products.find(r=>r.productRowId===item.productRowId);
      if(!row || !raw || item.productId && raw.catalogProductId!==item.productId)throw unavailable();
      const snapshot=(raw.commercial.legacySnapshot || {}) as JsonObject;
      let amount:unknown,unit:string;
      if(['longitudinal','slab','stair'].includes(row.productType)) {amount=row.areaSquareMeters;unit='مترمربع';}
      else if(row.productType==='prepared'){amount=row.quantity;unit=unitName(String(snapshot.preparedUnit || snapshot.unit || ''));if(!unit)throw unavailable();}
      else if(row.productType==='volumetric'){amount=row.quantity;unit=unitName(String(snapshot.volumetricUnit || snapshot.unit || item.product?.volumetricSalesUnit || ''));if(!unit)throw unavailable();}
      else throw unavailable();
      const technical:JsonObject=Object.fromEntries(['preparedKind','thicknessValue','stairPartType','length','lengthUnit','width','widthUnit','diameterOrWidth'].map(key=>[key,snapshot[key]??null]));
      Object.assign(technical,{productType:row.productType,...(row.lengthMeters!==undefined?{length:row.lengthMeters,lengthUnit:'m'}:{}),...(row.widthMeters!==undefined?{width:row.widthMeters,widthUnit:'m'}:{})});
      result.set(item.id,{quantity:new Prisma.Decimal(quantity(amount)),unit,description:row.description||row.contractualTitle,technical});
    }
    return result;
  } catch(error){if(error instanceof PurchasingError)throw error;throw unavailable();}
}
