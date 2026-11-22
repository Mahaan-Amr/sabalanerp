// THROWAWAY workspace simulation: one practical UI, using canonical Sabalan ERP components.
// Question: can the user create a request, place an order, and receive/accept a delivery unaided?
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {FaShoppingCart,FaClipboardList,FaTruck,FaBoxOpen,FaPlus,FaBell,FaWarehouse} from 'react-icons/fa';
import {ErpListPage,ErpCard,ErpButton,ErpBadge,ErpSegmentedControl,ErpSheet,ErpField,ErpFieldView,ErpInput,ErpSelect,ErpTextarea,ErpInlineState,ErpEmptyState,ErpDisclosure} from '../../../components/erp';
import {contracts,customers,deliveryCustomer,units,suppliers,seed,apply,fmt,fa,numeric,requestProgress,orderProgress,receiptProgress,exchangeProgress} from './workspace-model';
const router={push:()=>{},replace:()=>{},back:()=>{},forward:()=>{},refresh:()=>{},prefetch:async()=>{}};
const tabNames={requests:'درخواست‌ها',orders:'سفارش‌های خرید',receipts:'دریافت بار',exchanges:'تعویض‌ها'};
const showQty=(qty,unit)=>qty==null?'هنوز مشخص نشده':fmt(qty)+' '+unit;
function App(){
 const [data,setData]=useState(seed),[tab,setTab]=useState('receipts'),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[sheet,setSheet]=useState(null),[form,setForm]=useState({}),[errors,setErrors]=useState({}),[notice,setNotice]=useState(null),[focus,setFocus]=useState(null),[showNotifications,setShowNotifications]=useState(false),[events,setEvents]=useState([]);
 const set=(key,value)=>{setForm(f=>({...f,[key]:value}));setErrors(e=>({...e,[key]:undefined}));};
 const req=id=>data.requests.find(r=>r.id===id),order=id=>data.orders.find(o=>o.id===id);
 const contract=contracts.find(c=>c.id===form.contract);
 function changeTab(next){setTab(next);setSearch('');setStatus('all');setFocus(null);}
 function openRequest(){setErrors({});setForm({reason:'contract',contract:'100101',line:'101-1',stone:contracts[0].lines[0].stone,qty:'80',unit:'مترمربع',requester:'فروشنده داخلی',notes:'',dimensions:'',date:'',customUnit:''});setSheet('request');}
 function openOrder(id){const r=req(id)||data.requests.find(r=>requestProgress(data,r.id).toOrder!==0);setErrors({});setForm({request:r?.id||'',qty:r?String(requestProgress(data,r.id).toOrder??''):'',supplier:'',price:'',route:'warehouse',date:'',notes:'',newSupplier:'',supplierContact:''});setSheet('order');}
 function chooseOrder(id){const o=order(id);setForm(f=>({...f,order:id,qty:o?String(orderProgress(data,id).remaining):'',exchange:'',quality:'pending',accepted:'',recipient:'',destinationCustomer:'',notes:''}));setErrors({});}
 function openReceipt(id){const o=order(id)||data.orders.find(o=>orderProgress(data,o.id).remaining>0);setErrors({});setForm({order:o?.id||'',qty:o?String(orderProgress(data,o.id).remaining):'',exchange:'',quality:'pending',accepted:'',recipient:'',destinationCustomer:'',notes:''});setSheet('receipt');}
 function openQuality(id){const r=data.receipts.find(r=>r.id===id);setErrors({});setForm({receipt:id,accepted:String(receiptProgress(data,id).pending)});setSheet('quality');}
 function openDisposition(type,id){const r=data.receipts.find(r=>r.id===id),p=receiptProgress(data,id);setErrors({});setForm({receipt:id,qty:String(type==='reject'?p.pending:type==='return'?p.toReturn:p.toExchange),reason:'',notes:'',date:''});setSheet(type);}
 function openReplacement(id){const e=data.exchanges.find(e=>e.id===id),source=data.receipts.find(r=>r.id===e.receipt);setErrors({});setForm({order:e.order,exchange:id,qty:String(exchangeProgress(data,id).remaining),quality:'pending',accepted:'',recipient:'',destinationCustomer:source?.recipientCustomerId||'',notes:''});setSheet('receipt');}
 function receiptStatus(r){const p=receiptProgress(data,r.id);return p.pending>0?['نیازمند بررسی کیفیت','warning']:p.toReturn>0?['رد قطعی؛ منتظر برگشت','danger']:p.rejected>0?['رد قطعی؛ برگشت ثبت شد','neutral']:['کیفیت تأیید شد','success'];}
 function receiptActions(r){const p=receiptProgress(data,r.id),actions=[];
 if(p.pending>0)actions.push({label:'بررسی و تأیید کیفیت',onClick:()=>openQuality(r.id)},{label:'ثبت رد قطعی',tone:'danger',onClick:()=>openDisposition('reject',r.id)});
 if(p.toReturn>0)actions.push({label:'ثبت برگشت به تأمین‌کننده',onClick:()=>openDisposition('return',r.id)});
 if(p.toExchange>0)actions.push({label:'ثبت تعویض',onClick:()=>openDisposition('exchange',r.id)});
 actions.push({label:'جزئیات و سوابق رسید',onClick:()=>{setErrors({});setForm({receipt:r.id});setSheet('receiptDetail');}});return actions;}
 function save(){const result=apply(data,sheet,form);if(result.errors){setErrors(result.errors);return;}const action=sheet;setData(result.data);setSheet(null);setErrors({});setEvents(e=>[result.message,...e]);setNotice({message:result.message,type:action,id:result.id});setTab(result.tab||(action==='request'?'requests':action==='order'?'orders':'receipts'));setSearch('');setStatus('all');setFocus(result.id);}
 function contractChange(id){const c=contracts.find(c=>c.id===id),l=c?.lines[0];setForm(f=>({...f,contract:id,line:l?.id||'',stone:l?.stone||'',qty:l?String(l.qty):'',unit:l?.unit||'مترمربع'}));setErrors({});}
 function lineChange(id){const l=contract?.lines.find(l=>l.id===id);setForm(f=>({...f,line:id,stone:l?.stone||'',qty:l?String(l.qty):'',unit:l?.unit||'مترمربع'}));setErrors({});}
 const field=(key,label,props={})=><ErpField label={label} error={errors[key]} required={props.required} hint={props.hint}><ErpInput value={form[key]??''} onChange={e=>set(key,e.target.value)} {...Object.fromEntries(Object.entries(props).filter(([k])=>!['hint','required'].includes(k)))}/></ErpField>;
 const select=(key,label,options,extra={})=><ErpField label={label} error={errors[key]} required={extra.required} hint={extra.hint}><ErpSelect value={form[key]??''} onChange={e=>extra.onChange?extra.onChange(e.target.value):set(key,e.target.value)}>{options.map(x=><option key={x.value??x} value={x.value??x}>{x.label??x}</option>)}</ErpSelect></ErpField>;
 function requestStatus(r){const p=requestProgress(data,r.id);return p.missing===0?['تأمین کامل','success']:p.ordered>0?[p.toOrder===0?'سفارش داده شده':'بخشی سفارش داده شده','info']:['در انتظار خرید','warning'];}
 function orderStatus(o){const p=orderProgress(data,o.id);return p.toReturn>0?['برگشت کالای ردشده باز است','danger']:p.accepted===o.qty?['دریافت و تأیید کامل','success']:p.replacementRemaining>0?['در انتظار بار جایگزین','warning']:p.rejected>0&&p.accepted<o.qty?['کسری ناشی از رد کیفیت','warning']:p.pending>0?['در انتظار پذیرش کیفیت','warning']:p.received>0?['دریافت جزئی','info']:['در انتظار دریافت','warning'];}
 const requestColumns=[
  {id:'id',header:'درخواست / سنگ',priority:'primary',cell:r=><div><strong>{r.id}</strong><p>{r.stone}</p></div>},
  {id:'source',header:'محل نیاز',cell:r=>r.reason==='stock'?<ErpBadge>انبار سبلان</ErpBadge>:<div><span>قرارداد {fa(r.contract)}</span><p>{contracts.find(c=>c.id===r.contract)?.customer}{contracts.find(c=>c.id===r.contract)?.partner?' · همکار':''}</p></div>},
  {id:'qty',header:'مقدار موردنیاز',cell:r=>showQty(r.qty,r.unit)},
  {id:'progress',header:'سفارش / پذیرفته',cell:r=>{const p=requestProgress(data,r.id);return <span>{fmt(p.ordered)} / {fmt(p.accepted)} {r.unit}</span>;}},
  {id:'who',header:'درخواست‌کننده',priority:'hidden-mobile',cell:r=>r.requester},
  {id:'status',header:'وضعیت',cell:r=>{const [label,tone]=requestStatus(r);return <ErpBadge tone={tone}>{label}</ErpBadge>;}}
 ];
 const orderColumns=[
  {id:'id',header:'سفارش / تأمین‌کننده',priority:'primary',cell:o=><div><strong>{o.id}</strong><p>{o.supplier}</p></div>},
  {id:'stone',header:'سنگ / درخواست',cell:o=><div>{o.stone}<p>{o.request}</p></div>},
  {id:'qty',header:'مقدار سفارش',cell:o=>showQty(o.qty,o.unit)},
  {id:'price',header:'نرخ واحد (تومان)',cell:o=>o.price===null?'در انتظار توافق':fmt(o.price)},
  {id:'received',header:'رسیده / پذیرفته',cell:o=>{const p=orderProgress(data,o.id);return fmt(p.received)+' / '+fmt(p.accepted)+' '+o.unit;}},
  {id:'route',header:'مقصد',priority:'hidden-mobile',cell:o=>o.route==='direct'?'مستقیم به مشتری':'انبار سبلان'},
  {id:'status',header:'وضعیت',cell:o=>{const [label,tone]=orderStatus(o);return <ErpBadge tone={tone}>{label}</ErpBadge>;}}
 ];
 const receiptColumns=[
  {id:'id',header:'رسید / سفارش',priority:'primary',cell:r=><div><strong>{r.id}</strong><p>{r.order}{r.exchange?' · جایگزین '+r.exchange:''}</p></div>},
  {id:'stone',header:'سنگ',cell:r=>order(r.order)?.stone},
  {id:'qty',header:'بار رسیده',cell:r=>showQty(r.qty,order(r.order)?.unit)},
  {id:'accepted',header:'کیفیت پذیرفته‌شده',cell:r=>showQty(r.accepted,order(r.order)?.unit)},
  {id:'pending',header:'در انتظار بررسی',cell:r=>showQty(receiptProgress(data,r.id).pending,order(r.order)?.unit)},
  {id:'rejected',header:'رد قطعی / برگشت',cell:r=>showQty(r.rejected||0,order(r.order)?.unit)+' / '+fmt(r.returned||0)},
  {id:'dest',header:'محل تحویل',cell:r=>r.route==='direct'?'مقصد مشتری · '+r.recipient:'انبار سبلان'},
  {id:'status',header:'وضعیت',cell:r=>{const [label,tone]=receiptStatus(r);return <ErpBadge tone={tone}>{label}</ErpBadge>;}}
 ];
 const exchangeColumns=[
 {id:'id',header:'پرونده تعویض',priority:'primary',cell:e=><div><strong>{e.id}</strong><p>از {e.receipt} · {e.order}</p></div>},
 {id:'stone',header:'سنگ / تأمین‌کننده',cell:e=><div>{order(e.order)?.stone}<p>{order(e.order)?.supplier}</p></div>},
 {id:'qty',header:'مقدار تعویض',cell:e=>showQty(e.qty,order(e.order)?.unit)},
 {id:'received',header:'جایگزین رسیده / پذیرفته',cell:e=>{const p=exchangeProgress(data,e.id);return fmt(p.received)+' / '+fmt(p.accepted)+' '+order(e.order)?.unit;}},
 {id:'return',header:'برگشت بار اصلی',cell:e=>showQty(receiptProgress(data,e.receipt).toReturn,order(e.order)?.unit)+' باقی مانده'},
 {id:'status',header:'وضعیت',cell:e=>{const p=exchangeProgress(data,e.id);return <ErpBadge tone={p.accepted===e.qty?'success':'warning'}>{p.accepted===e.qty?(receiptProgress(data,e.receipt).toReturn>0?'جایگزین تأیید شد؛ برگشت باز است':'جایگزین تأیید شد'):p.remaining>0?'در انتظار دریافت جایگزین':'در انتظار تعیین تکلیف کیفیت جایگزین'}</ErpBadge>;}}
 ];
 const list=data[tab].filter(r=>{
 const text=[r.id,r.stone,r.supplier,r.contract,r.request,r.order,r.requester,r.receipt,order(r.order)?.stone].filter(Boolean).join(' ');
 if(search&&!text.includes(search)&&!text.includes(String(numeric(search))))return false;
 if(status==='all')return true;
 if(tab==='requests')return status==='open'?requestProgress(data,r.id).missing!==0:requestProgress(data,r.id).missing===0;
 if(tab==='orders'){const p=orderProgress(data,r.id);return status==='open'?p.accepted<r.qty||p.toReturn>0:p.accepted===r.qty&&p.toReturn===0;}
 if(tab==='exchanges')return status==='open'?exchangeProgress(data,r.id).accepted<r.qty||receiptProgress(data,r.receipt).toReturn>0:exchangeProgress(data,r.id).accepted===r.qty&&receiptProgress(data,r.receipt).toReturn===0;
 const p=receiptProgress(data,r.id);return status==='open'?p.pending>0||p.toReturn>0||p.toExchange>0:p.pending===0&&p.toReturn===0&&p.toExchange===0;
 });
 const selectedRequest=req(form.request),selectedOrder=order(form.order),destinationCustomer=deliveryCustomer(data,form.order,form.destinationCustomer),deliveryRequest=req(selectedOrder?.request),selectedReceipt=data.receipts.find(r=>r.id===form.receipt),selectedExchange=data.exchanges.find(e=>e.id===form.exchange);
 const primary=tab==='requests'?{label:'درخواست جدید',onClick:openRequest}:tab==='orders'?{label:'سفارش خرید جدید',onClick:()=>openOrder()}:tab==='exchanges'?{label:'بازگشت به رسیدهای بار',onClick:()=>changeTab('receipts')}:{label:'ثبت دریافت بار',onClick:()=>openReceipt()};
 const notices=notice?[notice.type==='request'?{label:'ثبت سفارش برای این درخواست',onClick:()=>openOrder(notice.id)}:notice.type==='order'?{label:'ثبت دریافت این سفارش',onClick:()=>openReceipt(notice.id)}:notice.type==='exchange'?{label:'ثبت دریافت بار جایگزین',onClick:()=>openReplacement(notice.id)}:notice.type==='reject'?{label:'ثبت برگشت همین بار',onClick:()=>openDisposition('return',notice.id)}:notice.type==='return'?{label:'ثبت تعویض همین بار',onClick:()=>openDisposition('exchange',notice.id)}:{label:'دیدن سفارش خرید',onClick:()=>changeTab('orders')}]:[];
 return <div className="purchase-app">
 <aside className="purchase-sidebar"><div className="brand"><FaShoppingCart/><strong>سبلان ERP</strong><span>مدیریت یکپارچه کسب‌وکار</span></div><p className="sidebar-caption">فضای کاری خرید</p>{Object.entries(tabNames).map(([key,label])=><ErpButton key={key} label={label} icon={key==='requests'?FaClipboardList:key==='orders'?FaShoppingCart:FaTruck} onClick={()=>changeTab(key)} variant={tab===key?'solid':'ghost'} className="w-full justify-start"/>)}<div className="sidebar-foot"><ErpBadge tone="warning">نسخهٔ آزمایشی</ErpBadge><p>داده‌ها فقط در این صفحه نگه داشته می‌شوند.</p></div></aside>
 <div className="purchase-body"><div className="purchase-topbar"><div><strong>سبلان / خرید</strong><p>محیط آزمایشی · با بارگذاری دوباره، داده‌ها از نو شروع می‌شوند.</p></div><div className="topbar-actions"><ErpButton label={'اعلان‌ها'+(events.length?' ('+fmt(events.length)+')':'')} icon={FaBell} onClick={()=>setShowNotifications(!showNotifications)} variant="ghost"/><ErpBadge>مدیریت · دسترسی کامل</ErpBadge></div></div>
 <div className="purchase-content"><ErpListPage
 eyebrow="فضای کاری خرید" title={tabNames[tab]} description={tab==='requests'?'درخواست تأمین سنگ برای قرارداد مشتری یا موجودی انبار.':tab==='orders'?'سفارش به تأمین‌کننده و پیگیری مقدارهای رسیده و باقی‌مانده.':tab==='exchanges'?'پیگیری بار جایگزین با حفظ ارتباط با بار ردشده؛ بدون ایجاد خرید یا بدهی تکراری.':'ثبت مقدار رسیده، پذیرش، رد قطعی و برگشت بار.'}
 actions={[{...primary,icon:FaPlus,variant:'solid'}]}
 metrics={[{label:'درخواست نیازمند پیگیری',value:fmt(data.requests.filter(r=>requestProgress(data,r.id).missing!==0).length),icon:FaClipboardList},{label:'سفارش در انتظار دریافت',value:fmt(data.orders.filter(o=>orderProgress(data,o.id).remaining>0||orderProgress(data,o.id).replacementRemaining>0).length),icon:FaTruck},{label:'رسید در انتظار کیفیت',value:fmt(data.receipts.filter(r=>receiptProgress(data,r.id).pending>0).length),icon:FaBoxOpen}]}
 sectionNavigation={<ErpSegmentedControl value={tab} onChange={changeTab} options={Object.entries(tabNames).map(([value,label])=>({value,label,count:data[value].length,countTone:'neutral'}))}/>}
 rows={list} rowKey={r=>r.id} focusedRowKey={focus} columns={tab==='requests'?requestColumns:tab==='orders'?orderColumns:tab==='exchanges'?exchangeColumns:receiptColumns} rowActionMode="menu"
 filters={[{id:'search',type:'search',label:'جست‌وجو',placeholder:'جست‌وجوی شماره، سنگ یا تأمین‌کننده',value:search,onChange:setSearch},{id:'status',type:'select',label:'وضعیت',value:status,onChange:setStatus,options:[{value:'all',label:'همه وضعیت‌ها'},{value:'open',label:'نیازمند پیگیری'},{value:'complete',label:'تکمیل‌شده'}]}]}
 rowActions={r=>tab==='requests'?[{label:'ثبت سفارش خرید',onClick:()=>openOrder(r.id),disabled:requestProgress(data,r.id).toOrder===0},{label:'جزئیات درخواست',onClick:()=>{setForm({detail:r.id});setSheet('detail');}}]:tab==='orders'?[{label:r.route==='direct'?'ثبت تحویل در مقصد':'ثبت دریافت بار',onClick:()=>openReceipt(r.id),disabled:orderProgress(data,r.id).remaining<=0}]:tab==='exchanges'?[{label:'ثبت دریافت بار جایگزین',onClick:()=>openReplacement(r.id),disabled:exchangeProgress(data,r.id).remaining<=0},{label:'دیدن رسید اصلی',onClick:()=>{setForm({receipt:r.receipt});setSheet('receiptDetail');}}]:receiptActions(r)}
 emptyState={<ErpEmptyState title="موردی برای نمایش وجود ندارد." description="فیلتر را تغییر دهید یا از دکمه بالای صفحه یک مورد جدید ثبت کنید."/>}
 footer={<p className="prototype-footer">نمونهٔ تعاملی برای بررسی فرم‌ها و گردش کار · اتصال واقعی به انبار و حسابداری، PDF و ارسال اعلان در این فایل فعال نیست.</p>}
 >{notice&&<ErpInlineState kind="success" title={notice.message} actions={notices}/>}{showNotifications&&<ErpCard className="p-4"><h2>اعلان‌های خرید</h2>{events.length?events.map((e,i)=><p key={i}>{e}</p>):<p>هنوز اعلان تازه‌ای ندارید.</p>}</ErpCard>}</ErpListPage></div>
 </div>
 <ErpSheet presentation="modal" open={!!sheet} onClose={()=>setSheet(null)} title={{request:'درخواست خرید جدید',order:'ثبت سفارش خرید',receipt:selectedOrder?.route==='direct'?'ثبت تحویل در مقصد مشتری':'ثبت دریافت بار',quality:'بررسی و تأیید کیفیت',reject:'ثبت رد قطعی کیفیت',return:'ثبت برگشت واقعی بار',exchange:'ثبت تعویض با تأمین‌کننده',receiptDetail:'جزئیات و سوابق رسید',detail:'جزئیات درخواست'}[sheet]||''} size="default" scope="workspace" footer={<div className="sheet-actions"><ErpButton label="بستن" onClick={()=>setSheet(null)} variant="outline"/>{!['detail','receiptDetail'].includes(sheet)&&<ErpButton label={{request:'ثبت درخواست',order:'ثبت سفارش خرید',receipt:'ثبت دریافت',quality:'ثبت پذیرش کیفیت',reject:'ثبت رد قطعی',return:'تأیید برگشت واقعی',exchange:'ثبت پرونده تعویض'}[sheet]||'ثبت'} onClick={save} tone={sheet==='reject'?'danger':'primary'} variant="solid"/>}</div>}>
 <div className="purchase-form">{Object.values(errors).filter(Boolean).length>0&&<div role="alert"><ErpInlineState kind="error" title={errors.general||'ثبت انجام نشد. موارد مشخص‌شده را اصلاح کنید؛ اطلاعات فرم حفظ شده است.'}/></div>}
 {sheet==='request'&&<>
 {select('reason','علت خرید',[{value:'contract',label:'برای سفارش مشتری'},{value:'stock',label:'برای موجودی انبار'}],{onChange:value=>{setForm(f=>({...f,reason:value,contract:value==='stock'?'':'100101',line:value==='stock'?'':'101-1',stone:value==='stock'?'':contracts[0].lines[0].stone,qty:value==='stock'?'':'80',unit:'مترمربع'}));setErrors({});}})}
 {form.reason==='contract'&&<>{select('contract','قرارداد مشتری',contracts.map(c=>({value:c.id,label:fa(c.id)+' · '+c.customer+(c.partner?' · همکار':'')+(!c.financial?' · بدون رکورد مالی':'')})),{required:true,onChange:contractChange})}{select('line','ردیف قرارداد',(contract?.lines||[]).map(l=>({value:l.id,label:l.stone+' · '+showQty(l.qty,l.unit)})),{required:true,onChange:lineChange})}{contract&&!contract.financial&&<ErpInlineState kind="permission" title="اعلام نیاز مجاز است؛ سفارش قطعی پس از ثبت رکورد مالی معتبر امکان‌پذیر می‌شود."/>}</>}
 {field('stone','سنگ و مشخصات اولیه',{required:true,readOnly:form.reason==='contract',placeholder:'مثلاً تراورتن عباس‌آباد، سورت ممتاز'})}
 <div className="form-grid">{field('qty','مقدار موردنیاز',{inputMode:'decimal',hint:'اگر هنوز مشخص نیست، خالی بگذارید.',placeholder:'مثلاً ۸۰'})}{form.reason==='contract'?<ErpFieldView label="واحد" value={form.unit}/>:select('unit','واحد',units)}</div>
 {form.unit==='سایر'&&field('customUnit','نام واحد',{required:true,placeholder:'مثلاً پالت'})}
 <ErpDisclosure title="جزئیات تکمیلی (اختیاری)"><div className="form-grid">{select('requester','درخواست‌کننده',['فروشنده داخلی','انباردار','مسئول خرید'])}{field('date','موعد موردنیاز (اختیاری)',{placeholder:'مثلاً ۱۴۰۵/۰۸/۲۰'})}</div>
 {field('dimensions','ابعاد، ضخامت و مشخصات تکمیلی (اختیاری)')}
 <ErpField label="توضیحات (اختیاری)"><ErpTextarea value={form.notes||''} onChange={e=>set('notes',e.target.value)}/></ErpField></ErpDisclosure>
 </>}
 {sheet==='order'&&<>
 {select('request','درخواست خرید',[{value:'',label:'درخواست را انتخاب کنید'},...data.requests.map(r=>({value:r.id,label:r.id+' · '+r.stone}))],{required:true,onChange:id=>{const r=req(id);setForm(f=>({...f,request:id,qty:r?String(requestProgress(data,id).toOrder??''):''}));setErrors({});}})}
 {selectedRequest&&<ErpCard className="p-4"><strong>{selectedRequest.stone}</strong><p>{selectedRequest.reason==='stock'?'نیاز انبار سبلان':'قرارداد '+fa(selectedRequest.contract)}</p><p>مقدار درخواست: {showQty(selectedRequest.qty,selectedRequest.unit)} · قبلاً سفارش داده‌شده: {showQty(requestProgress(data,selectedRequest.id).ordered,selectedRequest.unit)}</p>{selectedRequest.reason==='contract'&&!contracts.find(c=>c.id===selectedRequest.contract)?.financial&&<ErpInlineState kind="error" title="این قرارداد رکورد مالی معتبر ندارد؛ سفارش قطعی فعلاً مجاز نیست."/>}</ErpCard>}
 {select('supplier','تأمین‌کننده',[{value:'',label:'انتخاب تأمین‌کننده'},...suppliers,{value:'سایر',label:'ثبت تأمین‌کننده جدید'}],{required:true})}
 {form.supplier==='سایر'&&<div className="form-grid">{field('newSupplier','نام تأمین‌کننده',{required:true})}{field('supplierContact','شماره تماس یا راه ارتباطی',{required:true})}</div>}
 <div className="form-grid">{field('qty','مقدار سفارش'+(selectedRequest?' ('+selectedRequest.unit+')':''),{required:true,inputMode:'decimal'})}{field('price','قیمت هر واحد (تومان)',{inputMode:'decimal',hint:'اگر توافق نشده، خالی بگذارید.',placeholder:'در انتظار توافق'})}</div>
 {numeric(form.price)!==null&&numeric(form.qty)>0&&Number.isFinite(numeric(form.price))&&<ErpFieldView label="مبلغ سنگ (تومان)" value={fmt(numeric(form.price)*numeric(form.qty))}/>}
 <div className="form-grid">{select('route','محل تحویل',[{value:'warehouse',label:'انبار سبلان'},{value:'direct',label:'ارسال مستقیم به مشتری'}])}{field('date','موعد تحویل (اختیاری)',{placeholder:'مثلاً ۱۴۰۵/۰۸/۲۰'})}</div>
 <ErpDisclosure title="شرایط توافق و توضیحات (اختیاری)"><ErpField label="توضیحات توافق"><ErpTextarea value={form.notes||''} onChange={e=>set('notes',e.target.value)}/></ErpField></ErpDisclosure>
 </>}
 {sheet==='receipt'&&<>
 {selectedExchange?<ErpFieldView label="بار جایگزین" value={selectedExchange.id+' · '+selectedExchange.order+' · از '+selectedExchange.receipt}/>:select('order','سفارش خرید',[{value:'',label:'سفارش را انتخاب کنید'},...data.orders.map(o=>({value:o.id,label:o.id+' · '+o.supplier+' · '+o.stone}))],{required:true,onChange:chooseOrder})}
 {selectedOrder&&<p className="sds-text-secondary text-sm">{selectedOrder.route==='direct'?'تحویل مستقیم به مشتری':'دریافت در انبار سبلان'} · قبلاً رسیده: {showQty(orderProgress(data,selectedOrder.id).received,selectedOrder.unit)} · باقی دریافت: {showQty(selectedExchange?exchangeProgress(data,selectedExchange.id).remaining:orderProgress(data,selectedOrder.id).remaining,selectedOrder.unit)}</p>}

 {selectedOrder?.route==='direct'&&<>
 {deliveryRequest?.reason!=='contract'?select('destinationCustomer','مشتری مقصد',[{value:'',label:'انتخاب مشتری مقصد'},...customers.map(c=>({value:c.id,label:c.name}))],{required:true,onChange:id=>{setForm(f=>({...f,destinationCustomer:id,recipient:''}));setErrors({});}}):<p className="sds-text-secondary text-sm">مشتری مقصد: {destinationCustomer?.name||'اطلاعات مشتری موجود نیست'}</p>}
 {select('recipient','تأییدکننده در مقصد',[{value:'',label:'انتخاب از اطلاعات مشتری'},...(destinationCustomer?.contacts||[]).map(c=>({value:c.id,label:c.name+' · '+c.role}))],{required:true,hint:destinationCustomer&&!destinationCustomer.contacts.length?'برای این مشتری شخصی ثبت نشده است؛ ابتدا اطلاعات مشتری را تکمیل کنید.':undefined})}
 </>}
 {select('quality','نتیجه بررسی کیفیت',[{value:'pending',label:'هنوز بررسی نشده؛ فقط دریافت ثبت شود'},{value:'all',label:'تمام مقدار رسیده پذیرفته است'},{value:'partial',label:'فقط بخشی از بار پذیرفته است'}])}
 <div className="form-grid">{field('qty','مقدار بار رسیده'+(selectedOrder?' ('+selectedOrder.unit+')':''),{required:true,inputMode:'decimal'})}{form.quality==='partial'&&field('accepted','مقدار پذیرفته‌شده',{required:true,inputMode:'decimal'})}</div>
 <ErpInlineState kind="permission" title={form.quality==='partial'&&numeric(form.qty)>0&&numeric(form.accepted)!==null&&numeric(form.accepted)>=0&&numeric(form.accepted)<=numeric(form.qty)?fmt(numeric(form.accepted))+' '+(selectedOrder?.unit||'واحد')+' قابل مصرف می‌شود؛ '+fmt(numeric(form.qty)-numeric(form.accepted))+' '+(selectedOrder?.unit||'واحد')+' تا تعیین تکلیف کیفیت، قابل مصرف نیست. این مقدار هنوز رد یا برگشت ثبت نشده است.':'فقط مقدار پذیرفته‌شده از نظر کیفیت، قابل مصرف خواهد بود.'}/>
 <ErpDisclosure title="توضیح وضعیت بار یا مدرک تأیید (اختیاری)"><ErpField label="توضیحات یا مرجع تأیید"><ErpTextarea value={form.notes||''} onChange={e=>set('notes',e.target.value)}/></ErpField></ErpDisclosure>
 </>}
 {sheet==='quality'&&selectedReceipt&&<><ErpFieldView label="رسید" value={selectedReceipt.id+' · '+order(selectedReceipt.order)?.stone}/><div className="form-grid"><ErpFieldView label="مقدار رسیده" value={showQty(selectedReceipt.qty,order(selectedReceipt.order)?.unit)}/><ErpFieldView label="در انتظار پذیرش" value={showQty(receiptProgress(data,selectedReceipt.id).pending,order(selectedReceipt.order)?.unit)}/></div>{field('accepted','مقدار جدیدی که کیفیت آن پذیرفته شد',{required:true,inputMode:'decimal',hint:'این مقدار به پذیرش قبلی اضافه می‌شود.'})}<ErpButton label="ثبت رد قطعی به‌جای پذیرش" tone="danger" variant="outline" onClick={()=>openDisposition('reject',selectedReceipt.id)}/></>}
 {['reject','return','exchange'].includes(sheet)&&selectedReceipt&&<>
 <ErpFieldView label="بار اصلی" value={selectedReceipt.id+' · '+order(selectedReceipt.order)?.stone}/>
 <div className="form-grid"><ErpFieldView label="مقدار پذیرفته‌شده" value={showQty(selectedReceipt.accepted,order(selectedReceipt.order)?.unit)}/><ErpFieldView label={sheet==='reject'?'بررسی‌نشده':sheet==='return'?'ردشده و هنوز برگشت‌نخورده':'ردشده و بدون پرونده تعویض'} value={showQty(sheet==='reject'?receiptProgress(data,selectedReceipt.id).pending:sheet==='return'?receiptProgress(data,selectedReceipt.id).toReturn:receiptProgress(data,selectedReceipt.id).toExchange,order(selectedReceipt.order)?.unit)}/></div>
 {field('qty','مقدار'+(sheet==='reject'?' رد قطعی':sheet==='return'?' برگشت واقعی':' تعویض')+' ('+order(selectedReceipt.order)?.unit+')',{required:true,inputMode:'decimal'})}
 {sheet==='reject'&&select('reason','علت رد قطعی',[{value:'',label:'انتخاب علت'},'کیفیت یا سورت نامناسب','شکستگی یا آسیب بار','مغایرت ابعاد یا ضخامت','سایر'],{required:true})}
 <ErpInlineState kind="permission" title={sheet==='reject'?'رد قطعی، مقدار را از بررسی‌نشده جدا می‌کند؛ خروج واقعی کالا یا دریافت جایگزین هنوز ثبت نمی‌شود.':sheet==='return'?'فقط وقتی ثبت کنید که این مقدار واقعاً به تأمین‌کننده برگشت داده شده باشد. این اقدام دریافت وجه یا بار جایگزین نیست.':'ثبت تعویض فقط توافق تأمین‌کننده برای جایگزینی این مقدار است؛ دریافت و کیفیت بار جدید جدا ثبت می‌شوند. تعویض در این نمونه خرید یا بدهی جدید ایجاد نمی‌کند.'}/>
 <ErpDisclosure title="توضیحات تکمیلی (اختیاری)"><ErpField label="توضیحات یا مرجع توافق"><ErpTextarea value={form.notes||''} onChange={e=>set('notes',e.target.value)}/></ErpField></ErpDisclosure>
 </>}
 {sheet==='receiptDetail'&&selectedReceipt&&<>
 <ErpFieldView label="رسید اصلی" value={selectedReceipt.id+' · '+selectedReceipt.order+(selectedReceipt.exchange?' · جایگزین '+selectedReceipt.exchange:'')}/>
 <div className="form-grid">{[['رسیده',selectedReceipt.qty],['پذیرفته‌شده',selectedReceipt.accepted],['بررسی‌نشده',receiptProgress(data,selectedReceipt.id).pending],['رد قطعی',selectedReceipt.rejected||0],['برگشت واقعی',selectedReceipt.returned||0],['ردشده موجود در محل',receiptProgress(data,selectedReceipt.id).toReturn]].map(([label,value])=><ErpFieldView key={label} label={label} value={showQty(value,order(selectedReceipt.order)?.unit)}/>)}</div>
 <h3>سوابق این بار</h3><p>دریافت اولیه {showQty(selectedReceipt.qty,order(selectedReceipt.order)?.unit)} با پذیرش اولیه {showQty(selectedReceipt.accepted-(selectedReceipt.events||[]).filter(e=>e.type==='quality').reduce((n,e)=>n+e.qty,0),order(selectedReceipt.order)?.unit)}</p>
 {(selectedReceipt.events||[]).map((e,i)=><p key={i}>{({reject:'رد قطعی',return:'برگشت واقعی',exchange:'توافق تعویض',quality:'پذیرش کیفیت'})[e.type]}: {showQty(e.qty,order(selectedReceipt.order)?.unit)} {e.reason||e.reference||''}{e.notes?' · '+e.notes:''}</p>)}
 {(data.exchanges||[]).filter(e=>e.receipt===selectedReceipt.id).map(e=><ErpFieldView key={e.id} label={e.id} value={'جایگزین رسیده '+fmt(exchangeProgress(data,e.id).received)+' / پذیرفته '+fmt(exchangeProgress(data,e.id).accepted)}/>)}</>}
 {sheet==='detail'&&(()=>{const r=req(form.detail),p=r&&requestProgress(data,r.id);return r&&<><ErpFieldView label="درخواست" value={r.id}/><ErpFieldView label="سنگ" value={r.stone}/><div className="form-grid"><ErpFieldView label="مقدار نیاز" value={showQty(r.qty,r.unit)}/><ErpFieldView label="سفارش داده‌شده" value={showQty(p.ordered,r.unit)}/><ErpFieldView label="پذیرفته‌شده" value={showQty(p.accepted,r.unit)}/><ErpFieldView label="کسری تأمین" value={showQty(p.missing,r.unit)}/></div><ErpFieldView label="درخواست‌کننده / مسئول پیگیری" value={r.requester+' / '+r.owner}/><ErpFieldView label="توضیحات" value={r.notes||'—'}/><ErpButton label="ثبت سفارش برای این درخواست" onClick={()=>openOrder(r.id)} disabled={p.toOrder===0} variant="solid"/></>})()}
 </div></ErpSheet>
 </div>;
}
createRoot(document.getElementById('root')).render(<AppRouterContext.Provider value={router}><App/></AppRouterContext.Provider>);
