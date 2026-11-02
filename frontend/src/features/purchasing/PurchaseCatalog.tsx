'use client';
import {useEffect,useRef,useState} from 'react';
import {ErpButton,ErpInlineState,ErpLoading} from '@/components/erp';
import {ContractProductCatalog,type ContractCatalogFamily,type ContractCatalogTypeOption} from '@/features/contract-creation/components/steps/ContractProductCatalog';
import {purchasingAPI,purchaseError,type CatalogProduct} from './api';
import {purchaseNumber as fa,purchaseDigits,purchaseText} from './presentation';

export function PurchaseCatalog({onSelect,disabled=false}:{onSelect:(product:CatalogProduct)=>void;disabled?:boolean}) {
  const [query,setQuery]=useState(''),[items,setItems]=useState<CatalogProduct[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [family,setFamily]=useState<ContractCatalogFamily|null>(null),[types,setTypes]=useState<ContractCatalogTypeOption[]>([]);
  const sequence=useRef(0);
  useEffect(()=>{const current=sequence;const serial=++current.current;setLoading(true);const timer=setTimeout(()=>{
    void purchasingAPI.catalog(query,'',family||'').then(r=>{if(serial===sequence.current){setItems(r.data.data.items);setTypes(r.data.data.types);setCursor(r.data.data.nextCursor);setError('');}}).catch(e=>{if(serial===sequence.current)setError(purchaseError(e));}).finally(()=>{if(serial===sequence.current)setLoading(false);});
  },200);return()=>{clearTimeout(timer);current.current++;};},[query,family]);
  async function more(){const serial=sequence.current;setLoading(true);try{const r=await purchasingAPI.catalog(query,cursor||'',family||'');if(serial!==sequence.current)return;setItems(v=>[...v,...r.data.data.items]);setCursor(r.data.data.nextCursor);}catch(e){if(serial===sequence.current)setError(purchaseError(e));}finally{if(serial===sequence.current)setLoading(false);}}
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    {error&&<ErpInlineState kind="error" title={error}/>}
    <ContractProductCatalog query={query} onQueryChange={setQuery} activeType={family} onTypeChange={value=>{setFamily(value);setQuery('');}} typeOptions={types} wrapFacts searchId="purchase-catalog-search" items={items.map(p=>({id:p.id,name:purchaseText(p.name),facts:[`کد ${purchaseDigits(p.code)}`,p.facts,p.latest?`آخرین استعلام: ${p.latest.price==null?'قیمت نامشخص':`${fa(p.latest.price)} تومان/${p.latest.unit}`} · ${purchaseText(p.latest.supplierName)} · ${new Date(p.latest.recordedAt).toLocaleDateString('fa-IR')} · ${p.latest.valid?'معتبر':'نامعتبر یا منقضی'} · ${p.latest.scope==='general'?'قیمت عمومی':p.latest.specification||'مشخصات پایه کالا'} · ${fa(p.validCount)} پیشنهاد معتبر`:p.validCount===0?'هنوز استعلامی ثبت نشده':null].filter(Boolean).join(' — ')}))} onSelect={p=>{if(!disabled&&!loading){const product=items.find(i=>i.id===p.id);if(product)onSelect(product);}}}/>
    {loading&&<ErpLoading/>}
    {cursor&&<ErpButton label="محصولات بیشتر" variant="ghost" disabled={disabled||loading} onClick={more}/>}
  </fieldset>;
}
