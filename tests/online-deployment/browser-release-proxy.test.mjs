import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createBrowserReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';

const image=`sha256:${'a'.repeat(64)}`,action='b'.repeat(42);
// This fixture exercises the supported retained window; expiration refusal is
// covered separately with actual past deadlines in expired-build-fence tests.
const now=new Date(Date.now()-86400000).toISOString(),until=new Date(Date.now()+86400000).toISOString();
function registry(){return {format:'sabalan-browser-routing/v1',generation:1,
  current:{erp:'erp_current',inquiry:'inquiry_current'},legacy:{erp:'erp_legacy',inquiry:'inquiry_legacy'},
  builds:['erp_legacy','erp_current','inquiry_legacy','inquiry_current'].map(id=>({id,application:id.startsWith('erp_')?'erp':'inquiry',
    slotId:`slot_${id}`,image,manifestSha256:'c'.repeat(64),retiredAt:id.endsWith('legacy')?now:null,
    supportUntil:id.endsWith('legacy')?until:null,actionIds:id.startsWith('inquiry_')?[action]:[],assets:[]}))};}
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const close=server=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const journal=async(directory,instanceId)=>{const journal=new BrowserOperationJournal({directory,instanceId});await journal.initialize();return journal;};
async function removeFixture(directory){
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('sabalan-browser-journal-'));
  await fs.rm(directory,{recursive:true,force:true});
}
const fetchUi=(port,path,options={})=>new Promise((resolve,reject)=>{
  const body=options.body===undefined?null:Buffer.from(options.body);
  const request=http.request({hostname:'127.0.0.1',port,path,method:options.method||'GET',signal:options.signal,
    headers:{host:'erp.test',...(body?{'content-length':String(body.length)}:{}),...options.headers}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
  request.on('error',reject);request.end(body);
});

test('private browser transport preserves old requests, native bound bytes, privacy headers and fail-closed registry generation',{timeout:30000},async()=>{
  const previousAgent=http.globalAgent;
  http.globalAgent=new http.Agent({lookup:(host,options,callback)=>callback(null,options?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4)});
  const servers=[],seen=[];
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-browser-journal-'));
  let proxy;
  try {
    let input=registry();const endpoints=[];
    for(const build of input.builds){
      const server=http.createServer(async(req,res)=>{
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        seen.push({id:build.id,path:req.url,body:Buffer.concat(chunks),headers:req.headers});
        res.writeHead(200,{'content-type':'text/plain','cache-control':'public, max-age=86400','set-cookie':'same-session=retained; HttpOnly; SameSite=Lax'});
        res.end(build.id);
      });
      servers.push(server);const port=await listen(server);
      endpoints.push({slotId:build.slotId,host:build.application==='erp'?'frontend':'inquiry',port,image});
    }
    proxy=createBrowserReleaseProxy({loadRegistry:async()=>structuredClone(input),slotEndpoints:endpoints,
      operationJournal:await journal(directory,'1'.repeat(64)),
      applicationsByHost:{'erp.test':'erp','inquiry.test':'inquiry'},bodyLimit:2048,totalBodyLimit:4096});
    servers.push(proxy.server);const port=await listen(proxy.server);
    assert.equal(await (await fetchUi(port,'/about')).text(),'erp_current');
    const old=await fetchUi(port,'/about',{headers:{rsc:'1','x-deployment-id':'erp_legacy','x-forwarded-host':'attacker.invalid'}});
    assert.equal(await old.text(),'erp_legacy');assert.equal(old.headers.get('cache-control'),'no-store, private');
    assert.match(old.headers.get('set-cookie'),/same-session=retained/);
    assert.equal(seen.at(-1).headers['x-forwarded-host'],'erp.test');
    assert.equal(await (await fetchUi(port,'/about',{headers:{rsc:'1'}})).text(),'erp_legacy');
    const form=new FormData();form.set('$ACTION_REF_1','');form.set('$ACTION_1:0',JSON.stringify({id:action,bound:'$@1'}));
    form.set('$ACTION_1:1','UNCHANGED_ENCRYPTED_BOUND_ARGUMENTS');form.set('name','مقدار ثبت‌نشده');
    const encoded=new Request('http://form.invalid',{method:'POST',body:form});const body=Buffer.from(await encoded.arrayBuffer());
    const result=await fetchUi(port,'/admin',{method:'POST',headers:{host:'inquiry.test','content-type':encoded.headers.get('content-type')},body});
    assert.equal(await result.text(),'inquiry_legacy');assert.deepEqual(seen.at(-1).body,body);
    const before=seen.length;
    assert.equal((await fetchUi(port,'/api/contracts',{method:'POST',body:'no-business-routing'})).status,404);
    for(const path of ['/API/auth/me','/aPi/contracts','/Files/private','/Socket.IO/','/%61pi/auth/me','/safe/../API/auth/me']) {
      assert.equal((await fetchUi(port,path)).status,404,`${path} must not enter UI routing`);
    }
    for(const path of ['/api%2fcontracts','/%2fapi/auth/me','/safe%5c..%5capi/auth/me','/safe%252fapi','/%00api','/bad%XXpath','/foo#fragment']) {
      assert.equal((await fetchUi(port,path)).status,400,`${path} has ambiguous or invalid path interpretation`);
    }
    assert.equal((await fetchUi(port,'/about',{headers:{'x-deployment-id':'erp_unknown'}})).status,503);
    assert.equal((await fetchUi(port,'/admin',{method:'POST',headers:{host:'inquiry.test','content-type':'text/plain'},body:'not-an-action'})).status,400);
    assert.equal((await fetchUi(port,'/admin',{method:'PUT',headers:{host:'inquiry.test','next-action':action},body:'not-a-post'})).status,400);
    assert.equal((await fetchUi(port,'/admin',{method:'POST',headers:{host:'inquiry.test'},body:'x'.repeat(2049)})).status,413);
    assert.equal(seen.length,before,'unsupported requests never reach a serving slot');
    input.current.erp='erp_legacy';input.builds[0].retiredAt=null;input.builds[0].supportUntil=null;
    assert.equal((await fetchUi(port,'/about')).status,503,'same generation cannot change routing bytes');
    input.generation=2;
    assert.equal(await (await fetchUi(port,'/about')).text(),'erp_legacy');
    input.generation=1;
    assert.equal((await fetchUi(port,'/about')).status,503,'an old publication cannot silently roll traffic back');
    proxy.beginDrain();assert.equal((await fetchUi(port,'/about')).status,503);
    assert.deepEqual(proxy.status(),{accepting:false,active:0,unresolved:0,bodyBytes:0,generation:2});
    await proxy.assertDrained();
  } finally {proxy?.beginDrain();await Promise.all(servers.map(close));http.globalAgent.destroy();http.globalAgent=previousAgent;await removeFixture(directory);}
});

test('a disconnected browser cannot retire or cancel an admitted action; upstream ambiguity is never retried or declared drained',{timeout:30000},async()=>{
  const previousAgent=http.globalAgent;
  http.globalAgent=new http.Agent({lookup:(host,options,callback)=>callback(null,options?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4)});
  const started=deferred(),complete=deferred();let effects=0,proxy;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-browser-journal-'));
  const upstream=http.createServer(async(req,res)=>{
    for await(const chunk of req)void chunk;
    started.resolve();await complete.promise;effects++;
    if(req.url==='/ambiguous')res.destroy();else res.end('committed');
  });
  try {
    const upstreamPort=await listen(upstream),input=registry();
    proxy=createBrowserReleaseProxy({loadRegistry:async()=>input,applicationsByHost:{'inquiry.test':'inquiry'},
      operationJournal:await journal(directory,'1'.repeat(64)),
      slotEndpoints:input.builds.filter(build=>build.application==='inquiry').map(build=>({slotId:build.slotId,host:'inquiry',port:upstreamPort,image}))});
    const port=await listen(proxy.server),abort=new AbortController();
    const pending=fetchUi(port,'/action',{method:'POST',headers:{host:'inquiry.test','next-action':action,'x-deployment-id':'inquiry_current'},body:'one-call',signal:abort.signal}).catch(()=>null);
    await started.promise;abort.abort();await pending;
    proxy.beginDrain();assert.equal(proxy.status().active,1);await assert.rejects(()=>proxy.assertDrained(),/DRAIN_NOT_PROVEN/);
    await assert.rejects(()=>proxy.readStoppedTransport(),/TRANSPORT_NOT_STOPPED/);
    complete.resolve();
    for(let attempts=0;proxy.status().active && attempts<100;attempts++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(effects,1);await proxy.assertDrained();
    await close(proxy.server);
    const uncertain=createBrowserReleaseProxy({loadRegistry:async()=>input,applicationsByHost:{'inquiry.test':'inquiry'},
      operationJournal:await journal(directory,'2'.repeat(64)),
      slotEndpoints:input.builds.filter(build=>build.application==='inquiry').map(build=>({slotId:build.slotId,host:'inquiry',port:upstreamPort,image}))});
    proxy=uncertain;const secondPort=await listen(uncertain.server);
    const result=await fetchUi(secondPort,'/ambiguous',{method:'POST',headers:{host:'inquiry.test','next-action':action,'x-deployment-id':'inquiry_current'},body:'one-ambiguous-call'});
    assert.equal(result.status,502);assert.equal((await result.json()).error,'BROWSER_UPSTREAM_OUTCOME_UNKNOWN');
    assert.equal(effects,2,'the ambiguous action is forwarded once');
    uncertain.beginDrain();assert.equal(uncertain.status().unresolved,1);await assert.rejects(()=>uncertain.assertDrained(),/DRAIN_NOT_PROVEN/);
    for(let attempts=0;attempts<100;attempts++) {
      try {await uncertain.readStoppedTransport();break;} catch {await new Promise(resolve=>setTimeout(resolve,5));}
    }
    const stopped=await uncertain.readStoppedTransport();assert.equal(stopped.pendingOperations.length,1);
    assert.equal(stopped.pendingOperations[0].method,'POST');
    await assert.rejects(()=>uncertain.assertDrained(),/DRAIN_NOT_PROVEN/,'transport closure cannot settle an unknown application action');
    const restarted=createBrowserReleaseProxy({loadRegistry:async()=>input,applicationsByHost:{'inquiry.test':'inquiry'},
      operationJournal:await journal(directory,'3'.repeat(64)),
      slotEndpoints:input.builds.filter(build=>build.application==='inquiry').map(build=>({slotId:build.slotId,host:'inquiry',port:upstreamPort,image}))});
    restarted.beginDrain();assert.equal(restarted.status().unresolved,0);
    await assert.rejects(()=>restarted.assertDrained(),/DRAIN_NOT_PROVEN/,'new memory cannot hide the old durable ambiguous intent');
    assert.deepEqual((await restarted.readStoppedTransport()).pendingOperations,stopped.pendingOperations);
  } finally {complete.resolve();if(proxy)await close(proxy.server);await close(upstream);http.globalAgent.destroy();http.globalAgent=previousAgent;await removeFixture(directory);}
});
