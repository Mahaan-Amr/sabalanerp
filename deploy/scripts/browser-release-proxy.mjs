import {originalForwardedHeaders} from './release-forwarding.mjs';
import {assertReleaseEndpointCatalog,readReleaseEndpoint} from './release-endpoint-catalog.mjs';
import http from 'node:http';
import {compileBrowserRoutingRegistry,selectBrowserRelease,nativeActionIdentity,browserRoutingIdentity} from './browser-release-routing.mjs';
import {compileApiRoutingRegistry,selectApiRelease,apiRoutingIdentity} from './api-release-routing.mjs';

const excluded = new Set(['connection','proxy-connection','keep-alive','te','trailer','transfer-encoding','upgrade','proxy-authorization','proxy-authenticate']);
function forwardedHeaders(headers) {
  const blocked=new Set([...excluded,...String(headers.connection||'').toLowerCase().split(',').map(value=>value.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key])=>!blocked.has(key.toLowerCase())));
}
const error=(code,status=503)=>Object.assign(new Error(code),{code,status});

/** Private UI transport primitive. Admission, persistent publication and live
 * runtime proof belong to the deployment controller, not to client headers or
 * this selector. There is intentionally no production CLI/listener here. */
export function createBrowserReleaseProxy(options) { return createReleaseProxy(options,false); }

/** Separate private business transport. Browser and backend bindings must be
 * read from one owned, atomically published snapshot. Authentication/session
 * and domain authorization remain enforced by the selected canonical backend.
 * No public listener, compatibility attestation or release admission is added. */
export function createApiReleaseProxy({loadSnapshot,...options}) {
  return createReleaseProxy({...options,loadRegistry:loadSnapshot},true);
}

