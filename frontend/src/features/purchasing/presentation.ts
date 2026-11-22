import {formatNumericInputText,normalizeDigits} from '@/lib/numberFormat';
/** Only presentation changes: raw identities and exact decimal values stay intact. */
export const purchaseDigits=(value:unknown)=>String(value??'نامشخص').replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export function purchaseText(value:unknown) {
  return String(value??'').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'').replace(/\bc[a-z0-9]{24,}\b/gi,'').replace(/\s*·\s*(?=·|$)/g,'').replace(/\s+/g,' ').trim();
}
export function purchaseNumber(value:unknown) {
 if(value==null||value==='')return 'نامشخص';
 const text=normalizeDigits(String(value));
 return purchaseDigits(/^-?\d+(?:\.\d*)?$/.test(text)?formatNumericInputText(text).displayText:purchaseText(text));
}
export function purchaseTitle(doc:{displayTitle?:string;data:Record<string,any>}) {
 return purchaseDigits(purchaseText(doc.displayTitle||doc.data.stone||doc.data.title||doc.data.name)||'استعلام قیمت');
}
export function purchaseDimensions(technical:Record<string,unknown> | undefined) {
  if(!technical)return '';
  const units:Record<string,string>={m:'متر',cm:'سانتی‌متر',mm:'میلی‌متر'};
  const unit=(value:unknown)=>units[String(value)]||String(value||'واحد نامشخص');
  const parts:string[]=[];
  if(technical.length!=null)parts.push(`طول: ${purchaseNumber(technical.length)} ${unit(technical.lengthUnit)}`);
  const width=technical.width??technical.diameterOrWidth;
  if(width!=null)parts.push(`عرض: ${purchaseNumber(width)} ${unit(technical.widthUnit)}`);
  if(technical.thicknessValue!=null)parts.push(`ضخامت: ${purchaseNumber(technical.thicknessValue)}`);
  if(technical.dimensions)parts.push(String(technical.dimensions));
  return parts.join(' · ');
}

/** Labeled values avoid a dense mixed-direction specification sentence. */
export function purchaseSpecificationFields(technical:Record<string,unknown>|undefined) {
 if(!technical)return [];
 const units:Record<string,string>={m:'متر',cm:'سانتی‌متر',mm:'میلی‌متر'};
 const dimension=(value:unknown,u:unknown)=>`${purchaseNumber(value)}${u?` ${units[String(u)]||purchaseText(u)}`:''}`;
 const fields:Array<{label:string;value:string}>=[];
 if(technical.length!=null)fields.push({label:'طول',value:dimension(technical.length,technical.lengthUnit)});
 if((technical.width??technical.diameterOrWidth)!=null)fields.push({label:'عرض',value:dimension(technical.width??technical.diameterOrWidth,technical.widthUnit)});
 if(technical.thicknessValue!=null)fields.push({label:'ضخامت',value:dimension(technical.thicknessValue,technical.thicknessUnit)});
 for(const [key,label] of [['stoneType','نوع سنگ'],['finish','فرآوری'],['quality','سورت'],['dimensions','مشخصات اضافهٔ موردنیاز']])if(technical[key])fields.push({label,value:purchaseText(technical[key])});
 return fields;
}
