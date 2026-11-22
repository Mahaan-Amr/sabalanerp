// THROWAWAY: local fixtures and pure transitions. No real ERP mutations.
export const contracts=[
 {id:'100101',customer:'علی رضایی',financial:true,partner:false,lines:[{id:'101-1',stone:'تراورتن عباس‌آباد، سورت ممتاز',qty:80,unit:'مترمربع'},{id:'101-2',stone:'پله مرمریت آباده',qty:40,unit:'عدد'}]},
 {id:'100102',customer:'شرکت آفتاب',financial:false,partner:false,lines:[{id:'102-1',stone:'گرانیت نهبندان',qty:60,unit:'مترمربع'}]},
 {id:'100103',customer:'فروشگاه سنگ پارس',financial:true,partner:true,lines:[{id:'103-1',stone:'تراورتن حاجی‌آباد',qty:100,unit:'مترمربع'}]},
 {id:'100104',customer:'مریم احمدی',financial:true,partner:false,lines:[{id:'104-1',stone:'تراورتن دره‌بخاری',qty:50,unit:'مترمربع'}]}
];
// All people below are synthetic prototype customer/contact data.
export const customers=[
 {id:'customer-1',contract:'100101',name:'علی رضایی',contacts:[{id:'contact-1',name:'علی رضایی',role:'مشتری'},{id:'contact-2',name:'حسین رضایی',role:'نماینده پروژه'}]},
 {id:'customer-2',contract:'100102',name:'شرکت آفتاب',contacts:[{id:'contact-3',name:'سارا احمدی',role:'نماینده شرکت'}]},
 {id:'customer-3',contract:'100103',name:'فروشگاه سنگ پارس',contacts:[{id:'contact-4',name:'رضا محمدی',role:'نماینده فروشگاه'}]},
 {id:'customer-4',contract:'100104',name:'مریم احمدی',contacts:[{id:'contact-5',name:'مریم احمدی',role:'مشتری'}]}
];
export function deliveryCustomer(data,orderId,customerId=''){
 const o=data.orders.find(o=>o.id===orderId),r=data.requests.find(r=>r.id===o?.request);
 return r?.reason==='contract'?customers.find(c=>c.contract===r.contract):customers.find(c=>c.id===customerId);
}
export const units=['مترمربع','متر طول','عدد','تن','کیلوگرم','سایر'];
export const suppliers=['کارخانه سنگ آریا','سنگبری سپهر','کارخانه نگین'];
export const digits=s=>String(s??'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,]/g,'').replace('٫','.');
export const numeric=s=>String(s??'').trim()===''?null:Number(digits(s));
export const fmt=n=>Number(n).toLocaleString('fa-IR');
export const fa=s=>String(s).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[+d]);
export function seed(){return {requests:[
 {id:'درخواست ۰۰۱',reason:'contract',contract:'100104',line:'104-1',stone:'تراورتن دره‌بخاری',qty:50,unit:'مترمربع',requester:'فروشنده داخلی',notes:'برای نمای ساختمان؛ سورت یکدست باشد.',dimensions:'ضخامت ۲ سانتی‌متر',owner:'مسئول خرید'},
 {id:'درخواست ۰۰۲',reason:'stock',contract:'',line:'',stone:'گرانیت نهبندان',qty:60,unit:'مترمربع',requester:'انباردار',notes:'تکمیل موجودی انبار',dimensions:'ضخامت ۲ سانتی‌متر',owner:'مسئول خرید'},
 {id:'درخواست ۰۰۳',reason:'stock',contract:'',line:'',stone:'تراورتن حاجی‌آباد',qty:null,unit:'مترمربع',requester:'مسئول خرید',notes:'بررسی امکان تأمین',dimensions:'',owner:'مسئول خرید'}
 ],orders:[{id:'خرید ۰۰۱',request:'درخواست ۰۰۲',supplier:'کارخانه نگین',qty:60,unit:'مترمربع',price:420000,route:'warehouse',date:'',notes:'',stone:'گرانیت نهبندان'}],receipts:[{id:'رسید ۰۰۱',order:'خرید ۰۰۱',qty:20,accepted:20,recipient:'انبار سبلان',notes:'',route:'warehouse'},{id:'رسید ۰۰۲',order:'خرید ۰۰۱',qty:40,accepted:15,recipient:'انبار سبلان',notes:'نمونه آماده: ۱۵ متر پذیرفته و ۲۵ متر منتظر بررسی',route:'warehouse'}],exchanges:[],nextRequest:4,nextOrder:2,nextReceipt:3,nextExchange:1};}
