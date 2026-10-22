import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import puppeteer from 'puppeteer';
import {observeNativeNavigation,prepareNativeBrowserForm,persistNativeBrowserFailure,waitForNativeSubmitEnabled} from './application-native-browser-readiness.fixture.mjs';
import WebSocket from 'ws';
import {assertNativePrivateInterface} from './native-private-network.fixture.mjs';
import {readOriginalRemoteBrowserConnection} from '../../deploy/scripts/original-remote-browser-capability.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const until=async check=>{const deadline=Date.now()+30000;while(!await check()){
  assert.ok(Date.now()<deadline,'ACTUAL_BROWSER_OBSERVATION_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,20));}};
async function privateRead(file) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=4096n);
    assert.equal(before.uid,BigInt(process.getuid()));assert.equal(before.mode&0o077n,0n);
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true}),named=await fs.lstat(file,{bigint:true});
    const identity=value=>[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.mode,value.uid,value.nlink].map(String).join(':');
    assert.equal(identity(before),identity(after));assert.equal(identity(before),identity(named));assert.equal(bytes.length,Number(before.size));
    return {value:JSON.parse(bytes),sha256:sha(bytes)};
  } finally {await handle.close();}
}

/** The existing original routing controller owns the listener, actual FD20,
 * SAME store, all native A/B scope proofs and every publication. This helper
 * operates real immutable Next pages; it never creates a registry, fake auth
 * endpoint, renderer port, replacement controller or application DB client.
 *
 * journalDirectories are the controller's actual three provisioned journals;
 * publishGeneration('next'|'rollback') invokes that same owned store.publish.
 * whileBrowsersIdle, if supplied, must signal the original parent and await
 * its actual capture; a mere callback return is not capture qualification. */
