const fs=require('node:fs'); const WebSocket=require('/app/node_modules/ws');
(async()=>{
 const r=await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(15000)});const [target]=await r.json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);const pending=new Map();let seq=0;
 ws.on('message',data=>{const msg=JSON.parse(data);const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await cmd('Profiler.enable');await cmd('Profiler.setSamplingInterval',{interval:1000});await cmd('Profiler.start');
 await new Promise(resolve=>setTimeout(resolve,12000));const {profile}=await cmd('Profiler.stop');
 fs.writeFileSync('/tmp/sabalan-perf-20261011.cpuprofile',JSON.stringify(profile));
 const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
 const summary=profile.nodes.map(n=>({function:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber+1,hits:counts.get(n.id)||0})).sort((a,b)=>b.hits-a.hits).slice(0,25);
 console.log(JSON.stringify({samples:profile.samples?.length,durationMs:(profile.endTime-profile.startTime)/1000,top:summary},null,2));await cmd('Profiler.disable');ws.close();
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
