import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {readOriginalRemoteBrowserConnection} from '../../deploy/scripts/original-remote-browser-capability.mjs';
import {verifyInstalledPrivateLegacyChromeEnvelope} from './installed-private-chrome-evidence.fixture.mjs';

/** Actual original production Next UI, not the later instrumented5b fixture.
 * The caller owns SAME edge/store/native HTTP actors and SQL/restore checks.
 * No mock auth, no old backend, no request rekey/header insertion/replay. */
export async function qualifyNativeLegacySupportForm({browserConnection,seed,legacy,publishNew,readApiIntent}){
 const original=readOriginalRemoteBrowserConnection(browserConnection);
 return qualifyOriginalLegacySupportForm({original,seed,legacy,publishNew,readApiIntent});
}
export async function qualifyInstalledLegacySupportForm({chromeEnvelope,seed,legacy,publishNew,readApiIntent},expected){
 const original=verifyInstalledPrivateLegacyChromeEnvelope(chromeEnvelope,expected);
 return qualifyOriginalLegacySupportForm({original,seed,legacy,publishNew,readApiIntent});
}
async function qualifyOriginalLegacySupportForm({original,seed,legacy,publishNew,readApiIntent}){
 assert.equal(original.browserOrigin,'http://localhost:3199');
 assert.equal(legacy.nativeBuildId,'B3FQSLBH439Vaf6knWbsb');assert.equal(legacy.handoffPolicy,'MANUAL_SAVE_REQUIRED');
 assert.equal(legacy.id,'erp_legacy_'+createHash('sha256').update(legacy.nativeBuildId).digest('hex'));
 assert.equal(legacy.image,'sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004');
 assert.equal(typeof publishNew,'function');assert.equal(typeof readApiIntent,'function');
 const browser=await puppeteer.connect({browserWSEndpoint:original.browserWSEndpoint});let page,error,result;const interceptionTasks=new Set(),interceptionFailures=[];
 try{
  page=await browser.newPage();await page.setBypassServiceWorker(true);await page.setRequestInterception(true);
  // QA-only deny egress before any page code executes; no fake response,
  // version identity insertion or mutation retry is provided by these guards.
  await page.evaluateOnNewDocument(origin=>{
   const Native=window.WebSocket;
   window.WebSocket=class extends Native{constructor(url,protocols){const value=new URL(url,location.href);if(value.origin.replace(/^ws/,'http')!==origin)throw Error('LEGACY_EXTERNAL_SOCKET_DENIED');if(protocols===undefined)super(url);else super(url,protocols);}};
  },original.browserOrigin);
  await page.setCookie({name:'sabalan_session',value:seed.sessionToken,url:original.browserOrigin,httpOnly:true,sameSite:'Lax'});
  const pageErrors=[],external=[];let mainNavigations=0,createRequests=0;
  page.on('pageerror',failure=>pageErrors.push(failure.message));page.on('framenavigated',frame=>{if(frame===page.mainFrame())mainNavigations++;});
  page.on('request',request=>{const task=(async()=>{const url=new URL(request.url());if(url.origin===original.browserOrigin&&url.pathname==='/api/support-tickets'&&request.method()==='POST')createRequests++;if(['http:','https:','ws:','wss:'].includes(url.protocol)&&url.origin.replace(/^ws/,'http')!==original.browserOrigin){external.push({origin:url.origin,path:url.pathname});await request.abort('blockedbyclient');}else await request.continue();})();interceptionTasks.add(task);void task.then(()=>interceptionTasks.delete(task),failure=>{interceptionFailures.push(failure);interceptionTasks.delete(task);});});
  const context=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/support-tickets/context'&&response.request().method()==='GET',{timeout:30000});void context.catch(()=>{});
  const document=await page.goto(original.browserOrigin+'/dashboard/support/new',{waitUntil:'domcontentloaded',timeout:60000});assert.equal(document.status(),200);
  const contextResponse=await context;assert.equal(contextResponse.status(),200);const contextBody=await contextResponse.json();assert.equal(contextBody.success,true);assert.ok(Array.isArray(contextBody.data?.workspaces)&&Array.isArray(contextBody.data?.features));
  const input='form input[maxlength="180"]',description='form textarea[maxlength="10000"]';
  await page.waitForSelector(input,{visible:true,timeout:8000});const nonce=randomBytes(16).toString('hex'),title='فرم باز نسخهٔ اصلی '+nonce,text='متن فارسی پیش از تعویض نسخه؛ باید با اقدام خود کاربر ثبت شود. '+nonce;
  await page.type(input,title);await page.type(description,text);const before=mainNavigations;
  const publication=await publishNew();assert.ok(publication&&publication.registry&&publication.registry.current.erp!==legacy.id);
  assert.equal(await page.$eval(input,node=>node.value),title);assert.equal(await page.$eval(description,node=>node.value),text);assert.equal(mainNavigations,before,'LEGACY_FORM_AUTOMATICALLY_NAVIGATED');
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/support-tickets'&&response.request().method()==='POST',{timeout:30000});void responsePromise.catch(()=>{});
  await page.evaluate(()=>{const button=[...document.querySelectorAll('form button')].find(node=>node.type==='submit');if(!button||button.disabled)throw Error('LEGACY_REAL_SUBMIT_UNAVAILABLE');button.click();});
  const response=await responsePromise,request=response.request(),headers=request.headers();assert.equal(headers['x-deployment-id'],undefined);assert.equal(new URL(request.url()).searchParams.get('__sabalan_build'),null);
  assert.equal(response.status(),201);const responseRaw=Buffer.from(await response.buffer()),body=JSON.parse(responseRaw.toString());assert.equal(body.success,true);assert.equal(body.data.title,title);
  const operationId=response.headers()['x-sabalan-proxy-operation-id'];assert.match(operationId,/^[a-f0-9]{32}$/);
  const intent=await readApiIntent(operationId);assert.equal(intent.method,'POST');assert.equal(intent.buildId,legacy.id);assert.equal(intent.slotId,publication.registry.apiBindings.find(binding=>binding.buildId===legacy.id)?.slotId);
  await Promise.all([...interceptionTasks]);assert.equal(createRequests,1);assert.deepEqual(interceptionFailures,[]);assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);
  result={format:'sabalan-original-production-legacy-form/v1',nativeBuildId:legacy.nativeBuildId,buildId:legacy.id,image:legacy.image,ticket:{id:body.data.id,title,description:text},operationId,apiIntent:intent,responseRawBase64:responseRaw.toString('base64'),responseSha256:createHash('sha256').update(responseRaw).digest('hex'),responseStatus:201,automaticNavigation:false,explicitSingleSubmission:true,qaExternalEgressDenied:true,legacyBackendStarted:false,realElapsed24HoursQualified:false,productionAdmission:false};
 }catch(failure){error=failure;}
 finally{if(page)try{await page.close();}catch(failure){error??=failure;}await Promise.allSettled([...interceptionTasks]);browser.disconnect();}
 if(error)throw error;return result;
}


/** Reuse the actual source/restored actor's injected sole Prisma client. No
 * client construction, pool ownership changes, or regeneration is permitted. */
export async function verifyNativeLegacySupportTicket({db,qualification,reporterId}){
 assert.equal(qualification.format,'sabalan-original-production-legacy-form/v1');
 const expected=qualification.ticket;
 const ticket=await db.supportTicket.findUniqueOrThrow({where:{id:expected.id},include:{entries:true,attachments:true,auditEvents:true}});
 assert.equal(ticket.reporterId,reporterId);assert.equal(ticket.title,expected.title);assert.equal(ticket.attachments.length,0);
 const reports=ticket.entries.filter(entry=>entry.kind==='REPORT');assert.equal(reports.length,1);assert.equal(reports[0].authorId,reporterId);assert.equal(reports[0].body,expected.description);
 const created=ticket.auditEvents.filter(event=>event.action==='CREATED');assert.equal(created.length,1);assert.equal(created[0].actorId,reporterId);
 assert.equal(await db.supportTicket.count({where:{reporterId,title:expected.title}}),1);
 return{ticketId:ticket.id,originalPersianText:true,reportEntries:1,creationAudits:1,duplicateTickets:0,clientConstructed:false};
}
