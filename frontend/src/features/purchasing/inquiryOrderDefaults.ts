import type {PurchaseDocument} from './api';
const SCALE=BigInt('1'+'0'.repeat(30));
export const scaled = (v: string) => {const [a,b=''] = v.split('.');return BigInt(a || '0') * SCALE + BigInt(b.padEnd(30,'0'));};
export const plain = (v: bigint, scale = 30) => {const digits=v.toString().padStart(scale+1,'0');return `${digits.slice(0,-scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/,'') || '0';};
export function inquiryOrderDefaults(request: PurchaseDocument | undefined, orders: PurchaseDocument[], supplierId?: string) {
  const splits = request?.data.inquirySelection || [];
  if (!request || !splits.length) return null;
  const available=splits.map((split:any)=>{
    const committed=request.quoteCommitments?request.quoteCommitments.filter(b=>b.inquiryId===split.inquiryId&&b.offerId===split.offerId).reduce((t,b)=>t+scaled(b.quantity),BigInt(0)):orders.filter(o=>o.status!=='VOID').reduce((total,o)=>total+(o.data.effectiveAllocations || o.data.allocations || []).filter((a:any)=>a.requestId===request.id).flatMap((a:any)=>a.quoteBindings || []).filter((b:any)=>b.inquiryId===split.inquiryId && b.offerId===split.offerId).reduce((t:bigint,b:any)=>t+scaled(b.quantity),BigInt(0)),BigInt(0));
    const selected=scaled(split.quantity),own=selected>committed?selected-committed:BigInt(0),capacity=request.quoteAvailability?.find(b=>b.inquiryId===split.inquiryId&&b.offerId===split.offerId);
    return {...split,remaining:capacity&&scaled(capacity.quantity)<own?scaled(capacity.quantity):own};
  });
  const supplier = supplierId || available.find((s:any)=>s.remaining>BigInt(0))?.supplierId || splits[0].supplierId;
  const candidates=available.filter((s:any)=>s.supplierId===supplier);
  const first=candidates.find((s:any)=>s.remaining>BigInt(0)) || candidates[0];
  const remaining=candidates.filter((s:any)=>s.price===first?.price).reduce((total:bigint,s:any)=>total+s.remaining,BigInt(0));
  const allAllocations=orders.filter(o=>o.status!=='VOID').flatMap(o=>(o.data.effectiveAllocations||o.data.allocations||[]).filter((a:any)=>a.requestId===request.id));
  const totalPurchase=scaled(request.data.purchaseQuantity||request.data.quantity||plain(remaining));
  const totalNeed=scaled(request.data.quantity||plain(remaining));
  const committedPurchase=request.progress?.purchaseOrdered!=null?scaled(String(request.progress.purchaseOrdered)):allAllocations.reduce((total:bigint,a:any)=>total+scaled(a.purchaseQuantity||a.quantity),BigInt(0));
  const committedNeed=request.progress?.ordered!=null?scaled(String(request.progress.ordered)):allAllocations.reduce((total:bigint,a:any)=>total+scaled(a.quantity),BigInt(0));
  const mapped=request.data.purchaseQuantity&&totalPurchase>BigInt(0)?remaining===totalPurchase-committedPurchase?totalNeed-committedNeed:remaining*totalNeed/totalPurchase:remaining;
  const terms=Array.from(new Set(candidates.filter((s:any)=>s.price===first?.price&&s.remaining>BigInt(0)).map((s:any)=>s.offerSnapshot?.terms).filter(Boolean))).join('؛ ');
  const dates=Array.from(new Set(candidates.filter((s:any)=>s.price===first?.price&&s.remaining>BigInt(0)).map((s:any)=>s.offerSnapshot?.arrivalDate).filter(Boolean)));
  return {supplierId:supplier,price:first?.price ?? '',quantity:plain(remaining),demandQuantity:plain(mapped>BigInt(0)?mapped:BigInt(0)),paymentTerms:terms,date:dates.length===1?String(dates[0]):'',...(request.data.purchaseUnit?{unit:request.data.purchaseUnit,stone:request.data.purchaseStone}: {})};
}

export function offerKnownCost(price: string | null | undefined, amount: string | null | undefined, freight: string | null | undefined) {
  if(price==null || amount==null || !/^\d+(\.\d+)?$/.test(amount))return null;
  const material=scaled(price)*scaled(amount);
  return {material:plain(material,60),total:freight==null?null:plain(material+scaled(freight)*SCALE,60)};
}
