/** Inspect only our still-held original owner; no runtime capability is minted. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const list=await (await fetch('http://127.0.0.1:9229/json/list')).json();assert.equal(list.length,1);
const url=new URL(list[0].webSocketDebuggerUrl);assert.equal(url.hostname,'127.0.0.1');
const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0;const requests=new Map(),notifications=[];
socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const request=requests.get(message.id);requests.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result);}else notifications.push(message);};
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;requests.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
let paused=false;
try{
 await rpc('Runtime.enable');const identity=await rpc('Runtime.evaluate',{expression:'process.pid',returnByValue:true});assert.equal(identity.result.value,29432,'DIFFERENT_DEBUG_TARGET');
 await rpc('Debugger.enable');await rpc('Debugger.pause');
 for(let attempt=0;attempt<100&&!notifications.some(row=>row.method==='Debugger.paused');attempt++)await new Promise(resolve=>setTimeout(resolve,50));
 const event=notifications.find(row=>row.method==='Debugger.paused');assert.ok(event);paused=true;
 const frame=event.params.callFrames[0];
 const observation=await rpc('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({leaseType:typeof lease,commandsType:typeof commands,reportType:typeof report,owner:typeof lease==="object"?lease.originalPid:null})',returnByValue:true});
 console.log(JSON.stringify({frames:event.params.callFrames.map(f=>({id:f.callFrameId,name:f.functionName,url:f.url,location:f.location,scopes:f.scopeChain.map(s=>({type:s.type,name:s.name}))})),observation:observation.result.value}));assert.equal(observation.result.value.leaseType,'object');
 const fn=await rpc('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'commands.close',returnByValue:false});
 const properties=await rpc('Runtime.getProperties',{objectId:fn.result.objectId,ownProperties:false});
 const scopes=properties.internalProperties.find(row=>row.name==='[[Scopes]]');assert.ok(scopes);
 const scopeList=await rpc('Runtime.getProperties',{objectId:scopes.value.objectId,ownProperties:true});
 let owners;
 for(const scope of scopeList.result.filter(row=>/^\d+$/.test(row.name))){const values=await rpc('Runtime.getProperties',{objectId:scope.value.objectId,ownProperties:true});owners=values.result.find(row=>row.name==='owners');if(owners)break;}
 assert.ok(owners);
 const originals=await rpc('Runtime.callFunctionOn',{objectId:owners.value.objectId,functionDeclaration:'function(){return this.filter(o=>o.child.spawnargs.includes("up")).map(o=>({originalPid:o.originalPid,argv:o.child.spawnargs,code:o.result.code,signal:o.result.signal,stdout:o.result.stdout,stderr:o.result.stderr}));}',returnByValue:true});
 const file=new URL('./HELD-OWNER-DEBUG-OBSERVATION.json',import.meta.url);assert.ok(!fs.existsSync(file));
 fs.writeFileSync(file,JSON.stringify({format:'sabalan-owned-selection-debug-observation/v1',readOnly:true,targetPid:29432,liveScopeObservation:observation.result.value,composeOriginals:originals.result.value,productionAdmission:false},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({file:file.pathname,observation:observation.result.value,composeOriginals:originals.result.value}));
}finally{if(paused)await rpc('Debugger.resume');socket.close();}
