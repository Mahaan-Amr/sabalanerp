import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {PrismaClient} from '../../backend/node_modules/@prisma/client';
import {createAuthoritativeSession,SESSION_COOKIE} from '../../backend/src/services/identitySessionService';
import {assertNoHorizontalOverflow,assertNoSeriousAxeViolations,setTheme} from './support/design-system';
const db=new PrismaClient({datasources:{db:{url:'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10'}}});
let actorId='',token='',inquiryId='',orderId='';
const supplierIds:string[]=[];
test.beforeAll(async()=>{
  const key=randomUUID();
  const actor=await db.user.create({data:{username:`qa-purchase-read-${key}`,email:`${key}@example.invalid`,password:'unused',role:'ADMIN',firstName:'آزمون',lastName:'خواندن اسناد خرید'}});actorId=actor.id;
  token=(await createAuthoritativeSession(db,actorId,{userAgent:'Purchasing document read QA'})).token;
  for(const name of ['کارخانه نمونه الف','کارخانه نمونه ب']){
    const supplier=await db.purchasingSupplier.create({data:{name,identityKey:`QA:${key}:${name}`,contact:'QA only',createdBy:actorId}});supplierIds.push(supplier.id);
  }
  // Read-only UI fixtures contain no events, commitments, custody or ledger effects.
  // Actual business commands are covered separately by the rollback integration suite.
  const inquiry=await db.purchasingDocument.create({data:{kind:'INQUIRY',ownerId:actorId,creatorId:actorId,data:{reason:'stock',stone:'گرانیت نمونه آزمون رابط',unit:'مترمربع',quantity:'40',specKey:`QA:${key}`,technical:{},offers:supplierIds.map((supplierId,index)=>({id:randomUUID(),supplierId,supplierName:index?'کارخانه نمونه ب':'کارخانه نمونه الف',price:index?'600000':'500000',quantity:'40',capacity:'estimate',status:'VALID',variant:'پیشنهاد نمونه',freight:'1000000',terms:'طبق توافق نمونه',readyDate:null,arrivalDate:null,arrivalLeadDays:index?'5':'7',leadBasis:'ORDER_CONFIRMATION',dayKind:'calendar',validUntil:null})),selection:[],notes:'QA read-only fixture'}}});inquiryId=inquiry.id;
  const order=await db.purchasingDocument.create({data:{kind:'ORDER',ownerId:actorId,creatorId:actorId,data:{stone:'گرانیت نمونه آزمون چاپ',quantity:'75.125',unit:'مترمربع',price:'3500000',supplierId:supplierIds[0],supplierName:'کارخانه نمونه الف',route:'warehouse',technical:{length:'2.5',lengthUnit:'m',width:'40',widthUnit:'cm',thicknessValue:'2'},notes:'این سند فقط نمونه آزمون است و تعهد تجاری ایجاد نمی‌کند.',allocations:[],costs:[]}}});orderId=order.id;
});
test.afterAll(async()=>{try{
  await db.purchasingDocument.deleteMany({where:{id:{in:[inquiryId,orderId].filter(Boolean)},creatorId:actorId}});
  await db.purchasingSupplier.deleteMany({where:{id:{in:supplierIds},createdBy:actorId}});
  if(actorId){await db.authSession.deleteMany({where:{userId:actorId}});await db.recognizedBrowserProfile.deleteMany({where:{userId:actorId}});await db.user.delete({where:{id:actorId}});}
}finally{await db.$disconnect();}});
test('supplier comparison, compact proposal entry and branded PDF use real local read paths',async({page},info)=>{
  await page.context().addCookies([{name:SESSION_COOKIE,value:token,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  await page.goto(`/dashboard/purchasing/inquiries?document=${inquiryId}`);
  await expect(page.getByRole('heading',{name:'گرانیت نمونه آزمون رابط',exact:true})).toBeVisible();
  await expect(page.getByText('کمترین نرخ واحد',{exact:true}).filter({visible:true})).toBeVisible();
  for(const theme of ['light','dark'] as const){await setTheme(page,theme);await page.screenshot({path:info.outputPath(`comparison-${theme}.png`),fullPage:true});}
  await page.getByRole('button',{name:'ثبت پیشنهاد تأمین‌کننده',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'پیشنهاد تأمین‌کننده',exact:true});await expect(modal).toBeVisible();
  expect((await modal.boundingBox())!.width).toBeLessThan(800);
  await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);await assertNoSeriousAxeViolations(page);
  await page.screenshot({path:info.outputPath('proposal-mobile.png')});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/dashboard/purchasing/orders');
  const row=page.getByRole('row').filter({hasText:'\u06af\u0631\u0627\u0646\u06cc\u062a \u0646\u0645\u0648\u0646\u0647 \u0622\u0632\u0645\u0648\u0646 \u0686\u0627\u067e'});
  await row.getByRole('button',{name:'\u0633\u0627\u06cc\u0631 \u0639\u0645\u0644\u06cc\u0627\u062a',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByText('PDF \u0633\u0641\u0627\u0631\u0634 \u062e\u0631\u06cc\u062f',{exact:true}).filter({visible:true}).click();
  const saved=await download;await saved.saveAs(info.outputPath('purchase-order-route.pdf'));
  const bytes=await fs.readFile(info.outputPath('purchase-order-route.pdf'));expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
});
