'use client';
import {PurchaseGroups} from './PurchaseGroups';
import {useCallback,useEffect,useState} from 'react';
import {ErpButton,ErpCard,ErpEmptyState,ErpInlineState,ErpLoading,ErpPage,ErpSection} from '@/components/erp';
import {purchasingAPI,purchaseError,type PurchaseDocument,type PurchaseWorkspace} from './api';
import {purchaseNumber as fa,purchaseText,purchaseTitle} from './presentation';
export function InquiryCaseView({id,access,onBack,onChanged,onOpenLine}:{id:string;access:PurchaseWorkspace['access'];onBack:()=>void;onChanged:()=>Promise<void>;onOpenLine:(id:string)=>void}) {
  const [doc,setDoc]=useState<PurchaseDocument|null>(null),[lines,setLines]=useState<PurchaseDocument[]>([]),[error,setError]=useState('');
  const load=useCallback(async()=>{try{const r=await purchasingAPI.detail(id);setDoc(r.data.data.document);setLines(r.data.data.lines||[]);setError('');}catch(e){setError(purchaseError(e));}},[id]);
  useEffect(()=>{void load();},[load]);
  if(!doc)return error?<ErpInlineState kind="error" title={error} action={{label:'تلاش دوباره',onClick:load}}/>:<ErpLoading/>;
  return <ErpPage title={purchaseTitle(doc)} description={`شماره پیگیری: ${doc.number}`} actions={[{label:'بازگشت به استعلام‌ها',variant:'outline',onClick:onBack}]}>
    {error&&<ErpInlineState kind="error" title={error}/>}
    <ErpSection title="اقلام استعلام">{lines.length?<PurchaseGroups rows={lines.map(line=>({...line,key:line.id,stone:purchaseText(line.data.stone),productCode:line.data.productCode}))}>{line=><ErpCard key={line.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="min-w-0 space-y-2"><h3 className="font-semibold">{purchaseText(line.data.stone)}</h3><p>{doc.data.reason==='market'&&!line.data.quantity?'استعلام قیمت عمومی این کالا':`مقدار: ${fa(line.data.quantity)} ${line.data.unit}`}</p><p className="text-sm text-[var(--sds-text-secondary)]">{fa(line.data.offers?.length||0)} پیشنهاد · {line.data.converted?.length?'درخواست خرید ثبت شده':line.data.selection?.length?'پیشنهاد منتخب دارد':doc.data.reason==='market'?'استعلام مستقل قیمت':'در انتظار انتخاب پیشنهاد'}</p></div><ErpButton label={'ادامه'} variant="outline" onClick={()=>onOpenLine(line.id)}/></ErpCard>}</PurchaseGroups>:<ErpEmptyState title="قلمی در این استعلام وجود ندارد"/>}</ErpSection>
  </ErpPage>;
}
