// THROWAWAY: a plain-language walkthrough using the canonical ERP controls.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ErpButton, ErpCard, ErpInlineState, ErpFieldView} from '../../../components/erp';
import {initial, reduce, totals, roles} from './model';
import {scenarios} from './scenarios';
const n=value=>Number(value).toLocaleString('fa-IR');
const fa=value=>String(value).replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const mainStory={
 title:'خرید ۸۰ متر سنگ برای یک مشتری',
 description:'مشتری سنگ می‌خواهد و باید آن را از کارخانه بخریم. این مثال را قدم‌به‌قدم جلو ببرید.',
 steps:[
  {role:'seller',title:'فروشنده درخواست می‌دهد',body:'برای قرارداد این مشتری به ۸۰ مترمربع سنگ تراورتن نیاز داریم. درخواست را برای مسئول خرید می‌فرستیم.',button:'ارسال درخواست به مسئول خرید',action:{type:'request',qty:80}},
  {role:'buyer',title:'مسئول خرید سفارش می‌دهد',body:'درخواست فروشنده رسیده است. مسئول خرید ۸۰ مترمربع سنگ را از کارخانه الف سفارش می‌دهد. رکورد مالی قرارداد این مثال قبلاً ثبت شده است.',button:'ثبت سفارش به کارخانه',action:{type:'order',customer:80}},
  {role:'warehouse',title:'انباردار رسیدن بار را ثبت می‌کند',body:'کارخانه سنگ را فرستاده و ۸۰ مترمربع به انبار سبلان رسیده است. هنوز باید کیفیت آن بررسی شود.',button:'ثبت دریافت ۸۰ متر سنگ',action:{type:'receive',qty:80}},
  {role:'warehouse',title:'انباردار کیفیت را تأیید می‌کند',body:'انباردار سنگ‌ها را بررسی کرده است. در این مثال، مقدار و کیفیت تمام بار مطابق سفارش است.',button:'تأیید کیفیت ۸۰ متر سنگ',action:{type:'accept',qty:80}}
 ]
};
const explanations={
 quote:'پیش از قطعی‌شدن خرید هم می‌توان از کارخانه قیمت و امکان تأمین را پرسید.',
 order:'این اقدام تعهد خرید ایجاد می‌کند. سیستم مقدار باقی‌مانده و رکورد مالی قرارداد را بررسی می‌کند.',
 financial:'این اقدام در حسابداری انجام می‌شود. سفارش خرید به رکورد مالی معتبر قرارداد نیاز دارد.',
 receive:'رسیدن بار را ثبت می‌کنیم؛ تا کیفیت پذیرفته نشود، سنگ قابل مصرف نیست.',
 accept:'فقط همین مقدارِ تأییدشده برای مصرف و تأمین مشتری قابل استفاده می‌شود.',
 route:'در این مسیر، کارخانه بار را مستقیم به پروژه مشتری می‌فرستد.',
 send:'بار از کارخانه حرکت می‌کند؛ ارسال به‌تنهایی به معنای تأیید تحویل نیست.',
 confirm:'مسئول خرید تأیید نماینده پروژه را دریافت کرده و نتیجه را در پرونده ثبت می‌کند.',
 reduceNeed:'مقدار قرارداد از مسیر مجاز کاهش یافته است. سنگ اضافه برای انبار سبلان نگه داشته می‌شود.',
 price:'مسئول خرید قیمت توافق‌شده را ثبت می‌کند؛ واحد مبلغ تومان است.',
 advance:'حسابداری مبلغی را علی‌الحساب پرداخت می‌کند. این کار به معنای رسیدن سنگ یا تسویه نهایی نیست.',
 invoice:'حسابداری قیمت فاکتور را با توافق و دریافت کالا مقایسه می‌کند. اختلاف نباید پنهانی بدهی بسازد.',
 link:'دریافت، فاکتور و پرداخت قبلاً ثبت شده‌اند. فقط آن‌ها را به پرونده خرید متصل می‌کنیم.',
 request:'پیش از درخواست تکمیلی، مقدار نیاز و خرید قبلی همان قرارداد بررسی می‌شود.',
 return:'عیب سنگ پس از پذیرش مشخص شده است. برگشت را با حفظ سابقه خرید ثبت می‌کنیم.',
 assign:'ادمین پرونده را به مسئول خرید دیگری می‌سپارد؛ سابقه مسئول قبلی حفظ می‌شود.',
 timeout:'در این مثال ارتباط هنگام ثبت قطع می‌شود و معلوم نیست سفارش ثبت شده است یا خیر.',
 reconcile:'به‌جای ثبت دوباره، نتیجه سفارش قبلی را بررسی می‌کنیم.',
 ready:'سنگ خریداری‌شده در سبلان آماده‌سازی شده است. حالا آمادگی محصول نهایی را جدا ثبت می‌کنیم.',
 convert:'در این مثال هر بسته ۸ مترمربع است. این رابطه فقط برای همین خرید ثبت می‌شود.'
};
function storyFor(index){
 if(index===null)return mainStory;
 const scene=scenarios[index];let actor=scene.setup?.role||'buyer';
 return {...scene,steps:scene.steps.flatMap(step=>{
  if(step.action.type==='role'){actor=step.action.role;return [];}
  return [{role:actor,title:step.label,body:explanations[step.action.type],button:step.label,action:step.action}];
 })};
}
function resultText(s,t,index){
 if(index===null)return {title:'سنگ مشتری تأمین شد',body:'۸۰ مترمربع سنگ در انبار دریافت و تأیید شد و برای همین مشتری کنار گذاشته شده است. پیگیری خرید این مثال تمام شد.'};
 if(index===8)return {title:'سوابق قبلی متصل شدند',body:'موجودی ۸۰ متر، بدهی ۴۰ میلیون تومان و پرداخت ۱۰ میلیون تومان همان مقادیر قبلی ماندند؛ دوباره ثبت نشدند.'};
 if(index===12)return {title:'فقط یک سفارش ثبت شد',body:'نتیجه ثبت قبلی بررسی شد و همان سفارش بازیابی شد. تلاش دوباره، خرید تکراری ایجاد نکرد.'};
 if(index===9)return {title:'خرید تکراری متوقف شد',body:'۸۰ متر قبلاً سفارش داده شده بود؛ درخواست و سفارش دوباره برای همان نیاز پذیرفته نشد.'};
 if(index===5)return {title:'خرید و آماده‌سازی دو مرحله بودند',body:'ابتدا ۱۰۰ متر سنگ مصرفی رسید و پذیرفته شد؛ سپس آمادگی ۸۰ متر محصول نهایی جدا ثبت شد.'};
 if(index===13)return {title:'۱۰ بسته دریافت و تأیید شد',body:'با رابطه‌ای که برای همین خرید مشخص کردیم، ۱۰ بسته معادل ۸۰ مترمربع است؛ سیستم ضریب را حدس نزد.'};
 if(t.missing>0)return {title:n(t.missing)+' '+s.unit+' هنوز نیازمند تأمین است',body:t.pending>0?'بخشی از بار رسیده، اما کیفیت آن هنوز پذیرفته نشده است. فقط بخش پذیرفته‌شده قابل مصرف است.':'مقدار پذیرفته‌شده برای تکمیل نیاز مشتری کافی نیست؛ پیگیری باقی مقدار ادامه دارد.'};
 return {title:'تأمین مشتری کامل شد',body:t.stock>0?n(t.customer)+' '+s.unit+' برای مشتری محفوظ است و '+n(t.stock)+' '+s.unit+' سهم انبار است.':'مقدار موردنیاز مشتری رسیده و پذیرفته شده است. وضعیت پرداخت جداگانه پیگیری می‌شود.'};
}
function App(){
 const [index,setIndex]=useState(null),[state,setState]=useState(()=>initial()),[position,setPosition]=useState(0),[past,setPast]=useState([]),[choices,setChoices]=useState(false);
 const story=storyFor(index),done=position>=story.steps.length,card=story.steps[position],t=totals(state),result=done?resultText(state,t,index):null;
 const actor=card?.role||state.role,privateMoney=['buyer','manager','admin','accountant'].includes(actor);
 function restart(next=index){setIndex(next);setState(initial(next===null?{}:scenarios[next].setup));setPosition(0);setPast([]);setChoices(false);window.scrollTo(0,0);}
 function advance(){const next=reduce({...state,role:card.role},card.action);setPast([...past,state]);setState(next);setPosition(position+1);}
 function back(){setState(past[past.length-1]);setPast(past.slice(0,-1));setPosition(position-1);}
 return <main className="simple-demo">
  <header><div className="eyebrow">سبلان · نمونهٔ آزمایشی خرید</div><h1>{story.title}</h1><p>{story.description}</p><small>اطلاعات این صفحه نمونه است و چیزی در سیستم واقعی ثبت نمی‌شود.</small></header>
  <nav className="journey" aria-label="مسیر خرید"><span>۱. درخواست فروشنده</span><span aria-hidden="true">←</span><span>۲. سفارش خرید</span><span aria-hidden="true">←</span><span>۳. دریافت و تأیید انبار</span></nav>
  <ErpCard className="p-5 sm:p-8">
   <div className="story-meta"><span>{done?'نتیجهٔ مثال':'مرحلهٔ '+n(position+1)+' از '+n(story.steps.length)}</span>{!done&&<strong>اکنون: {roles[actor]}</strong>}</div>
   <h2 className="story-title">{done?result.title:card.title}</h2>
   <p className="story-body">{done?result.body:card.body}</p>
   <div className="story-facts"><ErpFieldView label="قرارداد مشتری" value="۱۰۰۱۰۱"/><ErpFieldView label={state.raw?'نیاز سنگ مصرفی':'مقدار موردنیاز مشتری'} value={n(state.need)+' '+state.unit}/>{index===null&&<ErpFieldView label="سنگ" value="تراورتن"/>}</div>
   {position>0&&<div className="last-result" aria-live="polite"><ErpInlineState kind={state.tone==='danger'?'error':'success'} title={fa(state.message)}/></div>}
   <div className="story-actions">{!done?<ErpButton label={card.button} onClick={advance} variant="solid"/>:<ErpButton label="دیدن حالت‌های دیگر خرید" onClick={()=>setChoices(!choices)} variant="solid"/>}{position>0&&<ErpButton label="مرحلهٔ قبل" onClick={back} variant="ghost"/>}</div>
  </ErpCard>
  {position>0&&!done&&<p className="plain-progress">{t.ordered===0?'درخواست به مسئول خرید رسیده است.':t.received===0?n(t.ordered)+' '+state.unit+' سفارش داده شده؛ هنوز بار نرسیده است.':t.pending>0?n(t.received)+' '+state.unit+' رسیده؛ منتظر بررسی کیفیت است.':n(t.accepted)+' '+state.unit+' پذیرفته شده است.'}</p>}
  {done&&<ErpCard className="p-5"><div className="end-summary"><ErpFieldView label="سهم پذیرفته‌شده مشتری" value={n(t.customer)+' '+state.unit}/><ErpFieldView label="سهم پذیرفته‌شده انبار" value={n(t.stock)+' '+state.unit}/><ErpFieldView label="باقی نیاز مشتری" value={n(t.missing)+' '+state.unit}/></div>{index===8&&privateMoney&&<p>موجودی قبلی: {n(state.ledger.stock)} · بدهی قبلی: {n(state.ledger.debt)} تومان · پرداخت قبلی: {n(state.ledger.paid)} تومان</p>}</ErpCard>}
  {done&&choices&&<ErpCard className="p-5"><h2>کدام حالت را ببینیم؟</h2><p>هر مثال هم فقط یک اقدام در هر مرحله دارد.</p><div className="other-stories">{scenarios.map((s,i)=><ErpButton key={i} label={n(i+1)+' ـ '+s.title} onClick={()=>restart(i)} variant="outline"/>)}</div></ErpCard>}
  <footer><ErpButton label={index===null?'شروع دوباره مثال':'بازگشت به مثال سادهٔ اول'} onClick={()=>restart(null)} variant="ghost"/><p>برای بررسی، کافی است بگویید در کدام مرحله رفتار سیستم با کار واقعی شما فرق دارد.</p></footer>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
