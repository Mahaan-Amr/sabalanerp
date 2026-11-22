import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {assertNativePrivateIPv4} from './native-private-network.fixture.mjs';

// Real candidate loopback, not a DNS/trustworthiness override. The original
// candidate controller owns this child and exact remote-network enrollment.
assert.equal(process.platform,'linux');assert.equal(process.argv.length,3);
const file=process.argv[2];assert.ok(path.isAbsolute(file));assert.equal(fs.realpathSync(file),file);
const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
let config;
try{
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
assert.deepEqual(Object.keys(config).sort(),['format','mainHost']);
assert.equal(config.format,'sabalan-native-browser-loopback-ingress/v1');assertNativePrivateIPv4(config.mainHost);
let draining=false,closed=false,failed=false,stdin='';const active=new Set();
function finished(){if(draining&&closed&&active.size===0){console.log(JSON.stringify({event:'closed',originalIngressPid:process.pid,activeConnections:0}));process.stdin.pause();process.exitCode=failed?1:0;}}
const server=net.createServer(client=>{
  if(draining||active.size>=128||client.remoteAddress!=='127.0.0.1'){client.destroy();return;}
  const state={clientClosed:false,targetClosed:false};active.add(state);
  const target=net.connect({host:config.mainHost,port:3199});
  const settled=()=>{if(state.clientClosed&&state.targetClosed){active.delete(state);finished();}};
  client.once('close',()=>{state.clientClosed=true;target.destroy();settled();});
  target.once('close',()=>{state.targetClosed=true;client.destroy();settled();});
  client.on('error',()=>client.destroy());target.on('error',()=>target.destroy());
  // Stream backpressure bounds memory; HTTP, RSC and WebSocket bytes and Host
  // are preserved. No parsing, retries, delivery ACK or business completion.
  client.pipe(target);target.pipe(client);
});
function drain(error){
  if(error){failed=true;console.error('ORIGINAL_BROWSER_INGRESS_CLOSURE_UNPROVEN');}
  if(!draining){draining=true;server.close(()=>{closed=true;finished();});}finished();
}
server.on('error',()=>drain(true));
process.stdin.on('data',chunk=>{
  stdin+=chunk.toString('utf8');
  if(stdin.length>32||stdin!=='finish\n'&&!('finish\n'.startsWith(stdin))){drain(true);return;}
  if(stdin==='finish\n')drain(false);
});
process.stdin.once('end',()=>{if(stdin!=='finish\n')drain(true);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3199,'127.0.0.1',resolve);});
console.log(JSON.stringify({event:'ready',originalIngressPid:process.pid,host:'127.0.0.1',port:3199,
  targetHost:config.mainHost,targetPort:3199,browserOrigin:'http://localhost:3199'}));
