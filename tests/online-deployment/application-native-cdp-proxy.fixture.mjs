import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {assertNativePrivateIPv4,assertNativePrivateInterface} from './native-private-network.fixture.mjs';

// Diagnostic transport only. The actual candidate controller owns this
// original process, Chrome Popen and private configuration. This module has
// no host signer, runtime grant, database client or Chrome launcher.
assert.equal(process.platform,'linux');assert.equal(process.argv.length,3);
const file=process.argv[2];assert.ok(path.isAbsolute(file));assert.equal(fs.realpathSync(file),file);
const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
let config;
try {
  const before=fs.fstatSync(descriptor,{bigint:true});
  assert.ok(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid())
    &&(before.mode&0o777n)===0o600n&&before.size>0n&&before.size<=4096n);
  const bytes=Buffer.alloc(Number(before.size));let offset=0;
  while(offset<bytes.length){const count=fs.readSync(descriptor,bytes,offset,bytes.length-offset,null);assert.ok(count>0);offset+=count;}
  assert.equal(fs.readSync(descriptor,Buffer.alloc(1),0,1,null),0);
  for(const actual of [fs.fstatSync(descriptor,{bigint:true}),fs.lstatSync(file,{bigint:true})])
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'])assert.equal(actual[key],before[key]);
  config=JSON.parse(bytes);
}finally{fs.closeSync(descriptor);}
assert.deepEqual(Object.keys(config).sort(),['bindHost','browserId','chromePort','format','mainHost','token'].sort());
assert.equal(config.format,'sabalan-native-private-cdp-proxy/v1');
assertNativePrivateInterface(config.bindHost);assertNativePrivateIPv4(config.mainHost);assert.notEqual(config.mainHost,config.bindHost);
assert.ok(Number.isInteger(config.chromePort)&&config.chromePort>=1024&&config.chromePort<=65535);
assert.match(config.browserId,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
assert.match(config.token,/^[a-f0-9]{64}$/);
const targetPath='/devtools/browser/'+config.browserId,requestPath='/'+config.token+targetPath;
let draining=false,closed=false,failed=false,stdin='';
const active=new Set();
const server=http.createServer({maxHeaderSize:8192},(_request,response)=>{response.writeHead(404,{'connection':'close'});response.end();});
server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=1000;
function finishIfClosed(){if(draining&&closed&&active.size===0){console.log(JSON.stringify({event:'closed',originalProxyPid:process.pid,activeConnections:0}));process.stdin.pause();process.exitCode=failed?1:0;}}
function drain(error){
  if(error){failed=true;console.error('ORIGINAL_PRIVATE_CDP_PROXY_CLOSURE_UNPROVEN');}
  if(!draining){draining=true;server.close(()=>{closed=true;finishIfClosed();});}
  finishIfClosed();
}
server.on('upgrade',(request,client,head)=>{
  if(draining||active.size>=1||client.remoteAddress!==config.mainHost||request.method!=='GET'||request.url!==requestPath
    ||request.headers.upgrade?.toLowerCase()!=='websocket'||request.headers['sec-websocket-version']!=='13'
    ||typeof request.headers['sec-websocket-key']!=='string'||!/^\S{24}$/.test(request.headers['sec-websocket-key'])){
    client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
  }
  const operation={clientClosed:false,upstreamClosed:true};active.add(operation);
  let upstream;
  const complete=()=>{if(operation.clientClosed&&operation.upstreamClosed){active.delete(operation);finishIfClosed();}};
  client.once('close',()=>{operation.clientClosed=true;upstream?.destroy();outgoing.destroy();complete();});
  client.on('error',()=>client.destroy());
  const outgoing=http.request({host:'127.0.0.1',port:config.chromePort,path:targetPath,method:'GET',
    headers:{host:'127.0.0.1:'+config.chromePort,connection:'Upgrade',upgrade:'websocket',
      'sec-websocket-key':request.headers['sec-websocket-key'],'sec-websocket-version':'13'},maxHeaderSize:8192});
  outgoing.on('socket',socket=>{
    upstream=socket;operation.upstreamClosed=false;
    socket.once('close',()=>{operation.upstreamClosed=true;client.destroy();complete();});
  });
  outgoing.once('upgrade',(response,socket,upstreamHead)=>{
    if(client.destroyed){socket.destroy();return;}
    const headers=[];for(let index=0;index<response.rawHeaders.length;index+=2)headers.push(response.rawHeaders[index]+': '+response.rawHeaders[index+1]);
    client.write('HTTP/1.1 101 Switching Protocols\r\n'+headers.join('\r\n')+'\r\n\r\n');
    if(upstreamHead.length)client.write(upstreamHead);if(head.length)socket.write(head);
    client.pipe(socket);socket.pipe(client);
  });
  outgoing.once('response',response=>{response.resume();client.destroy();outgoing.destroy();});
  outgoing.once('error',()=>{client.destroy();complete();});outgoing.end();
});
server.on('error',()=>drain(true));
process.stdin.on('data',chunk=>{
  stdin+=chunk.toString('utf8');
  if(stdin.length>32||stdin!=='finish\n'&&!('finish\n'.startsWith(stdin))){drain(true);return;}
  if(stdin==='finish\n')drain(false);
});
process.stdin.once('end',()=>{if(stdin!=='finish\n')drain(true);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,config.bindHost,resolve);});
const address=server.address();assert.ok(address&&typeof address!=='string');assert.equal(address.address,config.bindHost);
console.log(JSON.stringify({event:'ready',host:config.bindHost,port:address.port,originalProxyPid:process.pid,
  browserWSEndpoint:'ws://'+config.bindHost+':'+address.port+requestPath}));
