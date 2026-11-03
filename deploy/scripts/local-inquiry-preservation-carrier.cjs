'use strict';
// Bounded LOCAL maintenance transport. Never imports Next, Prisma or app code.
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const phase='CARRIER_READY_NOT_SERVING';
const managed=['BACKEND_ONLINE_SCOPE_FILE','BACKEND_ONLINE_SCOPE_SHA256','INQUIRY_NATIVE_AUTHORITY_FILE',
  'INQUIRY_NATIVE_CLAIM_SHA256','INQUIRY_RUNTIME_GENERATION','BACKEND_RUNTIME_ROLE'];
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');

function conservation(root='/app',database='/data/inquiry.db'){
  const raw=fs.readFileSync(root+'/local-inquiry-original.json');
  const value=JSON.parse(execFileSync('/usr/bin/python3',['-I','-B',root+'/local-inquiry-preservation.py',
    database,root+'/local-inquiry-original.json',root+'/inquiry-baseline.json'],
    {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],maxBuffer:1000000}));
  if(value.phase!==phase||value.canonicalDatabaseAdmitted!==false||value.applicationHealthy!==false)throw Error('CONSERVATION_UNPROVEN');
  return hash(raw);
}

function serve({port=3001,host='0.0.0.0',identity,observe=()=>{}}){
  if(managed.some(key=>Object.hasOwn(process.env,key)))throw Error('LOCAL_CARRIER_ONLINE_REFUSED');
  if(!/^[a-f0-9]{64}$/.test(identity))throw Error('CARRIER_IDENTITY_INVALID');
  observe();
  const server=http.createServer((request,response)=>{
    if(request.method==='GET'&&request.url==='/_carrier/conservation'){
      try{observe();response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
        response.end(JSON.stringify({phase,identity,maintenanceReady:true,applicationReady:false,runtimeAccepted:false,
          applicationHealthy:false,canonicalDatabaseAdmitted:false}));}
      catch{response.writeHead(503);response.end('CARRIER_CONSERVATION_UNPROVEN');}
    }else{response.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Retry-After':'60'});
      response.end('استعلام موقتاً برای بررسی محلی در دسترس نیست.');}
  });
  server.listen(port,host);
  return server;
}

async function health(identity,port=3001){
  const result=await fetch('http://127.0.0.1:'+port+'/_carrier/conservation',{signal:AbortSignal.timeout(10000)});
  const value=await result.json();
  if(result.status!==503||value.phase!==phase||value.identity!==identity
    ||value.maintenanceReady!==true||value.applicationReady!==false||value.runtimeAccepted!==false
    ||value.applicationHealthy!==false||value.canonicalDatabaseAdmitted!==false)throw Error('CARRIER_NOT_READY');
}
module.exports={serve,health,conservation};
if(require.main===module){
  try{
    const identity=conservation();
    if(process.argv[2]==='health')health(identity).catch(()=>{console.error('LOCAL_CARRIER_NOT_READY');process.exitCode=1;});
    else if(process.argv.length===2){
      const server=serve({identity,observe:()=>{if(conservation()!==identity)throw Error('CONSERVATION_CHANGED');}});
      for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
    }else throw Error('LOCAL_CARRIER_ARGUMENTS_INVALID');
  }catch{console.error('LOCAL_CARRIER_REFUSED');process.exitCode=1;}
}
