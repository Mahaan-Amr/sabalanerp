import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '../../backend/node_modules/@prisma/client';
import {createAuthoritativeSession,SESSION_COOKIE} from '../../backend/src/services/identitySessionService';
import {assertNoHorizontalOverflow,assertNoSeriousAxeViolations,setTheme,setViewportAndZoom} from './support/design-system';
const db=new PrismaClient({datasources:{db:{url:'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10'}}});
let actorId:string,token:string,contractId:string,contractNumber:string,rows:{index:number;itemId:string;rowId:string;quantity:string}[]=[];
test.beforeAll(async()=>{
  const c=await db.salesContract.findUniqueOrThrow({where:{contractNumber:'100312'},select:{id:true,contractNumber:true,contractData:true,items:{where:{retiredAt:null},select:{id:true,productRowId:true,productId:true}}}});
  contractId=c.id;contractNumber=c.contractNumber;
  const products=((c.contractData as any)?.products || []) as any[];
  rows=products.map((r,index)=>{const item=c.items.find(i=>i.productRowId===r.rowId);return item?{index,itemId:item.id,rowId:r.rowId,quantity:String(r.squareMeters ?? r.preparedQuantity ?? r.quantity)}:null;}).filter((r):r is NonNullable<typeof r>=>Boolean(r)).slice(0,2);
  expect(rows.length).toBe(2);
  const key=randomUUID();const actor=await db.user.create({data:{username:`qa-purchase-entry-${key}`,email:`${key}@example.invalid`,password:'unused',role:'ADMIN',firstName:'آزمون',lastName:'ورود خرید از فروش'}});actorId=actor.id;
  token=(await createAuthoritativeSession(db,actorId,{userAgent:'Purchasing Sales contract entry local QA'})).token;
});
test.afterAll(async()=>{try{if(actorId){await db.authSession.deleteMany({where:{userId:actorId}});await db.recognizedBrowserProfile.deleteMany({where:{userId:actorId}});await db.user.delete({where:{id:actorId}});}}finally{await db.$disconnect();}});
test('each Sales product opens its own authoritative purchasing source with a compact canonical dialog',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:SESSION_COOKIE,value:token,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}]);
  await page.goto(`/dashboard/sales/contracts/${contractId}`);
  await page.getByRole('button',{name:'اقلام و تحویل',exact:true}).click();
  const actions=page.getByRole('button',{name:'درخواست خرید',exact:true});
  await expect(actions.nth(rows[1].index)).toBeVisible();
  for(const row of rows){
    const response=page.waitForResponse(r=>r.url().includes('/api/purchasing/contract-entry') && r.status()===200);
    await actions.nth(row.index).click();
    const entry=(await (await response).json()).data; const source=entry.source;
    expect(source.contractId).toBe(contractId);expect(source.itemId).toBe(row.itemId);expect(source.sourceRowId).toBe(row.rowId);expect(source.quantity).toBe(row.quantity);
    const modal=page.getByRole('dialog',{name:'درخواست خرید این محصول',exact:true});
    await expect(modal.getByText(`قرارداد ${contractNumber}`,{exact:true})).toBeVisible();
    await expect(modal.getByLabel(/مقدار موردنیاز/)).toBeVisible();await expect(modal.getByLabel(/مقدار موردنیاز/)).not.toHaveValue('0');
    if(entry.remaining!=='0' && !entry.documents.some((d:any)=>d.kind==='INQUIRY')) await expect(modal.getByRole('button',{name:'ثبت استعلام برای این ردیف',exact:true})).toBeVisible();
    if(!entry.documents.some((d:any)=>d.kind==='INQUIRY' && d.data.selection?.length)) await expect(modal.getByRole('button',{name:'ثبت درخواست با پیشنهادهای منتخب',exact:true})).toHaveCount(0);
    await expect.poll(async()=>{const box=await modal.boundingBox();return box?Math.abs(box.x+box.width/2-page.viewportSize()!.width/2):999;}).toBeLessThan(2);
    expect((await modal.boundingBox())!.width).toBeLessThan(800);
    for(const theme of ['light','dark'] as const){await setTheme(page,theme);await page.screenshot({path:info.outputPath(`row-${row.index}-${theme}.png`)});}
    await page.keyboard.press('Escape');await expect(modal).not.toBeVisible();
  }
  await actions.nth(rows[0].index).click();
  const modal=page.getByRole('dialog',{name:'درخواست خرید این محصول',exact:true});await expect(modal.getByLabel(/مقدار موردنیاز/)).toBeVisible();
  await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);await assertNoSeriousAxeViolations(page);
  await page.screenshot({path:info.outputPath('entry-mobile.png')});
  await setViewportAndZoom(page,{width:1440,height:1000},2);await assertNoHorizontalOverflow(page);
  await page.screenshot({path:info.outputPath('entry-zoom.png')});
  await page.keyboard.press('Escape');await expect(modal).not.toBeVisible();
  expect(errors).toEqual([]);
  // Real contract reads only: no inquiry/request is submitted against the business contract.
  await page.context().close();
});
