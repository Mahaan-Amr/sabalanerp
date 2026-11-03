/** Deliver reviewed recovery to our same paused module scope; never reconstruct lease objects. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('./recover-owned-inquiry-selection.mjs',import.meta.url));
const pin=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const list=await (await fetch('http://127.0.0.1:9229/json/list')).json();assert.equal(list.length,1);
const url=new URL(list[0].webSocketDebuggerUrl);assert.equal(url.hostname,'127.0.0.1');
const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0,paused=false;const requests=new Map(),notifications=[];
socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const row=requests.get(message.id);requests.delete(message.id);message.error?row.reject(Error('OWNED_DEBUG_PROTOCOL_FAILED')):row.resolve(message.result);}else notifications.push(message);};
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;requests.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
try{
 await rpc('Runtime.enable');const identity=await rpc('Runtime.evaluate',{expression:'process.pid',returnByValue:true});assert.equal(identity.result.value,29432);
 await rpc('Debugger.enable');const lines=fs.readFileSync(new URL('./select-inquiry-native-r3.mjs',import.meta.url),'utf8').split('\n');const line=lines.findIndex(row=>row.includes('if(!safe){setInterval'));
 const script=notifications.find(row=>row.method==='Debugger.scriptParsed'&&row.params.url.endsWith('/select-inquiry-native-r3.mjs'));assert.ok(script);
 const points=await rpc('Debugger.getPossibleBreakpoints',{start:{scriptId:script.params.scriptId,lineNumber:line,columnNumber:0},end:{scriptId:script.params.scriptId,lineNumber:line+1,columnNumber:0}});
 const point=points.locations.find(row=>row.type==='return');assert.ok(point);const breakpoint=await rpc('Debugger.setBreakpoint',{location:point});
 for(let attempt=0;attempt<100&&!notifications.some(row=>row.method==='Debugger.paused');attempt++)await new Promise(resolve=>setTimeout(resolve,50));
 const event=notifications.find(row=>row.method==='Debugger.paused');assert.ok(event);paused=true;const frame=event.params.callFrames[0];
 const binding=await rpc('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({pid:process.pid,leasePid:lease.originalPid,operation:report.operation,phase:report.phase})',returnByValue:true});
 assert.deepEqual(binding.result.value,{pid:29432,leasePid:33860,operation:'a3a7aa1b5bcfbb58e69ee66a15474612',phase:'HELD_RESTORATION_UNPROVEN'});
 const expression=`globalThis.__ownedInquiryRecovery=(async()=>{const fs=await import('node:fs'),crypto=await import('node:crypto');if(crypto.createHash('sha256').update(fs.readFileSync(${JSON.stringify(source)})).digest('hex')!==${JSON.stringify(pin)})throw Error('RECOVERY_SOURCE_CHANGED');const m=await import(${JSON.stringify(new URL('./recover-owned-inquiry-selection.mjs',import.meta.url).href)});return m.recoverOwnedInquirySelection({lease,before,report});})()`;
 await rpc('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression,returnByValue:false});
 await rpc('Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId});await rpc('Debugger.resume');paused=false;
 const recovery=await rpc('Runtime.evaluate',{expression:'globalThis.__ownedInquiryRecovery',awaitPromise:true,returnByValue:true});
 assert.ok(!recovery.exceptionDetails&&recovery.result.value?.safeLocalBaselineRestored&&recovery.result.value.leaseClosed,'ORIGINAL_RECOVERY_REMAINS_HELD');
 const file=new URL('./OWNED-RECOVERY-RETURN.json',import.meta.url);fs.writeFileSync(file,JSON.stringify({format:'sabalan-419-same-owner-recovery-return/v1',binding:binding.result.value,recoverySourceSha256:pin,recovery:recovery.result.value,outerOwnerClosurePending:true,productionAdmission:false},null,2)+'\n',{flag:'wx',mode:0o600});
 // Every original child and the original lease have actually closed. The known-negative
 // outer owner now exits itself with code1; no serving process is stopped or adopted.
 await rpc('Debugger.disable');await rpc('Runtime.evaluate',{expression:"delete globalThis.__ownedInquiryRecovery;setImmediate(()=>process.exit(1));'KNOWN_NEGATIVE_OWNER_EXIT_REQUESTED'",returnByValue:true});
 console.log(JSON.stringify({file:file.pathname,sameOwnerPid:29432,leaseClosed:true,outerNegativeClosurePending:true}));
}finally{if(paused)await rpc('Debugger.resume');socket.close();}
