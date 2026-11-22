'use client';
import {purchaseText,purchaseTitle} from './presentation';
import {PurchaseGroups} from './PurchaseGroups';
import {PurchaseCatalog} from './PurchaseCatalog';
import {useEffect, useRef, useState} from 'react';
import {ErpButton, ErpCard, ErpCheckbox, ErpDisclosure, ErpEmptyState, ErpField, ErpFieldView, ErpInput, ErpInlineState, ErpLoading, ErpPage, ErpSearchableSelect, ErpSection} from '@/components/erp';
import {purchasingAPI, purchaseError, type ContractOption, type Option, type PurchaseWorkspace, type CommandResult} from './api';
import {usePurchasingCommand} from './usePurchasingCommand';

type Line = {key:string;productId?:string;productCode?:string;quoteScope?:string;rowId?:string;stone:string;unit:string;quantity:string;dimensions?:string;raw?:boolean;purchaseStone?:string;purchaseUnit?:string;purchaseQuantity?:string;purchaseDimensions?:string};
export type PurchaseInquirySeed={sourceTitle:string;items:Array<Omit<Line,'key'>>;query?:string};
const fa = (value:unknown) => String(value ?? '—').replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export function PurchaseStart({access, initialContract=null, initialSeed=null, onBack, onCreated}:{access:PurchaseWorkspace['access'];initialContract?:ContractOption|null;initialSeed?:PurchaseInquirySeed|null;onBack:()=>void;onCreated:(result:CommandResult)=>Promise<void>}) {
  const [reason,setReason]=useState(initialSeed?'market':'contract'),[contractId,setContractId]=useState(initialContract?.id||''),[contracts,setContracts]=useState<ContractOption[]>(initialContract?[initialContract]:[]),[buyers,setBuyers]=useState<Option[]>([]);
  const [search,setSearch]=useState(''),[ownerId,setOwnerId]=useState(access.buyer||access.seller?access.actorId:''),[lines,setLines]=useState<Line[]>(()=>initialSeed?.items.map(item=>({...item,key:crypto.randomUUID()}))||[]),[title,setTitle]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const chosenContract=useRef(initialContract);
  const command=usePurchasingCommand(onCreated), locked=command.busy||command.uncertain;
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{setLoading(true);void Promise.all([purchasingAPI.lookup<ContractOption>('contracts',search),purchasingAPI.lookup('buyers')]).then(([c,b])=>{if(!active)return;setContracts(chosenContract.current&&!c.data.data.some(row=>row.id===chosenContract.current!.id)?[chosenContract.current,...c.data.data]:c.data.data);setBuyers(b.data.data);if(b.data.data.length===1)setOwnerId(v=>v||b.data.data[0].id);setError('');}).catch(e=>{if(active)setError(purchaseError(e));}).finally(()=>{if(active)setLoading(false);});},200);return()=>{active=false;clearTimeout(timer);};},[search,initialContract]);
  const selected=contracts.find(c=>c.id===contractId);
  const setLine=(key:string,patch:Partial<Line>)=>setLines(current=>current.map(line=>line.key===key?{...line,...patch}:line));
  const chooseContract=(id:string)=>{chosenContract.current=contracts.find(c=>c.id===id)||null;setContractId(id);setLines([]);};
  return <ErpPage title="استعلام جدید" description="اقلام را انتخاب کنید و قیمت تأمین‌کنندگان را کنار هم ببینید." actions={[{label:'بازگشت',variant:'outline',disabled:locked,onClick:onBack}]}>
    {initialSeed&&<ErpInlineState kind="permission" title={`استعلام جدید از اقلام «${purchaseText(initialSeed.sourceTitle)}»؛ قیمت‌ها و پیشنهادهای قبلی منتقل نمی‌شوند.${initialSeed.items.length?'':' کالا را از کاتالوگ انتخاب کنید.'}`}/>}
    {(error||command.error)&&<ErpInlineState kind="error" title={error||command.error}/>}
    {command.uncertain&&<ErpInlineState kind="stale" title="نتیجه ثبت هنوز مشخص نیست؛ فقط همین ثبت را پیگیری کنید." action={{label:'بررسی نتیجه',onClick:command.recover}}/>}
    {command.uncertain&&<ErpButton label="ارسال دوباره همین ثبت" onClick={command.retry} disabled={command.busy}/>}
    <ErpSection title="مشخصات استعلام">
      <div className={`grid items-start gap-4 ${reason==='market'?'md:grid-cols-2':'md:grid-cols-3'}`}>
      <ErpField label="نوع کار" required><ErpSearchableSelect aria-label="نوع کار" value={reason==='market'?'market':'need'} disabled={locked} onChange={e=>{setReason(e.target.value==='market'?'market':'contract');setLines([]);}}><option value="need">استعلام برای نیاز خرید</option><option value="market">استعلام مستقل قیمت</option></ErpSearchableSelect></ErpField>
        {reason!=='market'&&<ErpField label="خرید برای" required><ErpSearchableSelect aria-label="خرید برای" value={reason} disabled={locked} onChange={e=>{setReason(e.target.value);setLines([]);}}><option value="contract">قرارداد مشتری</option><option value="stock">نیاز انبار</option><option value="prospect">مشتری، پیش از ثبت قرارداد</option></ErpSearchableSelect></ErpField>}
        <ErpField label="مسئول پیگیری خرید" required><ErpSearchableSelect aria-label="مسئول پیگیری خرید" value={ownerId} disabled={locked} onChange={e=>setOwnerId(e.target.value)}><option value="">انتخاب کنید</option>{buyers.map(b=><option key={b.id} value={b.id}>{purchaseText(b.name)}</option>)}</ErpSearchableSelect></ErpField>
      </div>
      {reason==='contract'?<div className="mt-4 space-y-4">
        <ErpField label="قرارداد" required><ErpSearchableSelect aria-label="قرارداد" value={contractId} disabled={locked} loading={loading} onSearchChange={setSearch} onChange={e=>chooseContract(e.target.value)}><option value="">شماره قرارداد یا نام مشتری را جست‌وجو کنید</option>{contracts.map(c=><option key={c.id} value={c.id}>{fa(c.number)} · {purchaseText(c.customer)}{c.partner?' · همکار':''}</option>)}</ErpSearchableSelect></ErpField>
        {selected?.sourceError&&<ErpInlineState kind="error" title={selected.sourceError}/>}
        {selected&&!selected.financial&&<ErpInlineState kind="permission" title="استعلام مجاز است؛ سفارش قطعی بعداً به رکورد مالی معتبر قرارداد نیاز دارد."/>}
      </div>:<div className="mt-4 space-y-4"><ErpField label={reason==='market'?'عنوان استعلام، اختیاری':reason==='prospect'?'عنوان نیاز مشتری':'عنوان نیاز انبار'}><ErpInput value={title} disabled={locked} onChange={e=>setTitle(e.target.value)}/></ErpField>{reason==='prospect'&&<ErpInlineState kind="permission" title="اکنون استعلام می‌گیرید؛ برای ثبت درخواست خرید مشتری، بعداً قرارداد و ردیف واقعی آن متصل می‌شوند."/>}</div>}
    </ErpSection>
    <ErpSection title={reason==='contract'?'اقلام قرارداد':reason==='market'?'کاتالوگ و اقلام استعلام':'اقلام موردنیاز'}>
      {reason!=='contract'&&<PurchaseCatalog initialQuery={initialSeed?.query} disabled={locked} onSelect={p=>setLines(v=>[...v,{key:crypto.randomUUID(),productId:p.id,productCode:p.code,stone:p.name,unit:p.unit,quantity:'',quoteScope:'general'}])}/>}
      {loading&&reason==='contract'&&!selected?<ErpLoading/>:reason==='contract'?selected?.items.length?<PurchaseGroups rows={selected.items}>{item=>{
        const key=item.rowId||item.id,line=lines.find(l=>l.key===key),remaining=item.remaining??item.quantity;
        return <ErpCard key={key} className="space-y-3 p-4"><ErpCheckbox label={item.stone} checked={Boolean(line)} disabled={locked||remaining==='0'} onChange={e=>setLines(v=>e.target.checked?[...v,{key,rowId:key,stone:item.stone,...(item.productCode?{productCode:item.productCode}:{}),unit:item.unit,quantity:remaining}]:v.filter(l=>l.key!==key))}/>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--sds-text-secondary)]"><p>نیاز قرارداد: <strong>{fa(item.quantity)} {item.unit}</strong></p>{item.requested&&item.requested!=='0'&&<p>قبلاً درخواست شده: {fa(item.requested)} {item.unit}</p>}{item.ordered&&item.ordered!=='0'&&<p>قبلاً سفارش شده: {fa(item.ordered)} {item.unit}</p>}</div>
          {line&&<div className="space-y-4">
            <ErpField label={`مقدار محصول نهایی موردنیاز (${item.unit})`}><ErpInput numberFormat="money" inputMode="decimal" value={line.quantity} disabled={locked} onChange={e=>setLine(key,{quantity:e.target.value})}/></ErpField>
            <ErpCheckbox label="به‌جای محصول آماده، قلم خام برای فرآوری خریداری می‌شود." checked={line.raw===true} disabled={locked} onChange={e=>setLine(key,{raw:e.target.checked,purchaseUnit:line.purchaseUnit||'مترمربع'})}/>
            {line.raw&&<ErpCard className="space-y-4 p-4">
              <ErpField label="سنگ یا قلم خام خرید" required><ErpInput value={line.purchaseStone||''} disabled={locked} onChange={e=>setLine(key,{purchaseStone:e.target.value})}/></ErpField>
              <ErpField label="واحد قلم خرید" required><ErpInput value={line.purchaseUnit||''} disabled={locked} onChange={e=>setLine(key,{purchaseUnit:e.target.value})}/></ErpField>
              <ErpField label="مقدار اولیه قلم خرید، اختیاری"><ErpInput numberFormat="money" inputMode="decimal" value={line.purchaseQuantity||''} disabled={locked} onChange={e=>setLine(key,{purchaseQuantity:e.target.value})}/></ErpField>
              <ErpField label="ابعاد و مشخصات قلم خرید"><ErpInput value={line.purchaseDimensions||''} disabled={locked} onChange={e=>setLine(key,{purchaseDimensions:e.target.value})}/></ErpField>
            </ErpCard>}
          </div>}
        </ErpCard>;
      }}</PurchaseGroups>:<ErpEmptyState title={selected?'قلم قابل انتخابی وجود ندارد':'ابتدا قرارداد را انتخاب کنید'}/>:<div className="space-y-4">
        <PurchaseGroups rows={lines}>{line=><ErpCard key={line.key} className="space-y-4 p-4"><h3 className="font-semibold">{line.productCode?`کد ${fa(line.productCode)}`:`قلم ${fa(lines.indexOf(line)+1)}`}</h3>
          <div className="grid gap-4 sm:grid-cols-2"><ErpField label="سنگ و مشخصات اولیه" required><ErpInput value={line.stone} disabled={locked||Boolean(line.productId)} onChange={e=>setLine(line.key,{stone:e.target.value})}/></ErpField><ErpField label="واحد مقدار" required><ErpSearchableSelect aria-label={`واحد قلم ${lines.indexOf(line)+1}`} value={['مترمربع','متر طول','عدد','تن','کیلوگرم'].includes(line.unit)?line.unit:'other'} disabled={locked} onChange={e=>setLine(line.key,{unit:e.target.value==='other'?'':e.target.value})}>{['مترمربع','متر طول','عدد','تن','کیلوگرم'].map(u=><option key={u} value={u}>{u}</option>)}<option value="other">سایر</option></ErpSearchableSelect></ErpField></div>
          {!['مترمربع','متر طول','عدد','تن','کیلوگرم'].includes(line.unit)&&<ErpField label="نام واحد" required><ErpInput value={line.unit} disabled={locked} onChange={e=>setLine(line.key,{unit:e.target.value})}/></ErpField>}
          <ErpField label={`مقدار موردنیاز (${line.unit||'واحد انتخابی'}) — اختیاری`}><ErpInput numberFormat="money" value={line.quantity} inputMode="decimal" disabled={locked} onChange={e=>setLine(line.key,{quantity:e.target.value})}/></ErpField>
          <ErpField label="مشخصات اضافهٔ موردنیاز (اختیاری)" hint="فقط جزئیاتی که در کالای انتخاب‌شده نیست؛ مانند طول برش سفارشی."><ErpInput value={line.dimensions||''} disabled={locked} onChange={e=>setLine(line.key,{dimensions:e.target.value,quoteScope:e.target.value.trim()?'specific':'general'})}/></ErpField>
          <ErpButton label="حذف قلم" variant="ghost" tone="danger" disabled={locked} onClick={()=>setLines(v=>v.filter(l=>l.key!==line.key))}/>
        </ErpCard>}</PurchaseGroups>
        {reason!=='market'&&<ErpButton label="افزودن قلم" variant="outline" disabled={locked} onClick={()=>setLines(v=>[...v,{key:crypto.randomUUID(),stone:'',unit:'مترمربع',quantity:''}])}/>}
      </div>}
    </ErpSection>
    <ErpButton label={`${reason==='market'?'ثبت استعلام مستقل':'ادامه به قیمت‌ها'}${lines.length?` · ${fa(lines.length)} قلم`:''}`} disabled={locked||!ownerId||!lines.length||reason==='contract'&&!selected} onClick={()=>command.run('INQUIRY_START',{reason,contractId:reason==='contract'?contractId:null,ownerId,title,lines})}/>
  </ErpPage>;
}