function createReleaseProxy({loadRegistry,slotEndpoints=[],endpointCatalog,ingressTrust,applicationsByHost,admission,
  operationJournal,bodyLimit=10*1024*1024,totalBodyLimit=32*1024*1024,timeoutMs=90000},api) {
  if(typeof loadRegistry!=='function' || !Number.isSafeInteger(bodyLimit) || bodyLimit<1
    || !Number.isSafeInteger(totalBodyLimit) || totalBodyLimit<bodyLimit
    || !Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>240000
    || !operationJournal || typeof operationJournal.begin!=='function' || typeof operationJournal.complete!=='function'
    || typeof operationJournal.pending!=='function') throw error('BROWSER_PROXY_CONFIGURATION_INVALID');
  if(endpointCatalog)assertReleaseEndpointCatalog(endpointCatalog);
  const endpoints=new Map(),hosts=new Map();
  for(const endpoint of slotEndpoints) {
    if(!/^[a-z][a-z0-9_-]{7,95}$/.test(endpoint.slotId) || endpoints.has(endpoint.slotId)
      || !(api ? /^backend(?:-[a-z0-9]+)*$/ : /^(frontend|inquiry)(?:-[a-z0-9]+)*$/).test(endpoint.host)
      || !Number.isInteger(endpoint.port) || endpoint.port<1024 || endpoint.port>65535
      || !/^sha256:[a-f0-9]{64}$/.test(endpoint.image)
      || (api && !/^[a-f0-9]{64}$/.test(endpoint.manifestSha256))) throw error('BROWSER_PROXY_ENDPOINT_INVALID');
    endpoints.set(endpoint.slotId,Object.freeze({...endpoint}));
  }
  for(const [host,application] of Object.entries(applicationsByHost)) {
    if(!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host) || !(api ? ['erp'] : ['erp','inquiry']).includes(application)) throw error('BROWSER_PROXY_HOST_INVALID');
    hosts.set(host,application);
  }
  let accepting=true,bodyBytes=0,generation=0,sequence=0,registryIdentity=null;
  const active=new Set(),unresolved=new Set(),outbound=new Set();
  const respond=(response,status,code)=>{
    if(response.destroyed)return;
    if(response.headersSent){response.destroy();return;}
    response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private'});
    response.end(JSON.stringify({success:false,error:code,message:code==='API_BUILD_REFRESH_REQUIRED'
      ? 'برای ادامه، نوشته‌های این فرم را حفظ کنید و سپس صفحه را تازه کنید.' : code==='API_LEGACY_MANUAL_SAVE_REQUIRED'
      ? 'این فرم قدیمی است؛ نوشته‌ها و فایل‌های آن را دستی ذخیره کنید. صفحه خودکار تازه نمی‌شود.' : code==='BROWSER_UPSTREAM_OUTCOME_UNKNOWN'
      ? 'نتیجهٔ درخواست مشخص نیست؛ پیش از تکرار، وضعیت ثبت آن را بررسی کنید.'
      : 'این نسخه فعلاً پاسخ‌گو نیست؛ نوشته‌های صفحه را نگه دارید و دوباره تلاش کنید.'}));
  };
  const server=http.createServer(async(request,response)=>{
    const operation=++sequence;active.add(operation);const ticket=admission?.begin();
    let forwarded=false,journalCompleted=false,allocated=0,intentId;
    try {
      if(!accepting)throw error('BROWSER_PROXY_DRAINING');
      const application=hosts.get(String(request.headers.host||'').toLowerCase());
      if(!application)throw error('BROWSER_PROXY_HOST_UNAVAILABLE',421);
      if(!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.split('?')[0].includes('\\'))throw error('BROWSER_PROXY_PATH_INVALID',400);
      const url=new URL(request.url,'http://browser.invalid');
      // Next rewrites use case-insensitive route matching. Reject alternate
      // separator/double-encoding interpretations before selecting a UI slot.
      if(url.hash || /\\|%(?:2f|5c|25|00)/i.test(url.pathname))throw error('BROWSER_PROXY_PATH_INVALID',400);
      let normalizedPath;
      try { normalizedPath=decodeURIComponent(url.pathname); } catch {throw error('BROWSER_PROXY_PATH_INVALID',400);}
      if(/[\u0000-\u001f\u007f]/.test(normalizedPath))throw error('BROWSER_PROXY_PATH_INVALID',400);
      if(api ? !/^\/(api|files)(?:\/|$)/i.test(normalizedPath)
        : /^\/(api|socket\.io|files)(?:\/|$)/i.test(normalizedPath))throw error('BROWSER_PROXY_BUSINESS_PATH_FORBIDDEN',404);
      const declared=request.headers['content-length'];
      if(declared!==undefined && (typeof declared!=='string' || !/^\d+$/.test(declared)
        || !Number.isSafeInteger(Number(declared))))throw error('BROWSER_PROXY_BODY_INVALID',400);
      if(declared!==undefined && Number(declared)>bodyLimit) {
        request.resume();throw error('BROWSER_PROXY_BODY_CAPACITY',413);
      }
      const chunks=[];
      for await(const chunk of request) {
        allocated+=chunk.length;bodyBytes+=chunk.length;
        if(allocated>bodyLimit || bodyBytes>totalBodyLimit)throw error('BROWSER_PROXY_BODY_CAPACITY',413);
        chunks.push(chunk);
      }
      if(request.aborted)throw error('BROWSER_PROXY_CLIENT_DISCONNECTED',400);
      const body=Buffer.concat(chunks);
      const method=request.method||'GET';
      if(['GET','HEAD'].includes(method) && body.length)throw error('BROWSER_PROXY_BODY_INVALID',400);
      let native={},actionIds=[];
      const actionHeader=request.headers['next-action'];
      if(api) {
        if(actionHeader!==undefined || !['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))throw error('API_PROXY_METHOD_UNPROVEN',405);
      } else if(actionHeader!==undefined) {
        if(typeof actionHeader!=='string' || method!=='POST')throw error('BROWSER_ACTION_INVALID',400);
        actionIds=[actionHeader];
      } else if(method==='POST') {
        if(application!=='inquiry' || request.headers['content-encoding'])throw error('BROWSER_PROXY_POST_UNPROVEN',400);
        const contentType=request.headers['content-type'];
        if(typeof contentType!=='string' || !/^(multipart\/form-data|application\/x-www-form-urlencoded)(?:;|$)/i.test(contentType))throw error('BROWSER_NATIVE_FORM_INVALID',400);
        const form=await new Request('http://browser.invalid',{method:'POST',headers:{'content-type':contentType},body}).formData();
        native=nativeActionIdentity(form);actionIds=native.actionIds;
      } else if(!['GET','HEAD','OPTIONS'].includes(method))throw error('BROWSER_PROXY_METHOD_UNPROVEN',405);
      const snapshot=await loadRegistry();
      const input=api ? snapshot.browser : snapshot;
      const registry=api ? compileApiRoutingRegistry(input,snapshot.api) : compileBrowserRoutingRegistry(input);
      if(registry.generation<generation)throw error('BROWSER_PROXY_GENERATION_REGRESSED');
      const nextIdentity=api ? apiRoutingIdentity(input,snapshot.api) : browserRoutingIdentity(input);
      if(registry.generation===generation && nextIdentity!==registryIdentity)throw error('BROWSER_PROXY_GENERATION_REUSED');
      generation=registry.generation;
      registryIdentity=nextIdentity;
      const resource=api ? nativeResourceIdentity(request.url,url,method,request.headers['x-deployment-id']) : null;
      const selection=api ? selectApiRelease(registry,resource.deploymentId) : selectBrowserRelease(registry,{application,
        deploymentId:request.headers['x-deployment-id'],
        assetDeploymentId:url.pathname.startsWith('/_next/static/') ? singleQuery(url,'dpl'):null,
        assetPath:url.pathname.startsWith('/_next/static/') ? normalizedPath:null,
        isRsc:request.headers.rsc==='1',actionIds,...native});
      admission?.select(ticket,selection.buildId);
      const endpoint=endpointCatalog?readReleaseEndpoint(endpointCatalog,api?'backend':'ui',selection.slotId):endpoints.get(selection.slotId);
      if(!endpoint || endpoint.image!==selection.image
        || (api ? endpoint.manifestSha256!==selection.manifestSha256 || !endpoint.host.startsWith('backend')
          : !endpoint.host.startsWith(application==='erp' ? 'frontend':'inquiry')))throw error('BROWSER_PROXY_SLOT_IDENTITY_UNAVAILABLE');
      if(selection.requiresDraftHandoff)throw error(selection.manualSaveRequired?'API_LEGACY_MANUAL_SAVE_REQUIRED':'API_BUILD_REFRESH_REQUIRED',409);
      const headers=forwardedHeaders(request.headers);
      delete headers['x-forwarded-host'];
      headers['x-forwarded-host']=request.headers.host;
      Object.assign(headers,originalForwardedHeaders(request,ingressTrust));
      if(api) {
        headers['x-deployment-id']=selection.buildId;
      }
      if(body.length || !['GET','HEAD'].includes(method))headers['content-length']=String(body.length);
      intentId=await operationJournal.begin({registryIdentity:nextIdentity,generation:registry.generation,
        buildId:selection.buildId,slotId:selection.slotId,image:selection.image,
        manifestSha256:api ? selection.manifestSha256 : registry.builds[selection.buildId].manifestSha256,method});
      headers['x-sabalan-proxy-operation-id']=intentId;
      await new Promise((resolve,reject)=>{
        let incomingResponse;
        const disconnected=()=>incomingResponse?.resume();
        const outgoing=http.request({hostname:endpoint.host,port:endpoint.port,path:resource?.path ?? request.url,method,headers},incoming=>{
          incomingResponse=incoming;
          const resultHeaders=forwardedHeaders(incoming.headers);
          resultHeaders['x-sabalan-proxy-operation-id']=intentId;
          // UI documents/RSC/actions may contain current private data. Exact
          // immutable static bytes retain their own upstream caching policy.
          if(api || !url.pathname.startsWith('/_next/static/'))resultHeaders['cache-control']='no-store, private';
          if(!response.destroyed)response.writeHead(incoming.statusCode||502,resultHeaders);
          incoming.on('data',chunk=>{if(!response.destroyed && !response.write(chunk))incoming.pause();});
          incoming.once('end',()=>{
            operationJournal.complete(intentId,'UPSTREAM_ENDED').then(()=>{
              journalCompleted=true;if(!response.destroyed)response.end();resolve();
            },reject);
          });
          incoming.once('aborted',()=>reject(error('BROWSER_UPSTREAM_OUTCOME_UNKNOWN')));
          incoming.once('error',reject);
        });
        outbound.add(outgoing);
        const release=admission?.hold(ticket);outgoing.once('close',()=>release?.());
        response.on('drain',disconnected);
        response.once('close',disconnected);
        const deadline=setTimeout(()=>outgoing.destroy(error('BROWSER_UPSTREAM_OUTCOME_UNKNOWN')),timeoutMs);
        outgoing.once('close',()=>{outbound.delete(outgoing);clearTimeout(deadline);response.off('drain',disconnected);response.off('close',disconnected);});
        outgoing.once('error',reject);
        outgoing.setTimeout(timeoutMs,()=>outgoing.destroy(error('BROWSER_UPSTREAM_OUTCOME_UNKNOWN')));
        // Once forwarded, a disconnected browser cannot cancel ownership of an
        // action. Consume its response and retain ambiguity if completion is
        // not observed. Never retry a mutation on another slot.
        forwarded=true;outgoing.end(body);
      });
    } catch(failure) {
      if(intentId && !forwarded) {
        try {await operationJournal.complete(intentId,'NOT_FORWARDED');journalCompleted=true;}
        catch {unresolved.add(operation);admission?.unknown(ticket);}
      }
      if(forwarded && !journalCompleted) {
        unresolved.add(operation);admission?.unknown(ticket);
        respond(response,502,'BROWSER_UPSTREAM_OUTCOME_UNKNOWN');
      } else respond(response,failure.status||503,failure.code||'BROWSER_PROXY_UNAVAILABLE');
    } finally {bodyBytes-=allocated;active.delete(operation);admission?.finish(ticket);}
  });
  server.requestTimeout=timeoutMs;
  server.headersTimeout=Math.min(30000,timeoutMs);
  return Object.freeze({server,
    beginDrain(){accepting=false;},
    status(){return {accepting,active:active.size,unresolved:unresolved.size,bodyBytes,generation};},
    // Transport closure does not settle an action, prove application/SQL
    // completion, or authorize replacement/recovery. Durable UNKNOWN intents
    // remain returned to the owned controller and still prevent assertDrained.
    async readStoppedTransport(){
      const assertStopped=()=>{if(accepting || active.size || outbound.size || bodyBytes)throw error('BROWSER_PROXY_TRANSPORT_NOT_STOPPED');};
      assertStopped();const pendingOperations=await operationJournal.pending();assertStopped();
      return {pendingOperations};
    },
    async assertDrained(){
      if(accepting || active.size || outbound.size || unresolved.size || (await operationJournal.pending()).length
        || accepting || active.size || outbound.size || unresolved.size)throw error('BROWSER_PROXY_DRAIN_NOT_PROVEN');
    },
  });
}

function singleQuery(url,key) {
  const values=url.searchParams.getAll(key);
  if(values.length>1)throw error('BROWSER_PROXY_QUERY_AMBIGUOUS',400);
  return values[0]??null;
}

/** Native DOM consumers cannot set headers. The query identifies a producer
 * only; selected backends still authenticate/authorize every request. Keep all
 * original application query bytes, including signed-token encoding, untouched.
 * Mutations must use their ordinary compiled request header, never this path. */
function nativeResourceIdentity(rawPath,url,method,header) {
  const values=url.searchParams.getAll('__sabalan_build');
  if(!values.length)return {deploymentId:header,path:rawPath};
  if(!['GET','HEAD'].includes(method) || values.length!==1
    || !/^[a-z][a-z0-9_-]{7,95}$/.test(values[0])
    || (header!==undefined && header!==values[0]))throw error('API_RESOURCE_IDENTITY_INVALID',400);
  const queryAt=rawPath.indexOf('?');
  const parts=rawPath.slice(queryAt+1).split('&');
  const kept=parts.filter(part=>!new URLSearchParams(part).has('__sabalan_build'));
  return {deploymentId:values[0],path:rawPath.slice(0,queryAt)+(kept.length?'?'+kept.join('&'):'')};
}
