'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{Writable}=require('node:stream');
const codec=require('./stream-codec.cjs');
const BOUND=null;
const originalInputIterator=process.stdin[Symbol.asyncIterator](),originalInputSource={[Symbol.asyncIterator](){return originalInputIterator;}};
const KEY='/root/sabalan-recovery-private/remote-recovery-private.pem',KEY_SHA='53f04770a79b7683e4575f2be6aa2d1fd7ee01594bb9a707ffcd7cdb0692e38d',SPKI='455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af';
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex'),need=v=>{if(!v)throw new Error('SOURCE_A_INDEPENDENT_STREAM_UNPROVEN');};
const identity=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.uid,s.nlink].map(String).join(':');
async function main(){
 need(BOUND&&Object.keys(BOUND).sort().join(',')==='cipherBytes,cipherSha256,image,plainBytes,plainSha256'&&BOUND.image==='sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3');
 const named=fs.lstatSync(KEY,{bigint:true});need(fs.realpathSync(KEY)===KEY&&named.isFile()&&named.uid===0n&&named.nlink===1n&&(named.mode&0o077n)===0n&&named.size>0n&&named.size<=16384n);
 const fd=fs.openSync(KEY,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let raw;
 try{
  need(identity(fs.fstatSync(fd,{bigint:true}))===identity(named));raw=fs.readFileSync(fd);need(sha(raw)===KEY_SHA&&identity(fs.fstatSync(fd,{bigint:true}))===identity(named));
  const key=crypto.createPrivateKey(raw);need(sha(crypto.createPublicKey(key).export({type:'spki',format:'der'}))===SPKI);
  const discarded=new Writable({write(block,encoding,done){done();}}),result=await codec.decrypt(originalInputSource,discarded,key);
  need(result.gcmAuthenticated===true&&result.cipherBytes===BOUND.cipherBytes&&result.cipherSha256===BOUND.cipherSha256&&result.plainBytes===BOUND.plainBytes&&result.plainSha256===BOUND.plainSha256);
  need(identity(fs.fstatSync(fd,{bigint:true}))===identity(named)&&identity(fs.lstatSync(KEY,{bigint:true}))===identity(named));
  console.log(JSON.stringify({format:'sabalan-source-a-independent-image-stream-gcm/v1',image:BOUND.image,...result,independentPublicKeySha256:SPKI,privateRsaExported:false,plaintextPersisted:false,cipherPersisted:false,productionAdmission:false,healthyPointClaimed:false}));
 }finally{if(raw)raw.fill(0);fs.closeSync(fd);}
}
main().catch(async error=>{
 for(;;){try{if((await originalInputIterator.next()).done)break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
 console.error(JSON.stringify({format:'sabalan-source-a-independent-image-stream-negative/v1',failureType:error.code||error.name,stdinEof:process.stdin.readableEnded}));process.exitCode=1;
});
