import {test,expect,type Locator,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {PrismaClient} from '../../backend/node_modules/@prisma/client';
import {createAuthoritativeSession,SESSION_COOKIE} from '../../backend/src/services/identitySessionService';

// Real local commands create immutable evidence. Keep clearly named, isolated QA
// records; never delete journals or real business data to make a browser test tidy.
const db=new PrismaClient({datasources:{db:{url:'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10'}}});
const runId=randomUUID(),stone='سنگ آزمایش گردش خرید';
let actorId='',token='';
const suppliers:{id:string;name:string}[]=[],created:Record<string,string[]>={};
test.beforeAll(async()=>{
  const actor=await db.user.create({data:{username:`qa-purchase-flow-${runId}`,email:`${runId}@example.invalid`,password:'unused',role:'ADMIN',firstName:'آزمایش',lastName:`چرخه خرید ${runId}`}});actorId=actor.id;
  token=(await createAuthoritativeSession(db,actorId,{userAgent:'Purchasing full lifecycle local QA'})).token;
  for(const name of ['کارخانه آزمایشی الف','کارخانه آزمایشی ب'])suppliers.push(await db.purchasingSupplier.create({data:{name:`${name}، آزمون ${new Date().toLocaleTimeString('fa-IR')}`,identityKey:`QA-FLOW:${runId}:${name}`,contact:'آزمون محلی؛ بدون تماس واقعی',createdBy:actorId},select:{id:true,name:true}}));
});
test.afterAll(async()=>{try{
  if(actorId){
    await db.authSession.deleteMany({where:{userId:actorId}});
    if(await db.purchasingDocument.count({where:{creatorId:actorId}})){
      await db.user.update({where:{id:actorId},data:{isActive:false}});
      await db.purchasingSupplier.updateMany({where:{id:{in:suppliers.map(s=>s.id)}},data:{isActive:false}});
    }else{
      await db.purchasingSupplier.deleteMany({where:{id:{in:suppliers.map(s=>s.id)},createdBy:actorId}});
      await db.recognizedBrowserProfile.deleteMany({where:{userId:actorId}});await db.user.delete({where:{id:actorId}});
    }
  }
}finally{await db.$disconnect();}});

async function choose(page:Page,field:Locator,name:string|RegExp){await field.click();await page.getByRole('option',{name,exact:typeof name==='string'}).click();}
async function command(page:Page,type:string,action:()=>Promise<unknown>){
  const result=page.waitForResponse(r=>r.url().split('?')[0].endsWith('/purchasing/commands')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type===type);
  await action();const response=await result,body=await response.json();expect(response.status(),JSON.stringify(body)).toBe(200);expect(body.success).toBe(true);
  const doc=body.data;console.log('Purchasing lifecycle:',type,doc.number);created[type]||=[];created[type].push(doc.id);return doc as {id:string;number:string;kind:string};
}
async function document(id:string){return db.purchasingDocument.findUniqueOrThrow({where:{id}});}
async function receipt(page:Page,amount:string,quality:'pending'|'all'|'partial',accepted?:string){
  const modal=page.getByRole('dialog',{name:/^(دریافت بار|دریافت بار جایگزین)$/});await expect(modal).toBeVisible();
  await modal.getByLabel(/مقدار بار رسیده/).fill(amount);
  await choose(page,modal.getByRole('combobox',{name:'نتیجه بررسی کیفیت',exact:true}),quality==='all'?'تمام مقدار رسیده پذیرفته است':quality==='partial'?'فقط بخشی از بار پذیرفته است':'هنوز بررسی نشده؛ فقط دریافت ثبت شود');
  if(accepted)await modal.getByRole('textbox',{name:'مقدار پذیرفته‌شده',exact:true}).fill(accepted);
  return command(page,'RECEIPT',()=>modal.getByRole('button',{name:/^ثبت دریافت بار/}).click());
}
test('real RFQ to 40/15/25 rejection, physical return, partial replacement and late defect',async({page},info)=>{
  test.setTimeout(240000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:SESSION_COOKIE,value:token,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  await page.goto('/dashboard/purchasing');await page.getByRole('button',{name:'استعلام جدید',exact:true}).click();
  await choose(page,page.getByRole('combobox',{name:'خرید برای',exact:true}),'نیاز انبار');
  await page.getByLabel('عنوان نیاز انبار',{exact:true}).fill(stone);
  await page.getByRole('button',{name:'افزودن قلم',exact:true}).click();
  await page.screenshot({path:info.outputPath('stock-line-start.png'),fullPage:true});
  await expect(page.getByRole('textbox',{name:'سنگ و مشخصات اولیه',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'سنگ و مشخصات اولیه',exact:true}).fill(stone);
  await page.getByLabel(/مقدار موردنیاز.*اختیاری/).fill('40');
  const inquiryCase=await command(page,'INQUIRY_START',()=>page.getByRole('button',{name:/^ادامه به قیمت‌ها/}).click());
  await page.getByRole('button',{name:'ادامه',exact:true}).click();
  const caseRecord=await document(inquiryCase.id),inquiryId=(caseRecord.data as any).lineIds[0];
  for(const [index,supplier] of suppliers.entries()){
    await page.getByRole('button',{name:'ثبت پیشنهاد تأمین‌کننده',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'پیشنهاد تأمین‌کننده',exact:true});
    await choose(page,modal.getByRole('combobox',{name:'تأمین‌کننده',exact:true}),new RegExp(supplier.name));
    await modal.getByLabel('نرخ هر مترمربع (تومان)',{exact:true}).fill(index?'600000':'500000');
    await modal.getByLabel('مقدار قابل تأمین',{exact:true}).fill('40');
    await modal.getByRole('button',{name:/^حمل، موعد و شرایط پرداخت/}).click();
    await choose(page,modal.getByRole('combobox',{name:'نوع پیشنهاد پرداخت',exact:true}),index?'چکی':'نقدی');
    await command(page,'INQUIRY_OFFER',()=>modal.getByRole('button',{name:'ثبت پیشنهاد',exact:true}).click());
    await expect(modal).not.toBeVisible();
    expect(((await document(inquiryId)).data as any).offers.at(-1).variant).toBe(index?'چکی':'نقدی');
    expect(((await document(inquiryId)).data as any).offers.at(-1).capacity).toBe('estimate');
    await page.screenshot({path:info.outputPath(`after-offer-${index}.png`),fullPage:true});
    await expect(page.getByRole('heading',{name:stone,exact:true})).toBeVisible();
  }
  const offerRow=page.getByRole('row').filter({hasText:suppliers[0].name});
  await expect(offerRow.getByText('کمترین نرخ واحد',{exact:true})).toBeVisible();
  await offerRow.getByRole('checkbox').check();
  const request=await command(page,'INQUIRY_CONTINUE',()=>page.getByRole('button',{name:'ادامه به سفارش',exact:true}).click());
  expect((await document(request.id)).kind).toBe('REQUEST');
  const orderModal=page.getByRole('dialog',{name:'سفارش خرید',exact:true});await expect(orderModal.getByRole('textbox',{name:'مقدار خرید',exact:true})).toHaveValue('40');
  const order=await command(page,'ORDER',()=>orderModal.getByRole('button',{name:'ثبت سفارش خرید',exact:true}).click());
  await page.getByRole('button',{name:'ادامه: دریافت بار',exact:true}).click();
  const original=await receipt(page,'40','partial','15');
  expect((await document(original.id)).data).toMatchObject({quantity:'40',accepted:'15',rejected:'0',returned:'0'});
  await page.getByRole('button',{name:'ادامه: بررسی کیفیت',exact:true}).click();
  await choose(page,page.getByRole('dialog').getByRole('combobox',{name:'نتیجه بررسی',exact:true}),'رد قطعی کیفیت');
  const rejection=page.getByRole('dialog',{name:'رد قطعی کیفیت',exact:true});
  await choose(page,rejection.getByRole('combobox',{name:'علت',exact:true}),'کیفیت یا سورت نامناسب');
  await command(page,'REJECT',()=>rejection.getByRole('button',{name:'ثبت رد قطعی کیفیت',exact:true}).click());
  expect((await document(original.id)).data).toMatchObject({accepted:'15',rejected:'25',returned:'0'});
  await page.getByRole('button',{name:'ادامه: برگشت بار',exact:true}).click();
  const returning=page.getByRole('dialog',{name:'برگشت واقعی بار',exact:true});
  await returning.getByRole('checkbox',{name:'این مقدار واقعاً به تأمین‌کننده برگشت داده شده است.',exact:true}).check();
  await command(page,'RETURN',()=>returning.getByRole('button',{name:'ثبت برگشت واقعی بار',exact:true}).click());
  expect((await document(original.id)).data).toMatchObject({accepted:'15',rejected:'25',returned:'25'});
  await page.getByRole('button',{name:'ادامه: تعویض بار',exact:true}).click();
  const exchangeModal=page.getByRole('dialog',{name:'تعویض با تأمین‌کننده',exact:true});
  const exchange=await command(page,'EXCHANGE',()=>exchangeModal.getByRole('button',{name:'ثبت تعویض با تأمین‌کننده',exact:true}).click());
  expect((await document(exchange.id)).data).toMatchObject({quantity:'25',orderId:order.id});
  await page.getByRole('button',{name:'ادامه: دریافت جایگزین',exact:true}).click();
  const replacementA=await receipt(page,'10','all');
  await page.getByRole('button',{name:'ادامه: دریافت باقی جایگزین',exact:true}).click();
  const replacementB=await receipt(page,'15','pending');
  expect((await document(replacementB.id)).data).toMatchObject({accepted:'0',quantity:'15'});
  await page.getByRole('button',{name:'ادامه: بررسی کیفیت',exact:true}).click();
  const quality=page.getByRole('dialog',{name:'پذیرش کیفیت',exact:true});
  await command(page,'ACCEPT',()=>quality.getByRole('button',{name:'ثبت پذیرش کیفیت',exact:true}).click());
  expect((await document(replacementB.id)).data).toMatchObject({accepted:'15',quantity:'15'});

  // A later defect preserves original acceptance and reopens its exact share.
  await page.goto('/dashboard/purchasing/receipts');
  const originalRow=page.getByRole('row').filter({hasText:original.number});
  await originalRow.getByRole('button',{name:'سایر عملیات',exact:true}).click();
  await page.getByText('برگشت پس از پذیرش',{exact:true}).filter({visible:true}).click();
  const late=page.getByRole('dialog',{name:'برگشت پس از پذیرش',exact:true});
  await expect(late.getByLabel(/مقدار برگشت پس از پذیرش/)).toHaveValue('15');
  await late.getByLabel(/مقدار برگشت پس از پذیرش/).fill('5');
  await choose(page,late.getByRole('combobox',{name:'علت',exact:true}),'شکستگی یا آسیب');
  await late.getByRole('checkbox',{name:'این مقدار واقعاً به تأمین‌کننده برگشت داده شده است.',exact:true}).check();
  await command(page,'RETURN_ACCEPTED',()=>late.getByRole('button',{name:'ثبت برگشت پس از پذیرش',exact:true}).click());
  expect((await document(original.id)).data).toMatchObject({accepted:'15',acceptedReturned:'5',rejected:'30',returned:'30'});
  await page.getByRole('button',{name:'ادامه: تعویض بار',exact:true}).click();
  const lateExchange=page.getByRole('dialog',{name:'تعویض با تأمین‌کننده',exact:true});
  await command(page,'EXCHANGE',()=>lateExchange.getByRole('button',{name:'ثبت تعویض با تأمین‌کننده',exact:true}).click());
  await page.getByRole('button',{name:'ادامه: دریافت جایگزین',exact:true}).click();
  const replacementC=await receipt(page,'5','all');

  const receipts=await db.purchasingDocument.findMany({where:{parentId:order.id,kind:'RECEIPT'}});
  expect(receipts).toHaveLength(4);
  expect(receipts.reduce((n,r)=>n+Number((r.data as any).accepted)-Number((r.data as any).acceptedReturned||0),0)).toBe(40);
  expect(await db.purchasingDocument.count({where:{creatorId:actorId,kind:'ORDER'}})).toBe(1);
  expect((await document(order.id)).data).toMatchObject({quantity:'40'});
  const identities=receipts.map(r=>`purchase-receipt:${r.id}`);
  const custody=await db.accountingInventoryEvent.findMany({where:{identityId:{in:identities}}});
  expect(custody.reduce((n,e)=>n+(e.eventType==='RETURN'?-1:1)*Number(e.quantity),0)).toBe(40);
  expect(await db.accountingInventoryValuationLayer.count({where:{identityId:{in:identities}}})).toBe(0);
  expect(await db.purchasingDocument.count({where:{creatorId:actorId,kind:'ACCOUNTING_HANDOFF'}})).toBe(0);
  expect(await db.purchasingEvent.count({where:{documentId:original.id,action:'RETURN_ACCEPTED'}})).toBe(1);
  await page.screenshot({path:info.outputPath('lifecycle-complete.png'),fullPage:true});
  await fs.writeFile(info.outputPath('lifecycle-evidence.json'),JSON.stringify({runId,actorId,stone,inquiryCaseId:inquiryCase.id,inquiryId,requestId:request.id,orderId:order.id,originalReceiptId:original.id,receiptIds:[original.id,replacementA.id,replacementB.id,replacementC.id],commands:created,netAccepted:'40',netCustody:'40',orderQuantity:'40',valuationLayers:0,financialPosting:false},null,2));
  expect(errors).toEqual([]);
});

test('independent catalog inquiry retains prices and a later need explicitly reuses a confirmed general quote',async({page},info)=>{
  test.setTimeout(180000);
  const sku=await db.product.findFirstOrThrow({where:{isActive:true,deletedAt:null},orderBy:{code:'asc'}});
  await page.context().addCookies([{name:SESSION_COOKIE,value:token,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  await page.goto('/dashboard/purchasing');await page.getByRole('button',{name:'استعلام جدید',exact:true}).click();
  await choose(page,page.getByRole('combobox',{name:'نوع کار',exact:true}),'استعلام مستقل قیمت');
  const catalog=page.getByRole('region',{name:'کاتالوگ محصولات'});
  await catalog.getByRole('searchbox',{name:'جستجوی محصول',exact:true}).fill(sku.code);
  const choice=catalog.getByRole('option').filter({hasText:sku.namePersian||sku.name}).first();
  await expect(choice).toBeVisible();await choice.click();
  const independent=await command(page,'INQUIRY_START',()=>page.getByRole('button',{name:/^ثبت استعلام مستقل/}).click());
  const marketCase=await document(independent.id),marketId=(marketCase.data as any).lineIds[0];
  await page.getByRole('button',{name:'ادامه',exact:true}).click();
  await page.getByRole('button',{name:'ثبت پیشنهاد تأمین‌کننده',exact:true}).click();
  const offer=page.getByRole('dialog',{name:'پیشنهاد تأمین‌کننده',exact:true});
  await choose(page,offer.getByRole('combobox',{name:'تأمین‌کننده',exact:true}),new RegExp(suppliers[0].name));
  await offer.getByRole('textbox',{name:/^نرخ هر .*تومان/}).fill('723456');
  await command(page,'INQUIRY_OFFER',()=>offer.getByRole('button',{name:'ثبت پیشنهاد',exact:true}).click());
  await expect(offer).not.toBeVisible();
  await expect(page.getByRole('button',{name:'ادامه به سفارش',exact:true})).toHaveCount(0);
  expect(await db.purchasingDocument.count({where:{parentId:marketId,kind:'REQUEST'}})).toBe(0);
  await page.screenshot({path:info.outputPath('independent-prices.png'),fullPage:true});
  await page.goto('/dashboard/purchasing');await page.getByRole('button',{name:'استعلام جدید',exact:true}).click();
  await choose(page,page.getByRole('combobox',{name:'خرید برای',exact:true}),'نیاز انبار');
  await page.getByLabel('عنوان نیاز انبار',{exact:true}).fill(`نیاز واقعی پس از استعلام ${runId}`);
  await catalog.getByRole('searchbox',{name:'جستجوی محصول',exact:true}).fill(sku.code);
  await expect(choice).toContainText('۷۲۳,۴۵۶');await choice.click();
  await page.getByLabel(/مقدار موردنیاز.*اختیاری/).fill('4');
  await choose(page,page.getByRole('combobox',{name:'دامنه قیمت قلم 1',exact:true}),'برای ابعاد یا فرآوری مشخص');
  await page.getByRole('button',{name:/^مشخصات تکمیلی و استعلام قبلی/}).click();
  await page.getByRole('textbox',{name:'ابعاد و ضخامت',exact:true}).fill('ابعاد مشخص مورد تأیید کارخانه');
  const need=await command(page,'INQUIRY_START',()=>page.getByRole('button',{name:/^ادامه به قیمت‌ها/}).click());
  await page.getByRole('button',{name:'ادامه',exact:true}).click();
  const prior=page.getByRole('row').filter({hasText:suppliers[0].name}).filter({hasText:'۷۲۳,۴۵۶'});
  await prior.getByRole('checkbox').check();
  await expect(page.getByRole('button',{name:'ادامه به سفارش',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'حمل و موعد پیشنهاد قبلی را برای مقصد و مقدار این نیاز بررسی کرده‌ام.',exact:true}).check();
  await page.getByRole('checkbox',{name:'تأمین‌کننده اجرای همین قیمت و شرایط را برای مشخصات این نیاز تأیید کرده است.',exact:true}).check();
  await page.getByRole('textbox',{name:'شرح تأیید تأمین‌کننده',exact:true}).fill('تأیید اجرای قیمت برای ابعاد همین نیاز؛ آزمایش محلی');
  const request=await command(page,'INQUIRY_CONTINUE',()=>page.getByRole('button',{name:'ادامه به سفارش',exact:true}).click());
  await expect(page.getByRole('dialog',{name:'سفارش خرید',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/ابعاد مشخص مورد تأیید کارخانه/)).toBeVisible();
  const saved=(await document(request.id)).data as any;
  expect(saved.inquirySelection[0].inquiryId).toBe(marketId);
  expect(saved.inquirySelection[0].specReview.confirmation).toContain('همین نیاز');
  expect(await db.purchasingLink.count({where:{targetId:request.id,purpose:'ALLOCATION'}})).toBe(0);
  await page.screenshot({path:info.outputPath('catalog-to-order-review.png'),fullPage:true});
  await fs.writeFile(info.outputPath('catalog-evidence.json'),JSON.stringify({marketCaseId:independent.id,marketId,needCaseId:need.id,requestId:request.id,productId:sku.id,orderAutomaticallyCreated:false},null,2));
});
