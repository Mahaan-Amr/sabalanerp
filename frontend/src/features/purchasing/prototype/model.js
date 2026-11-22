// THROWAWAY: pure in-memory purchasing model, not production code.
export const roles = {buyer:'مسئول خرید',manager:'مدیریت',admin:'ادمین',seller:'فروشنده',warehouse:'انباردار',accountant:'حسابداری'};
const privileged = s => ['buyer','manager','admin'].includes(s.role);
export function initial(overrides={}) { return {role:'buyer',owner:'مسئول خرید اول',need:80,stockNeed:0,financial:true,raw:false,ready:false,route:'warehouse',unit:'مترمربع',conversion:null,orders:[],receipts:[],pending:null,ledger:{stock:0,debt:0,paid:0},links:[],advance:0,finalPrice:null,quote:false,notifications:[],history:[],message:'یک درخواست نمونه برای قرارداد ۱۰۰۱۰۱ آماده است.',tone:'info',...overrides}; }
export function totals(s) {
 const accepted=s.receipts.reduce((n,r)=>n+r.accepted-r.returned,0), received=s.receipts.reduce((n,r)=>n+r.qty,0);
 const committed=s.orders.reduce((n,o)=>n+o.customer,0), stockCommitted=s.orders.reduce((n,o)=>n+o.stock,0);
 const cAccepted=s.receipts.reduce((n,r)=>n+r.customerAccepted-r.customerReturned,0);
 const customer=Math.min(s.need,cAccepted), stock=Math.max(0,accepted-customer);
 const pending=s.receipts.reduce((n,r)=>n+r.qty-r.accepted,0);
 return {accepted,received,committed,stockCommitted,customer,stock,pending,missing:Math.max(0,s.need-customer),ordered:s.orders.reduce((n,o)=>n+o.customer+o.stock,0),complete:customer>=s.need&&stock>=s.stockNeed&&accepted>0};
}
export function reduce(previous,a){
 const s=structuredClone(previous); s.tone='success';
 if('qty' in a && (!Number.isFinite(a.qty)||a.qty<0||(a.type!=='reduceNeed'&&a.qty===0))){s.message='مقدار باید عدد معتبر و مثبت باشد. مقدار را بررسی کنید.';s.tone='danger';return s;}
 const fail=(message)=>{s.message=message;s.tone='danger';s.history.push({text:'متوقف شد: '+message,financial:['price','advance','invoice'].includes(a.type)});return s;};
 const note=message=>{s.message=message;s.history.push({text:message,financial:['price','advance','invoice'].includes(a.type)});s.notifications.push({to:a.to||'مسئول پیگیری و افراد مرتبط',text:message});return s;};
 if(a.type==='role'){s.role=a.role;s.message='نمایش با نقش «'+roles[s.role]+'»؛ اطلاعات مالی برای فروشنده و انباردار پنهان است.';s.tone='info';return s;}
 const write=['order','send','confirm','price','reduceNeed','assign','link','return','close','resolve','convert','timeout','reconcile'];
 if(write.includes(a.type)&&!privileged(s))return fail('این کار در اختیار مسئول خرید، مدیریت یا ادمین است. برای پیگیری با مسئول پرونده تماس بگیرید.');
 switch(a.type){
 case 'quote':s.quote=true;return note('استعلام ثبت شد؛ قیمت و تاریخ می‌توانند فعلاً نامشخص بمانند.');
 case 'financial':if(!['accountant','manager','admin'].includes(s.role))return fail('ثبت رکورد مالی در اختیار حسابداری است. نقش حسابداری را انتخاب کنید.');s.financial=!a.void;return note(a.void?'رکورد مالی باطل شد؛ تعهد خرید قبلی حفظ شده و نیازمند تعیین تکلیف است.':'رکورد مالی معتبر ثبت شد؛ تأیید مالی یا تسویه شرط سفارش خرید نیست.');
 case 'order':case 'timeout':{
 if(!s.financial && (a.customer??80)>0)return fail('سفارش خرید ثبت نشد؛ قرارداد ۱۰۰۱۰۱ رکورد مالی معتبر ندارد. وضعیت را با حسابداری پیگیری کنید.');
 if(s.pending)return fail('نتیجه سفارش قبلی هنوز مشخص نیست. ابتدا «بررسی نتیجه ثبت» را بزنید؛ سفارش را دوباره ثبت نکنید. شناسه پیگیری: خریدـ۰۰۱');
 const t=totals(s),c=a.customer??80,st=a.stock??0;
 if(!Number.isFinite(c)||!Number.isFinite(st)||c<0||st<0||c+st<=0)return fail('مقدار سفارش باید عدد مثبت باشد؛ سهم مشتری و انبار را بررسی کنید.');
 if(c+t.committed>s.need)return fail('این مقدار قبلاً برای قرارداد سفارش داده شده است. مقدار باقی‌مانده را بررسی کنید یا سهم اضافه را برای انبار مشخص کنید.');
 if(a.type==='timeout'){s.pending={customer:c,stock:st,supplier:a.supplier||'کارخانه الف'};return note('ارتباط قطع شد؛ نتیجه ثبت مشخص نیست. اطلاعات حفظ شد. «بررسی نتیجه ثبت» را بزنید. شناسه پیگیری: خریدـ۰۰۱');}
 s.orders.push({id:'خریدـ'+(s.orders.length+1),supplier:a.supplier||'کارخانه الف',customer:c,stock:st,price:a.price??null,sent:0,closed:false});return note('سفارش '+(c+st)+' '+s.unit+' ثبت شد؛ سهم مشتری '+c+' و سهم انبار '+st+'.');}
 case 'reconcile':if(!s.pending)return fail('ثبت نامشخصی برای بررسی وجود ندارد.');s.orders.push({id:'خریدـ'+(s.orders.length+1),...s.pending,price:null,sent:0,closed:false});s.pending=null;return note('نتیجه بررسی شد: سفارش قبلی ثبت شده بود؛ همان سفارش بازیابی شد و سفارش تازه ایجاد نشد.');
 case 'receive':{
 if(!['warehouse','manager','admin'].includes(s.role))return fail('دریافت انبار را انباردار ثبت می‌کند. نقش انباردار را انتخاب کنید.');
 if(s.route==='direct')return fail('این سفارش ارسال مستقیم است؛ تأیید مقصد را مسئول خرید ثبت می‌کند.');
 return receive(s,a,note,fail);}
 case 'accept':{
 if(!['warehouse','manager','admin'].includes(s.role))return fail('پذیرش کیفیت در انبار را انباردار، مدیریت یا ادمین ثبت می‌کند.');
 const r=s.receipts[a.receipt??s.receipts.length-1];if(!r)return fail('ابتدا دریافت کالا را ثبت کنید.');
 const qty=a.qty??(r.qty-r.accepted);if(qty<=0||qty>r.qty-r.accepted)return fail('مقدار پذیرش از مقدار دریافت‌شده و بررسی‌نشده بیشتر است. مقدار را اصلاح کنید.');
 accept(s,r,qty);return note(qty+' '+s.unit+' پذیرفته شد؛ فقط مقدار پذیرفته‌شده قابل مصرف است.');}
 case 'route':if(!privileged(s))return fail('انتخاب مسیر ارسال در اختیار مسئول خرید است.');if(s.receipts.length||s.orders.some(o=>o.sent))return fail('پس از ارسال یا دریافت، تغییر مسیر نیازمند تعیین تکلیف محموله است.');s.route=a.route;return note(a.route==='direct'?'مسیر ارسال مستقیم به پروژه انتخاب شد.':'مسیر ورود به انبار سبلان انتخاب شد.');
 case 'send':{const o=s.orders[a.order??0];if(!o)return fail('ابتدا سفارش قطعی را ثبت کنید.');const q=a.qty??o.customer+o.stock;if(o.sent+q>o.customer+o.stock)return fail('مقدار ارسال از باقی سفارش بیشتر است.');o.sent+=q;return note('بار ارسال شد؛ در انتظار تأیید مقدار و کیفیت در مقصد. راننده نیازی به حساب سیستمی ندارد.');}
 case 'confirm':{
 const o=s.orders[a.order??0];if(!o||!o.sent)return fail('ابتدا ارسال محموله را ثبت کنید.');
 const q=a.qty??o.sent,already=s.receipts.filter(r=>r.order===(a.order??0)).reduce((n,r)=>n+r.qty,0);if(q+already>o.sent)return fail('این مقدار ارسال یا تحویل قبلاً ثبت شده است.');
 if(!a.recipient)return fail('نام تأییدکننده در مقصد را مشخص کنید.');
 const r={order:a.order??0,qty:q,accepted:0,returned:0,customerAccepted:0,customerReturned:0,recipient:a.recipient};s.receipts.push(r);accept(s,r,q);return note('تحویل و کیفیت '+q+' '+s.unit+' با تأیید '+a.recipient+' در مقصد ثبت شد.');}
 case 'reduceNeed':if(!Number.isFinite(a.qty)||a.qty<0||a.qty>s.need)return fail('مقدار جدید باید بین صفر و نیاز فعلی باشد.');s.need=a.qty;return note('نیاز مشتری به '+a.qty+' تغییر کرد؛ سهم اضافه به انبار منتقل شد. انتقال فیزیکی مازادِ خارج از سبلان باید جدا پیگیری شود.');
 case 'price':s.finalPrice=a.amount;return note('قیمت توافقی '+a.amount.toLocaleString('fa-IR')+' تومان ثبت شد؛ حسابداری باید فاکتور را تطبیق دهد.');
 case 'advance':if(!['accountant','manager','admin'].includes(s.role))return fail('پرداخت واقعی در اختیار حسابداری است.');s.advance+=a.amount;s.ledger.paid+=a.amount;return note('پیش‌پرداخت ثبت شد؛ تحویل کالا یا تسویه نهایی محسوب نمی‌شود.');
 case 'invoice':if(!['accountant','manager','admin'].includes(s.role))return fail('تطبیق فاکتور در اختیار حسابداری است.');if(s.finalPrice===null)return fail('قیمت توافقی نهایی نشده است. ابتدا مسئول خرید قیمت را مشخص کند.');if(a.price!==s.finalPrice)return fail('قیمت فاکتور با توافق خرید متفاوت است. برای بررسی به مسئول خرید ارجاع شد؛ بدهی ثبت نشد.');if(totals(s).accepted<totals(s).ordered)return fail('دریافت و پذیرش کل مقدار این فاکتور هنوز تکمیل نشده است؛ بدهی ثبت نشد.');if(s.ledger.debt)return fail('این فاکتور قبلاً ثبت یا متصل شده است؛ بدهی دوباره ثبت نمی‌شود.');s.ledger.debt=a.total;return note('فاکتور تطبیق و بدهی ثبت شد؛ پیش‌پرداخت تا تخصیص حسابداری، مستقل باقی می‌ماند.');
 case 'link':if(s.links.length)return fail('سوابق این خرید قبلاً متصل شده‌اند؛ اثر تکراری ایجاد نشد.');if(s.ledger.stock<=0||s.ledger.debt<=0)return fail('در این سناریو سند قبلی وجود ندارد. سناریوی اتصال سوابق قبلی را انتخاب کنید.');s.links=['دریافت انبار قبلی','فاکتور قبلی','پرداخت قبلی'];s.orders.push({id:'خریدـسابقه',supplier:'کارخانه الف',customer:80,stock:0,price:500000,sent:80,closed:true});s.receipts.push({order:0,qty:80,accepted:80,returned:0,customerAccepted:80,customerReturned:0,previous:true});return note('سه سابقه قبلی متصل شدند؛ موجودی، بدهی و پرداخت تغییری نکردند.');
 case 'request':{const t=totals(s);if(t.committed+a.qty>s.need)return fail('برای این نیاز قبلاً سفارش ثبت شده است. درخواست تکمیلی باید کسری واقعی یا سهم مستقل انبار داشته باشد.');return note('درخواست تکمیلی ثبت شد؛ سفارش قطعی جداگانه لازم است.');}
 case 'return':{const r=s.receipts[0];if(!r||a.qty>r.accepted-r.returned)return fail('مقدار برگشت از موجودی پذیرفته‌شده بیشتر است.');r.returned+=a.qty;const cr=Math.min(a.qty,r.customerAccepted-r.customerReturned);r.customerReturned+=cr;return note('برگشت '+a.qty+' '+s.unit+' به خرید اصلی متصل شد؛ نیاز مشتری دوباره کسری دارد. وجه یا جایگزین خودکار دریافت نشد.');}
 case 'assign':if(!['manager','admin'].includes(s.role))return fail('واگذاری مسئول پیگیری در اختیار مدیریت و ادمین است.');s.owner='مسئول خرید دوم';return note('پرونده به مسئول خرید دوم واگذار شد؛ مسئول قبلی در تاریخچه محفوظ است.');
 case 'close':{const o=s.orders[0];if(!o)return fail('سفارش بازی وجود ندارد.');o.closed=true;return note('باقی سفارش کارخانه بسته شد؛ کسری نیاز مشتری همچنان باز است.');}
 case 'ready':if(!['warehouse','manager','admin'].includes(s.role))return fail('آمادگی محصول نهایی را مسئول مجاز انبار ثبت می‌کند.');if(!totals(s).complete)return fail('تأمین هنوز کامل نشده است.');s.ready=true;return note('آمادگی محصول نهایی ثبت شد؛ این اقدام از تکمیل خرید مستقل است.');
 case 'convert':if(s.orders.length)return fail('پس از ثبت سفارش، واحد قبلی حفظ می‌شود. برای بررسی واحد دیگر، سناریو را از نو شروع کنید.');if(!a.unit?.trim())return fail('نام واحد را وارد کنید.');s.unit=a.unit;s.conversion=a.description;s.conversionFactor=a.factor??null;s.conversionUnit=a.baseUnit??null;return note('واحد «'+a.unit+'» و رابطه تبدیل صریح ثبت شد؛ تبدیل عمومی تن به مترمربع وجود ندارد.');
 default:return fail('اقدام شناخته نشد. شناسه پیگیری: نمونهـ۰۰۲');
 }
}
function receive(s,a,note,fail){const oi=a.order??0,o=s.orders[oi];if(!o)return fail('ابتدا سفارش قطعی را ثبت کنید.');const received=s.receipts.filter(r=>r.order===oi).reduce((n,r)=>n+r.qty,0),qty=a.qty??o.customer+o.stock-received;if(qty<=0||qty+received>o.customer+o.stock)return fail('مقدار دریافت از باقی سفارش بیشتر است؛ مقدار را بررسی کنید.');s.receipts.push({order:oi,qty,accepted:0,returned:0,customerAccepted:0,customerReturned:0});return note(qty+' '+s.unit+' دریافت شد؛ تا پذیرش کیفیت قابل مصرف نیست.');}
function accept(s,r,q){const o=s.orders[r.order],already=s.receipts.filter(x=>x.order===r.order).reduce((n,x)=>n+x.customerAccepted,0);r.accepted+=q;r.customerAccepted+=Math.min(q,Math.max(0,o.customer-already));}
