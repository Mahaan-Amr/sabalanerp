'use strict';
// Test-only native callback barrier. It never replaces SQLite or action bodies.
const fs=require('fs'),path=require('path'),http=require('http');
const {AsyncLocalStorage}=require('async_hooks');
const root=process.env.INQUIRY_COHERENT_ROOT;
if(!/^\/app\/online-runtime-acceptance\/inquiry-coherent-[a-f0-9]{32}$/.test(root||''))throw Error('PRIVATE_ROOT_REQUIRED');
const requests=new AsyncLocalStorage();
function mark(name){const file=path.join(root,name);const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,'observed');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(event,...args){
 if(event==='request'&&args[0].method==='POST'&&args[0].url==='/admin/products/new'&&['lost-ack','queued'].includes(args[0].headers['x-private-inquiry-case'])){
  const queued=args[0].headers['x-private-inquiry-case']==='queued';if(queued)mark('queued-arrived');
  return requests.run({paused:false,queued},()=>emit.call(this,event,...args));
 }
 return emit.call(this,event,...args);
};
const {RuntimeWorkContext}=require(path.join(process.cwd(),'online-runtime/services/runtimeWorkContext.js'));
const run=RuntimeWorkContext.prototype.run;
RuntimeWorkContext.prototype.run=function(body){
 const request=requests.getStore();
 if(request&&!request.queued&&!request.paused&&this.storage.getStore()?.active){
  request.paused=true;
  return run.call(this,async()=>{mark('action-delayed');while(!fs.existsSync(path.join(root,'release-action')))await new Promise(r=>setTimeout(r,5));return body();});
 }
 return run.call(this,body);
};

const {RuntimeTaskAdmission}=require(path.join(process.cwd(),'online-runtime/services/runtimeTaskAdmission.js'));
const acquire=RuntimeTaskAdmission.prototype.acquire;
RuntimeTaskAdmission.prototype.acquire=function(...args){if(requests.getStore()?.queued&&!fs.existsSync(path.join(root,'queued-acquire')))mark('queued-acquire');return acquire.apply(this,args);};