const sum=(rows,key)=>rows.reduce((n,r)=>n+r[key],0);
export function receiptProgress(data,id){
 const r=data.receipts.find(r=>r.id===id);if(!r)return {pending:0,rejected:0,returned:0,toReturn:0,toExchange:0};
 const rejected=r.rejected||0,returned=r.returned||0,exchanged=(data.exchanges||[]).filter(e=>e.receipt===id).reduce((n,e)=>n+e.qty,0);
 return {pending:r.qty-r.accepted-rejected,rejected,returned,toReturn:rejected-returned,toExchange:rejected-exchanged};
}
export function exchangeProgress(data,id){const e=(data.exchanges||[]).find(e=>e.id===id),rs=data.receipts.filter(r=>r.exchange===id),received=sum(rs,'qty'),children=(data.exchanges||[]).filter(x=>rs.some(r=>r.id===x.receipt)),accepted=sum(rs,'accepted')+children.reduce((n,x)=>n+exchangeProgress(data,x.id).accepted,0);return {received,accepted,remaining:e?e.qty-received:0};}
export function orderProgress(data,id){const o=data.orders.find(x=>x.id===id);const rs=data.receipts.filter(x=>x.order===id);const received=sum(rs.filter(r=>!r.exchange),'qty'),accepted=sum(rs,'accepted'),pending=rs.reduce((n,r)=>n+receiptProgress(data,r.id).pending,0),rejected=rs.reduce((n,r)=>n+(r.rejected||0),0),toReturn=rs.reduce((n,r)=>n+receiptProgress(data,r.id).toReturn,0),replacementRemaining=(data.exchanges||[]).filter(e=>e.order===id).reduce((n,e)=>n+exchangeProgress(data,e.id).remaining,0);return {received,accepted,pending,rejected,toReturn,replacementRemaining,remaining:o?o.qty-received:0};}
export function requestProgress(data,id){const r=data.requests.find(x=>x.id===id);const os=data.orders.filter(x=>x.request===id);const ordered=sum(os,'qty'),accepted=os.reduce((n,o)=>n+orderProgress(data,o.id).accepted,0);return {ordered,accepted,toOrder:r?.qty==null?null:Math.max(0,r.qty-ordered),missing:r?.qty==null?null:Math.max(0,r.qty-accepted)};}
const positive=x=>Number.isFinite(x)&&x>0;
export function apply(data,type,form){
 const s=structuredClone(data),errors={};const f={...form};
 if(type==='request'){
  const qty=numeric(f.qty);let unit=f.unit==='سایر'?(f.customUnit||'').trim():f.unit;
  if(!f.stone?.trim())errors.stone='نام و مشخصات اولیه سنگ را وارد کنید.';
  if(!unit)errors.customUnit='نام واحد را وارد کنید.';
  if(qty!==null&&!positive(qty))errors.qty='مقدار باید عددی بزرگ‌تر از صفر باشد؛ یا فعلاً خالی بماند.';
  if(f.reason==='contract'){
   const c=contracts.find(c=>c.id===f.contract),l=c?.lines.find(l=>l.id===f.line);
   if(!l)errors.contract='قرارداد و ردیف موردنیاز را انتخاب کنید.';
   if(l&&qty!==null&&qty>l.qty)errors.qty='مقدار از نیاز همین ردیف قرارداد بیشتر است؛ اضافه را جدا برای انبار درخواست کنید.';
   if(l){f.stone=l.stone;unit=l.unit;}
  }
  if(Object.keys(errors).length)return {errors};
  const id='درخواست '+fmt(s.nextRequest++).padStart(3,'۰');s.requests.unshift({...f,id,qty,unit,owner:'مسئول خرید'});return {data:s,id,message:id+' ثبت شد و در اختیار مسئول خرید قرار گرفت.'};
 }
 if(type==='order'){
  const r=s.requests.find(r=>r.id===f.request),qty=numeric(f.qty),price=numeric(f.price);
  if(!r)errors.request='درخواست خرید را انتخاب کنید.';
  if(!f.supplier?.trim())errors.supplier='تأمین‌کننده را انتخاب یا ثبت کنید.';
  if(f.supplier==='سایر'&&!f.newSupplier?.trim())errors.newSupplier='نام تأمین‌کننده جدید را وارد کنید.';
  if(f.supplier==='سایر'&&!f.supplierContact?.trim())errors.supplierContact='شماره تماس یا راه ارتباطی تأمین‌کننده را وارد کنید.';
  if(!positive(qty))errors.qty='مقدار سفارش باید عددی بزرگ‌تر از صفر باشد.';
  if(price!==null&&(!Number.isFinite(price)||price<0))errors.price='قیمت را به تومان وارد کنید؛ اگر توافق نشده، خالی بگذارید.';
  if(r){
   const p=requestProgress(s,r.id);if(p.toOrder!==null&&qty>p.toOrder)errors.qty='از این درخواست فقط '+fmt(p.toOrder)+' '+r.unit+' باقی مانده است. مقدار را اصلاح کنید.';
   if(r.reason==='contract'){
    const c=contracts.find(c=>c.id===r.contract),l=c?.lines.find(l=>l.id===r.line);
    if(!c?.financial)errors.request='قرارداد '+fa(r.contract)+' رکورد مالی معتبر ندارد. وضعیت را با حسابداری پیگیری کنید؛ درخواست شما حفظ می‌شود.';
    const other=s.orders.filter(o=>{const x=s.requests.find(r=>r.id===o.request);return x?.contract===r.contract&&x?.line===r.line}).reduce((n,o)=>n+o.qty,0);
    if(l&&qty+other>l.qty)errors.qty='برای این ردیف قرارداد قبلاً سفارش ثبت شده است؛ بیش از '+fmt(Math.max(0,l.qty-other))+' '+l.unit+' قابل سفارش نیست.';
   }
  }
  if(Object.keys(errors).length)return {errors};
  if(r.qty===null)r.qty=qty;
  const id='خرید '+fmt(s.nextOrder++).padStart(3,'۰');s.orders.unshift({...f,id,supplier:f.supplier==='سایر'?f.newSupplier.trim():f.supplier,qty,price,unit:r.unit,stone:r.stone});return {data:s,id,message:id+' ثبت شد. دریافت بار را از همین سفارش پیگیری کنید.'};
 }
 if(type==='receipt'){
  const o=s.orders.find(o=>o.id===f.order),qty=numeric(f.qty);let accepted=f.quality==='all'?qty:f.quality==='pending'?0:numeric(f.accepted);
  if(!o)errors.order='سفارش خرید را انتخاب کنید.';
  if(!positive(qty))errors.qty='مقدار بار رسیده باید عددی بزرگ‌تر از صفر باشد.';
  const exchange=f.exchange?(s.exchanges||[]).find(e=>e.id===f.exchange):null;
  if(f.exchange&&(!exchange||exchange.order!==f.order))errors.order='پرونده تعویض با این سفارش مطابقت ندارد.';
  const remaining=exchange?exchangeProgress(s,exchange.id).remaining:(o?orderProgress(s,o.id).remaining:0);
  if(o&&qty>remaining)errors.qty='فقط '+fmt(remaining)+' '+o.unit+' از '+(exchange?'این تعویض':'این سفارش')+' باقی مانده است؛ دریافت قبلی را دوباره ثبت نکنید.';
  if(!Number.isFinite(accepted)||accepted<0||accepted>qty)errors.accepted='مقدار پذیرفته‌شده باید بین صفر و مقدار رسیده باشد.';
  const customer=deliveryCustomer(s,f.order,f.destinationCustomer);
  const contact=customer?.contacts.find(c=>c.id===f.recipient);
  if(o?.route==='direct'){
   if(!customer)errors.destinationCustomer='مشتری مقصد را انتخاب کنید تا افراد مرتبط با او نمایش داده شوند.';
   if(!contact)errors.recipient='تأییدکننده را از افراد ثبت‌شده برای همین مشتری انتخاب کنید.';
  }
  if(Object.keys(errors).length)return {errors};
  const id='رسید '+fmt(s.nextReceipt++).padStart(3,'۰');s.receipts.unshift({...f,id,qty,accepted,route:o.route,recipient:o.route==='direct'?contact.name:'انبار سبلان',recipientContactId:o.route==='direct'?contact.id:null,recipientCustomerId:o.route==='direct'?customer.id:null,recipientRole:o.route==='direct'?contact.role:null});return {data:s,id,message:id+' ثبت شد؛ '+fmt(accepted)+' '+o.unit+' پذیرفته و '+fmt(qty-accepted)+' '+o.unit+' در انتظار پذیرش کیفیت است.'};
 }
 if(['reject','return','exchange'].includes(type)){
  const r=s.receipts.find(r=>r.id===f.receipt),qty=numeric(f.qty),p=receiptProgress(s,f.receipt);
  if(!r)errors.receipt='رسید بار را انتخاب کنید.';
  const available=type==='reject'?p.pending:type==='return'?p.toReturn:p.toExchange;
  if(available<=0)errors.qty=type==='reject'?'این رسید مقدار بررسی‌نشده‌ای برای رد قطعی ندارد؛ نتیجه بررسی قبلی را ببینید.':type==='return'?(p.rejected===0?'ابتدا مقدار نامناسب را قطعی رد کنید؛ سپس برگشت واقعی آن را ثبت کنید.':'برگشت تمام مقدار ردشده قبلاً ثبت شده است؛ دوباره ثبت نکنید.'):(p.rejected===0?'ابتدا مقدار نامناسب را قطعی رد کنید؛ سپس برای آن تعویض ثبت کنید.':'برای تمام مقدار ردشده قبلاً تعویض ثبت شده است؛ پرونده تعویض موجود را پیگیری کنید.');
  else if(!positive(qty)||qty>available)errors.qty='مقدار باید مثبت و حداکثر '+fmt(available)+' '+(s.orders.find(o=>o.id===r.order)?.unit||'واحد')+' باشد؛ سوابق قبلی را بررسی کنید.';
  if(type==='reject'&&!f.reason?.trim())errors.reason='علت رد کیفیت را انتخاب کنید.';
  if(Object.keys(errors).length)return {errors};
  r.events=r.events||[];
  if(type==='reject'){r.rejected=(r.rejected||0)+qty;r.events.push({type,qty,reason:f.reason,notes:f.notes||''});return {data:s,id:r.id,message:fmt(qty)+' واحد از '+r.id+' قطعی رد شد؛ قابل مصرف نیست و هنوز برگشت فیزیکی ثبت نشده است.'};}
  if(type==='return'){r.returned=(r.returned||0)+qty;r.events.push({type,qty,notes:f.notes||''});return {data:s,id:r.id,message:'برگشت واقعی '+fmt(qty)+' واحد به تأمین‌کننده ثبت شد؛ وجه یا بار جایگزین خودکار ثبت نشد.'};}
  const id='تعویض '+fmt(s.nextExchange++).padStart(3,'۰');s.exchanges.unshift({id,receipt:r.id,order:r.order,qty,notes:f.notes||'',date:f.date||''});r.events.push({type,qty,reference:id});return {data:s,id,tab:'exchanges',message:id+' برای '+fmt(qty)+' واحد ثبت شد؛ تا دریافت و تأیید بار جایگزین، کسری تأمین باز می‌ماند.'};
 }
 if(type==='quality'){
  const r=s.receipts.find(r=>r.id===f.receipt),qty=numeric(f.accepted);
  if(!r)errors.receipt='رسید بار را انتخاب کنید.';
  if(!positive(qty)||r&&qty>receiptProgress(s,r.id).pending)errors.accepted='مقدار پذیرش باید مثبت و حداکثر برابر باقی‌مانده بررسی‌نشده باشد.';
  if(Object.keys(errors).length)return {errors};
  r.events=r.events||[];r.events.push({type:'quality',qty});r.accepted+=qty;return {data:s,id:r.id,message:fmt(qty)+' واحد دیگر از '+r.id+' پذیرفته شد؛ موجودی قابل مصرف به‌روز شد.'};
 }
 return {errors:{general:'ثبت انجام نشد. دوباره تلاش کنید. شناسه پیگیری: نمونه‌خریدـ۰۰۱'}};
}