export async function runNativeBrowserAcceptance({edge,root,seed,actors,uiArtifacts,journalDirectories,
  publishGeneration,whileBrowsersIdle,readSocketPending,browserConnection}) {
  assert.equal(process.platform,'linux');assert.equal(await fs.realpath(root),root);
  const rootStat=await fs.lstat(root);assert.equal(rootStat.uid,process.getuid());assert.equal(rootStat.mode&0o077,0);
  assert.equal(actors.length,2);assert.notEqual(actors[0].runtimeId,actors[1].runtimeId);
  const address=edge.server.address();assert.ok(address&&typeof address!=='string');assertNativePrivateInterface(address.address);
  const originalBrowser=readOriginalRemoteBrowserConnection(browserConnection);
  assert.equal(originalBrowser.browserOrigin,'http://localhost:3199');
  assert.notEqual(originalBrowser.host,address.address,'actual Chrome must belong to the separate candidate container');
  assert.equal(originalBrowser.ingress.host,'127.0.0.1');assert.equal(originalBrowser.ingress.port,3199);
  assert.equal(originalBrowser.ingress.targetHost,address.address);assert.equal(originalBrowser.ingress.targetPort,address.port);
  const origin=originalBrowser.browserOrigin,operation=randomBytes(16).toString('hex');
  const directory=path.join(root,'browser-'+operation);await fs.mkdir(directory,{mode:0o700});
  for(const name of ['ui','api','socket']) {
    assert.ok(journalDirectories[name].startsWith(root+'/'));assert.equal(await fs.realpath(journalDirectories[name]),journalDirectories[name]);
  }
  const evidence={format:'sabalan-actual-native-browser/v1',operation,origin,actors:actors.map(({runtimeId,namespace,scopeSha256,slotId})=>({runtimeId,namespace,scopeSha256,slotId})),
    uiArtifacts,operations:[],tickets:[],sockets:[],screenshots:[],pageErrors:[],externalRequests:[],
    actualCompiledPages:true,actualCanonicalAuthorization:true,fullSalesContractIssuanceQualified:false,
    realElapsed24HoursQualified:false,productionAdmission:false};
  let browser,networkClient,primaryFailure;const tabs=[];const pending=new Set(),failures=[];
  const closeNetworkClient=async abrupt=>{
    if(!networkClient||networkClient.readyState===WebSocket.CLOSED)return;
    const closed=new Promise(resolve=>networkClient.once('close',resolve));
    if(abrupt)networkClient.terminate();else networkClient.close();await closed;
  };
  const producerById=new Map([[uiArtifacts.old.buildId,{artifact:uiArtifacts.old,actor:actors[0]}],
    [uiArtifacts.new.buildId,{artifact:uiArtifacts.new,actor:actors[1]}]]);
  function owned(task) {pending.add(task);void task.then(()=>pending.delete(task),error=>{failures.push(error);pending.delete(task);});}
  async function intent(transport,id,expectedBuild,expectedSlot) {
    assert.match(id??'',/^[a-f0-9]{32}$/);
    const record=await privateRead(path.join(journalDirectories[transport],id+'.intent.json'));
    assert.equal(record.value.buildId,expectedBuild);assert.equal(record.value.slotId,expectedSlot);
    evidence.operations.push({transport,operationId:id,intentSha256:record.sha256,generation:record.value.generation,
      buildId:record.value.buildId,slotId:record.value.slotId,method:record.value.method});return record.value;
  }
  async function pageFor(artifact,actor) {
    const page=await browser.newPage(),readiness=observeNativeNavigation(page);await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
    await page.setCookie({name:'sabalan_session',value:seed.sessionToken,url:origin,httpOnly:true,sameSite:'Lax'});
    page.on('pageerror',error=>evidence.pageErrors.push(error.message));
    page.on('request',request=>{const url=new URL(request.url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&url.origin.replace(/^ws/,'http')!==origin)
      evidence.externalRequests.push({origin:url.origin,path:url.pathname,method:request.method()});});
    page.on('response',response=>{const url=new URL(response.url());
      if(url.origin.replace(/^ws/,'http')!==origin)return;
      const transport=/^\/(api|files)(?:\/|$)/.test(url.pathname)?'api':url.pathname==='/socket.io/'?'socket':'ui';
      const id=response.headers()['x-sabalan-proxy-operation-id'];if(!id)return;
      const request=response.request(),headers=request.headers();
      const explicit=headers['x-deployment-id']||url.searchParams.get(transport==='ui'?'dpl':'__sabalan_build');
      // Plain public/static resources can legitimately be shared by builds;
      // qualify documents/RSC/explicit assets and every business request here.
      if(transport==='ui'&&!request.isNavigationRequest()&&!explicit&&headers.rsc!=='1')return;
      const buildId=explicit||(transport==='ui'&&request.isNavigationRequest()?artifact.buildId:uiArtifacts.old.buildId);
      owned((async()=>{
        const expected=producerById.get(buildId);assert.ok(expected);
        if(transport==='api'&&request.method()==='POST'&&url.pathname.startsWith('/api/support-tickets'))assert.equal(explicit,artifact.buildId);
        await intent(transport,id,buildId,transport==='ui'?expected.artifact.slotId:expected.actor.slotId);
      })());
    });
    const session=await page.target().createCDPSession();await session.send('Network.enable');
    const socketRequests=new Map();
    session.on('Network.webSocketCreated',({requestId,url})=>{
      const parsed=new URL(url);if(parsed.origin.replace(/^ws/,'http')!==origin){failures.push(Error('BROWSER_SOCKET_BYPASSED_COMMON_ORIGIN'));return;}
      if(artifact===uiArtifacts.new&&parsed.searchParams.get('__sabalan_build')!==artifact.buildId)failures.push(Error('BROWSER_SOCKET_COMPILED_PRODUCER_MISSING'));
      socketRequests.set(requestId,{requestId,buildQuery:parsed.searchParams.get('__sabalan_build'),authenticated:false,closed:false});
    });
    session.on('Network.webSocketClosed',({requestId})=>{const socket=socketRequests.get(requestId);if(socket)socket.closed=true;});
    session.on('Network.webSocketHandshakeResponseReceived',({requestId,response})=>{
      const socket=socketRequests.get(requestId);if(!socket)return;
      const id=Object.entries(response.headers).find(([key])=>key.toLowerCase()==='x-sabalan-proxy-operation-id')?.[1];
      if(response.status===101)owned(intent('socket',id,artifact.buildId,actor.slotId));
    });
    session.on('Network.webSocketFrameReceived',({requestId,response})=>{
      const socket=socketRequests.get(requestId);if(!socket)return;
      if(response.opcode===1&&response.payloadData.startsWith('40'))socket.authenticated=true;
      if(response.opcode===1&&response.payloadData.startsWith('44'))failures.push(Error('CANONICAL_BROWSER_SOCKET_AUTHENTICATION_REFUSED'));
    });
    const tab={page,socketRequests,artifact,actor,readiness};tabs.push(tab);return tab;
  }
  const inputSelector='form input[maxlength="180"]',descriptionSelector='form textarea[maxlength="10000"]';
  async function fill(tab,label) {
    await prepareNativeBrowserForm(tab.page,origin,tab.readiness,()=>until(()=>{
      if(failures.length)throw failures[0];
      return [...tab.socketRequests.values()].some(value=>value.authenticated&&!value.closed);
    }));
    const title='Private browser '+label+' '+operation,description='Actual unsaved original form '+label+' '+operation;
    await tab.page.type(inputSelector,title);await tab.page.type(descriptionSelector,description);
    const screenshot=path.join(directory,label+'.png');await tab.page.screenshot({path:screenshot,type:'png'});
    const bytes=await fs.readFile(screenshot);assert.ok(bytes.length<25*1024*1024);
    const fileInput=await tab.page.$('form input[type="file"][accept="image/jpeg,image/png,image/webp"]');assert.ok(fileInput);
    await fileInput.uploadFile(screenshot);
    evidence.screenshots.push({path:screenshot,sha256:sha(bytes),bytes:bytes.length});
    return {title,description,screenshot,sha256:sha(bytes)};
  }
  async function submit(tab,draft) {
    assert.equal(await tab.page.$eval(inputSelector,node=>node.value),draft.title);
    assert.equal(await tab.page.$eval(descriptionSelector,node=>node.value),draft.description);
    await waitForNativeSubmitEnabled(tab.page);
    const [response]=await Promise.all([
      tab.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/support-tickets'&&response.request().method()==='POST',{timeout:60000}),
      Promise.resolve().then(()=>tab.page.click('form button[type="submit"]')),
    ]);
    const body=await response.json();
    assert.equal(response.status(),201,JSON.stringify(body));assert.equal(body.data.title,draft.title);
    await tab.page.waitForFunction(()=>/\/dashboard\/support\/tickets\/[^/]+$/.test(location.pathname),{timeout:30000});
    await tab.page.waitForSelector('img[src*="/api/support-tickets/attachments/"]',{visible:true,timeout:30000});
    await tab.page.waitForFunction(()=>Array.from(document.querySelectorAll('img[src*="/api/support-tickets/attachments/"]')).some(img=>img.complete&&img.naturalWidth>0),{timeout:30000});
    const resource=await tab.page.$eval('img[src*="/api/support-tickets/attachments/"]',node=>node.src);
    const bytes=await tab.page.evaluate(async resource=>{
      const response=await fetch(resource,{credentials:'same-origin'});if(response.status!==200)throw Error('ACTUAL_ATTACHMENT_UNAVAILABLE');
      const data=await response.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',data);
      return {sha256:Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join(''),bytes:data.byteLength};
    },resource);
    assert.equal(bytes.sha256,draft.sha256);
    const url=new URL(resource);assert.equal(url.origin,origin);
    if(tab.artifact===uiArtifacts.new)assert.equal(url.searchParams.get('__sabalan_build'),tab.artifact.buildId);
    evidence.tickets.push({id:body.data.id,title:draft.title,description:draft.description,
      screenshotSha256:draft.sha256,attachmentBytes:bytes.bytes,resourcePath:url.pathname,buildId:tab.artifact.buildId,backendSlotId:tab.actor.slotId});
  }
  try {
    // The actual candidate controller owns Chrome's original Popen/profile.
    // Only its host-signed, original-parent pipe capability can expose CDP.
    browser=await puppeteer.connect({browserWSEndpoint:readOriginalRemoteBrowserConnection(browserConnection).browserWSEndpoint});
    const old=await pageFor(uiArtifacts.old,actors[0]),draft=await fill(old,'old-before-switch');
    await until(()=>[...old.socketRequests.values()].some(value=>value.authenticated&&!value.closed));
    const next=await publishGeneration('next');
    assert.equal(next.registry.current.erp,uiArtifacts.new.buildId);
    const retired=next.registry.builds.find(value=>value.id===uiArtifacts.old.buildId);assert.ok(retired);
    assert.ok(Date.parse(retired.supportUntil)-Date.parse(retired.retiredAt)>=86400000);
    // The actual old React form stays untouched while new users receive B.
    const newer=await pageFor(uiArtifacts.new,actors[1]),newDraft=await fill(newer,'new-after-switch');
    await submit(old,draft);await submit(newer,newDraft);
    await until(()=>[...newer.socketRequests.values()].some(value=>value.authenticated&&!value.closed));
    assert.ok([...old.socketRequests.values()].some(value=>value.authenticated&&!value.closed));
    evidence.oldFormSubmittedAfterSwitch=true;evidence.newFormSubmittedOnNewSlot=true;
    assert.equal(typeof readSocketPending,'function');
    let networkAuthenticated=false,networkOperationId;
    networkClient=new WebSocket('ws://'+address.address+':'+address.port+'/socket.io/?EIO=4&transport=websocket&__sabalan_build='+uiArtifacts.new.buildId,
      {headers:{host:'localhost:3199',cookie:'sabalan_session='+seed.sessionToken}});
    networkClient.on('error',error=>failures.push(error));
    networkClient.once('upgrade',response=>{networkOperationId=response.headers['x-sabalan-proxy-operation-id'];});
    networkClient.on('message',data=>{
      const message=data.toString();
      if(message.startsWith('0'))networkClient.send('40'+JSON.stringify({expectedUserId:seed.adminId}));
      else if(message==='2')networkClient.send('3');
      else if(message.startsWith('40'))networkAuthenticated=true;
      else if(message.startsWith('44'))failures.push(Error('ACTUAL_NETWORK_CLIENT_AUTHORIZATION_REFUSED'));
    });
    await until(()=>{if(failures.length)throw failures[0];return networkAuthenticated;});
    await intent('socket',networkOperationId,uiArtifacts.new.buildId,actors[1].slotId);
    if(whileBrowsersIdle)await whileBrowsersIdle({operation,tickets:evidence.tickets,origin,
      originalChromePid:originalBrowser.originalChromePid,originalChromeControllerId:originalBrowser.controllerId,uiArtifacts,
      compiledSockets:[old,newer].map(tab=>({buildId:tab.artifact.buildId,backendSlotId:tab.actor.slotId,
        sessions:[...tab.socketRequests.values()]})),
      networkClient:{operationId:networkOperationId,authenticated:true,open:networkClient.readyState===WebSocket.OPEN}});
    // Read after the original controller's capture interval; do not replay a
    // mutation or regenerate a missing PDF/attachment to conceal restore gaps.
    for(const tab of [old,newer]){
      assert.ok([...tab.socketRequests.values()].some(value=>value.authenticated&&!value.closed),
        'actual compiled Socket must remain open across capture');
      const me=await tab.page.evaluate(async buildId=>{const response=await fetch('/api/auth/me',
        {credentials:'same-origin',headers:{'x-deployment-id':buildId}});return response.status;},tab.artifact.buildId);
      assert.equal(me,200);
      evidence.sockets.push({buildId:tab.artifact.buildId,sessions:[...tab.socketRequests.values()]});
    }
    const rolled=await publishGeneration('rollback');assert.equal(rolled.registry.current.erp,uiArtifacts.old.buildId);
    await until(()=>pending.size===0);if(failures.length)throw failures[0];
    assert.equal(evidence.externalRequests.length,0,'actual compiled pages must not bypass the common edge');
    assert.deepEqual(evidence.pageErrors,[]);
    // Close both actual compiled browsers normally first. The only remaining
    // transport must be this separately authenticated, still-open original
    // client, so browser closure cannot be mislabeled as the network loss.
    await browser.close();browser=undefined;
    await until(async()=>{const values=await readSocketPending();return values.length===1&&values[0].id===networkOperationId;});
    assert.equal(networkClient.readyState,WebSocket.OPEN);
    await closeNetworkClient(true);
    await until(()=>pending.size===0);if(failures.length)throw failures[0];
    evidence.actualNetworkLoss={operationId:networkOperationId,authenticated:true,termination:'original-client-network-loss',
      originalOperationOutcome:'UNKNOWN',compiledBrowserSessionsClosedNormally:true};
    return evidence;
  } catch(error) {
    primaryFailure=error;
    try{await persistNativeBrowserFailure(directory,tabs,error);}catch{/* Diagnostic failure cannot replace the original qualification failure. */}
    throw error;
  } finally {
    let cleanupFailure;
    try{if(browser)await browser.close();}catch(error){cleanupFailure=error;}
    try{await closeNetworkClient(false);}catch(error){cleanupFailure??=error;}
    await Promise.allSettled([...pending]);
    if(!primaryFailure&&cleanupFailure)throw cleanupFailure;
    // Caller owns actual transport/journal/native drain after this original
    // browser's awaited normal close; no controller or lease is released here.
  }
}
