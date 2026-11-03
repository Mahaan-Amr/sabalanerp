'use strict';
// Fixed image/keys only. The Python owner binds source hashes and all live
// guards before invoking this original; no argv can choose an image or key.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Writable}=require('node:stream');

const codec=require('./stream-codec.cjs');
const COMPONENT=null;
const IMAGE=COMPONENT&&COMPONENT.image,SPKI='455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af';
const BOUND=null;
const originalInputIterator=process.stdin[Symbol.asyncIterator]();
const originalInputSource={[Symbol.asyncIterator](){return originalInputIterator;}};
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function need(value){if(!value)throw new Error('FIXED_STREAM_BINDING_UNPROVEN');}
function pin(s){return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.uid,s.nlink].map(String).join(':');}
function read(file,max,expected,privateBytes=true){
 const a=fs.lstatSync(file,{bigint:true});need(fs.realpathSync(file)===file&&a.isFile()&&a.uid===0n&&a.nlink===1n&&(a.mode&(privateBytes?0o077n:0o022n))===0n&&a.size>0n&&a.size<=BigInt(max));
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{need(pin(fs.fstatSync(fd,{bigint:true}))===pin(a));const raw=fs.readFileSync(fd);need(pin(fs.fstatSync(fd,{bigint:true}))===pin(a)&&pin(fs.lstatSync(file,{bigint:true}))===pin(a));if(expected)need(sha(raw)===expected);return raw;}
 finally{fs.closeSync(fd);}
}
async function encryptExisting(recipients){
 const result=await codec.encrypt(originalInputSource,process.stdout,recipients);
 need(result.plainBytes===COMPONENT.gzip.bytes&&result.plainSha256===COMPONENT.gzip.sha256);
 return {...result,inputKind:'FIXED_EXISTING_GZIP',imageExported:false,regzipped:false};
}
async function main(){
 need(BOUND&&Object.keys(BOUND).sort().join(',')==='mode,secretRoot');
 const root=BOUND.secretRoot,s=fs.lstatSync(root);need(path.isAbsolute(root)&&fs.realpathSync(root)===root&&s.isDirectory()&&s.uid===0&&(s.mode&0o077)===0);
 const local=read(path.join(root,'local-rollback-key'),16384),publicKey=read(path.join(root,'remote-recovery-public.pem'),16384,undefined,false);
 try{
  need(sha(crypto.createPublicKey(publicKey).export({format:'der',type:'spki'}))===SPKI);
  const passphrase=local.toString('utf8').trim();need(passphrase.length>=32&&!/REPLACE|CHANGE_ME|UNCONFIGURED/.test(passphrase));
  let result;
  if(BOUND.mode==='encrypt-existing')result=await encryptExisting([{keyId:'local-rollback',passphrase},{keyId:'independent-recovery',publicKeyPem:publicKey}]);
  else if(BOUND.mode==='local-decrypt')result=await codec.decrypt(originalInputSource,new Writable({write(_block,_encoding,done){done();}}),passphrase);
  else throw new Error('FIXED_STREAM_MODE');
  process.stderr.write(JSON.stringify({format:'sabalan-source-a-stream-native/v1',mode:BOUND.mode,image:IMAGE,recipientSpkiSha256:SPKI,result})+'\n');
 }finally{local.fill(0);}
}
async function drainOriginalInput(){
 // Keep this same channel alive on early header/unwrap/key failure. The
 // Windows original may still be delivering its pinned file via this FD.
 for(;;){
  try{if((await originalInputIterator.next()).done)return;}
  catch{await new Promise(resolve=>setTimeout(resolve,50));}
 }
}
main().catch(async error=>{
 await drainOriginalInput();
 process.stderr.write(JSON.stringify({format:'sabalan-source-a-stream-native-negative/v1',failureType:error.code||error.name,stdinEof:process.stdin.readableEnded})+'\n');process.exitCode=1;
});
